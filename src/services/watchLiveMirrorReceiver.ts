/**
 * Slice 13d D32 — iPhone applicationContext live-mirror receiver.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 Q6 (frozen 2026-05-29 evening). The
 * Watch is the source of truth during a live session; it builds a full
 * `SessionSnapshot` and pushes it via `WCSession.updateApplicationContext`
 * every ~15s (debounce + dirty flag, Watch-side D29). The OS delivers
 * ONLY the latest payload — applicationContext has latest-state-replace
 * semantics, NOT a FIFO queue (unlike transferUserInfo / sendMessage).
 *
 * This orchestrator is the iPhone-side inbound half:
 *   inbound applicationContext object
 *     → runtime-validate it parses to a SessionSnapshot
 *     → `replaceLiveMirror(db, snapshot)` (single-transaction UPSERT of
 *       the three session-shape tables — already shipped + tested)
 *     → return a structured result.
 *
 * NEW-Q50 demoted the live mirror from the deleted D19 6-kind
 * `liveMirrorReducer` + D20 per-field LWW to a plain snapshot replace:
 * the channel already collapses intermediate states, so a diff/merge
 * layer is wasted complexity, and LWW reconciliation moved into Watch
 * Swift in-memory state. There is therefore NO reducer/LWW step here —
 * the snapshot IS the resolved state. (See ADR-0019 § NEW-Q50 翻盤 table
 * rows D19/D20.)
 *
 * Wire contract — the applicationContext payload IS the `SessionSnapshot`
 * JSON shape directly (the same shape `handshake.snapshotToWire` emits
 * for the iPhone→Watch `start-from-iphone` envelope). It is NOT wrapped
 * in a `{ kind, payload }` WC envelope: applicationContext is a raw
 * snapshot dict, not envelope-shaped (see `connectivity.updateAppContext`
 * doc — `snapshot: object`).
 *
 *   // TODO(D32): the Watch Swift D29 SessionController that PRODUCES this
 *   // applicationContext is not built yet. The Q6 ADR pseudocode sketches
 *   // `{ session: { id, title, startedAt, exercises } }` with an `id`
 *   // field, but `SessionSnapshot` (the type `replaceLiveMirror` consumes
 *   // and that `snapshotToWire` already emits over the wire) uses
 *   // `sessionId`. We adopt the `SessionSnapshot` flat shape as the
 *   // canonical contract because it (a) matches the existing wire
 *   // projection, (b) feeds `replaceLiveMirror` with zero re-shaping, and
 *   // (c) keeps one snapshot shape across both directions. When D29 Swift
 *   // lands, confirm the Watch encodes `sessionId` (not `id`) and a flat
 *   // (not `{ session: ... }`-wrapped) dict — confirm w/ user.
 *
 * Contract (mirrors `watchSessionResolve.onStartResolve`):
 *   - NEVER throws. Bad payloads return `{ ok: false, code: 'bad-payload' }`;
 *     DB failures return `{ ok: false, code: 'db-error' }`. The caller (the
 *     `addAppContextListener` in `app/(tabs)/index.tsx`) just `void`s the
 *     promise and calls `refreshRef.current?.()` on return.
 *   - Idempotent. `replaceLiveMirror` is all `INSERT ... ON CONFLICT DO
 *     UPDATE` — re-applying the same snapshot (e.g. a redundant OS
 *     redelivery, or the same context observed twice) overwrites each row
 *     with identical values = a no-op. No row counts grow.
 *   - Authority-but-not-purge: rows present in the iPhone DB but absent
 *     from the snapshot are LEFT ALONE — purging snapshot-orphans is
 *     end-session reconcile's job (D7), not the live mirror's. This is
 *     `replaceLiveMirror`'s own contract (see its module doc).
 */

import type { Database } from '../db/types';
import type {
  SessionSnapshot,
  SessionSnapshotExercise,
  SessionSnapshotSet,
} from '../adapters/watch';
import { replaceLiveMirror } from './replaceLiveMirror';

/**
 * Aggregate outcome surfaced to the caller. Mostly for tests + a
 * potential future diagnostics overlay; the production caller in
 * index.tsx just `void`s the promise then refreshes.
 */
export type LiveMirrorResult =
  | { ok: true; sessionId: string; exerciseCount: number; setCount: number }
  | { ok: false; code: 'bad-payload' | 'db-error'; message: string };

