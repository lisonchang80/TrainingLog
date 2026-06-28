/**
 * Slice 13d Phase B — iPhone-side live-mirror PRODUCER (reverse iPhone→Watch).
 *
 * The forward half (Watch→iPhone) ships: the Watch builds a `SessionSnapshot`
 * and DUAL-FIRES it via `sendMessage('live-mirror')` + `updateApplicationContext`,
 * stamped `originator:'watch'` + a monotonic `rev`; the iPhone applies it in
 * `watchLiveMirrorReceiver.onLiveMirror`. This module is the symmetric reverse
 * half: when the iPhone edits an in-session row (✓ logged / weight·reps /
 * add·delete exercise / title / notes), it re-reads the full session from
 * SQLite, stamps `originator:'iphone'` + a monotonic `rev`, and DUAL-FIRES the
 * SAME `live-mirror` shape back to the Watch (the Phase C Watch receiver
 * applies it as an overlay reverse-projection).
 *
 * Per ADR-0019 § 2026-06-24 (reverse-sync grill 拍板):
 *   - 拍板#3 transport = REUSE the existing `live-mirror` kind + dual-fire
 *     (`sendMessage` instant foreground + `updateApplicationContext`
 *     background backstop). The iPhone→Watch appContext slot is empty (the
 *     forward direction is Watch→iPhone), so it does NOT collide.
 *   - 拍板#7 ③ producer = debounce ~250–300ms, full snapshot (REUSE the
 *     handshake `fetchSessionSnapshot` builder), `originator:'iphone'`,
 *     monotonic `rev`, localised exerciseName (Bug Y contract — already done
 *     inside `fetchSessionSnapshot`) + notes.
 *   - 拍板#7 ② iPhone-side in-flight gate: while the iPhone is APPLYING a
 *     remote (Watch) snapshot, SUPPRESS producing — else applying a Watch
 *     snapshot → `refresh()` → push would bounce it straight back to the
 *     Watch (the iPhone half of the bidirectional echo guard; the Watch half
 *     is a Phase C producer-stop). Symmetric to the receiver's
 *     `originator==='iphone'` echo-drop.
 *
 * SCOPE (Phase B — ships INERT): this is the pure producer library + its jest
 * coverage. It is NOT yet wired into the in-session edit handlers / inbound-
 * apply suppression in `app/(tabs)/index.tsx` + `app/session/[id].tsx` — that
 * runtime wiring lands WITH Phase C (the Watch receiver) in a device session,
 * because a snapshot pushed with no Watch receiver to consume it has no
 * observable effect (ADR-0019 § 2026-06-24 拍板#8 Phase 綁定; plan
 * `docs/slice-13d-sync-phase-bc-plan.md`「B 不單獨 ship」).
 *
 * WIRE SHAPE — plist-clean OMIT-NULL. WC payloads (all three channels) are
 * plist-serialised and CANNOT carry JSON null (`NSNull` is not a plist type).
 * The forward Watch producer's Swift `JSONEncoder` OMITS nil optionals, and
 * `parseLiveMirrorSnapshot` normalises ABSENT → null for the nullable set
 * fields. We mirror that EXACTLY: this projection OMITS null optionals
 * (weight/reps/rpe/rest_sec/notes/parent_set_id/display_rank + the cluster
 * linkage) rather than emitting null, so the wire shape is byte-compatible
 * with the proven forward direction and the Phase C Watch receiver. (This is
 * why we do NOT reuse handshake's private `snapshotToWire`, which emits
 * explicit null for the `start-from-iphone` sendMessage reply.)
 */

import type { Database } from '../db/types';
import {
  fetchSessionSnapshot,
  makeEnvelope,
  sendMessage,
  updateAppContext,
  type JsonValue,
  type LiveMirrorPayload,
  type SessionSnapshot,
  type WCMessage,
} from '../adapters/watch';

/**
 * The two WC out-bound primitives the producer dual-fires through. Injected
 * (not module-mocked) so jest can assert the dispatch without a native bridge
 * — mirrors the receiver test's "take the raw object directly" philosophy.
 * Production binds the real `connectivity` functions (`defaultTransport`).
 */
export interface LiveMirrorTransport {
  /** Instant foreground channel (FIFO, <1s while reachable). */
  sendMessage: (env: WCMessage) => Promise<unknown> | unknown;
  /** Background backstop (latest-state-replace, OS-paced). */
  updateAppContext: (snapshot: object) => void;
}

const defaultTransport: LiveMirrorTransport = {
  sendMessage: (env) => sendMessage(env),
  updateAppContext: (snapshot) => updateAppContext(snapshot),
};

