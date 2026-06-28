//
//  CastEditLock.swift
//  TrainingLog Watch
//
//  Cast edit-token lock — Watch runtime (ADR-0028). SWIFT MIRROR of
//  `app/hooks/useCastEditLock.ts`. Wraps the pure `EditLockMachine` reducer with
//  the impure side-effects the Watch host needs: WC sends (lock-request / grant
//  / ack / takeover / sync, dual-fired by the coordinator), request / ack
//  timers, applying an inbound flush snapshot (grant / sync) via the reverse-
//  sync engine, and keeping the forward live-mirror producer's HOLDER epoch +
//  forward-pause flag in sync so only the holder emits (INV-3).
//
//  `SetLoggerView` owns this as a `@StateObject` (mirror of how it owns the
//  `LiveMirrorProducer`) and drives it:
//    - `castReceived(sessionId:epoch:)` on mount when this session was CAST from
//      the iPhone (the Watch adopts the epoch + goes LOCKED; INV-4 cast-only —
//      a Watch-LED session stays UNPAIRED so editing is never gated).
//    - feeds inbound lock-* envelopes via `handleLockEnvelope` (routed by the
//      coordinator's WC delegate).
//    - feeds inbound iPhone live-mirror epochs via `noteMirrorEpoch` (also the
//      apply-gate for the reverse mirror — see that method).
//    - the UI reads `isLockedOut` to show the lock overlay + `lock` for its state.
//
//  The state machine + its invariants live in `EditLockMachine.swift` (pure,
//  mirrors the jest-tested editLock.ts); this is the thin impure shell.
//

import Foundation
import Combine

@MainActor
final class CastEditLock: ObservableObject {

    /// No grant within this window after pressing 解除鎖定 → show the timeout dialog.
    private static let requestTimeoutNanos: UInt64 = 6_000_000_000
    /// No ack within this window after granting → reclaim the token (transfer aborted).
    private static let ackTimeoutNanos: UInt64 = 4_000_000_000

    @Published private(set) var state: EditLockState = initialEditLockState(.watch)

    /// True when this side may edit (holder or solo/unpaired). Inlined (rather
    /// than calling the free `canEdit(_:)`) to avoid a same-name member/global
    /// collision; kept in lock-step with `EditLockMachine.canEdit`.
    var canEdit: Bool { state.status == .unpaired || state.status == .holder }
    /// True when the lock overlay + unlock button should be shown. Inlined; kept
    /// in lock-step with `EditLockMachine.isLockedOut`.
    var isLockedOut: Bool {
        state.status == .locked || state.status == .requesting || state.status == .offering
    }

    private weak var coordinator: WatchConnectivityCoordinator?
    /// Forward producer — we drive its `forwardPaused` (INV-3: only the holder
    /// emits) + `holderEpoch` (stamped on the outbound mirror), and read its
    /// `currentSnapshot()` for the grant/sync flush + `reverseSyncApply` to apply
    /// an inbound flush.
    private weak var producer: LiveMirrorProducer?

    private var requestTimer: Task<Void, Never>?
    private var ackTimer: Task<Void, Never>?

    /// msgId dedup — the dual-fire (sendMessage + transferUserInfo) delivers the
    /// same envelope twice. The epoch guards make a re-delivery idempotent, but
    /// dropping the second leg avoids a redundant re-apply of a grant/sync
    /// snapshot. Bounded ring (insertion-ordered).
    private var seenMsgIds: [String] = []
    private let seenMsgCap = 64

    /// Bind to the coordinator (sends) + producer (forward direction + flush
    /// snapshot + apply engine). Call once from `SetLoggerView`'s `.task` before
    /// the live-mirror producer's initial push, so a cast mount can pause the
    /// forward producer before it force-pushes (no echo of the cast back to iPhone).
    func configure(
        coordinator: WatchConnectivityCoordinator?,
        producer: LiveMirrorProducer?
    ) {
        self.coordinator = coordinator
        self.producer = producer
    }

    // MARK: - Host inputs

    /// This Watch adopted a session CAST from the iPhone at `epoch` → go LOCKED.
    /// (The iPhone is the cast initiator + holder per 發起方初握.) Drives
    /// `forwardPaused` true immediately so the producer's initial force-push is
    /// suppressed (INV-3 — the locked side never emits).
    func castReceived(sessionId: String, epoch: Int) {
        dispatch(.castReceived(sessionId: sessionId, epoch: epoch))
    }

    /// User tapped 解除鎖定 on the locked Watch.
    func requestUnlock() { dispatch(.unlockPressed) }
    /// Timeout dialog: 強制取得控制權.
    func forceTake() { dispatch(.forceTake) }
    /// Timeout dialog: 保留鎖定.
    func keepLock() { dispatch(.keepLock) }
    /// The cast session ended / was discarded → tear the lock down.
    func notifyEnded() { dispatch(.ended) }

