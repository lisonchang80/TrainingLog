import { randomUUID } from 'expo-crypto';
import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  addAppContextListener,
  addMessageListener,
  addUserInfoListener,
  makeEnvelope,
  onHandshakeRequest,
  onHistoryRequest,
  onStartFromWatch,
  sendUserInfo,
} from '@/src/adapters/watch';
import type { Database } from '@/src/db/types';
import { onLiveMirror } from '@/src/services/watchLiveMirrorReceiver';
import { onDiscardSession } from '@/src/services/watchSessionDiscard';
import { onStartResolve } from '@/src/services/watchSessionResolve';
import {
  applyHrTick,
  applyKcalTick,
  type WatchLiveTicks,
} from '@/src/services/watchLiveTicksReceiver';

/**
 * Signature of the Training tab's `finalizeEndAndRoute` (declared in
 * app/(tabs)/index.tsx and surfaced to this hook through a ref). Mirrored
 * here so the end-session route closure stays fully typed without a
 * circular import back into the component.
 */
type FinalizeEndAndRoute = (
  sessionId: string,
  opts?: {
    endedAt?: number;
    snapshot?: unknown;
    fromWatchInbound?: boolean;
  },
) => Promise<void>;

/**
 * Watch⇄iPhone live-sync listener cluster (report 09 #2, 2026-06-20).
 *
 * Owns the two `useEffect`s that wire every inbound WC channel the
 * Training tab listens on — lifted verbatim from app/(tabs)/index.tsx
 * where they sat buried mid-file (the densest, most race-sensitive block
 * in the app's largest component). The per-message *handling* already
 * lives in `src/services/watch*` + `src/adapters/watch`; this hook owns
 * only the subscription wiring + cleanup, so the listeners become a
 * named, greppable unit instead of an inline closure.
 *
 * Behaviour preserved 1:1 — same channels, same handlers, same intentional
 * empty deps (listeners mount once on mount; the freshest `refresh` /
 * `finalizeEndAndRoute` closures are read through the passed refs, so the
 * effects never re-subscribe on re-render). `db` is a stable handle.
 *
 * ⚠️ Touches live Watch sync — any change here is device-smoke-gated
 * (real Watch round-trip), NOT a blind merge.
 */
