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
    static func project(
        base: SessionSnapshot,
        logged: Set<String>,
        edited: [EditedValueKey: Double]
    ) -> SessionSnapshot {
        let exercises = base.exercises.map { ex -> SessionSnapshotExercise in
            let sets = ex.sets.map { s -> SessionSnapshotSet in
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
                    notes: s.notes,
                    setKind: s.setKind,
                    isLogged: logged.contains(s.setId)
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

    /// Q6=a — coalesce mutations into at most one push per 15s.
    private let throttle: TimeInterval = 15
    /// How often the loop wakes to re-check (dirty && elapsed ≥ throttle).
    private let pollNanos: UInt64 = 3_000_000_000

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
            .sink { [weak self] _ in self?.dirty = true }
            .store(in: &cancellables)
        interaction.$editedValues
            .dropFirst()
            .sink { [weak self] _ in self?.dirty = true }
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
            edited: interaction.editedValues
        )
    }

    private func shouldEmitNow() -> Bool {
        guard let last = lastEmit else { return true }
        return Date().timeIntervalSince(last) >= throttle
    }

    private func emit(force: Bool) {
        guard let base, let interaction, let coordinator else { return }
        if !force && !dirty { return }
        let live = LiveMirror.project(
            base: base,
            logged: interaction.loggedSetIds,
            edited: interaction.editedValues
        )
        coordinator.updateLiveMirror(live)
        dirty = false
        lastEmit = Date()
    }
}
