/**
 * Cast edit-token lock — pure state machine (ADR-0028).
 *
 * Cast (投影 session) abandoned simultaneous bidirectional editing because two
 * independent async actors writing the same session is structurally race-prone.
 * The replacement is a mutual-exclusion EDIT TOKEN: exactly one side is the
 * HOLDER (edits + pushes one-way live-mirror); the other is LOCKED (read-only
 * mirror + lock overlay + unlock button). A monotonic `epoch` arbitrates every
 * transfer; the race CLASS is eliminated by construction because the locked side
 * never produces edits.
 *
 * This module is the *pure* slice of the protocol — no React, no native bridge,
 * no Date.now / Math.random — so jest can prove the invariants and the Watch
 * Swift port (`SessionInteractionState` edit-lock fields) can mirror the logic
 * line-for-line. The host (iPhone session screen / Watch coordinator) feeds
 * events in and performs the returned EFFECTS (send a WC message, arm/cancel a
 * timer, apply a snapshot, show the timeout dialog).
 *
 * Invariants (mirrored from ADR-0028):
 *   INV-1 mutual exclusion — at most one HOLDER at a time. A transient
 *         "both non-holder" window during handover is allowed (neither can
 *         edit = safe); two HOLDERs in steady state is never allowed.
 *   INV-2 epoch monotonic — every successful transfer bumps the epoch. Any
 *         inbound message with epoch < mine is dropped; epoch > mine means
 *         "I've been superseded" → demote to LOCKED + adopt (universal
 *         self-heal / force-take detection).
 *   INV-3 direction follows holder — only the HOLDER emits live-mirror.
 *   INV-4 cast-only — the lock exists only while a cast pairing is active;
 *         UNPAIRED = solo session = normal editing.
 */

import type { WCMessageKind } from './payloadSchema';

/** Which physical side this state machine instance runs on. */
export type EditLockRole = 'iphone' | 'watch';

/**
 * Per-side lock status.
 *   unpaired   — no cast active. Solo editing, no lock (INV-4).
 *   holder     — holds the token; may edit; pushes one-way mirror.
 *   offering   — held the token, received a lock-request: editing PAUSED, final
 *                snapshot flushed via the grant, waiting for the requester's ack.
 *   locked     — read-only live mirror + lock overlay + unlock button.
 *   requesting — locked side pressed unlock: sent lock-request, awaiting grant
 *                (with a request timeout that escalates to force-take/keep-lock).
 */
export type EditLockStatus =
  | 'unpaired'
  | 'holder'
  | 'offering'
  | 'locked'
  | 'requesting';

export interface EditLockState {
  role: EditLockRole;
  status: EditLockStatus;
  /** Current token generation. 0 while unpaired / pre-pairing. */
  epoch: number;
  /** The cast session this lock governs, or null while unpaired. */
  sessionId: string | null;
  /**
   * Set while in `requesting` AND the request timer has fired: the host shows
   * the force-take / keep-lock dialog. Cleared on resolution or any grant/sync.
   */
  requestTimedOut: boolean;
}

/** A side-effect the host must perform after a transition. */
export type EditLockEffect =
  /** Send a lock-* WC message at `epoch`. `withSnapshot` → attach a fresh
   *  session-tree snapshot (grant / sync flush). */
  | { type: 'send'; kind: LockMessageKind; epoch: number; withSnapshot: boolean }
  /** Apply the snapshot carried by the inbound event (grant / sync / mirror). */
  | { type: 'apply-snapshot' }
  | { type: 'start-request-timer' }
  | { type: 'cancel-request-timer' }
  | { type: 'start-ack-timer' }
  | { type: 'cancel-ack-timer' }
  | { type: 'show-timeout-dialog' }
  | { type: 'hide-timeout-dialog' };

/** The lock-* subset of WC kinds (the only kinds this machine emits). */
export type LockMessageKind = Extract<
  WCMessageKind,
  'lock-request' | 'lock-grant' | 'lock-ack' | 'lock-takeover' | 'lock-sync'
>;

