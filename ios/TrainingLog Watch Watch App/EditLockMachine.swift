//
//  EditLockMachine.swift
//  TrainingLog Watch
//
//  Cast edit-token lock — pure state machine (ADR-0028). SWIFT MIRROR of
//  `src/adapters/watch/editLock.ts` (the source of truth, jest-tested there).
//  Keep the two line-for-line so the protocol can't drift across platforms.
//
//  Cast (投影 session) abandoned simultaneous bidirectional editing because two
//  independent async actors writing the same session is structurally race-prone
//  ("打地鼠"). The replacement is a mutual-exclusion EDIT TOKEN: exactly one
//  side is the HOLDER (edits + pushes one-way live-mirror); the other is LOCKED
//  (read-only mirror + lock overlay + unlock button). A monotonic `epoch`
//  arbitrates every transfer; the race CLASS is eliminated by construction
//  because the locked side never produces edits.
//
//  This file is the *pure* slice — no SwiftUI, no WatchConnectivity, no clock
//  (`Date()` / timers live in the impure `CastEditLock` shell). The host feeds
//  events in and performs the returned EFFECTS (send a WC message, arm/cancel a
//  timer, apply a snapshot, show the timeout dialog).
//
//  Invariants (mirrored from ADR-0028 / editLock.ts):
//    INV-1 mutual exclusion — at most one HOLDER at a time. A transient
//          "both non-holder" window during handover is allowed (neither can
//          edit = safe); two HOLDERs in steady state is never allowed.
//    INV-2 epoch monotonic — every successful transfer bumps the epoch. Any
//          inbound message with epoch < mine is dropped; epoch > mine means
//          "I've been superseded" → demote to LOCKED + adopt (universal
//          self-heal / force-take detection).
//    INV-3 direction follows holder — only the HOLDER emits live-mirror.
//    INV-4 cast-only — the lock exists only while a cast pairing is active;
//          UNPAIRED = solo session = normal editing.
//

import Foundation

/// Which physical side this state machine instance runs on. On the Watch this
/// is always `.watch`; `.iphone` exists for parity with the TS reducer (so the
/// two ports stay byte-identical) and for unit tests that simulate both ends.
enum EditLockRole: String, Equatable {
    case iphone
    case watch
}

/// Per-side lock status (see editLock.ts `EditLockStatus`).
///   unpaired   — no cast active. Solo editing, no lock (INV-4).
///   holder     — holds the token; may edit; pushes one-way mirror.
///   offering   — held the token, received a lock-request: editing PAUSED, final
///                snapshot flushed via the grant, waiting for the requester's ack.
///   locked     — read-only live mirror + lock overlay + unlock button.
///   requesting — locked side pressed unlock: sent lock-request, awaiting grant
///                (with a request timeout that escalates to force-take/keep-lock).
enum EditLockStatus: String, Equatable {
    case unpaired
    case holder
    case offering
    case locked
    case requesting
}

struct EditLockState: Equatable {
    var role: EditLockRole
    var status: EditLockStatus
    /// Current token generation. 0 while unpaired / pre-pairing.
    var epoch: Int
    /// The cast session this lock governs, or nil while unpaired.
    var sessionId: String?
    /// Set while in `requesting` AND the request timer has fired: the host shows
    /// the force-take / keep-lock dialog. Cleared on resolution or any grant/sync.
    var requestTimedOut: Bool
}

/// The lock-* subset of WC kinds (the only kinds this machine emits). The raw
/// values are the exact wire `kind` strings (mirror `WCMessageKind`).
enum LockMessageKind: String, Equatable {
    case request = "lock-request"
    case grant = "lock-grant"
    case ack = "lock-ack"
    case takeover = "lock-takeover"
    case sync = "lock-sync"
}

/// A side-effect the host must perform after a transition (see editLock.ts
/// `EditLockEffect`).
enum EditLockEffect: Equatable {
    /// Send a lock-* WC message at `epoch`. `withSnapshot` → attach a fresh
    /// session-tree snapshot (grant / sync flush).
    case send(kind: LockMessageKind, epoch: Int, withSnapshot: Bool)
    /// Apply the snapshot carried by the inbound event (grant / sync).
    case applySnapshot
    case startRequestTimer
    case cancelRequestTimer
    case startAckTimer
    case cancelAckTimer
    case showTimeoutDialog
    case hideTimeoutDialog
}

