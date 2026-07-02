//
//  RestTimerController.swift
//  TrainingLog Watch
//
//  Watch rest timer (2026-07-02). Mirrors the iPhone rest-timer system
//  (ADR-0019 § Q2) as a watch-native full-screen popup:
//    - Trigger: a set is marked ✓ (logged) in SetLoggerView, IF the
//      `restTimerMode` setting == .popup (default). SetLoggerView observes
//      `interactionState.loggedSetIds` and calls `start(...)` / `cancel()`.
//    - Duration: the set's `restSec`; 0 / nil → 60s (ADR-0019 Q2.1 hardcoded).
//    - Cluster: only the head/solo/working/warmup row (`parentSetId == nil`)
//      starts a timer; dropset followers don't (ADR-0019 Q2 (C)).
//    - Finish: haptic only (respects `hapticStrength`; 「震動即可」— no sound)
//      + auto-dismiss after a 0.4s flash so the user sees 00:00 land.
//    - Background reliability: relies on the active HKWorkoutSession's
//      extended runtime — no local notification (user-chosen v1 scope).
//
//  Split: `RestTimerLogic` holds the pure wall-clock helpers (testable /
//  reused by RestTimerView for display); the ObservableObject owns the
//  running state + 1 Hz finish-edge tick + haptic. Wall-clock (`endAt`)
//  rather than a decrementing counter → robust to timer jitter and to the
//  workout-session suspend/resume cycle.
//

import Combine
import Foundation
import SwiftUI
import WatchKit

// MARK: - Pure logic (mirror src/domain/session/restTimer.ts)

enum RestTimerLogic {
    /// System default when a set carries no explicit rest (ADR-0019 Q2.1).
    static let defaultRestSec = 60

    /// Effective rest seconds: 0 / negative / nil → 60.
    static func effectiveRestSec(_ restSec: Int?) -> Int {
        guard let r = restSec, r > 0 else { return defaultRestSec }
        return r
    }

    /// Whole seconds remaining until `endAt`, clamped ≥ 0.
    static func remainingSeconds(endAt: Date, now: Date) -> Int {
        max(0, Int(ceil(endAt.timeIntervalSince(now))))
    }

    /// Elapsed fraction 0…1 (0 = just started, 1 = done) for the ring.
    static func progress(endAt: Date, totalSec: Int, now: Date) -> Double {
        guard totalSec > 0 else { return 1 }
        let elapsed = 1 - (endAt.timeIntervalSince(now) / Double(totalSec))
        return min(1, max(0, elapsed))
    }

    /// mm:ss.
    static func formatRemaining(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

// MARK: - Controller

@MainActor
final class RestTimerController: ObservableObject {
    /// Drives the `.fullScreenCover` presentation on SetLoggerView.
    @Published var isPresented = false
    /// True on the finished edge (00:00) — flips the popup to its green
    /// "休息結束" state for the 0.4s flash before auto-dismiss.
    @Published private(set) var finished = false

    // Display inputs read by RestTimerView (via a TimelineView).
    @Published private(set) var endAt: Date = .distantPast
    @Published private(set) var totalSec: Int = 0
    @Published private(set) var exerciseName: String = ""
    @Published private(set) var setOrdinal: Int = 0

    /// The set whose ✓ started the running timer — used to cancel when the
    /// user un-logs that exact set (✓→◯).
    private(set) var runningSetId: String?

    private var tick: Timer?

    // MARK: Commands

    /// Start (or restart) the countdown for a freshly ✓'d set.
    func start(setId: String, restSec: Int?, exerciseName: String, ordinal: Int, now: Date = Date()) {
        let total = RestTimerLogic.effectiveRestSec(restSec)
        runningSetId = setId
        totalSec = total
        endAt = now.addingTimeInterval(TimeInterval(total))
        self.exerciseName = exerciseName
        setOrdinal = ordinal
        finished = false
        isPresented = true
        scheduleTick()
    }

    /// Skip / dismiss early (no finish haptic).
    func skip() {
        tick?.invalidate()
        tick = nil
        isPresented = false
        finished = false
        runningSetId = nil
    }

    /// Cancel because a set was un-logged — only if it's the running one.
    func cancelIfRunning(setId: String) {
        if runningSetId == setId { skip() }
    }

    // MARK: Finish-edge detection (1 Hz)

    private func scheduleTick() {
        tick?.invalidate()
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkFinish() }
        }
        RunLoop.main.add(t, forMode: .common)
        tick = t
    }

    private func checkFinish(now: Date = Date()) {
        guard isPresented, !finished else { return }
        guard RestTimerLogic.remainingSeconds(endAt: endAt, now: now) <= 0 else { return }
        finished = true
        tick?.invalidate()
        tick = nil
        fireFinishHaptic()
        // Flash so the user registers 00:00, then auto-dismiss. 0.9s (was
        // 0.4s) so BOTH double-buzz plays (0s + 0.5s) land while the popup is
        // still up — see fireFinishHaptic.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 900_000_000)
            if self.finished { self.skip() }
        }
    }

    /// Finish haptic respects the `hapticStrength` setting (「震動即可」— no sound).
    /// Fires TWICE (double buzz, ~0.22s apart) so the rest-done haptic is
    /// distinguishable from every other single-haptic feedback in the app.
    private func fireFinishHaptic() {
        let raw = UserDefaults.standard.string(forKey: WatchSettingsKey.hapticStrength)
            ?? WatchSettingsDefault.hapticStrength
        let type: WKHapticType
        switch HapticStrength(rawValue: raw) ?? .medium {
        case .light: type = .click
        case .medium: type = .notification
        case .heavy: type = .success
        }
        // Double buzz — second play off `self`-free locals so it still lands
        // even after the auto-dismiss unmounts the popup. 0.5s gap: a 0.22s gap
        // read as a SINGLE buzz on-wrist (device smoke 2026-07-03) because
        // watchOS coalesces closely-spaced haptics (esp. the multi-pulse
        // `.notification`); 0.5s clearly separates them into "buzz — buzz".
        // The finish auto-dismiss (checkFinish) waits 0.9s so both land while
        // the popup is still up.
        let device = WKInterfaceDevice.current()
        device.play(type)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            device.play(type)
        }
    }
}