/** Debounce window — coalesce a burst of edits into one push (拍板#7 ③). */
export const LIVE_MIRROR_DEBOUNCE_MS = 280;

/**
 * Per-session monotonic `rev` (拍板#7 ① — the iPhone's OWN high-water, a
 * SEPARATE variable from the watch-rev the receiver tracks; the two sides
 * must never share a counter). `max(now, prev+1)` is restart-safe (ms-based,
 * so always "fresh enough" after a relaunch) AND strictly monotonic within a
 * run (so a same-ms burst still advances). The Watch receiver gates on this
 * `iphone-rev` high-water to drop a late dual-fired backstop.
 */
const lastRev = new Map<string, number>();

function nextRev(sessionId: string): number {
  const prev = lastRev.get(sessionId) ?? 0;
  const rev = Math.max(Date.now(), prev + 1);
  lastRev.set(sessionId, rev);
  return rev;
}

/**
 * ADR-0028 — per-session edit-token epoch the iPhone is currently editing
 * under (the lock hook sets this whenever the local lock state's epoch changes).
 * Every projection stamps it so the Watch's lock machine can arbitrate the
 * mirror (apply at ==, demote at >, drop at <). 0 = no cast pairing.
 */
const lockEpoch = new Map<string, number>();

/** Called by the iPhone edit-lock hook on every epoch change. */
export function setLiveMirrorEpoch(sessionId: string, epoch: number): void {
  lockEpoch.set(sessionId, epoch);
}

function epochFor(sessionId: string): number {
  return lockEpoch.get(sessionId) ?? 0;
}

/**
 * In-flight "applying a remote snapshot" gate (拍板#7 ②). A DEPTH counter,
 * not a boolean, so nested / overlapping applies don't clear it early. The
 * inbound-apply path (Phase C wiring) brackets its whole apply + `refresh()`
 * with begin/end; while depth > 0, the producer no-ops so an applied Watch
 * snapshot can't bounce back.
 */
let applyDepth = 0;

/** Enter an "applying remote snapshot" critical section (producer suppressed). */
export function beginApplyingRemoteSnapshot(): void {
  applyDepth += 1;
}

/** Leave the critical section. Clamped at 0 (a stray end can't go negative). */
export function endApplyingRemoteSnapshot(): void {
  applyDepth = Math.max(0, applyDepth - 1);
}

/** True while a remote snapshot is being applied (producer suppressed). */
export function isApplyingRemoteSnapshot(): boolean {
  return applyDepth > 0;
}

/**
 * Run `fn` inside an apply-remote critical section (producer suppressed for
 * its whole duration, including any `refresh()` it triggers). The `finally`
 * guarantees the gate releases even if `fn` throws. The Phase C inbound
 * handler wraps `onLiveMirror(...) + refresh()` with this.
 */
export async function runWhileApplyingRemoteSnapshot<T>(
  fn: () => Promise<T>,
): Promise<T> {
  beginApplyingRemoteSnapshot();
  try {
    return await fn();
  } finally {
    endApplyingRemoteSnapshot();
  }
}

/**
 * Build the iPhone→Watch live-mirror payload for `sessionId`: read the full
 * session via the shared `fetchSessionSnapshot` builder (localised
 * exerciseName + notes already applied at that boundary), then project to the
 * plist-clean omit-null wire shape + stamp `originator:'iphone'` + the next
 * monotonic `rev`. Returns `null` when the session does not exist (caller
 * skips the push).
 *
 * NOTE this ADVANCES the `rev` counter as a side effect — call it once per
 * intended push (the debounced `scheduleLiveMirrorPush` /
 * `pushLiveMirrorToWatch` do exactly that).
 */
export async function buildLiveMirrorPayload(
  db: Database,
  sessionId: string,
): Promise<StampedLiveMirrorPayload | null> {
  const snap = await fetchSessionSnapshot(db, sessionId);
  if (snap === null) return null;
  return projectToWire(snap, nextRev(sessionId));
}

/** A `LiveMirrorPayload` the producer always stamps with a concrete `rev`. */
type StampedLiveMirrorPayload = LiveMirrorPayload & { rev: number };

