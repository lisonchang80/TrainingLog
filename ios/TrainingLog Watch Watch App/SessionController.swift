//
//  SessionController.swift
//  TrainingLog Watch
//
//  Slice 13d D5 — Watch HK lifecycle state machine.
//  Per ADR-0019 § Slice 13d Amendment Q28 Branch C
//  (D0 spike A confirmed 2026-05-27 19:51 真機 PASS).
//
//  Flow (trigger-only sampling):
//    1. start() — ensureAuthorized → configure HKWorkoutSession
//       + HKLiveWorkoutBuilder + HKLiveWorkoutDataSource (traditional
//       strength training + indoor) → startActivity + beginCollection.
//       HR sampling begins; samples persist to HK store independent
//       of the builder.
//    2. end() / cancel() — stopActivity + builder.discardWorkout().
//       Per Q28 Branch C: discardWorkout writes NO HKWorkout entry.
//       iPhone 13c saveTrainingLogWorkout is the only HKWorkout writer
//       (see ADR-0019 line 1120 + spike A 9-phase 56.3s run).
//
//  Delegate adoption (D5 scope decision 2026-05-27):
//    Conforms to HKWorkoutSessionDelegate to sync OS-side state
//    transitions back into the controller's @Published state. Watch
//    can independently transition session.state (e.g. .ended on
//    low-battery auto-stop) — without delegate the controller would
//    drift from OS truth.
//
//    D17 (2026-06-12): HKLiveWorkoutBuilderDelegate adopted — live
//    sample-cadence (~1Hz HR) streaming into `streamedStats`
//    (@Published), consumed by the SetLoggerView HRFrozenPane.
//    Replaces the #312 interim 5s TimelineView poll (ADR-0019 D14
//    § 2026-06-11 amendment point 5, reversal logged 2026-06-12).
//

import Foundation
import HealthKit
import Combine

/// Aggregate live readings off the in-flight HKLiveWorkoutBuilder
/// (#312). Per-field nil = no sample collected yet. Consumed by the
/// D14 FinishPage tiles (HR range + 動/靜 kcal, pull on appear) and
/// the session-page HRFrozenPane top bar (latest HR + active kcal,
/// D17 delegate-streamed via `streamedStats`).
struct WorkoutLiveStats: Equatable {
    var hrMin: Double? = nil
    var hrMax: Double? = nil
    var hrLatest: Double? = nil
    var activeKcal: Double? = nil
    var basalKcal: Double? = nil
}

@MainActor
final class SessionController: NSObject, ObservableObject {

    enum State: Equatable {
        case idle
        case starting
        case active
        case ending
        case ended
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var sessionStartedAt: Date?
    @Published private(set) var sessionEndedAt: Date?

    /// D17 (2026-06-12) — push-based live stats. Recomputed inside
    /// `workoutBuilder(_:didCollectDataOf:)` whenever HK delivers a
    /// relevant sample batch (~1Hz for HR), assigned only when the
    /// values actually changed (a `@Published` struct assign fires
    /// `objectWillChange` even for an identical value — the equality
    /// gate IS the throttle: UI re-renders exactly at the data's
    /// change rate). HRFrozenPane consumes this as a plain value
    /// threaded down from SetLoggerView, replacing the retired 5s
    /// TimelineView poll. Reset on `start()` so a new session shows
    /// "--" until its own first sample lands (10-60s, see skill
    /// watch-live-workout-stats 坑 2).
    @Published private(set) var streamedStats = WorkoutLiveStats()

    private let healthKit: HealthKitController
    private(set) var session: HKWorkoutSession?
    private(set) var builder: HKLiveWorkoutBuilder?

    /// F-1 (稽核 07 2026-06-12) — start-run generation token. `start()`
    /// suspends at two awaits (ensureAuthorized — first launch parks on
    /// the system permission dialog for tens of seconds — and
    /// beginCollection). During a suspension an iPhone-led end can run
    /// (`stopAndDiscard` admits `.starting`), or even an end + fresh
    /// `start()`. Each resume point re-checks token + state so a stale
    /// resume can't resurrect a zombie HK session nothing will ever end
    /// (the 2026-05-29 green-runner symptom via another door).
    private var startGeneration = 0