    /// Dispatch an inbound lock-* envelope. `envelope` is the raw `[String:Any]`
    /// the WC delegate received (`{msgId, ts, kind, payload}`). Deduped by msgId.
    func handleLockEnvelope(_ envelope: [String: Any]) {
        guard let kind = envelope["kind"] as? String,
              let payload = envelope["payload"] as? [String: Any],
              let epoch = unboxEpoch(payload["epoch"]) else { return }
        let msgId = (envelope["msgId"] as? String) ?? ""
        if !msgId.isEmpty {
            if seenMsgIds.contains(msgId) { return }
            seenMsgIds.append(msgId)
            if seenMsgIds.count > seenMsgCap { seenMsgIds.removeFirst() }
        }
        // grant / sync carry a flush snapshot for the apply-snapshot effect.
        let snap: SessionSnapshot? = {
            guard kind == "lock-grant" || kind == "lock-sync",
                  let snapDict = payload["snapshot"] as? [String: Any]
            else { return nil }
            return SessionSnapshot.decodeInbound(snapDict)
        }()

        switch kind {
        case "lock-request": dispatch(.recvLockRequest(epoch: epoch))
        case "lock-grant": dispatch(.recvLockGrant(epoch: epoch), inboundSnapshot: snap)
        case "lock-ack": dispatch(.recvLockAck(epoch: epoch))
        case "lock-takeover": dispatch(.recvLockTakeover(epoch: epoch))
        case "lock-sync": dispatch(.recvLockSync(epoch: epoch), inboundSnapshot: snap)
        default: break
        }
    }

    /// Feed an inbound iPhone live-mirror's epoch AND decide whether the caller
    /// should apply the snapshot. Mirrors editLock.ts `recv-mirror` semantics:
    ///   - UNPAIRED (Watch-led session, no lock) → always apply (the pre-lock
    ///     C-core reverse-sync behaviour, untouched).
    ///   - cast session: route through the machine — apply at == while LOCKED /
    ///     REQUESTING, demote + apply at >, drop at <, ignore a same-epoch echo
    ///     while HOLDER/OFFERING. This gate is what stops a stray reverse-mirror
    ///     from a still-locked iPhone clobbering the Watch once it's the holder
    ///     (the iPhone forward producer is only gated by its apply-depth latch,
    ///     not by the lock — so the receiver must defend).
    /// Returns `true` iff the caller should `applyRemote(snap)`.
    func noteMirrorEpoch(_ epoch: Int?) -> Bool {
        if state.status == .unpaired { return true }
        guard let epoch else { return isLockedOut }
        let result = reduceEditLock(state, .recvMirror(epoch: epoch))
        // Commit + run the NON-apply effects (timers / dialog / forward-pause /
        // epoch). The apply itself is the caller's job (mirror TS: noteMirrorEpoch
        // carries no snapshot, the existing onLiveMirror path applies) — so the
        // .applySnapshot effect here is a no-op (inboundSnapshot nil) and we just
        // report whether the machine wanted it.
        commit(result, inboundSnapshot: nil)
        return result.effects.contains(.applySnapshot)
    }

    // MARK: - dispatch / effects

    private func dispatch(_ event: EditLockEvent, inboundSnapshot: SessionSnapshot? = nil) {
        commit(reduceEditLock(state, event), inboundSnapshot: inboundSnapshot)
    }

    private func commit(_ result: EditLockResult, inboundSnapshot: SessionSnapshot?) {
        state = result.state
        // Keep the forward producer aligned with the token: pause emission while
        // locked-out (INV-3) + stamp the current holder epoch on the mirror.
        producer?.setForwardPaused(isLockedOut)
        producer?.setHolderEpoch(state.epoch)
        runEffects(result.effects, inboundSnapshot: inboundSnapshot)
    }

    private func runEffects(_ effects: [EditLockEffect], inboundSnapshot: SessionSnapshot?) {
        for e in effects {
            switch e {
            case let .send(kind, epoch, withSnapshot):
                send(kind: kind, epoch: epoch, withSnapshot: withSnapshot)
            case .applySnapshot:
                if let snap = inboundSnapshot {
                    producer?.reverseSyncApply?.applyRemote(snap)
                }
            case .startRequestTimer:
                startRequestTimer()
            case .cancelRequestTimer:
                requestTimer?.cancel(); requestTimer = nil
            case .startAckTimer:
                startAckTimer()
            case .cancelAckTimer:
                ackTimer?.cancel(); ackTimer = nil
            // show/hide-timeout-dialog are reflected by state.requestTimedOut,
            // which the overlay reads directly — no imperative effect needed.
            case .showTimeoutDialog, .hideTimeoutDialog:
                break
            }
        }
    }

    private func send(kind: LockMessageKind, epoch: Int, withSnapshot: Bool) {
        guard let sid = state.sessionId else { return }
        let snapshot = withSnapshot ? producer?.currentSnapshot() : nil
        coordinator?.sendLock(kind: kind, sessionId: sid, epoch: epoch, snapshot: snapshot)
    }

    private func startRequestTimer() {
        requestTimer?.cancel()
        requestTimer = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.requestTimeoutNanos)
            guard !Task.isCancelled, let self else { return }
            self.dispatch(.requestTimeout)
        }
    }

    private func startAckTimer() {
        ackTimer?.cancel()
        ackTimer = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.ackTimeoutNanos)
            guard !Task.isCancelled, let self else { return }
            self.dispatch(.ackTimeout)
        }
    }

    deinit {
        requestTimer?.cancel()
        ackTimer?.cancel()
    }
}

/// Tolerant epoch unbox — WC delivers JSON numbers as Int / Int64 / NSNumber
/// inconsistently across iOS versions (same pattern as StartReconcileResult /
/// the rev unbox). Returns nil for a missing / non-numeric value.
private func unboxEpoch(_ raw: Any?) -> Int? {
    if let i = raw as? Int { return i }
    if let i64 = raw as? Int64 { return Int(i64) }
    if let n = raw as? NSNumber { return n.intValue }
    return nil
}