export function useWatchSync(
  db: Database,
  {
    refreshRef,
    finalizeEndAndRouteRef,
    setWatchLiveTicks,
  }: {
    /** Ref to the latest Training-tab `refresh` closure. */
    refreshRef: RefObject<(() => void) | null>;
    /** Ref to the latest `finalizeEndAndRoute` closure. */
    finalizeEndAndRouteRef: RefObject<FinalizeEndAndRoute | null>;
    /** Setter for the display-only hr/kcal 5-tile panel state. */
    setWatchLiveTicks: Dispatch<SetStateAction<WatchLiveTicks | null>>;
  },
): void {
  useEffect(() => {
    // Slice 13d WC ship-blocker E1/E2 (grill 2026-05-30, Q1/Q2/Q4) —
    // listen on BOTH WC channels for a Watch-led end:
    //   - addMessageListener  → instant delivery when iPhone is reachable
    //   - addUserInfoListener → transferUserInfo backstop, OS-queued so it
    //     STILL arrives when iPhone was backgrounded / locked / out of
    //     range at end time. Without this TUI listener a Watch [完成]
    //     fired while iPhone unreachable was lost forever → session row
    //     kept ended_at NULL → every future start refused (the E1 zombie).
    // Both route to the same finalize; the ended_at idempotent gate inside
    // finalizeEndAndRoute makes the second (dual-fire) delivery a no-op, so
    // the two channels can't diverge (end is terminal — unlike start, E4).
    // `fromWatchInbound: true` tells the gate a duplicate delivery must
    // NOT router.push（2026-06-11 fix — 雙發都到時完成頁跳兩次）；只有
    // iPhone-led（按鈕）在 already-ended 時才需要補跳頁。
    // The envelope now carries `endedAt` (Q4 — real finish time) + the
    // final `snapshot` (Q1/Q2 — reconcile-by-membership purge); both are
    // forwarded to finalize.
    const routeEnd = async (
      sessionId: string,
      endedAt?: number,
      snapshot?: unknown,
    ) => {
      const fn = finalizeEndAndRouteRef.current;
      if (!fn) return;
      try {
        await fn(sessionId, { endedAt, snapshot, fromWatchInbound: true });
      } catch (e) {
        console.warn('[watch] end-session handler failed:', e);
      }
    };
    // Defensive: ignore own outbound. iPhone-led envelopes carry
    // side='iphone'; Apple's WC framework doesn't echo a device's own
    // sends back to its own listeners, but this guard is cheap insurance
    // against bridge weirdness / future loopback testing.
    const unsubMsg = addMessageListener('end-session', async (env) => {
      if (env.payload.side !== 'watch') return;
      await routeEnd(
        env.payload.sessionId,
        env.payload.endedAt,
        env.payload.snapshot,
      );
    });
    const unsubTui = addUserInfoListener('end-session', async (env) => {
      if (env.payload.side !== 'watch') return;
      await routeEnd(
        env.payload.sessionId,
        env.payload.endedAt,
        env.payload.snapshot,
      );
    });
    return () => {
      unsubMsg();
      unsubTui();
    };
    // Intentional empty deps — handlers read latest finalize closure
    // via ref. Listeners mount once on component mount, unsubscribe
    // on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D9 wire-in (ADR-0019 NEW-Q44) — handshake + start-from-watch listeners.
  //
  // `handshake` (channel #0): Watch app launch fires this; iPhone replies
  // with Stage 1 (active session summary + template prefetch list). Watch
  // picker uses the reply to decide Adopt vs new-start without a second
  // round-trip.
  //
  // `start-from-watch` (channel #1): Watch picker user picked freestyle /
  // a template; iPhone creates the session row (or adopts the existing
  // one on race), flips is_watch_tracked=true, then replies with the
  // session snapshot. Watch hydrates its in-memory mirror from the reply.
  //
  // Both handlers receive a `replyHandler` from the bridge (lib's
  // 'message' callback signature: `(payload, replyHandler)`). The
  // orchestrators in `handshake.ts` invoke `replyHandler` with the
  // Stage1ReplyPayload / StartFromIphonePayload. Errors degrade to
  // empty replies (best-effort per Q11).
  //
  // After the handlers fire, `refresh()` re-reads the active session so
  // the iPhone UI flips into in-session mode if Watch initiated start.
  // refresh is called via the same component-scoped closure that other
  // listeners use, so we capture it via ref.
  useEffect(() => {
    const unsubHandshake = addMessageListener('handshake', async (env, reply) => {
      await onHandshakeRequest(db, env, reply);
    });
    // #311-A (2026-06-09 grill) — Watch 📊 查看歷史 pull-on-tap. Same
    // request-reply shape as handshake: the Watch sends
    // `history-request { exerciseId }`, we query + format display-ready
    // records (unit + locale resolved here) and ack via the replyHandler.
    // Reply shape lives in watchHistory.ts (not a modelled WC kind).
    const unsubHistory = addMessageListener('history-request', async (env, reply) => {
      await onHistoryRequest(db, env, reply);
    });
    // NEW-Q50 D9 Wave 2 wire-in (2026-05-29) — `start-from-watch` swapped
    // from sendMessage path (v1) to TUI transport (v2). The Watch
    // initiator side sends via `transferUserInfo` so the envelope queues
    // even if iPhone is unreachable (background / locked); we receive it
    // via `addUserInfoListener` once the OS delivers.
    //
    // The orchestrator emits `StartFromWatchReconcile` (a domain shape);
    // we wrap it in the `start-reconcile` envelope kind and ship back
    // via `sendUserInfo` (queued TUI — Watch picks it up next time it's
    // reachable). D30 Watch-side Swift handles the reverse-TUI receive.
    const unsubStartFromWatch = addUserInfoListener(
      'start-from-watch',
      async (env) => {
        // 2026-05-29 deep-night smoke fix (B2): pass `randomUUID` so
        // onStartFromWatch can route to `startSessionFromTemplate` when
        // the Watch supplies a templateId. Without uuid injection the
        // orchestrator falls back to the empty-title freestyle path
        // (banner shows 「空白訓練」 even if Watch picked a template).
        await onStartFromWatch(
          db,
          env,
          (response) => {
            sendUserInfo(makeEnvelope('start-reconcile', response));
          },
          randomUUID,
        );
        // Watch just created (or adopted) a session — refresh iPhone
        // state so the UI flips into in-session mode. Read latest
        // closure via ref.
        refreshRef.current?.();
      },
    );
    // NEW-Q50 D9 Wave 2 wire-in (2026-05-29) — `start-from-watch`
    // message-channel listener (the Watch's sendMessage leg).
    //
    // ⚠️ DO NOT REMOVE as "v1 compat debt" — verified 2026-06-12 (F3
    // cleanup STOP). An older revision of this comment said "REMOVE
    // THIS BLOCK once D30 active"; that became WRONG when audit-F4
    // made the msgId dedupe ring SHARED across both intake channels:
    //
    //   - Watch Swift `sendStartFromWatchTUI` + `resendStartFromWatch`
    //     still DUAL-FIRE the same envelope (same msgId) via
    //     transferUserInfo AND sendMessage (the sendMessage leg exists
    //     because foreground TUI latency is unpredictable — minutes of
    //     queueing observed 2026-05-29).
    //   - The 'message' intake (connectivity.ts) claims the msgId in
    //     the shared ring BEFORE the handler-existence check, and parks
    //     handler-less envelopes in the pre-handler buffer (#287 Fix C).
    //   - If this listener were removed: sendMessage leg arrives first
    //     (the common foreground case) → claims the ring → no message-
    //     channel handler → parked forever → the TUI leg is then
    //     dropped as a ring dup → `onStartFromWatch` never runs →
    //     Watch-initiated start silently lost on iPhone.
    //
    // So post-F4 this listener IS the live handling path whenever the
    // sendMessage leg wins intake; the TUI listener above owns the
    // TUI-leg-wins + background/queued-delivery cases. Removal
    // precondition: Watch Swift single-fires (TUI only) — ack is now
    // unified (below), but this leg is still the msg-leg dispatch path.
    const unsubStartFromWatchV1 = addMessageListener(
      'start-from-watch',
      async (env) => {
        // 2026-05-29 deep-night smoke fix (B2): same uuid injection as
        // the TUI path above — Watch templates need to materialise
        // template_name + exercise tree, not collapse to freestyle.
        await onStartFromWatch(
          db,
          env,
          (response) => {
            // 2026-06-12 (audit 01 F3 residual): the Watch sendMessage
            // leg fires with `replyHandler:nil`, so a message-channel
            // reply can never reach it — ack MUST go reverse-TUI like
            // the TUI path above, or a msg-leg win drops the
            // 'conflict' reconcile (alert intermittently missing).
            // Watch dedupes start-reconcile via Equatable onChange, so
            // an ack per winning leg is safe.
            sendUserInfo(makeEnvelope('start-reconcile', response));
          },
          randomUUID,
        );
        refreshRef.current?.();
      },
    );
    // D31 (2026-05-29 late) — start-resolve forward-TUI inbound.
    // Watch fires this after the user picked "中止 iPhone 保留 Watch"
    // in the conflict alert sheet that landed when start-reconcile
    // returned {status:'conflict'}. iPhone hard-deletes the now-losing
    // existingSessionId via discardSession (cascades sets +
    // session_exercise + achievement_unlock + edit-snapshot in one txn).
    //
    // No reply envelope — Watch dismissed its alert immediately on
    // tap. We call refresh() so the iPhone UI flips out of the
    // now-stale active-session mode (typical: idle banner returns
    // to "選擇訓練" since both the old session AND the new Watch
    // session might not yet be visible to iPhone — that's fine,
    // the standard start-reconcile pipeline adopts the Watch session
    // separately).
    const unsubStartResolve = addUserInfoListener(
      'start-resolve',
      async (env) => {
        await onStartResolve(db, env);
        refreshRef.current?.();
      },
    );
    // D31 wave 2 (2026-05-29 late) — discard-session forward-TUI inbound.
    // Watch fires this when the user tapped [放棄] in FinishPageView.
    // iPhone hard-deletes the row via discardSession (cascades sets /
    // session_exercise / achievement_unlock / edit-snapshot in one txn).
    //
    // Distinct from end-session: end-session preserves the row in history
    // (sets ended_at); discard-session deletes it entirely. User explicit
    // intent.
    const unsubDiscardSession = addUserInfoListener(
      'discard-session',
      async (env) => {
        await onDiscardSession(db, env);
        refreshRef.current?.();
      },
    );
    // D32 (2026-05-29) — applicationContext live-mirror inbound.
    // Per ADR-0019 § Slice 13d NEW-Q50 Q6. During a live session the
    // Watch is the SoT; it builds a full SessionSnapshot and pushes it
    // via `WCSession.updateApplicationContext` every ~15s (Watch-side
    // D29 — not yet shipped, see watchLiveMirrorReceiver TODO). The OS
    // delivers only the LATEST payload (latest-state-replace semantics,
    // no FIFO queue), so `onLiveMirror` unconditionally adopts it via
    // `replaceLiveMirror` snapshot-replace (no diff/reduce/LWW — the
    // most-recent snapshot IS the resolved state).
    //
    // The payload is a raw SessionSnapshot dict (not a {kind,payload}
    // envelope — applicationContext isn't envelope-shaped), so the
    // handler receives `ctx: object` directly; `onLiveMirror` runtime-
    // validates it. Never throws (returns {ok:false,...} on bad payload
    // / db error) — we just refresh so the iPhone in-session UI reflects
    // the latest mirrored sets/exercises.
    const unsubLiveMirror = addAppContextListener(async (ctx) => {
      await onLiveMirror(db, ctx);
      refreshRef.current?.();
    });
    // Sync fast lane (2026-06-01) — the SAME live-mirror snapshot, dual-fired
    // by the Watch over `sendMessage` for instant (<1s, FIFO-ordered) delivery
    // when the iPhone is reachable. applicationContext (above) stays as the
    // background backstop. Both route to the rev-guarded `onLiveMirror`, which
    // drops a stale redelivery so the two channels never clobber each other.
    // `env.payload` IS the raw SessionSnapshot dict (same shape the appContext
    // path delivers), so `onLiveMirror` consumes it identically. Riding
    // applicationContext alone was the "又慢、又亂、時有時無（尤其遞減組）"
    // regression — sendMessage is the real-time channel.
    const unsubLiveMirrorMsg = addMessageListener('live-mirror', async (env) => {
      await onLiveMirror(db, env.payload);
      refreshRef.current?.();
    });
    // point2 live-sync (2026-06-12) — hr-tick / kcal-tick inbound (Q4
    // channels #9/#10). The Watch's LiveTicksProducer throttles its D17
    // `streamedStats` stream to one emit per 3-5s and sends each metric
    // as its own `sendMessage` envelope (NO TUI — a durable queue
    // replaying stale ticks is worse than dropping them; NO appContext —
    // that slot is the live-mirror snapshot's backstop). Display-only:
    // no DB, no refresh() — just the React state feeding the 5-tile
    // panel's ❤️/🔥 tiles. The reducers runtime-validate + drop
    // stale/out-of-order ticks and return the SAME reference on reject,
    // so setState skips the re-render.
    const unsubHrTick = addMessageListener('hr-tick', (env) => {
      setWatchLiveTicks((prev) => applyHrTick(prev, env));
    });
    const unsubKcalTick = addMessageListener('kcal-tick', (env) => {
      setWatchLiveTicks((prev) => applyKcalTick(prev, env));
    });
    return () => {
      unsubHandshake();
      unsubHistory();
      unsubStartFromWatch();
      unsubStartFromWatchV1();
      unsubStartResolve();
      unsubDiscardSession();
      unsubLiveMirror();
      unsubLiveMirrorMsg();
      unsubHrTick();
      unsubKcalTick();
    };
    // Intentional empty deps — db handle stable; refresh read via ref.
    // Listeners mount once on component mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
