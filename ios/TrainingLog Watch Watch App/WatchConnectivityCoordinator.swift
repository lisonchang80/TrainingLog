//
//  WatchConnectivityCoordinator.swift
//  TrainingLog Watch
//
//  Slice 13d D7-Swift — Watch ↔ iPhone WC bridge (Watch side).
//  Per ADR-0019 § Slice 13d Amendment Q23 + NEW-Q45 + WC channel #11
//  (`end-session` bidirectional).
//
//  This is the Watch counterpart of:
//    - iPhone outbound: `src/services/watchSessionEnd.ts` (D7-TS,
//      commit cc3307d) — `pushEndToWatch(db, sessionId)` sends
//      `{kind:'end-session', payload:{sessionId, side:'iphone'}}`
//      and awaits `replyHandler` for 5s before reconciling
//      `is_watch_tracked = false`.
//    - iPhone inbound: handler in `app/(tabs)/index.tsx`
//      (D7-TS, same commit) — receives Watch-led `end-session`
//      envelope (side:'watch') and routes through `finalizeEndAndRoute`.
//
//  D7-Swift scope (per 2026-05-27 grill decisions):
//    - ONLY `end-session` channel (bidirectional). `start-from-iphone`
//      inbound + `start-from-watch` outbound deferred to D8 picker UI
//      commit. No payload parsing for any other `kind` — receiver
//      replies `{ok:false, code:"unknown-kind"}` and drops.
//    - Single coordinator class (not bridge + service split like RN
//      side) — Watch only has 1-2 channels to wire, two-layer split
//      would be premature.
//
//  Architecture:
//    - Conforms to `WCSessionDelegate`. Activated on init via
//      `WCSession.default.activate()`.
//    - Holds a `SessionController` reference (the HK lifecycle owner).
//      On inbound `end-session(side:'iphone')` the coordinator invokes
//      `sessionController.end()` on the MainActor + replies ack.
//    - Exposes `sendEndToiPhone(sessionId:)` for Watch-led outbound.
//      Wire format mirrors `src/adapters/watch/payloadSchema.ts`
//      `makeEnvelope('end-session', {sessionId, side:'watch'})`:
//        {
//          "msgId": <UUID>,
//          "ts": <epoch ms>,
//          "kind": "end-session",
//          "payload": {"sessionId": ..., "side": "watch"}
//        }
//    - Idempotent on Watch side via SessionController.State machine
//      (end() returns early when state is .ending/.ended/.idle/.failed).
//      No DB gate needed — Watch has no SQLite. iPhone owns the
//      ended_at gate.
//
//  Observable state (for dev_smoke UI + future debug readout):
//    - `status` — Activation state machine
//    - `lastInbound` — UI string for last received envelope
//    - `lastOutbound` — UI string for last send attempt + ack outcome
//
//  watchOS delegate quirks:
//    - Only `session(_:activationDidCompleteWith:error:)` is required.
//      iOS-only methods (sessionDidBecomeInactive, sessionDidDeactivate)
//      do NOT exist on watchOS — leaving them out is correct.
//

import Foundation
import Combine
import WatchConnectivity

@MainActor
final class WatchConnectivityCoordinator: NSObject, ObservableObject {

    enum Status: Equatable {
        case unsupported
        case inactive
        case activating
        case activated
        case failed(String)
    }

    @Published private(set) var status: Status = .inactive
    @Published private(set) var lastInbound: String = "—"
    @Published private(set) var lastOutbound: String = "—"

    private let sessionController: SessionController
    private let session: WCSession?

    init(sessionController: SessionController) {
        self.sessionController = sessionController
        if WCSession.isSupported() {
            self.session = WCSession.default
        } else {
            self.session = nil
        }
        super.init()
        activate()
    }

    private func activate() {
        guard let session else {
            status = .unsupported
            return
        }
        session.delegate = self
        status = .activating
        session.activate()
    }

    // MARK: - Outbound (Watch-led)

