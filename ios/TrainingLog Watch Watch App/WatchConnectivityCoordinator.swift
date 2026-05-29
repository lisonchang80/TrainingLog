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

    /// NEW-Q50 D30 — most-recent inbound `start-reconcile` envelope
    /// payload from iPhone (delivered via reverse TUI / transferUserInfo).
    /// `nil` until the first reconcile lands. PickerViewModel (D31)
    /// subscribes to drive conflict UI; for D29/D30 MVP we just expose
    /// it for diagnostics (lastInbound also gets a one-line summary).
    @Published private(set) var lastReconcile: StartReconcileResult?

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
        // 2026-05-29 D11 HK lifecycle wire — Watch-led end path must
        // ALSO tear down the local HKWorkoutSession, otherwise the
        // workout-active state stays on the OS side after the user
        // taps [完成] → watch face still shows the active-workout
        // indicator, screen stays awake forever, app never gets
        // suspended. The symmetric iPhone-led end path already does
        // this in `session(_:didReceiveMessage:replyHandler:)` for
        // kind="end-session" (line ~586). We fire HK end FIRST and
        // independently of the WC guards below: even if iPhone is
        // unreachable / sessionId is empty, the user pressed [完成]
        // — local HK lifecycle must terminate regardless. end() is
        // idempotent (returns early when state is .idle/.ending/
        // .ended/.failed) so a duplicate call from a subsequent
        // iPhone-led broadcast is a safe no-op.
        await sessionController.end()

        guard let session, session.activationState == .activated else {
            lastOutbound = "skip: not activated"
            return
        }
        guard session.isReachable else {
            // Note: WC has a separate transferUserInfo path for queued
            // delivery, but D7 spec uses sendMessage — caller can retry
            // when iPhone becomes reachable.
            lastOutbound = "skip: iPhone unreachable"
            return
        }
        guard !sessionId.isEmpty else {
            lastOutbound = "skip: empty sessionId"
            return
        }

        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            // watchOS uses arm64_32 — Swift `Int` is 32-bit on Watch
            // (Int.max ≈ 2.1e9), but epoch ms (~1.78e12 in 2026) overflows.
            // Use `Int64` (always 64-bit) so the cast doesn't crash.
            "ts": Int64(Date().timeIntervalSince1970 * 1000),
            "kind": "end-session",
            "payload": [
                "sessionId": sessionId,
                "side": "watch",
            ],
        ]

        // Fire-and-forget (replyHandler: nil) — but with WCError 7016 swallowed.
        //
        // Why not 3-arg sendMessage with replyHandler?
        // `react-native-watch-connectivity` (iPhone JS side) defines BOTH
        // `session:didReceiveMessage:` AND `session:didReceiveMessage:replyHandler:`
        // delegate methods on the iPhone side. Apple's WC framework always
        // dispatches to the reply-variant when both exist, regardless of
        // what the sender (Watch) specified for replyHandler. The library
        // stores the framework-supplied replyHandler in an NSCache + dispatches
        // the message to JS with an injected `id` field, and requires JS to
        // call its `replyToMessageWithId` API to invoke the stored block.
        // Our D7-TS handler (`addMessageListener('end-session', …)` in
        // app/(tabs)/index.tsx) does NOT call that — so iOS times out the
        // reply after ~5s and fires our errorHandler with
        // `WCErrorCodeMessageReplyTimedOut` (code 7016) even though the
        // message was successfully delivered + processed by iPhone JS.
        //
        // Treatment: detect 7016 specifically and display "sent (no-ack)"
        // instead of "err: …" so the UI reflects what actually happened.
        // Real transport errors (other WCError codes / NSURLError) still
        // surface as "err: …". (Validated 2026-05-27 night real-device smoke.)
        //
        // ADR-0019 § Q23 / NEW-Q45: Watch→iPhone direction is
        // notification-shaped — iPhone reconciles its own state via
        // `finalizeEndAndRoute`'s idempotent gate (DB read of ended_at),
        // so Watch doesn't strictly need an ack to complete the flow.
        // The iPhone→Watch direction (D7-TS `pushEndToWatch`) keeps the
        // ack pattern because the Watch Coordinator DOES call replyHandler
        // synchronously and iPhone uses the ack to flip is_watch_tracked.
        session.sendMessage(
            envelope,
            replyHandler: nil,
            errorHandler: { [weak self] error in
                Task { @MainActor [weak self] in
                    let nsError = error as NSError
                    let isReplyTimeout =
                        nsError.domain == WCErrorDomain
                        && nsError.code == WCError.Code.messageReplyTimedOut.rawValue
                    self?.lastOutbound =
                        isReplyTimeout
                        ? "sent sess=\(self?.prefix8(sessionId) ?? "?") (no-ack)"
                        : "err: \(error.localizedDescription)"
                }
            }
        )
        lastOutbound = "sent sess=\(prefix8(sessionId))"
    }

    private nonisolated func prefix8(_ s: String) -> String {
        return String(s.prefix(8))
    }

    // MARK: - Outbound: handshake (Stage 1, D8 Phase 2)
    //
    // Sends the WC channel #0 `handshake` envelope (per ADR-0019
    // NEW-Q44 two-stage handshake) and awaits iPhone's reply via
    // `sendMessage(_:replyHandler:errorHandler:)`. The reply payload
    // matches `Stage1ReplyPayload` from `src/adapters/watch/handshake.ts`.
    //
    // Race-resistance: a new requestId is minted per call and the
    // returned reply's `requestId` is checked before resolving — late
    // replies for a previous request are dropped.
    //
    // Returns nil on:
    //   - WC not activated / not reachable / not supported
    //   - 5s framework timeout (errorHandler path)
    //   - Reply shape doesn't decode into `Stage1Reply`
    //   - Reply's requestId doesn't match the one we sent

    // MARK: - Outbound: start-from-watch (D8 Phase 3)
    //
    // Sends the WC channel #1 `start-from-watch` envelope (per
    // ADR-0019 § Slice 13d Amendment Q42 / NEW-Q42) carrying the
    // user's 3-tuple selection. iPhone's `onStartFromWatch`
    // orchestrator (D9 wire-in, d7edadd) creates the session row,
    // flips `is_watch_tracked=true`, and replies with the full
    // SessionSnapshot.
    //
    // Phase 3 scope: just wire the WC mechanics + parse the reply.
    // HK lifecycle (SessionController.start()) is intentionally NOT
    // triggered here — D11 set logger owns HK timing.

    /// NEW-Q50 D29 — Watch standalone offline-first send. Replaces the
    /// legacy `sendStartFromWatch` (sendMessage + replyHandler) path.
    ///
    /// Differences vs legacy:
    ///   - Uses `WCSession.transferUserInfo` → queued by iOS, delivers
    ///     even if iPhone app is backgrounded / killed / out of range.
    ///     No `isReachable` gate.
    ///   - Fire-and-forget: no `replyHandler`, no `await`. Watch UI must
    ///     transition immediately (`PickerViewModel.startFromWatch` does
    ///     this via a locally-minted sessionId + mock snapshot).
    ///   - Carries `sessionId` (locally minted by Watch) in payload —
    ///     iPhone's `onStartFromWatch` orchestrator uses it as INSERT
    ///     OR IGNORE key (per Q5 first-write-wins).
    ///
    /// The reverse reply (iPhone's `start-reconcile` envelope confirming
    /// `created` vs `conflict`) lands via `didReceiveUserInfo` and
    /// surfaces in `@Published lastReconcile`. D31 wires conflict UI;
    /// D29/D30 just log + diagnostic.

    // ---------------------------------------------------------------
    // 2026-05-29 deep-night smoke fix (Bug 3) — iPhone-initiated end
    // notify channel for SetLoggerView auto-dismiss.
    //
    // didReceiveMessage(end-session, side='iphone') already calls
    // `sessionController.end()` (HK teardown). We additionally publish
    // the sessionId here so SwiftUI views can subscribe + dismiss UI:
    //
    //   SetLoggerView .onChange(of: coordinator.lastIncomingEnd) {
    //       if $0 == snapshot.sessionId { dismiss() }
    //   }
    //
    // Independent of `lastInbound` (diagnostic string) — type-safe
    // String? so subscribers can pattern-match.
    // ---------------------------------------------------------------
    @Published private(set) var lastIncomingEnd: String?

    func sendStartFromWatchTUI(
        sessionId: String,
        templateId: String?,
        programCycleId: String?,
        intensityId: String?
    ) {
        guard let session, session.activationState == .activated else {
            lastOutbound = "start-from-watch TUI skip: not activated"
            return
        }
        guard !sessionId.isEmpty else {
            lastOutbound = "start-from-watch TUI skip: empty sessionId"
            return
        }

        // Payload shape per `StartFromWatchPayload` in
        // `src/adapters/watch/payloadSchema.ts`.
        //
        // 2026-05-29 deep-night B1 root cause FIX:
        //   Pre-fix used `NSNull()` for absent optionals (e.g.
        //   programCycleId / intensityId on the planned-row tap path
        //   where they're always nil). WCSession.sendMessage AND
        //   transferUserInfo both REJECT envelopes containing NSNull
        //   with `WCError.payloadUnsupportedTypes (code 7010)`. Bug
        //   was latent for template-tap path (user always picked
        //   non-nil program + intensity) but fatal for planned-tap
        //   (where those fields are nil by-construction). Diag chain:
        //   D1 smoke → iPhone never received envelope → enriched
        //   errorHandler surfaced 'msg ERR code=7010 Payload contains
        //   unsupported type' on Watch DBG overlay.
        //
        // Fix: build dict conditionally — omit keys whose value is
        // nil. iPhone JS side receives `undefined` for missing keys
        // (TS type `templateId?: string | null` accepts both); the
        // `truthy` checks in onStartFromWatch handle them identically.
        var payload: [String: Any] = ["sessionId": sessionId]
        if let templateId { payload["templateId"] = templateId }
        if let programCycleId { payload["programCycleId"] = programCycleId }
        if let intensityId { payload["intensityId"] = intensityId }
        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            "ts": Int64(Date().timeIntervalSince1970 * 1000),
            "kind": "start-from-watch",
            "payload": payload,
        ]

        // NEW-Q50 D29 dual-fire (added 2026-05-29 night smoke fix):
        // iOS TUI (transferUserInfo) delivery latency is unpredictable
        // when iPhone is foregrounded — observed empirically that
        // envelopes can sit in queue for minutes despite reachable
        // state. To get immediate UX when iPhone is at hand, ALSO fire
        // `sendMessage` (instant path, replyHandler:nil so no ack
        // dance). iPhone's `onStartFromWatch` orchestrator is
        // idempotent (INSERT OR IGNORE keyed on sessionId per Q5
        // first-write-wins) so dual-delivery is safe — whichever
        // envelope lands first wins, the second hit becomes a no-op
        // at the DB layer.
        //
        // Background-killable scenario (the NEW-Q50 core promise)
        // still works because: isReachable=false → sendMessage skip,
        // TUI keeps queue + iOS delivers on next iPhone wake.
        session.transferUserInfo(envelope)
        var sendMsgStatus = "tui"
        if session.isReachable {
            session.sendMessage(
                envelope,
                replyHandler: nil,
                errorHandler: { [weak self] err in
                    // 2026-05-29 B1 diag → permanent defensive log:
                    // Pre-change this was a no-op (`{ _ in }`) which
                    // silently swallowed errors. The B1 smoke surfaced
                    // a NSNull payload bug specifically because we
                    // started writing the error code to lastOutbound:
                    // 'msg ERR code=7010 Payload contains unsupported
                    // type' immediately pointed at the root cause.
                    //
                    // Keep this enrichment long-term — silent swallowing
                    // hides real bugs. WatchSettingsView surfaces
                    // lastOutbound for ad-hoc diag if a future issue
                    // recurs.
                    //
                    // Common WCError codes (Apple docs):
                    //   7004 notReachable — isReachable flipped false
                    //                       between check + actual send
                    //   7007 sessionNotActivated — WC deactivated mid-send
                    //   7010 payloadUnsupportedTypes — NSNull / custom
                    //                                  object in payload
                    //   7016 messageReplyTimedOut — receiver got it but
                    //                               didn't reply in 5s
                    //                               (cosmetic here)
                    Task { @MainActor [weak self] in
                        let ns = err as NSError
                        self?.lastOutbound =
                            "msg ERR code=\(ns.code) \(err.localizedDescription)"
                    }
                }
            )
            sendMsgStatus = "tui+msg"
        }
        lastOutbound = "start-from-watch \(sendMsgStatus) sent sess=\(prefix8(sessionId))"
    }

    /// D31 (2026-05-29 late) — Watch → iPhone conflict resolution outbound.
    ///
    /// Fires when the user picked "中止 iPhone 保留 Watch" in the conflict
    /// alert sheet that landed after `start-reconcile { status: 'conflict' }`.
    /// Tells iPhone to hard-delete its now-losing session row (per
    /// NEW-Q50 Q5 escalation tail — first-write-wins is being overridden
    /// by explicit user choice on Watch).
    ///
    /// Fire-and-forget per Q5 design (matches sendStartFromWatchTUI):
    ///   - `transferUserInfo` queues even if iPhone is unreachable.
    ///   - `sendMessage` ALSO fires when reachable for instant UX —
    ///     iPhone's onStartResolve is idempotent (discardSession is a
    ///     sequence of `DELETE WHERE` no-ops on already-deleted rows)
    ///     so dual-delivery is safe.
    ///   - No `replyHandler` / no `await` — caller (alert handler in
    ///     SetLoggerView) dismisses the alert immediately and continues
    ///     the local Watch session. iPhone delivery is best-effort.
    ///
    /// Payload shape matches TS `StartResolvePayload`:
    ///   {localSessionId, existingSessionId}
    /// — both required strings. iPhone uses `existingSessionId` as the
    /// hard-delete target via `discardSession`.
    func sendStartResolveToiPhone(
        localSessionId: String,
        existingSessionId: String
    ) {
        guard let session, session.activationState == .activated else {
            lastOutbound = "start-resolve skip: not activated"
            return
        }
        guard !localSessionId.isEmpty, !existingSessionId.isEmpty else {
            lastOutbound = "start-resolve skip: empty sessionId"
            return
        }

        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            "ts": Int64(Date().timeIntervalSince1970 * 1000),
            "kind": "start-resolve",
            "payload": [
                "localSessionId": localSessionId,
                "existingSessionId": existingSessionId,
            ],
        ]

        // Dual-fire like sendStartFromWatchTUI — TUI is the always-on
        // queued path; sendMessage is the instant path when reachable.
        session.transferUserInfo(envelope)
        var status = "tui"
        if session.isReachable {
            session.sendMessage(
                envelope,
                replyHandler: nil,
                errorHandler: { [weak self] err in
                    Task { @MainActor [weak self] in
                        let ns = err as NSError
                        self?.lastOutbound =
                            "start-resolve msg ERR code=\(ns.code) \(err.localizedDescription)"
                    }
                }
            )
            status = "tui+msg"
        }
        lastOutbound =
            "start-resolve \(status) sent local=\(prefix8(localSessionId)) → "
            + "discard=\(prefix8(existingSessionId))"
    }

    /// LEGACY (pre-NEW-Q50) — Send `start-from-watch` to iPhone with
    /// the user's 3-tuple + await reply. Uses sendMessage + replyHandler
    /// which requires `isReachable=true` (i.e., iPhone app foregrounded).
    /// PickerViewModel no longer calls this — kept around as a fallback
    /// reference until D31 conflict UI ships + Wave 2 cleanup retires it.
    @available(*, deprecated, message: "Use sendStartFromWatchTUI (NEW-Q50 D29) — TUI path works in background.")
    func sendStartFromWatch(
        templateId: String?,
        programCycleId: String?,
        intensityId: String?
    ) async -> StartFromWatchReply? {
        guard let session, session.activationState == .activated else {
            lastOutbound = "start-from-watch skip: not activated"
            return nil
        }
        guard session.isReachable else {
            lastOutbound = "start-from-watch skip: iPhone unreachable"
            return nil
        }

        // Per StartFromWatchPayload (payloadSchema.ts): all 3 fields
        // present, null for absent. NSNull bridges to JSON null on
        // the WC wire; plain `nil` in a Swift `[String: Any]` drops
        // the key entirely which makes TS-side optional-chain checks
        // pass with `undefined` (then JSON.stringify drops it).
        // Stick with NSNull to match the protocol shape verbatim.
        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            "ts": Int64(Date().timeIntervalSince1970 * 1000),
            "kind": "start-from-watch",
            "payload": [
                "templateId": (templateId as Any?) ?? NSNull(),
                "programCycleId": (programCycleId as Any?) ?? NSNull(),
                "intensityId": (intensityId as Any?) ?? NSNull(),
            ],
        ]

        lastOutbound = "start-from-watch sent"
            + " template=\(templateId.map(prefix8) ?? "—")"
            + " program=\(programCycleId.map(prefix8) ?? "—")"
            + " intensity=\(intensityId.map(prefix8) ?? "—")"

        return await withCheckedContinuation { (cont: CheckedContinuation<StartFromWatchReply?, Never>) in
            session.sendMessage(
                envelope,
                replyHandler: { [weak self] reply in
                    Task { @MainActor [weak self] in
                        guard let parsed = StartFromWatchReply.parse(from: reply) else {
                            self?.lastInbound = "start-from-watch reply: unparseable"
                            cont.resume(returning: nil)
                            return
                        }
                        if parsed.isOK, let snapshot = parsed.snapshot {
                            self?.lastInbound =
                                "session sess=\(self?.prefix8(parsed.sessionId) ?? "?") "
                            + "ex=\(snapshot.exercises.count)"
                        } else {
                            self?.lastInbound =
                                "start-from-watch reply: iPhone failed"
                        }
                        cont.resume(returning: parsed)
                    }
                },
                errorHandler: { [weak self] error in
                    Task { @MainActor [weak self] in
                        self?.lastOutbound =
                            "start-from-watch err: \(error.localizedDescription)"
                        cont.resume(returning: nil)
                    }
                }
            )
        }
    }

    /// Send the `handshake` envelope to iPhone and await the Stage 1
    /// reply. Updates `lastOutbound` / `lastInbound` for debug
    /// readout. Idempotent: safe to call from multiple sites (e.g.
    /// cold-launch bootstrap + 🔄 refresh button).
    func requestHandshake(clientVersion: String = "13d.0") async -> Stage1Reply? {
        guard let session, session.activationState == .activated else {
            lastOutbound = "handshake skip: not activated"
            return nil
        }
        guard session.isReachable else {
            lastOutbound = "handshake skip: iPhone unreachable"
            return nil
        }

        let requestId = UUID().uuidString
        let envelope: [String: Any] = [
            "msgId": UUID().uuidString,
            "ts": Int64(Date().timeIntervalSince1970 * 1000),
            "kind": "handshake",
            "payload": [
                "requestId": requestId,
                "clientVersion": clientVersion,
            ],
        ]

        lastOutbound = "handshake req=\(prefix8(requestId))…"

        // withCheckedContinuation: the WC framework calls EITHER
        // replyHandler OR errorHandler, never both — Apple's contract.
        // Resuming twice would crash via the runtime's resumed-once
        // check; we rely on framework correctness here rather than
        // adding a redundant guard.
        return await withCheckedContinuation { (cont: CheckedContinuation<Stage1Reply?, Never>) in
            session.sendMessage(
                envelope,
                replyHandler: { [weak self] reply in
                    Task { @MainActor [weak self] in
                        let stage1 = Stage1Reply.parse(from: reply)
                        // Race check: drop replies that don't echo our
                        // current requestId (e.g. stale reply for a
                        // previous launch's nonce).
                        guard let stage1, stage1.requestId == requestId else {
                            self?.lastInbound = "handshake reply: malformed or stale"
                            cont.resume(returning: nil)
                            return
                        }
                        self?.lastInbound =
                            "stage1 reply templates=\(stage1.prefetch.templates.count)"
                        + (stage1.hasActiveSession ? " (active)" : "")
                        cont.resume(returning: stage1)
                    }
                },
                errorHandler: { [weak self] error in
                    Task { @MainActor [weak self] in
                        self?.lastOutbound =
                            "handshake err: \(error.localizedDescription)"
                        cont.resume(returning: nil)
                    }
                }
            )
        }
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
            // 2026-05-29 deep-night smoke fix (Bug 3): publish the
            // sessionId so SetLoggerView can subscribe + auto-dismiss.
            // Set BEFORE replyHandler so iPhone gets ack with UI already
            // teared down (no double-trigger surface).
            self.lastIncomingEnd = sessionId
            replyHandler(["ok": true])
        }
    }

    // MARK: - NEW-Q50 D30 — Reverse TUI inbound
    //
    // iPhone replies to Watch-initiated `start-from-watch` (TUI) via
    // its own `sendUserInfo(makeEnvelope('start-reconcile', ...))`
    // (per `app/(tabs)/index.tsx` D9 wave-2 wire-in). The iOS WC
    // framework delivers it here regardless of foreground state.
    //
    // We parse the envelope by `kind` and route:
    //   - `start-reconcile` → publish to `lastReconcile` (D31 conflict
    //     UI subscribes; D29/D30 just diagnostic).
    //   - Other kinds → drop silently (forward-compat for D32 set/etc.
    //     when those land via appContext instead).
    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        // Synchronous envelope shape validation; bail before MainActor hop
        // if it's noise (e.g. lib housekeeping payload).
        guard let kind = userInfo["kind"] as? String else { return }
        guard kind == "start-reconcile" else {
            // Unknown / not-our-business envelope kind. Logged on main
            // actor for diagnostic visibility.
            Task { @MainActor [weak self] in
                self?.lastInbound = "TUI ignored kind=\(kind)"
            }
            return
        }
        guard let payload = userInfo["payload"] as? [String: Any] else {
            Task { @MainActor [weak self] in
                self?.lastInbound = "start-reconcile: bad payload"
            }
            return
        }

        let parsed = StartReconcileResult.parse(from: payload)
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.lastReconcile = parsed
            switch parsed {
            case .created(let sessionId):
                self.lastInbound = "reconcile created sess=\(self.prefix8(sessionId))"
            case .conflict(let local, let existing, _, _):
                self.lastInbound =
                    "reconcile CONFLICT local=\(self.prefix8(local)) "
                    + "vs existing=\(self.prefix8(existing))"
            case .unparseable:
                self.lastInbound = "start-reconcile: unparseable payload"
            }
        }
    }
}