function projectToWire(
  snap: SessionSnapshot,
  rev: number,
): StampedLiveMirrorPayload {
  const exercises: JsonValue[] = snap.exercises.map((ex) => {
    const wireEx: Record<string, JsonValue> = {
      sessionExerciseId: ex.sessionExerciseId,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      ordering: ex.ordering,
      plannedSets: ex.plannedSets,
      sets: ex.sets.map((s) => {
        const wireSet: Record<string, JsonValue> = {
          setId: s.setId,
          ordinal: s.ordinal,
          set_kind: s.set_kind,
          is_logged: s.is_logged,
        };
        // OMIT null optionals (plist-clean — see module doc). `!= null`
        // collapses null + undefined; a real 0 (weight/reps/rest_sec) stays.
        if (s.weight != null) wireSet.weight = s.weight;
        if (s.reps != null) wireSet.reps = s.reps;
        if (s.rpe != null) wireSet.rpe = s.rpe;
        if (s.rest_sec != null) wireSet.rest_sec = s.rest_sec;
        if (s.notes != null) wireSet.notes = s.notes;
        if (s.parent_set_id != null) wireSet.parent_set_id = s.parent_set_id;
        if (s.display_rank != null) wireSet.display_rank = s.display_rank;
        return wireSet;
      }),
    };
    // Cluster linkage (D15 superset card) — omit when null, same rule.
    if (ex.parentId != null) wireEx.parentId = ex.parentId;
    if (ex.reusableSupersetId != null) {
      wireEx.reusableSupersetId = ex.reusableSupersetId;
    }
    return wireEx;
  });

  const epoch = epochFor(snap.sessionId);
  return {
    sessionId: snap.sessionId,
    title: snap.title,
    startedAt: snap.startedAt,
    originator: 'iphone',
    rev,
    // ADR-0028 — stamp the holder's token epoch (omit when 0/unpaired so a
    // pre-lock byte-compat shape is preserved for non-cast sessions).
    ...(epoch > 0 ? { epoch } : {}),
    exercises,
  };
}

/** Outcome of a push attempt (mostly for tests + a future diagnostics overlay). */
export type PushResult =
  | { pushed: true; rev: number }
  | { pushed: false; reason: 'suppressed' | 'no-session' };

/**
 * Build + DUAL-FIRE the current session snapshot to the Watch (拍板#3). No-op
 * (`suppressed`) while applying a remote snapshot (拍板#7 ②) — re-checked
 * AFTER the DB read too, since the apply gate can close during the await.
 *
 * Fire-and-forget (Q3 spirit): a transport error never rejects this promise —
 * a dropped push self-heals on the next edit's push. `sendMessage`'s own
 * reachability precheck means an unreachable Watch simply gets no instant
 * delivery; `updateAppContext` still lands the background backstop.
 */
export async function pushLiveMirrorToWatch(
  db: Database,
  sessionId: string,
  transport: LiveMirrorTransport = defaultTransport,
): Promise<PushResult> {
  if (applyDepth > 0) return { pushed: false, reason: 'suppressed' };
  const payload = await buildLiveMirrorPayload(db, sessionId);
  if (payload === null) return { pushed: false, reason: 'no-session' };
  // Re-check after the await: an inbound apply may have started during the DB
  // read. (`payload.rev` was already consumed; that's fine — revs are allowed
  // to skip, the receiver only needs monotonic-increasing.)
  if (applyDepth > 0) return { pushed: false, reason: 'suppressed' };

  // sendMessage — instant foreground. Swallow rejections (fire-and-forget).
  try {
    void Promise.resolve(
      transport.sendMessage(makeEnvelope('live-mirror', payload)),
    ).catch(() => {});
  } catch {
    /* synchronous throw from a bad transport — ignore, appContext still fires */
  }
  // updateApplicationContext — background backstop (latest-state-replace).
  try {
    transport.updateAppContext(payload);
  } catch {
    /* ignore — next edit re-pushes */
  }
  return { pushed: true, rev: payload.rev };
}

/**
 * Trailing-debounced push (拍板#7 ③). Coalesces a burst of in-session edits
 * (rapid ✓ / typing) into a single push `LIVE_MIRROR_DEBOUNCE_MS` after the
 * last edit. No-op if currently applying a remote snapshot (don't even arm a
 * timer that would fire a bounce).
 */
const pendingPush = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleLiveMirrorPush(
  db: Database,
  sessionId: string,
  transport: LiveMirrorTransport = defaultTransport,
): void {
  if (applyDepth > 0) return;
  const existing = pendingPush.get(sessionId);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    pendingPush.delete(sessionId);
    void pushLiveMirrorToWatch(db, sessionId, transport);
  }, LIVE_MIRROR_DEBOUNCE_MS);
  pendingPush.set(sessionId, handle);
}

/** Reset all module state (rev high-water, apply gate, pending timers). Test-only. */
export function __resetLiveMirrorProducerForTests(): void {
  lastRev.clear();
  applyDepth = 0;
  for (const handle of pendingPush.values()) clearTimeout(handle);
  pendingPush.clear();
}
