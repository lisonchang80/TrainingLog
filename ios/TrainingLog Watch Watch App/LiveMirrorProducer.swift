//
//  LiveMirrorProducer.swift
//  TrainingLog Watch
//
//  Slice 13d D29 — Watch live-mirror producer.
//  Per ADR-0019 § Slice 13d NEW-Q50 Q6=a (frozen 2026-05-29 evening):
//  "applicationContext throttled 15s + dirty flag + end-session TUI
//  final batch — D19 6-kind reducer 退化為 replaceLiveMirror snapshot
//  replace".
//
//  Role:
//    During a live SetLoggerView session the Watch is the source of
//    truth. This producer projects the immutable start `SessionSnapshot`
//    (built by `PickerViewModel.buildSnapshotFromFatTree`) over the live
//    `SessionInteractionState` overlay — logged ✓ rows → `isLogged`,
//    committed cell edits → `weight` / `reps` — and pushes the merged
//    snapshot to iPhone via `WatchConnectivityCoordinator.updateLiveMirror`
//    (which calls `WCSession.updateApplicationContext`). The iPhone
//    `addAppContextListener` → `onLiveMirror` → `replaceLiveMirror` adopts
//    it (snapshot-replace, latest-wins — no diff/reduce/LWW).
//
//  Throttle (Q6=a):
//    - Initial push on mount (force) — iPhone gets the full tree from
//      second zero, before any set is logged. This is what makes the D32
//      receiver actually live (it was dead until D29 produced a payload).
//    - Coalesce mutations into at most one push per 15s (`throttle`),
//      checked by a poll loop (`pollNanos`).
//    - `emitFinal()` forces an immediate push — call it ONLY on the
//      [完成] keep-path so the iPhone mirror has the last sub-15s edits
//      before end-session reconcile runs. NEVER on discard/abort: a late
//      mirror would re-create a row the iPhone is hard-deleting.
//
//  Plist / null caveat:
//    `updateApplicationContext` requires a plist-serialisable dict, and
//    `NSNull` is not a plist type. The coordinator encodes via
//    `JSONEncoder`, which OMITS nil optionals — so per-set nullable fields
//    (weight/reps/rpe/rest_sec/notes) travel ABSENT, not null. The iPhone
//    `parseLiveMirrorSnapshot` normalises absent → null for those fields
//    (see watchLiveMirrorReceiver.ts D29 note). Both sides agreed.
//
//  Verification status:
//    Swift compiles (xcodebuild Watch target). Runtime behaviour
//    (appContext delivery, throttle timing, null-omission round-trip) is
//    real-device-smoke-gated — deferred per the D29 hand-off.
//

import Foundation
import Combine

/// Pure projection: fold the live interaction overlay onto the immutable
/// start snapshot to produce the CURRENT session state. No I/O, no clock —
/// deterministic so the merge can be reasoned about in isolation.
enum LiveMirror {
    /// Merge one exercise's base snapshot sets with the Watch overlay —
    /// drop deleted, add added — and return them in WATCH DISPLAY order
    /// (by `displayRank`: base = its ordinal, added = its fractional rank).
    /// Shared by the card renderer (`ExerciseCard.rowGroups`) and the
    /// projection below so both agree on membership + order.
    static func mergeSets(
        base: [SessionSnapshotSet],
        deletedSets: Set<String>,
        addedSets: [AddedSet],
        kindOverrides: [String: String],
        rankOverrides: [String: Double],
        sessionExerciseId: String
    ) -> [SessionSnapshotSet] {
        let visibleBase = base.filter { !deletedSets.contains($0.setId) }
        let addedHere = addedSets.filter { $0.sessionExerciseId == sessionExerciseId }
        // Sort key = reorder override if present, else the natural rank
        // (base = ordinal, added = displayRank). This is the entire Watch-
        // side reorder; the wire ordinal is re-derived in `project`.
        var ranked: [(set: SessionSnapshotSet, rank: Double)] =
            visibleBase.map { ($0, rankOverrides[$0.setId] ?? Double($0.ordinal)) }
        ranked += addedHere.map { ($0.asSnapshotSet(), rankOverrides[$0.id] ?? $0.displayRank) }
        return ranked
            // STABLE total order — break rank ties on `(ordinal, setId)` so two
            // rows sharing a `rank` value can NEVER permute non-deterministically
            // across re-renders/ticks. `Swift.sorted` is NOT guaranteed stable,
            // and a non-deterministic permutation of equal-rank rows is what lets
            // a dropset follower drift away from its head (`SetRowGroup.group`
            // folds by array-adjacency → cluster split) and a superset side's
            // index-paired working-# jump (the「1,3,3,4」signature). When ranks are
            // already distinct (the common case) this is identical to `rank <`.
            .sorted {
                if $0.rank != $1.rank { return $0.rank < $1.rank }
                if $0.set.ordinal != $1.set.ordinal { return $0.set.ordinal < $1.set.ordinal }
                return $0.set.setId < $1.set.setId
            }
            // Stamp the effective sort `rank` onto each set as `displayRank`
            // so the iPhone can render the Watch's display ORDER (#1/#2). The
            // wire `ordinal` stays glued to set identity (reconcile key); this
            // is the separate, fractional sort key that carries reorder /
            // mid-insert. The iPhone sorts by `display_rank ?? ordering`.
            .map { applyKindOverride($0.set.withDisplayRank($0.rank), kindOverrides) }
    }

