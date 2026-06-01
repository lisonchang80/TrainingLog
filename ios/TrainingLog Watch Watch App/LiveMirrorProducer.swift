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
            .sorted { $0.rank < $1.rank }
            .map { applyKindOverride($0.set, kindOverrides) }
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
            parentSetId: s.parentSetId
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
        rankOverrides: [String: Double]
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
        let exercises = base.exercises
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
            // Reorder / mid-insert round-trip: the WIRE ordinal of each set =
            // the present ordinal pool SORTED, laid back out in DISPLAY order.
            // Identity for the un-reordered case; for a reorder or a mid-list
            // +1 it makes the iPhone value-match render the Watch's order. The
            // pool's VALUE SET is unchanged, so the reconcile's delete-purge
            // (absent ordinal) + add-INSERT (max+1) semantics stay intact —
            // only the ordinal↔content assignment permutes.
            let sortedOrdinals = merged.map { $0.ordinal }.sorted()
            let sets = merged.enumerated().map { (i, s) -> SessionSnapshotSet in
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
                    ordinal: sortedOrdinals[i],
                    weight: weight,
                    reps: reps,
                    rpe: s.rpe,
                    restSec: s.restSec,
                    notes: s.notes,
                    setKind: s.setKind,
                    isLogged: logged.contains(s.setId),
                    parentSetId: s.parentSetId
                )
            }
            return SessionSnapshotExercise(
                sessionExerciseId: ex.sessionExerciseId,
                exerciseId: ex.exerciseId,
                exerciseName: ex.exerciseName,
                ordering: ex.ordering,
                plannedSets: ex.plannedSets,
                sets: sets
            )
        }
        return SessionSnapshot(
            sessionId: base.sessionId,
            title: base.title,
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
            rankOverrides: interaction.setRankOverrides
        )
    }

    /// A mutation happened. Push IMMEDIATELY when the coalesce window has
    /// elapsed (so a spaced-out edit reaches the iPhone in well under 1s);
    /// otherwise just flag dirty and let the poll loop emit the latest once
    /// `throttle` passes (bursts coalesce to ≤2 pushes/sec).
    private func markDirty() {
        dirty = true
        if shouldEmitNow() { emit(force: false) }
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

    private func emit(force: Bool) {
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
            rankOverrides: interaction.setRankOverrides
        )
        // Stamp a monotonic rev + originator so the iPhone receiver can drop
        // out-of-order / stale redeliveries (the dual-fired sendMessage +
        // applicationContext channels both land in the rev-guarded onLiveMirror).
        let live = SessionSnapshot(
            sessionId: projected.sessionId,
            title: projected.title,
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