const VALID_SET_KINDS: ReadonlySet<string> = new Set([
  'warmup',
  'working',
  'dropset',
  'superset',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Runtime-validate an untyped applicationContext object into a
 * `SessionSnapshot`. Returns `null` on any structural mismatch — the
 * orchestrator maps `null` to `bad-payload` and drops the tick (the
 * Watch pushes a fresh snapshot every ~15s, so a single dropped
 * malformed payload self-heals on the next tick).
 *
 * We validate strictly enough to guarantee `replaceLiveMirror`'s SQL
 * binds get well-typed values (no `undefined`, correct nullability) but
 * tolerate the forward-compat `rpe` / `rest_sec` placeholder fields
 * (snapshot-only — `replaceLiveMirror` already ignores them at the DB
 * layer).
 */
export function parseLiveMirrorSnapshot(ctx: unknown): SessionSnapshot | null {
  if (!isObject(ctx)) return null;

  const { sessionId, title, startedAt, exercises } = ctx;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (typeof title !== 'string') return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  if (!Array.isArray(exercises)) return null;

  const parsedExercises: SessionSnapshotExercise[] = [];
  for (const rawEx of exercises) {
    if (!isObject(rawEx)) return null;
    const {
      sessionExerciseId,
      exerciseId,
      exerciseName,
      ordering,
      plannedSets,
      sets,
    } = rawEx;
    if (typeof sessionExerciseId !== 'string' || sessionExerciseId.length === 0) {
      return null;
    }
    if (typeof exerciseId !== 'string' || exerciseId.length === 0) return null;
    if (typeof exerciseName !== 'string') return null;
    if (typeof ordering !== 'number' || !Number.isFinite(ordering)) return null;
    if (typeof plannedSets !== 'number' || !Number.isFinite(plannedSets)) {
      return null;
    }
    if (!Array.isArray(sets)) return null;

    const parsedSets: SessionSnapshotSet[] = [];
    for (const rawSet of sets) {
      if (!isObject(rawSet)) return null;
      const {
        setId,
        ordinal,
        weight,
        reps,
        rpe,
        rest_sec,
        notes,
        set_kind,
        is_logged,
      } = rawSet;
      if (typeof setId !== 'string' || setId.length === 0) return null;
      if (typeof ordinal !== 'number' || !Number.isFinite(ordinal)) return null;
      if (!isNullableFiniteNumber(weight)) return null;
      if (!isNullableFiniteNumber(reps)) return null;
      if (!isNullableFiniteNumber(rpe)) return null;
      if (!isNullableFiniteNumber(rest_sec)) return null;
      if (notes !== null && typeof notes !== 'string') return null;
      if (typeof set_kind !== 'string' || !VALID_SET_KINDS.has(set_kind)) {
        return null;
      }
      if (typeof is_logged !== 'boolean') return null;

      parsedSets.push({
        setId,
        ordinal,
        weight: weight as number | null,
        reps: reps as number | null,
        rpe: rpe as number | null,
        rest_sec: rest_sec as number | null,
        notes: notes as string | null,
        set_kind: set_kind as SessionSnapshotSet['set_kind'],
        is_logged,
      });
    }

    parsedExercises.push({
      sessionExerciseId,
      exerciseId,
      exerciseName,
      ordering,
      plannedSets,
      sets: parsedSets,
    });
  }

  return { sessionId, title, startedAt, exercises: parsedExercises };
}

function isNullableFiniteNumber(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * Handle an inbound applicationContext live-mirror snapshot. Validates,
 * then replaces the iPhone-side mirror of the three session-shape tables
 * via `replaceLiveMirror`.
 *
 * Errors are caught + returned as `{ok:false,...}` so the caller never
 * has to wrap in try/catch (mirrors `onStartResolve`).
 *
 * @param db   open Database handle
 * @param ctx  raw applicationContext object delivered by
 *             `addAppContextListener` (untyped — crossed the WC boundary)
 */
export async function onLiveMirror(
  db: Database,
  ctx: unknown,
): Promise<LiveMirrorResult> {
  const snapshot = parseLiveMirrorSnapshot(ctx);
  if (snapshot === null) {
    return {
      ok: false,
      code: 'bad-payload',
      message: 'applicationContext did not parse to a SessionSnapshot',
    };
  }
  try {
    await replaceLiveMirror(db, snapshot);
    const setCount = snapshot.exercises.reduce(
      (acc, ex) => acc + ex.sets.length,
      0,
    );
    return {
      ok: true,
      sessionId: snapshot.sessionId,
      exerciseCount: snapshot.exercises.length,
      setCount,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'db-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