    /// Apply a per-set `set_kind` override (# type cycling). Returns the set
    /// unchanged when no (or a no-op) override applies. Shared by the card
    /// renderer + the projection so both agree on the effective kind that
    /// drives numbering / cluster folding / progress bar.
    private static func applyKindOverride(
        _ s: SessionSnapshotSet,
        _ overrides: [String: String]
    ) -> SessionSnapshotSet {
        guard let kind = overrides[s.setId], kind != s.setKind else { return s }
        return SessionSnapshotSet(
            setId: s.setId,
            ordinal: s.ordinal,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            restSec: s.restSec,
            notes: s.notes,
            setKind: kind,
            isLogged: s.isLogged,
            parentSetId: s.parentSetId,
            displayRank: s.displayRank
        )
    }

    static func project(
        base: SessionSnapshot,
        logged: Set<String>,
        edited: [EditedValueKey: Double],
        deletedExercises: Set<String>,
        deletedSets: Set<String>,
        addedSets: [AddedSet],
        kindOverrides: [String: String],
        rankOverrides: [String: Double],
        // Phase C-core reverse-sync overlay (2026-06-26). Defaults keep the
        // forward-only behaviour for any caller that doesn't supply them.
        addedExercises: [SessionSnapshotExercise] = [],
        notesOverride: [String: String] = [:],
        exerciseOrderOverride: [String] = []
    ) -> SessionSnapshot {
        // Phase F: drop exercises / sets the user deleted on the Watch and
        // MERGE in the sets they added. The projection is what reaches the
        // iPhone — a deleted row absent here is what the END-session
        // reconcile purges (E2); an added row present here (with an ordinal
        // past every canonical one) is INSERTed. Surviving base sets keep
        // their ORIGINAL `ordinal` (filter, never re-index): the iPhone
        // matches sets by `(session_exercise_id, ordinal)` value, so
        // preserving ordinals is what makes a mid-list delete purge the
        // right row instead of shifting data onto a neighbour.
        //
        // Phase C-core: an iPhone-added exercise (`addedExercises`) is unioned
        // in like an added set; `exerciseOrderOverride` reorders the union
        // (mirrors the iPhone display order); a deleted base exercise is still
        // dropped. Surviving exercises with a non-nil note pushed from iPhone
        // echo it back (notesOverride wins over the stale immutable base note),
        // so the forward round-trip can't clobber an iPhone note edit.
        let unionExercises = base.exercises + addedExercises
        let orderedExercises: [SessionSnapshotExercise]
        if exerciseOrderOverride.isEmpty {
            orderedExercises = unionExercises
        } else {
            let rank = Dictionary(
                exerciseOrderOverride.enumerated().map { ($1, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            orderedExercises = unionExercises.sorted {
                (rank[$0.sessionExerciseId] ?? Int.max) < (rank[$1.sessionExerciseId] ?? Int.max)
            }
        }
        let exercises = orderedExercises
            .filter { !deletedExercises.contains($0.sessionExerciseId) }
            .map { ex -> SessionSnapshotExercise in
            let merged = mergeSets(
                base: ex.sets,
                deletedSets: deletedSets,
                addedSets: addedSets,
                kindOverrides: kindOverrides,
                rankOverrides: rankOverrides,
                sessionExerciseId: ex.sessionExerciseId
            )
            // Each set carries its OWN stable `ordinal` on the wire — NOT a
            // display-position re-stamp. The iPhone reconcile matches base
            // sets by (session_exercise_id, ordinal) VALUE, so the ordinal
            // MUST stay glued to set identity. The old `sortedOrdinals[i]`
            // by-display-position re-stamp permuted it to encode display order
            // and collided a mid-list added follower's ordinal with an
            // existing base row → wrote the follower onto the wrong row, then
            // lost it (grill-with-docs 2026-06-01 Q1=B; ADR-0019; overnight
            // Agent C HIGH). `merged` (display order) is kept ONLY as the
            // ARRAY order so a dropset HEAD precedes its followers (the
            // iPhone setIdMap resolves a follower's parent from the head seen
            // earlier this pass). Consequence (accepted, Q2): a Watch reorder
            // / mid-insert does NOT propagate to the iPhone — the set keeps
            // its original ordinal, content intact; the iPhone folds a dropset
            // by parent_set_id regardless of ordinal. AddedSet ordinals are
            // dense-unique (max(all)+1, never reused) so no two sets collide.
            let sets = merged.map { s -> SessionSnapshotSet in
                // Edited weight overrides the planned value; absent → keep
                // the snapshot's planned weight (may itself be nil).
                let weight = edited[EditedValueKey(setId: s.setId, field: .weight)] ?? s.weight
                // `editedValues` stores reps as Double (keypad/crown buffer
                // is numeric); SessionSnapshotSet.reps is Int? → round.
                let reps: Int?
                if let editedReps = edited[EditedValueKey(setId: s.setId, field: .reps)] {
                    reps = Int(editedReps.rounded())
                } else {
                    reps = s.reps
                }
                return SessionSnapshotSet(
                    setId: s.setId,
                    ordinal: s.ordinal,
                    weight: weight,
                    reps: reps,
                    rpe: s.rpe,
                    restSec: s.restSec,
                    // Phase C-core: echo the iPhone-pushed note (display-only on
                    // the Watch) so the forward round-trip is idempotent and
                    // can't clobber an iPhone note edit with the stale base note.
                    notes: notesOverride[s.setId] ?? s.notes,
                    setKind: s.setKind,
                    isLogged: logged.contains(s.setId),
                    parentSetId: s.parentSetId,
                    // Preserve the rank stamped by `mergeSets` so it travels on
                    // the wire (#1/#2 — the iPhone renders by display_rank).
                    displayRank: s.displayRank
                )
            }
            return SessionSnapshotExercise(
                sessionExerciseId: ex.sessionExerciseId,
                exerciseId: ex.exerciseId,
                exerciseName: ex.exerciseName,
                ordering: ex.ordering,
                plannedSets: ex.plannedSets,
                sets: sets,
                // D15 superset card — preserve cluster linkage on the reverse
                // mirror so it round-trips for forward-compat (the iPhone
                // reconcile currently preserves the DB value either way).
                parentId: ex.parentId,
                reusableSupersetId: ex.reusableSupersetId
            )
        }
        return SessionSnapshot(
            sessionId: base.sessionId,
            title: base.title,
            subtitle: base.subtitle,
            startedAt: base.startedAt,
            exercises: exercises
        )
    }
}

@MainActor
final class LiveMirrorProducer: ObservableObject {

    private weak var coordinator: WatchConnectivityCoordinator?
    private weak var interaction: SessionInteractionState?
    private var base: SessionSnapshot?

    /// Set whenever the interaction overlay mutates; cleared on emit.
    /// Starts true so `run()`'s initial emit force-pushes the start tree.
    private var dirty = true
    private var lastEmit: Date?
    private var cancellables = Set<AnyCancellable>()

    /// Phase C-core reverse-sync gate (2026-06-26). When a remote (iPhone)
    /// snapshot is being applied to the overlay, the resulting `@Published`
    /// mutations would re-fire the sinks below → `markDirty` → a forward
    /// `emit` that bounces the just-applied state straight back to the iPhone.
    /// `markDirty` + `emit` short-circuit while this is set. `ReverseSyncApply`
    /// wraps the whole apply in begin/end. Because `markDirty` short-circuits
    /// at its TOP (before scheduling its deferred async emit), no stray emit is
    /// queued during the apply, so a synchronous `endApplyingRemote()` in the
    /// caller's `defer` is sufficient — no extra runloop hop needed.
    private var applyingRemote = false

    /// Phase C-core reverse-sync apply engine, created in `configure()` and
    /// OWNED (strong) here so its lifetime == the producer's (== the
    /// SetLoggerView `@StateObject`). The coordinator holds only a `weak` ref,
    /// so on unmount this producer deallocs → the engine deallocs → the
    /// coordinator's `reverseSyncApply` nils out. `ReverseSyncApply` holds a
    /// `weak` back-ref to the producer, so no retain cycle.
    private(set) var reverseSyncApply: ReverseSyncApply?

    /// Monotonic high-water for the per-emit `rev` stamp. Seeded from the
    /// wall clock on each emit but forced strictly increasing (see `nextRev`).
    private var revCounter: Int64 = 0

    /// Coalesce window — at most one push per 0.5s. Was 15s (NEW-Q50 Q6=a);
    /// lowered + paired with immediate emit-on-mutation (`markDirty`) so the
    /// iPhone live mirror reflects a Watch edit in well under 1s (user request
    /// 2026-06-01). A spaced-out edit pushes instantly; a burst coalesces to
    /// ≤2 pushes/sec. Safe for WC applicationContext (latest-state, coalesced).
    private let throttle: TimeInterval = 0.5
    /// How often the loop wakes to re-check (dirty && elapsed ≥ throttle).
    private let pollNanos: UInt64 = 500_000_000

    /// Bind the producer to this session's base snapshot + live overlay +
    /// outbound coordinator, and start watching the overlay for mutations.
    /// Call once before `run()`.
    func configure(
        base: SessionSnapshot,
        interaction: SessionInteractionState,
        coordinator: WatchConnectivityCoordinator?
    ) {
        self.base = base
        self.interaction = interaction
        self.coordinator = coordinator
        // Phase C-core — build the reverse-sync apply engine bound to the same
        // base + overlay. SetLoggerView assigns it into `coordinator.
        // reverseSyncApply` (weak) right after this call.
        self.reverseSyncApply = ReverseSyncApply(
            base: base,
            interaction: interaction,
            producer: self
        )
        cancellables.removeAll()
        // dropFirst() — @Published replays its current value on subscribe;
        // skip that so only genuine post-configure mutations mark dirty.
        interaction.$loggedSetIds
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        interaction.$editedValues
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        // Phase F: a delete must also mark the mirror dirty so the shrunk
        // tree is pushed (within the 15s window, and definitely on the
        // [完成] `emitFinal()` force-push that feeds end-session reconcile).
        interaction.$deletedExerciseIds
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        interaction.$deletedSetIds
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        interaction.$addedSets
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        // Phase F: a # type-cycle changes set_kind (+ may add/remove sub-
        // sets) — mark dirty so the new tree reaches iPhone (15s tick or the
        // [完成] `emitFinal()` force-push that feeds end-session reconcile).
        interaction.$setKindOverrides
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
        // Phase F: a reorder changes display order → re-derived wire ordinals
        // → mark dirty so the reordered tree reaches iPhone.
        interaction.$setRankOverrides
            .dropFirst()
            .sink { [weak self] _ in self?.markDirty() }
            .store(in: &cancellables)
    }

    /// Drive from `.task { await producer.run() }` so the loop inherits the
    /// view's lifetime and auto-cancels on teardown.
    func run() async {
        emit(force: true) // initial full-tree push
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: pollNanos)
            if Task.isCancelled { break }
            if dirty, shouldEmitNow() {
                emit(force: false)
            }
        }
    }

    /// Force an immediate push. [完成] keep-path ONLY (see file header).
    func emitFinal() {
        emit(force: true)
    }

    /// The CURRENT merged snapshot (start tree folded over the live
    /// overlay), or nil if not yet configured. Used by the end-session
    /// envelope (E2 — ADR-0019 § "WC Ship-Blocker Fixes") to carry the
    /// final authoritative tree to iPhone for membership reconcile. Same
    /// projection `emit` pushes — read-only, no state change.
    func currentSnapshot() -> SessionSnapshot? {
        guard let base, let interaction else { return nil }
        return LiveMirror.project(
            base: base,
            logged: interaction.loggedSetIds,
            edited: interaction.editedValues,
            deletedExercises: interaction.deletedExerciseIds,
            deletedSets: interaction.deletedSetIds,
            addedSets: interaction.addedSets,
            kindOverrides: interaction.setKindOverrides,
            rankOverrides: interaction.setRankOverrides,
            addedExercises: interaction.addedExercises,
            notesOverride: interaction.notesOverride,
            exerciseOrderOverride: interaction.exerciseOrderOverride
        )
    }

    /// A mutation happened. Push IMMEDIATELY when the coalesce window has
    /// elapsed (so a spaced-out edit reaches the iPhone in well under 1s);
    /// otherwise just flag dirty and let the poll loop emit the latest once
    /// `throttle` passes (bursts coalesce to ≤2 pushes/sec).
    private func markDirty() {
        // Phase C-core gate — suppress the bounce-back while applying a remote
        // snapshot. Short-circuit BEFORE setting `dirty` / scheduling the async
        // emit so nothing is queued for after the apply.
        if applyingRemote { return }
        dirty = true
        guard shouldEmitNow() else { return }
        // `@Published` publishes in `willSet` — the mutated stored property is
        // NOT assigned yet when this sink fires. Emitting synchronously here
        // would project the PRE-mutation overlay, so the iPhone mirrors one
        // step behind (tap ✓ on set N → iPhone shows set N-1's state). Defer
        // the emit one main-runloop turn so `willSet`→`didSet` completes first
        // and `project()` reads the committed post-mutation state. Still well
        // under the <1s live-mirror budget (next-tick, sub-millisecond).
        DispatchQueue.main.async { [weak self] in
            guard let self, self.dirty else { return }
            self.emit(force: false)
        }
    }

    private func shouldEmitNow() -> Bool {
        guard let last = lastEmit else { return true }
        return Date().timeIntervalSince(last) >= throttle
    }

    /// Strictly-monotonic per-emit revision. Seeded from ms-since-epoch so it
    /// survives a mid-session producer restart (the iPhone's per-session
    /// high-water mark stays behind a wall-clock value), but forced
    /// `> previous` so two emits in the same millisecond still differ.
    private func nextRev() -> Int64 {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        revCounter = max(nowMs, revCounter + 1)
        return revCounter
    }

    // MARK: - Phase C-core reverse-sync gate (2026-06-26)

    /// Open the gate before applying a remote (iPhone) snapshot to the overlay.
    func beginApplyingRemote() { applyingRemote = true }
    /// Close the gate after the apply. Safe to call synchronously in a `defer`
    /// (see `applyingRemote` doc — `markDirty` short-circuits at its top).
    func endApplyingRemote() { applyingRemote = false }

    private func emit(force: Bool) {
        // Phase C-core gate — never push out the overlay we're mid-applying.
        if applyingRemote { return }
        guard let base, let interaction, let coordinator else { return }
        if !force && !dirty { return }
        let projected = LiveMirror.project(
            base: base,
            logged: interaction.loggedSetIds,
            edited: interaction.editedValues,
            deletedExercises: interaction.deletedExerciseIds,
            deletedSets: interaction.deletedSetIds,
            addedSets: interaction.addedSets,
            kindOverrides: interaction.setKindOverrides,
            rankOverrides: interaction.setRankOverrides,
            addedExercises: interaction.addedExercises,
            notesOverride: interaction.notesOverride,
            exerciseOrderOverride: interaction.exerciseOrderOverride
        )
        // Stamp a monotonic rev + originator so the iPhone receiver can drop
        // out-of-order / stale redeliveries (the dual-fired sendMessage +
        // applicationContext channels both land in the rev-guarded onLiveMirror).
        let live = SessionSnapshot(
            sessionId: projected.sessionId,
            title: projected.title,
            subtitle: projected.subtitle,
            startedAt: projected.startedAt,
            exercises: projected.exercises,
            rev: nextRev(),
            originator: "watch"
        )
        coordinator.updateLiveMirror(live)
        dirty = false
        lastEmit = Date()
    }
}

/// Phase C-core (2026-06-26) — the INVERSE of `LiveMirrorProducer`: applies an
/// inbound iPhone snapshot to the Watch overlay, wrapping the whole apply in
/// the producer's in-flight gate (`begin/endApplyingRemote`) so the resulting
/// `@Published` overlay mutations don't bounce straight back out to the iPhone.
/// Injected into `WatchConnectivityCoordinator.reverseSyncApply` by
/// `SetLoggerView`'s `.task` (mirror of how the producer is configured), so it
/// holds the same immutable `base` snapshot + live `interaction` overlay.
@MainActor
final class ReverseSyncApply {
    private let base: SessionSnapshot
    private weak var interaction: SessionInteractionState?
    private weak var producer: LiveMirrorProducer?

    init(
        base: SessionSnapshot,
        interaction: SessionInteractionState,
        producer: LiveMirrorProducer
    ) {
        self.base = base
        self.interaction = interaction
        self.producer = producer
    }

    /// Fold an iPhone-originated snapshot into the overlay. Gate open → apply →
    /// gate closed (synchronous `defer`; safe because `markDirty` short-circuits
    /// at its top so nothing is queued during the apply — see `applyingRemote`).
    func applyRemote(_ snap: SessionSnapshot) {
        producer?.beginApplyingRemote()
        defer { producer?.endApplyingRemote() }
        interaction?.applyRemoteSnapshot(snap, base: base)
    }
}
