//
//  LiveTicksProducer.swift
//  TrainingLog Watch
//
//  point2 live-sync (2026-06-12) — Watch `hr-tick` / `kcal-tick` producer
//  (Q4 channels #9/#10, payload spec in src/adapters/watch/payloadSchema.ts).
//
//  Role:
//    During a live SetLoggerView session the D17 delegate stream feeds
//    `SessionController.streamedStats` at sample cadence (~1Hz for HR).
//    This producer observes that stream via Combine, throttles it to the
//    spec'd 3-5s window, and pushes the LATEST value of each metric to
//    the iPhone via `WatchConnectivityCoordinator.sendHrTick/sendKcalTick`
//    so the in-session 5-tile panel's ❤️/🔥 tiles track the Watch.
//
//  Transport (mirrors the receiver doc, watchLiveTicksReceiver.ts):
//    `sendMessage`-when-reachable ONLY — the coordinator drops a tick
//    when the iPhone is unreachable and reports it un-sent, so the
//    per-metric dirty flag here stays set and the next reachable window
//    re-emits. No applicationContext (that single latest-state slot is
//    owned by the live-mirror raw SessionSnapshot backstop since the
//    2026-06-01 sync fast lane) and no transferUserInfo (a durable FIFO
//    queue replaying stale HR ticks minutes later is strictly worse than
//    dropping — a missed tick self-heals on the next emit).
//
//  Throttle (3-5s per payloadSchema spec → 4s):
//    - Per-metric dirty flags set when the observed value CHANGES (the
//      sink receives the new struct value directly, so no @Published
//      willSet hazard — contrast LiveMirrorProducer.markDirty).
//    - Emit immediately when the coalesce window has already elapsed
//      (first HR sample reaches the iPhone without an extra 4s wait);
//      otherwise a 1s poll loop flushes once the window passes. A burst
//      coalesces to one emit per window carrying only the latest values.
//    - An UNCHANGED metric is never re-sent (nothing new to say —
//      latest-wins display on the iPhone keeps showing the last tick).
//
//  Display-only contract: the iPhone receiver keeps these ticks in
//  ephemeral React state (no DB), so there is no discard/teardown
//  hazard (live-mirror audit H1 class does not apply) and no need for
//  an emitFinal()/abort distinction — the producer simply dies with the
//  view's `.task` and the iPhone panel unmounts on session end.
//

import Foundation
import Combine

@MainActor
final class LiveTicksProducer: ObservableObject {

    private weak var coordinator: WatchConnectivityCoordinator?
    private var sessionId: String = ""

    /// Latest observed value + observation time per metric. `observedAt`
    /// feeds the payload's `sampleTs` (the D17 sink fires at sample
    /// cadence, so observation time ≈ HK sample time within ~1s —
    /// `WorkoutLiveStats` itself carries no per-sample timestamp).
    private var latestBpm: Double?
    private var bpmObservedAt = Date()
    private var latestKcal: Double?
    private var kcalObservedAt = Date()

    /// Per-metric "value changed since last successful send" flags.
    private var bpmDirty = false
    private var kcalDirty = false

    private var lastEmit: Date?
    private var cancellables = Set<AnyCancellable>()

    /// Coalesce window — spec says 3-5s; 4s splits the difference.
    private let throttle: TimeInterval = 4.0
    /// Poll cadence for the backstop flush loop (covers a dirty value
    /// whose stream then goes quiet inside the throttle window).
    private let pollNanos: UInt64 = 1_000_000_000

    /// Bind to this session + the D17 stream + the outbound coordinator.
    /// Call once before `run()`. No `dropFirst()` on the subscription:
    /// @Published replays the current value on subscribe, which is empty
    /// at mount (SessionController.start() resets streamedStats) and is
    /// the freshest reading on a mid-session re-mount — both correct to
    /// observe.
    func configure(
        sessionId: String,
        controller: SessionController,
        coordinator: WatchConnectivityCoordinator?
    ) {
        self.sessionId = sessionId
        self.coordinator = coordinator
        cancellables.removeAll()
        controller.$streamedStats
            .sink { [weak self] stats in self?.observe(stats) }
            .store(in: &cancellables)
    }

    /// Drive from `.task { await ticks.run() }` so the loop inherits the
    /// view's lifetime and auto-cancels on teardown (same pattern as
    /// LiveMirrorProducer.run()).
    func run() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: pollNanos)
            if Task.isCancelled { break }
            if (bpmDirty || kcalDirty), shouldEmitNow() {
                emit()
            }
        }
    }

    /// One D17 stream tick. Updates the per-metric latest + dirty when
    /// the value actually changed, then emits straight away if the
    /// coalesce window already elapsed. Value sanity floors mirror the
    /// iPhone reducer (`parseTick`): bpm must be > 0, kcal ≥ 0 — the
    /// receiver would drop garbage anyway, this just saves the send.
    /// `hrLatest`/`activeKcal` go nil on session teardown reset — kept
    /// values are NOT cleared (nothing further is sent; the producer is
    /// about to die with the view).
    private func observe(_ stats: WorkoutLiveStats) {
        if let bpm = stats.hrLatest, bpm > 0, bpm != latestBpm {
            latestBpm = bpm
            bpmObservedAt = Date()
            bpmDirty = true
        }
        if let kcal = stats.activeKcal, kcal >= 0, kcal != latestKcal {
            latestKcal = kcal
            kcalObservedAt = Date()
            kcalDirty = true
        }
        if (bpmDirty || kcalDirty), shouldEmitNow() {
            emit()
        }
    }

    private func shouldEmitNow() -> Bool {
        guard let last = lastEmit else { return true }
        return Date().timeIntervalSince(last) >= throttle
    }

    /// Flush the dirty metrics. A metric's dirty flag clears ONLY when
    /// the coordinator confirms the envelope was handed to sendMessage
    /// (reachable + activated) — an unreachable drop keeps it dirty so
    /// the next window after reachability returns re-sends the latest
    /// value (kcal can sit unchanged for minutes during rest; without
    /// this the tile would lag until the next HK delta). `lastEmit`
    /// advances regardless so an unreachable iPhone doesn't turn the
    /// poll loop into a 1s retry hammer.
    private func emit() {
        guard let coordinator, !sessionId.isEmpty else { return }
        if bpmDirty, let bpm = latestBpm {
            let sent = coordinator.sendHrTick(
                sessionId: sessionId,
                bpm: bpm,
                sampleTs: Int64(bpmObservedAt.timeIntervalSince1970 * 1000)
            )
            if sent { bpmDirty = false }
        }
        if kcalDirty, let kcal = latestKcal {
            let sent = coordinator.sendKcalTick(
                sessionId: sessionId,
                kcal: kcal,
                sampleTs: Int64(kcalObservedAt.timeIntervalSince1970 * 1000)
            )
            if sent { kcalDirty = false }
        }
        lastEmit = Date()
    }
}