    init(healthKit: HealthKitController) {
        self.healthKit = healthKit
        super.init()
    }

    // MARK: - Live workout stats (#312 — D14 FinishPage real tiles +
    //         HRFrozenPane top-bar wire)

    /// Aggregate stats read straight off the in-flight live builder
    /// (collecting since `start()`'s beginCollection). Per-field nil when
    /// no sample has landed yet — Simulator runs, HK auth denied, or a
    /// session too short for the first HR sample. Synchronous + cheap.
    /// Pull-style API kept for on-appear readers (FinishPage); live
    /// views should observe `streamedStats` instead (D17). Only
    /// meaningful while the session is active (builder is discarded by
    /// `end()`/`cancel()`).
    func liveWorkoutStats() -> WorkoutLiveStats {
        guard let builder else { return WorkoutLiveStats() }
        return Self.computeStats(from: builder)
    }

    /// Single source for aggregating live readings off a builder —
    /// shared by the pull path (`liveWorkoutStats()`, FinishPage
    /// onAppear) and the D17 push path (builder delegate →
    /// `streamedStats`). `builder.statistics(for:)` is a cheap local
    /// synchronous read; per-callback recompute is fine.
    private static func computeStats(from builder: HKLiveWorkoutBuilder) -> WorkoutLiveStats {
        var stats = WorkoutLiveStats()
        if let hrType = HKObjectType.quantityType(forIdentifier: .heartRate),
           let hr = builder.statistics(for: hrType) {
            let bpm = HKUnit.count().unitDivided(by: .minute())
            stats.hrMin = hr.minimumQuantity()?.doubleValue(for: bpm)
            stats.hrMax = hr.maximumQuantity()?.doubleValue(for: bpm)
            stats.hrLatest = hr.mostRecentQuantity()?.doubleValue(for: bpm)
        }
        if let activeType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
            stats.activeKcal = builder.statistics(for: activeType)?
                .sumQuantity()?.doubleValue(for: .kilocalorie())
        }
        if let basalType = HKObjectType.quantityType(forIdentifier: .basalEnergyBurned) {
            stats.basalKcal = builder.statistics(for: basalType)?
                .sumQuantity()?.doubleValue(for: .kilocalorie())
        }
        return stats
    }

    // MARK: - Lifecycle API