    /// Send an `end-session` envelope to iPhone. Mirrors the TS
    /// `makeEnvelope('end-session', {sessionId, side:'watch'})` shape +
    /// `connectivity.sendMessage` semantics (best-effort, never throws).
    ///
    /// Returns when iPhone replies OR errorHandler fires OR the
    /// WC framework times out internally. Updates `lastOutbound` for
    /// UI diagnostics.
    func sendEndToiPhone(sessionId: String) async {
        guard let session, session.activationState == .activated else {
            lastOutbound = "skip: not activated"
            return
        }
        guard session.isReachable else {
            // Note: WC has a separate transferUserInfo path for queued
            // delivery, but D7 spec is bidirectional ack-based — we
            // only attempt sendMessage. Caller can retry when iPhone
            // becomes reachable.
            lastOutbound = "skip: iPhone unreachable"
            return
        }
        guard !sessionId.isEmpty else {
            lastOutbound = "skip: empty sessionId"
            return
        }

        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            "ts": Int(Date().timeIntervalSince1970 * 1000),
            "kind": "end-session",
            "payload": [
                "sessionId": sessionId,
                "side": "watch",
            ],
        ]

        lastOutbound = "sending sess=\(prefix8(sessionId))…"

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            session.sendMessage(
                envelope,
                replyHandler: { reply in
                    Task { @MainActor [weak self] in
                        let ok = (reply["ok"] as? Bool) ?? false
                        self?.lastOutbound = ok
                            ? "ack ok sess=\(self?.prefix8(sessionId) ?? "?")"
                            : "ack non-ok: \(reply)"
                    }
                    continuation.resume()
                },
                errorHandler: { error in
                    Task { @MainActor [weak self] in
                        self?.lastOutbound = "err: \(error.localizedDescription)"
                    }
                    continuation.resume()
                }
            )
        }
    }

    private nonisolated func prefix8(_ s: String) -> String {
        return String(s.prefix(8))
    }
}

// MARK: - WCSessionDelegate

extension WatchConnectivityCoordinator: WCSessionDelegate {

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if let error {
                self.status = .failed(error.localizedDescription)
                return
            }
            switch activationState {
            case .activated:
                self.status = .activated
            case .inactive:
                self.status = .inactive
            case .notActivated:
                self.status = .failed("notActivated")
            @unknown default:
                self.status = .failed("unknown")
            }
        }
    }

    /// Inbound handler. Called on a WC-internal background thread.
    /// Per D7-Swift scope: only `end-session` with `side == 'iphone'`
    /// is honoured. Any other shape → reply non-ok and drop.
    ///
    /// Reply MUST be called within ~5s (WC framework constraint).
    /// `sessionController.end()` calls `discardWorkout()` which is
    /// synchronous on watchOS 11+ → reply lands well within budget.
    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        // Synchronous validation — reject malformed envelopes inline.
        guard
            let kind = message["kind"] as? String,
            kind == "end-session"
        else {
            replyHandler(["ok": false, "code": "unknown-kind"])
            return
        }
        guard
            let payload = message["payload"] as? [String: Any],
            let sessionId = payload["sessionId"] as? String,
            let side = payload["side"] as? String
        else {
            replyHandler(["ok": false, "code": "bad-payload"])
            return
        }
        // Defensive: ignore self-echo. iPhone-initiated msgs carry
        // side='iphone'; Watch should never receive its own outbound.
        // If we DO receive side='watch' here, drop it silently rather
        // than re-trigger SessionController.end() on a Watch-led msg
        // we already started locally.
        guard side == "iphone" else {
            replyHandler(["ok": false, "code": "wrong-side"])
            return
        }

        let msgId = (message["msgId"] as? String) ?? "?"

        Task { @MainActor [weak self] in
            guard let self else {
                replyHandler(["ok": false, "code": "deinit"])
                return
            }
            self.lastInbound = "end sess=\(self.prefix8(sessionId))… msgId=\(self.prefix8(msgId))…"
            // SessionController.end() is idempotent — re-call on already-
            // ended state is a no-op (early return via State switch).
            // Same behaviour for Watch-led: when Watch initiates end()
            // locally then iPhone bounces end-session(side:'iphone') back,
            // this call is a no-op and we just reply ack so iPhone's
            // 5s reconcile sees the ack.
            await self.sessionController.end()
            replyHandler(["ok": true])
        }
    }
}