/// Inputs to the reducer. `epoch` on `recv*` is the inbound message's epoch.
enum EditLockEvent: Equatable {
    /// This side initiated / re-asserted a cast (iPhone). Bumps epoch, becomes holder.
    case castInitiated(sessionId: String)
    /// This (Watch) side received a cast-session at `epoch` → becomes locked.
    case castReceived(sessionId: String, epoch: Int)
    /// User tapped 解除鎖定 on the locked side.
    case unlockPressed
    case recvLockRequest(epoch: Int)
    case recvLockGrant(epoch: Int)
    case recvLockAck(epoch: Int)
    case recvLockTakeover(epoch: Int)
    case recvLockSync(epoch: Int)
    /// A holder's live-mirror landed (the locked side applies; epoch arbitrates).
    case recvMirror(epoch: Int)
    /// The request timer fired without a grant.
    case requestTimeout
    /// The granter's ack timer fired without an ack.
    case ackTimeout
    /// User chose 強制取得控制權 in the timeout dialog.
    case forceTake
    /// User chose 保留鎖定 in the timeout dialog.
    case keepLock
    /// The session ended (either side) → tear down the pairing.
    case ended
}

struct EditLockResult: Equatable {
    var state: EditLockState
    var effects: [EditLockEffect]
}

func initialEditLockState(_ role: EditLockRole) -> EditLockState {
    EditLockState(
        role: role,
        status: .unpaired,
        epoch: 0,
        sessionId: nil,
        requestTimedOut: false
    )
}

/// True when this side may perform editing mutations. UNPAIRED (solo session,
/// no lock) and HOLDER may edit; OFFERING (handover in flight), LOCKED, and
/// REQUESTING may not. The host gates every edit handler on this.
func canEdit(_ state: EditLockState) -> Bool {
    state.status == .unpaired || state.status == .holder
}

/// True when the lock-overlay + unlock button should be shown.
func isLockedOut(_ state: EditLockState) -> Bool {
    state.status == .locked
        || state.status == .requesting
        || state.status == .offering
}