    /// Start a Watch-side workout session (HR sampling only, no
    /// HKWorkout entry). Idempotent guard: only valid from .idle /
    /// .ended / .failed. Other states are ignored.
    func start() async {
        switch state {
        case .idle, .ended, .failed:
            break
        case .starting, .active, .ending:
            return
        }

        state = .starting
        startGeneration += 1
        let gen = startGeneration
        sessionStartedAt = nil
        sessionEndedAt = nil
        // D17 — wipe the previous session's streamed readings BEFORE
        // the new builder collects: a restarted session must show "--"
        // until its own first sample lands, not stale numbers.
        streamedStats = WorkoutLiveStats()

        // Phase 1: HK authorization (Watch-side request — Q22 fallback)
        do {
            try await healthKit.ensureAuthorized()
        } catch {
            // F-1 — only the run that still owns the state machine may
            // write the terminal state (an interleaved end set .ending /
            // .ended; a newer start() bumped the generation).
            if gen == startGeneration, case .starting = state {
                state = .failed("HK auth failed: \(error.localizedDescription)")
            }
            return
        }

        // F-1 — re-check after the auth suspension: if an end-during-start
        // interleave moved us off .starting (or a newer start() took over),
        // bail BEFORE creating an OS session no UI path would ever end.
        // Deliberately NOT also gating on Task.isCancelled: a SwiftUI
        // re-mount cancels the old `.task` while its replacement start()
        // has already no-op'd on `.starting` — bailing here would leave no
        // session and no retry (see SetLoggerView re-mount comment).
        guard gen == startGeneration, case .starting = state else { return }

        // Phase 2: configure session + builder + data source
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        let newSession: HKWorkoutSession
        do {
            newSession = try HKWorkoutSession(
                healthStore: healthKit.store,
                configuration: config
            )
        } catch {
            state = .failed("session configure failed: \(error.localizedDescription)")
            return
        }

        newSession.delegate = self
        let newBuilder = newSession.associatedWorkoutBuilder()
        // D17 — live stats streaming: builder delegate feeds
        // `streamedStats` at sample cadence (see extension below).
        newBuilder.delegate = self
        newBuilder.dataSource = HKLiveWorkoutDataSource(
            healthStore: healthKit.store,
            workoutConfiguration: config
        )

        self.session = newSession
        self.builder = newBuilder

        // Phase 3: startActivity + beginCollection
        let startDate = Date()
        newSession.startActivity(with: startDate)
        do {
            try await newBuilder.beginCollection(at: startDate)
        } catch {
            // F-2 (稽核 07) — startActivity already ran, so the OS-side
            // session is LIVE here. Parking in .failed without a
            // compensating end() strands it: stopAndDiscard's entry
            // switch rejects .failed, so [完成]/[放棄] could never
            // terminate it (green-runner forever), and a retried start()
            // would overwrite refs while the orphan keeps running.
            // end() on an already-terminal session (interleaved
            // stopAndDiscard got there first) is a harmless no-op.
            newSession.end()
            // Same ownership rule as the F-1 resume checks: only the run
            // that still owns the state machine clears refs + writes the
            // terminal state (an interleaved .ending/.ended owns its own
            // cleanup; a newer start() owns the refs).
            if gen == startGeneration, case .starting = state {
                self.session = nil
                self.builder = nil
                state = .failed("beginCollection failed: \(error.localizedDescription)")
            }
            return
        }

        // F-1 — same interleave window across the beginCollection await:
        // only the run that still owns the state machine may declare
        // .active. When it doesn't, the interleaved stopAndDiscard already
        // ended the OS session (refs were assigned before the await) — the
        // extra end() is a terminal-state no-op kept as belt-and-suspenders.
        guard gen == startGeneration, case .starting = state else {
            newSession.end()
            return
        }

        sessionStartedAt = startDate
        state = .active
    }

    /// End an active session via natural completion (user pressed
    /// "結束訓練"). discardWorkout is trigger-only — no HKWorkout
    /// entry written.
    func end() async {
        await stopAndDiscard()
    }

    /// Cancel an active session via explicit user discard. Identical
    /// HK lifecycle to end() because Branch C doesn't distinguish
    /// "save" vs "discard" at the HK layer; the semantic difference
    /// lives in the iPhone WC handler (whether to finalize SQLite
    /// session row or roll it back). D5 just exposes both APIs so
    /// downstream wiring is clear.
    func cancel() async {
        await stopAndDiscard()
    }

