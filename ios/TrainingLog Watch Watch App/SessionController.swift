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
//    NOT adopted in D5: HKLiveWorkoutBuilderDelegate (live HR
//    streaming) — that ships in D17 'Watch in-session live HR
//    display'. Builder reference is exposed via `builder` (internal)
//    for D17 to attach its delegate then.
//

import Foundation
import HealthKit
import Combine

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

    private let healthKit: HealthKitController
    private(set) var session: HKWorkoutSession?
    private(set) var builder: HKLiveWorkoutBuilder?

    init(healthKit: HealthKitController) {
        self.healthKit = healthKit
        super.init()
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
        sessionStartedAt = nil
        sessionEndedAt = nil

        // Phase 1: HK authorization (Watch-side request — Q22 fallback)
        do {
            try await healthKit.ensureAuthorized()
        } catch {
            state = .failed("HK auth failed: \(error.localizedDescription)")
            return
        }

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
            state = .failed("beginCollection failed: \(error.localizedDescription)")
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
        session?.stopActivity(with: endDate)

        // Per Q28 Branch C (spike A confirmed): discardWorkout is
        // synchronous void on watchOS 11+ and writes NO HKWorkout
        // entry. HR samples already in HK store persist.
        builder?.discardWorkout()

        session = nil
        builder = nil
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
        }
    }
}
