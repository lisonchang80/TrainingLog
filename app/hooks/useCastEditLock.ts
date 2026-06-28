/**
 * useCastEditLock — iPhone runtime for the cast edit-token lock (ADR-0028).
 *
 * Wraps the pure `editLock` state machine with the side-effects the iPhone host
 * needs: WC sends (lock-request/grant/ack/takeover/sync, dual-fired), request /
 * ack timers, applying an inbound flush snapshot, and keeping the live-mirror
 * producer's epoch in sync. The session screen (`app/(tabs)/index.tsx`) drives
 * it: it calls `castInitiated()` when the user taps 投影 Watch, feeds inbound
 * lock-* envelopes via `handleLockEnvelope`, feeds inbound live-mirror epochs via
 * `noteMirrorEpoch`, and gates editing on `canEdit` + renders the lock overlay
 * from `lock`.
 *
 * The state machine itself (and its invariants) lives in
 * `src/adapters/watch/editLock.ts` and is unit-tested there; this hook is the
 * impure shell, kept thin.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Database } from '@/src/db/types';
import {
  initialEditLockState,
  reduceEditLock,
  canEdit as canEditState,
  isLockedOut as isLockedOutState,
  makeEnvelope,
  sendMessage,
  sendUserInfo,
  type EditLockState,
  type EditLockEvent,
  type EditLockEffect,
  type LockMessageKind,
  type WCMessage,
} from '@/src/adapters/watch';
import {
  buildLiveMirrorPayload,
  setLiveMirrorEpoch,
} from '@/src/services/iphoneLiveMirrorProducer';

/** No grant within this window after pressing 解除鎖定 → show the timeout dialog. */
const REQUEST_TIMEOUT_MS = 6000;
/** No ack within this window after granting → reclaim the token (transfer aborted). */
const ACK_TIMEOUT_MS = 4000;

export interface UseCastEditLockArgs {
  db: Database;
  /** The active in-progress session id, or null when none. */
  sessionId: string | null;
  /**
   * Apply an inbound flush snapshot (lock-grant / lock-sync) to the iPhone DB.
   * The host wraps `onLiveMirror(db, snapshot)` + a UI refresh in
   * `runWhileApplyingRemoteSnapshot` so the producer doesn't bounce it back.
   */
  applyInboundSnapshot: (snapshot: Record<string, unknown>) => Promise<void>;
}

export interface CastEditLock {
  lock: EditLockState;
  /** True when this side may edit (holder or solo/unpaired). */
  canEdit: boolean;
  /** True when the lock overlay + unlock button should be shown. */
  isLockedOut: boolean;
  /** iPhone cast (or re-assert). Returns the new epoch to seed the cast-session. */
  castInitiated: () => number;
  /** User tapped 解除鎖定 on the locked iPhone. */
  requestUnlock: () => void;
  /** Timeout dialog: 強制取得控制權. */
  forceTake: () => void;
  /** Timeout dialog: 保留鎖定. */
  keepLock: () => void;
  /** Dispatch an inbound lock-* envelope into the machine. */
  handleLockEnvelope: (env: WCMessage) => void;
  /** Feed an inbound live-mirror's epoch (for supersede / self-heal detection). */
  noteMirrorEpoch: (epoch: number | undefined) => void;
  /** The cast session ended / was discarded → tear the lock down. */
  notifyEnded: () => void;
}