/** Inputs to the reducer. `epoch` on `recv-*` is the inbound message's epoch. */
export type EditLockEvent =
  /** This (iPhone) side initiated / re-asserted a cast. Bumps epoch, becomes holder. */
  | { type: 'cast-initiated'; sessionId: string }
  /** This (Watch) side received a cast-session at `epoch` → becomes locked. */
  | { type: 'cast-received'; sessionId: string; epoch: number }
  /**
   * Restart recovery — this side reclaims the token as HOLDER at a GIVEN epoch
   * (no bump), used only from UNPAIRED. After an app restart the persisted-lock
   * restore can miss (stays unpaired), so when a lock-request arrives for THIS
   * side's active session the host adopts holder at the requester's epoch so the
   * subsequent recv-lock-request grants instead of being ignored. The host gates
   * this on sessionId match (the reducer can't see the session).
   */
  | { type: 'reclaim-holder'; sessionId: string; epoch: number }
  /** User tapped 解除鎖定 on the locked side. */
  | { type: 'unlock-pressed' }
  | { type: 'recv-lock-request'; epoch: number }
  | { type: 'recv-lock-grant'; epoch: number }
  | { type: 'recv-lock-ack'; epoch: number }
  | { type: 'recv-lock-takeover'; epoch: number }
  | { type: 'recv-lock-sync'; epoch: number }
  /** A holder's live-mirror landed (the locked side applies; epoch arbitrates). */
  | { type: 'recv-mirror'; epoch: number }
  /** The request timer fired without a grant. */
  | { type: 'request-timeout' }
  /** The granter's ack timer fired without an ack. */
  | { type: 'ack-timeout' }
  /** User chose 強制取得控制權 in the timeout dialog. */
  | { type: 'force-take' }
  /** User chose 保留鎖定 in the timeout dialog. */
  | { type: 'keep-lock' }
  /** The session ended (either side) → tear down the pairing. */
  | { type: 'ended' };

export interface EditLockResult {
  state: EditLockState;
  effects: EditLockEffect[];
}

export function initialEditLockState(role: EditLockRole): EditLockState {
  return {
    role,
    status: 'unpaired',
    epoch: 0,
    sessionId: null,
    requestTimedOut: false,
  };
}

/**
 * True when this side may perform editing mutations. UNPAIRED (solo session, no
 * lock) and HOLDER may edit; OFFERING (handover in flight), LOCKED, and
 * REQUESTING may not. The host gates every edit handler on this.
 */
export function canEdit(state: EditLockState): boolean {
  return state.status === 'unpaired' || state.status === 'holder';
}

/** True when the lock-overlay + unlock button should be shown. */
export function isLockedOut(state: EditLockState): boolean {
  return (
    state.status === 'locked' ||
    state.status === 'requesting' ||
    state.status === 'offering'
  );
}