// MARK: - NEW-Q50 D30 — start-reconcile envelope payload

/// Mirror of TS `StartReconcilePayload` (src/adapters/watch/payloadSchema.ts).
/// Discriminated union by `status` field; `'created'` is the success
/// path, `'conflict'` indicates iPhone had a different active session
/// (first-write-wins per Q5).
///
/// `.unparseable` covers wire shape we can't decode — surfaces to UI
/// as a diagnostic so we don't silently swallow protocol drift.
enum StartReconcileResult: Equatable {
    case created(sessionId: String)
    case conflict(
        localSessionId: String,
        existingSessionId: String,
        existingTitle: String,
        existingStartedAt: Int64
    )
    case unparseable

    static func parse(from payload: [String: Any]) -> StartReconcileResult {
        guard let status = payload["status"] as? String else { return .unparseable }
        guard let sessionId = payload["sessionId"] as? String else { return .unparseable }
        switch status {
        case "created":
            return .created(sessionId: sessionId)
        case "conflict":
            guard
                let existingSessionId = payload["existingSessionId"] as? String,
                let existingTitle = payload["existingTitle"] as? String
            else {
                return .unparseable
            }
            // existingStartedAt is epoch ms; tolerate both Int64 and Int
            // wire shapes (JSON delivers a NSNumber the WC framework
            // unboxes inconsistently across iOS versions).
            let startedAtRaw = payload["existingStartedAt"]
            let existingStartedAt: Int64
            if let i64 = startedAtRaw as? Int64 {
                existingStartedAt = i64
            } else if let i = startedAtRaw as? Int {
                existingStartedAt = Int64(i)
            } else if let n = startedAtRaw as? NSNumber {
                existingStartedAt = n.int64Value
            } else {
                return .unparseable
            }
            return .conflict(
                localSessionId: sessionId,
                existingSessionId: existingSessionId,
                existingTitle: existingTitle,
                existingStartedAt: existingStartedAt
            )
        default:
            return .unparseable
        }
    }
}