export function useCastEditLock({
  db,
  sessionId,
  applyInboundSnapshot,
}: UseCastEditLockArgs): CastEditLock {
  const [lock, setLock] = useState<EditLockState>(() =>
    initialEditLockState('iphone'),
  );
  // Ref mirror so async effect runners + timers read the latest state without
  // a stale closure.
  const lockRef = useRef(lock);
  lockRef.current = lock;

  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRequestTimer = useCallback(() => {
    if (requestTimer.current) {
      clearTimeout(requestTimer.current);
      requestTimer.current = null;
    }
  }, []);
  const clearAckTimer = useCallback(() => {
    if (ackTimer.current) {
      clearTimeout(ackTimer.current);
      ackTimer.current = null;
    }
  }, []);

  /** Send a lock-* envelope, dual-fired (instant + TUI backstop), dedup by msgId. */
  const sendLock = useCallback(
    async (kind: LockMessageKind, epoch: number, withSnapshot: boolean) => {
      const sid = lockRef.current.sessionId;
      if (!sid) return;
      let snapshot: Record<string, unknown> | undefined;
      if (withSnapshot) {
        const built = await buildLiveMirrorPayload(db, sid);
        if (built) snapshot = built as unknown as Record<string, unknown>;
      }
      const payload =
        kind === 'lock-grant' || kind === 'lock-sync'
          ? { sessionId: sid, epoch, snapshot: snapshot ?? {} }
          : { sessionId: sid, epoch };
      // makeEnvelope is typed per-kind; `kind` here is the lock union, so the
      // inferred envelope isn't narrowed to a single WCMessage member — cast.
      const env = makeEnvelope(kind, payload as never) as WCMessage;
      sendUserInfo(env); // durable backstop first
      void sendMessage(env).catch(() => {}); // instant when reachable
    },
    [db],
  );

  /**
   * Run the effects a transition produced. `inboundSnapshot` is the snapshot the
   * triggering inbound envelope carried (lock-grant / lock-sync), applied when
   * the machine asks for apply-snapshot. recv-mirror passes none (the existing
   * onLiveMirror path already applied it — here we only track the epoch).
   */
  const runEffects = useCallback(
    (
      effects: EditLockEffect[],
      inboundSnapshot?: Record<string, unknown>,
    ) => {
      for (const e of effects) {
        switch (e.type) {
          case 'send':
            void sendLock(e.kind, e.epoch, e.withSnapshot);
            break;
          case 'apply-snapshot':
            if (inboundSnapshot) {
              void applyInboundSnapshot(inboundSnapshot);
            }
            break;
          case 'start-request-timer':
            clearRequestTimer();
            requestTimer.current = setTimeout(() => {
              dispatchRef.current({ type: 'request-timeout' });
            }, REQUEST_TIMEOUT_MS);
            break;
          case 'cancel-request-timer':
            clearRequestTimer();
            break;
          case 'start-ack-timer':
            clearAckTimer();
            ackTimer.current = setTimeout(() => {
              dispatchRef.current({ type: 'ack-timeout' });
            }, ACK_TIMEOUT_MS);
            break;
          case 'cancel-ack-timer':
            clearAckTimer();
            break;
          // show/hide-timeout-dialog are reflected by state.requestTimedOut,
          // which the overlay reads directly — no imperative effect needed.
          case 'show-timeout-dialog':
          case 'hide-timeout-dialog':
            break;
        }
      }
    },
    [sendLock, applyInboundSnapshot, clearRequestTimer, clearAckTimer],
  );

  /** Reduce + commit + run effects. Stable via ref so timers can call it. */
  const dispatch = useCallback(
    (event: EditLockEvent, inboundSnapshot?: Record<string, unknown>) => {
      const { state, effects } = reduceEditLock(lockRef.current, event);
      lockRef.current = state;
      setLock(state);
      setLiveMirrorEpoch(state.sessionId ?? '', state.epoch);
      runEffects(effects, inboundSnapshot);
    },
    [runEffects],
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const castInitiated = useCallback((): number => {
    if (!sessionId) return lockRef.current.epoch;
    dispatch({ type: 'cast-initiated', sessionId });
    return lockRef.current.epoch;
  }, [dispatch, sessionId]);

  const requestUnlock = useCallback(() => dispatch({ type: 'unlock-pressed' }), [dispatch]);
  const forceTake = useCallback(() => dispatch({ type: 'force-take' }), [dispatch]);
  const keepLock = useCallback(() => dispatch({ type: 'keep-lock' }), [dispatch]);
  const notifyEnded = useCallback(() => dispatch({ type: 'ended' }), [dispatch]);

  const noteMirrorEpoch = useCallback(
    (epoch: number | undefined) => {
      if (epoch == null) return;
      dispatch({ type: 'recv-mirror', epoch });
    },
    [dispatch],
  );

  const handleLockEnvelope = useCallback(
    (env: WCMessage) => {
      switch (env.kind) {
        case 'lock-request':
          dispatch({ type: 'recv-lock-request', epoch: env.payload.epoch });
          break;
        case 'lock-grant':
          dispatch(
            { type: 'recv-lock-grant', epoch: env.payload.epoch },
            env.payload.snapshot as Record<string, unknown>,
          );
          break;
        case 'lock-ack':
          dispatch({ type: 'recv-lock-ack', epoch: env.payload.epoch });
          break;
        case 'lock-takeover':
          dispatch({ type: 'recv-lock-takeover', epoch: env.payload.epoch });
          break;
        case 'lock-sync':
          dispatch(
            { type: 'recv-lock-sync', epoch: env.payload.epoch },
            env.payload.snapshot as Record<string, unknown>,
          );
          break;
        default:
          break;
      }
    },
    [dispatch],
  );

  // Reset the lock when the active session changes (new session = clean slate).
  const prevSessionId = useRef<string | null>(sessionId);
  useEffect(() => {
    if (prevSessionId.current !== sessionId) {
      prevSessionId.current = sessionId;
      clearRequestTimer();
      clearAckTimer();
      const fresh = initialEditLockState('iphone');
      lockRef.current = fresh;
      setLock(fresh);
      setLiveMirrorEpoch(sessionId ?? '', 0);
    }
  }, [sessionId, clearRequestTimer, clearAckTimer]);

  // Tear down timers on unmount.
  useEffect(
    () => () => {
      clearRequestTimer();
      clearAckTimer();
    },
    [clearRequestTimer, clearAckTimer],
  );

  return {
    lock,
    canEdit: canEditState(lock),
    isLockedOut: isLockedOutState(lock),
    castInitiated,
    requestUnlock,
    forceTake,
    keepLock,
    handleLockEnvelope,
    noteMirrorEpoch,
    notifyEnded,
  };
}