/** Pure transition. Returns the next state + effects for the host to run. */
export function reduceEditLock(
  state: EditLockState,
  event: EditLockEvent,
): EditLockResult {
  switch (event.type) {
    case 'cast-initiated': {
      // iPhone casts (or re-casts) — become holder, bump the generation so a
      // re-cast re-asserts control over a Watch that may have advanced epoch.
      const epoch = state.epoch + 1;
      return done(
        { ...state, status: 'holder', epoch, sessionId: event.sessionId, requestTimedOut: false },
        [{ type: 'cancel-request-timer' }, { type: 'cancel-ack-timer' }],
      );
    }

    case 'cast-received': {
      // Watch receives a cast. A different sessionId = brand-new pairing
      // (adopt unconditionally). Same session = honour epoch monotonicity.
      const isNewPairing = event.sessionId !== state.sessionId;
      if (!isNewPairing && event.epoch < state.epoch) {
        return done(state, []); // stale re-cast, drop
      }
      return done(
        {
          ...state,
          status: 'locked',
          epoch: event.epoch,
          sessionId: event.sessionId,
          requestTimedOut: false,
        },
        [
          { type: 'apply-snapshot' },
          { type: 'cancel-request-timer' },
          { type: 'cancel-ack-timer' },
        ],
      );
    }

    case 'reclaim-holder': {
      // Restart recovery — adopt holder at the GIVEN epoch (no bump). Only from
      // UNPAIRED (a live holder/locked/offering side must not be silently
      // overwritten). The host fires this just before recv-lock-request when an
      // unpaired side gets a request for its active session, so the request then
      // grants (holder path) instead of being ignored (unpaired guard).
      if (state.status !== 'unpaired') return done(state, []);
      return done(
        {
          ...state,
          status: 'holder',
          epoch: event.epoch,
          sessionId: event.sessionId,
          requestTimedOut: false,
        },
        [],
      );
    }

    case 'unlock-pressed': {
      // Only meaningful from a locked state.
      if (state.status !== 'locked') return done(state, []);
      return done({ ...state, status: 'requesting', requestTimedOut: false }, [
        { type: 'send', kind: 'lock-request', epoch: state.epoch, withSnapshot: false },
        { type: 'start-request-timer' },
      ]);
    }

    case 'recv-lock-request': {
      // UNPAIRED = not (yet) in this pairing — typically a holder mid-restart
      // whose async lock restore hasn't run. Do NOT demote here: a lock-request
      // expects US to be the holder and grant it; demoting to LOCKED leaves
      // NOBODY able to grant → both sides locked-out forever. This is the root of
      // the device "對方沒回應 → iPhone 重開 → 卡死 / force-take 對方不降級 / 雙鎖
      // 死" class: the iPhone restarts (unpaired@0), the Watch's (retried) request
      // lands before the async holder-restore runs, demote flips iPhone to LOCKED,
      // and restore then SKIPS (status already advanced past unpaired). Ignore it;
      // the restore's re-announce (lock-sync) — or a re-cast — establishes our real
      // role, and the requester's retry is granted once we're holder again.
      if (state.status === 'unpaired') return done(state, []);
      // A higher epoch than mine means I'm already superseded — demote.
      if (event.epoch > state.epoch) return demote(state, event.epoch);
      // Holder grants; OFFERING re-grants. A requester that lost a grant (it hit
      // the request-timeout, chose 保留鎖定, then re-pressed 解除鎖定) sends a
      // fresh lock-request@epoch while we're still parked in `offering` awaiting
      // an ack that will never come (its first grant was dropped because it had
      // already gone back to `locked`). Without re-granting we'd silently drop
      // the new request and the requester times out AGAIN (對方沒回應) even
      // though we're alive — re-send the grant + restart the ack timer so the
      // handover completes. (Idempotent: a duplicate grant at the same epoch is
      // dropped by a requester that already became holder.)
      if (state.status !== 'holder' && state.status !== 'offering') {
        return done(state, []);
      }
      if (event.epoch < state.epoch) {
        // Stale requester — re-lock it at the current generation, don't grant.
        return done(state, [
          { type: 'send', kind: 'lock-sync', epoch: state.epoch, withSnapshot: true },
        ]);
      }
      // Valid request at my epoch → offer: pause editing, flush, await ack.
      const nextEpoch = state.epoch + 1;
      return done({ ...state, status: 'offering' }, [
        { type: 'send', kind: 'lock-grant', epoch: nextEpoch, withSnapshot: true },
        { type: 'start-ack-timer' },
      ]);
    }

    case 'recv-lock-grant': {
      // Accept a grant only while requesting and only if it advances the epoch.
      if (state.status !== 'requesting') return done(state, []);
      if (event.epoch <= state.epoch) return done(state, []);
      return done(
        { ...state, status: 'holder', epoch: event.epoch, requestTimedOut: false },
        [
          { type: 'apply-snapshot' },
          { type: 'send', kind: 'lock-ack', epoch: event.epoch, withSnapshot: false },
          { type: 'cancel-request-timer' },
          { type: 'hide-timeout-dialog' },
        ],
      );
    }

    case 'recv-lock-ack': {
      // Granter confirms handover → go locked. Only honour the ack for the
      // epoch I actually granted (state.epoch + 1, since offering kept my epoch).
      if (state.status !== 'offering') return done(state, []);
      if (event.epoch !== state.epoch + 1) return done(state, []);
      return done(
        { ...state, status: 'locked', epoch: event.epoch },
        [{ type: 'cancel-ack-timer' }],
      );
    }

    case 'recv-lock-takeover': {
      // The other side force-took. If it advances the epoch, I'm demoted.
      if (event.epoch > state.epoch) return demote(state, event.epoch);
      return done(state, []);
    }

    case 'recv-lock-sync': {
      // Holder re-locked me at the current generation.
      if (event.epoch < state.epoch) return done(state, []);
      return done(
        {
          ...state,
          status: 'locked',
          epoch: event.epoch,
          requestTimedOut: false,
        },
        [
          { type: 'apply-snapshot' },
          { type: 'cancel-request-timer' },
          { type: 'hide-timeout-dialog' },
        ],
      );
    }

    case 'recv-mirror': {
      if (state.status === 'unpaired') return done(state, []);
      if (event.epoch > state.epoch) {
        // Superseded by a newer holder — demote + apply its mirror.
        return demote(state, event.epoch);
      }
      if (event.epoch < state.epoch) return done(state, []); // stale, drop
      // Same epoch: only the locked side meaningfully applies a holder's mirror.
      if (state.status === 'locked' || state.status === 'requesting') {
        return done(state, [{ type: 'apply-snapshot' }]);
      }
      return done(state, []); // holder/offering ignore same-epoch echoes
    }

    case 'request-timeout': {
      if (state.status !== 'requesting') return done(state, []);
      return done({ ...state, requestTimedOut: true }, [
        { type: 'show-timeout-dialog' },
      ]);
    }

    case 'ack-timeout': {
      // Handover failed (grant or ack lost) → reclaim the token at the SAME
      // epoch. If the other side actually became holder (ack lost), its next
      // message carries a higher epoch and demotes me (INV-2 self-heal).
      if (state.status !== 'offering') return done(state, []);
      return done({ ...state, status: 'holder' }, [{ type: 'cancel-ack-timer' }]);
    }

    case 'force-take': {
      // From the timeout dialog. Unilaterally claim the next epoch.
      if (state.status !== 'requesting') return done(state, []);
      const nextEpoch = state.epoch + 1;
      return done(
        { ...state, status: 'holder', epoch: nextEpoch, requestTimedOut: false },
        [
          { type: 'send', kind: 'lock-takeover', epoch: nextEpoch, withSnapshot: false },
          { type: 'cancel-request-timer' },
          { type: 'hide-timeout-dialog' },
        ],
      );
    }

    case 'keep-lock': {
      if (state.status !== 'requesting') return done(state, []);
      return done({ ...state, status: 'locked', requestTimedOut: false }, [
        { type: 'cancel-request-timer' },
        { type: 'hide-timeout-dialog' },
      ]);
    }

    case 'ended': {
      return done(initialEditLockState(state.role), [
        { type: 'cancel-request-timer' },
        { type: 'cancel-ack-timer' },
        { type: 'hide-timeout-dialog' },
      ]);
    }

    default:
      // Exhaustiveness guard — a new event type must be handled above.
      return assertNever(event);
  }
}

function assertNever(event: never): never {
  throw new TypeError(`Unhandled EditLockEvent: ${JSON.stringify(event)}`);
}

// --- helpers ---------------------------------------------------------------

function done(state: EditLockState, effects: EditLockEffect[]): EditLockResult {
  return { state, effects };
}

/**
 * Universal INV-2 self-heal: an inbound message carrying an epoch strictly
 * greater than ours means we've been superseded (normal grant we missed, or a
 * force-take). Adopt the new epoch, go LOCKED, apply whatever snapshot rode in,
 * and tear down any pending request/ack timers + dialog.
 */
function demote(state: EditLockState, epoch: number): EditLockResult {
  return done(
    {
      ...state,
      status: 'locked',
      epoch,
      requestTimedOut: false,
    },
    [
      { type: 'apply-snapshot' },
      { type: 'cancel-request-timer' },
      { type: 'cancel-ack-timer' },
      { type: 'hide-timeout-dialog' },
    ],
  );
}