    private func stopAndDiscard() async {
        switch state {
        case .active, .starting:
            break
        case .idle, .ending, .ended, .failed:
            return
        }

        state = .ending
        let endDate = Date()

        // 2026-05-29 late-evening real-device smoke iter 2 —
        //
        // First attempt (fix2 earlier this session): added
        // `try? await builder.endCollection(at:)` between stopActivity
        // and discardWorkout. Real-device smoke STILL showed the
        // active-workout indicator (green runner) + TrainingLog
        // app-logo Live Activity persisting after [完成] tap — user
        // had to start + end a workout in Apple's own Workout app to
        // clear them.
        //
        // Root cause: `stopActivity(with:)` only transitions the
        // HKWorkoutSession from `.running` to `.stopped` — an
        // INTERMEDIATE state. The OS still treats `.stopped` as an
        // active workout session (which is why the indicators stay).
        // The proper terminal call is `session.end()` (available
        // watchOS 10+), which transitions to `.ended` and releases
        // OS-level resources.
        //
        // Apple's recommended pattern for an explicit "end workout"
        // user action (validated against the WatchOS 11 Workout app
        // template's End button impl):
        //   session.end()
        //   try await builder.endCollection(at: endDate)
        //   builder.finishWorkout()  OR  builder.discardWorkout()
        //
        // We use discardWorkout (no HKWorkout entry per Q28 Branch C).
        session?.end()

        // endCollection still needed AFTER session.end() so the builder
        // flushes its pending sample collection state. try? — silent
        // fail (already-terminal state is harmless; we still want
        // discardWorkout + state cleanup to proceed unconditionally).
        if let builder {
            try? await builder.endCollection(at: endDate)
        }

        // Discard collected data. Per Q28 Branch C: synchronous void
        // on watchOS 11+; no HKWorkout entry created. HR samples
        // already in HK store persist independently of the builder.
        builder?.discardWorkout()

        session = nil
        builder = nil
        // D17 — parity with the retired poll (which read "--" once the
        // builder was nil): clear streamed readings so no stale frozen
        // numbers outlive the session.
        streamedStats = WorkoutLiveStats()
        sessionEndedAt = endDate
        state = .ended
    }
}

// MARK: - HKWorkoutSessionDelegate

extension SessionController: HKWorkoutSessionDelegate {

    /// Called on a HK-internal thread when the OS-side session
    /// state machine moves. Hop to main and reconcile our @Published
    /// state when the OS reports a terminal transition we didn't
    /// initiate (e.g. .stopped triggered by low-battery auto-stop).
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        Task { @MainActor in
            switch toState {
            case .ended, .stopped:
                // If we're still .active when the OS reports stopped,
                // the OS killed the session out from under us. Sync
                // our state without calling discardWorkout again
                // (the OS already cleaned up the builder side).
                if case .active = state {
                    sessionEndedAt = date
                    session = nil
                    builder = nil
                    streamedStats = WorkoutLiveStats()  // D17 — no stale freeze
                    state = .ended
                }
            default:
                break
            }
        }
    }

    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didFailWithError error: Error
    ) {
        Task { @MainActor in
            state = .failed("session failed: \(error.localizedDescription)")
            session = nil
            builder = nil
            streamedStats = WorkoutLiveStats()  // D17 — no stale freeze
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate (D17 — live stats streaming)

extension SessionController: HKLiveWorkoutBuilderDelegate {

    /// Called on an HK-internal queue every time the live builder
    /// collects a sample batch (~1Hz for HR once samples start
    /// landing). Filter for the three stat-feeding quantity types
    /// BEFORE the MainActor hop, then recompute `streamedStats` from
    /// the builder's statistics (same read as `liveWorkoutStats()`).
    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        let relevant = collectedTypes.contains { type in
            guard let qt = type as? HKQuantityType else { return false }
            switch HKQuantityTypeIdentifier(rawValue: qt.identifier) {
            case .heartRate, .activeEnergyBurned, .basalEnergyBurned:
                return true
            default:
                return false
            }
        }
        guard relevant else { return }

        // Hop to main (SessionController is @MainActor). [weak self] —
        // an in-flight hop must not extend the controller's life
        // during teardown.
        Task { @MainActor [weak self] in
            guard let self else { return }
            // Late callback from a discarded builder — end()/cancel()
            // already nil'd `builder`, or a restart swapped it. Drop;
            // `start()` owns the reset-to-empty.
            guard self.builder === workoutBuilder else { return }
            let fresh = Self.computeStats(from: workoutBuilder)
            // Equality gate (see `streamedStats` doc) — assign only on
            // real change so @Published doesn't re-render SwiftUI for
            // identical values on every sample batch.
            if fresh != self.streamedStats {
                self.streamedStats = fresh
            }
        }
    }

    /// Workout events (pause/resume/segment markers) are out of D17
    /// scope — protocol requires the method, body intentionally empty.
    nonisolated func workoutBuilderDidCollectEvent(
        _ workoutBuilder: HKLiveWorkoutBuilder
    ) {}
}