/// Pure transition. Returns the next state + effects for the host to run.
/// Mirror of editLock.ts `reduceEditLock` — keep the branches in lock-step.
func reduceEditLock(_ state: EditLockState, _ event: EditLockEvent) -> EditLockResult {
    switch event {
    case let .castInitiated(sessionId):
        // iPhone casts (or re-casts) — become holder, bump the generation so a
        // re-cast re-asserts control over a Watch that may have advanced epoch.
        let epoch = state.epoch + 1
        var next = state
        next.status = .holder
        next.epoch = epoch
        next.sessionId = sessionId
        next.requestTimedOut = false
        return done(next, [.cancelRequestTimer, .cancelAckTimer])

    case let .castReceived(sessionId, epoch):
        // Watch receives a cast. A different sessionId = brand-new pairing
        // (adopt unconditionally). Same session = honour epoch monotonicity.
        let isNewPairing = sessionId != state.sessionId
        if !isNewPairing && epoch < state.epoch {
            return done(state, []) // stale re-cast, drop
        }
        var next = state
        next.status = .locked
        next.epoch = epoch
        next.sessionId = sessionId
        next.requestTimedOut = false
        return done(next, [.applySnapshot, .cancelRequestTimer, .cancelAckTimer])

    case .unlockPressed:
        // Only meaningful from a locked state.
        guard state.status == .locked else { return done(state, []) }
        var next = state
        next.status = .requesting
        next.requestTimedOut = false
        return done(next, [
            .send(kind: .request, epoch: state.epoch, withSnapshot: false),
            .startRequestTimer,
        ])

    case let .recvLockRequest(epoch):
        // UNPAIRED = not (yet) in this pairing — typically a holder mid-restart
        // whose async lock restore hasn't run. Do NOT demote here: a lock-request
        // expects US to be the holder and grant it; demoting to LOCKED leaves
        // NOBODY able to grant → both sides locked-out forever (the device "對方沒
        // 回應 → iPhone 重開 → 卡死 / force-take 對方不降級 / 雙鎖死" class). Ignore
        // it; restore (re-announce lock-sync) or a re-cast establishes our real role.
        guard state.status != .unpaired else { return done(state, []) }
        // A higher epoch than mine means I'm already superseded — demote.
        if epoch > state.epoch { return demote(state, epoch) }
        // Holder grants; OFFERING re-grants. A requester that lost a grant (it hit
        // the request-timeout, chose 保留鎖定, then re-pressed 解除鎖定) sends a
        // fresh lock-request@epoch while we're still parked in `offering` awaiting
        // an ack that will never come (its first grant was dropped because it had
        // already gone back to `locked`). Without re-granting we'd silently drop
        // the new request and the requester times out AGAIN (對方沒回應) even
        // though we're alive — re-send the grant + restart the ack timer so the
        // handover completes. (Idempotent: a duplicate grant at the same epoch is
        // dropped by a requester that already became holder.)
        guard state.status == .holder || state.status == .offering else {
            return done(state, [])
        }
        if epoch < state.epoch {
            // Stale requester — re-lock it at the current generation, don't grant.
            return done(state, [
                .send(kind: .sync, epoch: state.epoch, withSnapshot: true),
            ])
        }
        // Valid request at my epoch → offer: pause editing, flush, await ack.
        let nextEpoch = state.epoch + 1
        var next = state
        next.status = .offering
        return done(next, [
            .send(kind: .grant, epoch: nextEpoch, withSnapshot: true),
            .startAckTimer,
        ])

    case let .recvLockGrant(epoch):
        // Accept a grant only while requesting and only if it advances the epoch.
        guard state.status == .requesting else { return done(state, []) }
        guard epoch > state.epoch else { return done(state, []) }
        var next = state
        next.status = .holder
        next.epoch = epoch
        next.requestTimedOut = false
        return done(next, [
            .applySnapshot,
            .send(kind: .ack, epoch: epoch, withSnapshot: false),
            .cancelRequestTimer,
            .hideTimeoutDialog,
        ])

    case let .recvLockAck(epoch):
        // Granter confirms handover → go locked. Only honour the ack for the
        // epoch I actually granted (state.epoch + 1, since offering kept my epoch).
        guard state.status == .offering else { return done(state, []) }
        guard epoch == state.epoch + 1 else { return done(state, []) }
        var next = state
        next.status = .locked
        next.epoch = epoch
        return done(next, [.cancelAckTimer])

    case let .recvLockTakeover(epoch):
        // The other side force-took. If it advances the epoch, I'm demoted.
        if epoch > state.epoch { return demote(state, epoch) }
        return done(state, [])

    case let .recvLockSync(epoch):
        // Holder re-locked me at the current generation.
        if epoch < state.epoch { return done(state, []) }
        var next = state
        next.status = .locked
        next.epoch = epoch
        next.requestTimedOut = false
        return done(next, [.applySnapshot, .cancelRequestTimer, .hideTimeoutDialog])

    case let .recvMirror(epoch):
        if state.status == .unpaired { return done(state, []) }
        if epoch > state.epoch {
            // Superseded by a newer holder — demote + apply its mirror.
            return demote(state, epoch)
        }
        if epoch < state.epoch { return done(state, []) } // stale, drop
        // Same epoch: only the locked side meaningfully applies a holder's mirror.
        if state.status == .locked || state.status == .requesting {
            return done(state, [.applySnapshot])
        }
        return done(state, []) // holder/offering ignore same-epoch echoes

    case .requestTimeout:
        guard state.status == .requesting else { return done(state, []) }
        var next = state
        next.requestTimedOut = true
        return done(next, [.showTimeoutDialog])

    case .ackTimeout:
        // Handover failed (grant or ack lost) → reclaim the token at the SAME
        // epoch. If the other side actually became holder (ack lost), its next
        // message carries a higher epoch and demotes me (INV-2 self-heal).
        guard state.status == .offering else { return done(state, []) }
        var next = state
        next.status = .holder
        return done(next, [.cancelAckTimer])

    case .forceTake:
        // From the timeout dialog. Unilaterally claim the next epoch.
        guard state.status == .requesting else { return done(state, []) }
        let nextEpoch = state.epoch + 1
        var next = state
        next.status = .holder
        next.epoch = nextEpoch
        next.requestTimedOut = false
        return done(next, [
            .send(kind: .takeover, epoch: nextEpoch, withSnapshot: false),
            .cancelRequestTimer,
            .hideTimeoutDialog,
        ])

    case .keepLock:
        guard state.status == .requesting else { return done(state, []) }
        var next = state
        next.status = .locked
        next.requestTimedOut = false
        return done(next, [.cancelRequestTimer, .hideTimeoutDialog])

    case .ended:
        return done(initialEditLockState(state.role), [
            .cancelRequestTimer,
            .cancelAckTimer,
            .hideTimeoutDialog,
        ])
    }
}

// MARK: - helpers

private func done(_ state: EditLockState, _ effects: [EditLockEffect]) -> EditLockResult {
    EditLockResult(state: state, effects: effects)
}

/// Universal INV-2 self-heal: an inbound message carrying an epoch strictly
/// greater than ours means we've been superseded (normal grant we missed, or a
/// force-take). Adopt the new epoch, go LOCKED, apply whatever snapshot rode in,
/// and tear down any pending request/ack timers + dialog.
private func demote(_ state: EditLockState, _ epoch: Int) -> EditLockResult {
    var next = state
    next.status = .locked
    next.epoch = epoch
    next.requestTimedOut = false
    return done(next, [
        .applySnapshot,
        .cancelRequestTimer,
        .cancelAckTimer,
        .hideTimeoutDialog,
    ])
}
