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
 *   D29 (2026-05-30) — the Watch Swift producer now PRODUCES this
 *   applicationContext (`LiveMirrorProducer.swift`). It projects the
 *   immutable start `SessionSnapshot` over the live `SessionInteractionState`
 *   overlay (logged ✓ → `is_logged`, edited cells → `weight`/`reps`) and
 *   pushes the result via `WCSession.updateApplicationContext` on a 15s
 *   debounce + dirty flag (Q6=a). The dict is FLAT (top-level `sessionId`,
 *   NOT a `{ session: { id, ... } }` wrapper) — matching the
 *   `SessionSnapshot` shape `replaceLiveMirror` consumes with zero
 *   re-shaping, so one snapshot shape spans both directions.
 *
 *   Transport caveat the parser below accommodates — WC applicationContext
 *   is plist-serialised and CANNOT carry JSON `null` (`NSNull` is not a
 *   plist type). Swift's `JSONEncoder` therefore OMITS nil optionals, so
 *   the per-set nullable fields (`weight` / `reps` / `rpe` / `rest_sec` /
 *   `notes`) arrive ABSENT, not null. `parseLiveMirrorSnapshot` normalises
 *   absent → null for exactly those five fields; required fields stay
 *   strict (an absent one is still a reject).
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
type LiveMirrorResult =
  | { ok: true; sessionId: string; exerciseCount: number; setCount: number }
  | { ok: false; code: 'bad-payload' | 'db-error' | 'stale'; message: string };

/**
 * Per-session monotonic-`rev` high-water mark (sync fast lane, 2026-06-01).
 *
 * The Watch DUAL-FIRES every live snapshot — `sendMessage` (instant, FIFO,
 * the <1s foreground channel) AND `updateApplicationContext` (background
 * backstop, latest-state-replace, OS-paced delivery). Both land in
 * `onLiveMirror`. Without a guard, a LATE applicationContext redelivery can
 * arrive carrying an OLDER state than a `sendMessage` already applied and
 * clobber it — the visible "亂七八糟 / 遞減組跳號" reorder. Each snapshot
 * carries a monotonic `rev` (ms-since-epoch from the Watch producer); we drop
 * any inbound whose `rev <= lastApplied[sessionId]`.
 *
 * In-memory + per-session — resets cleanly on iPhone app restart (a fresh
 * Watch push then re-seeds it; revs are absolute ms so always "fresh enough").
 * Keyed by sessionId (a UUID, never reused), so the map only grows by one
 * entry per session over the app's lifetime — negligible. `null`/absent `rev`
 * (a legacy pre-fix producer) bypasses the guard entirely (back-compat).
 */
const lastAppliedRev = new Map<string, number>();

/** Clear all per-session rev high-water marks. Test-only. */
export function __resetLiveMirrorRevForTests(): void {
  lastAppliedRev.clear();
}

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
      const { setId, ordinal, set_kind, is_logged } = rawSet;
      // WC applicationContext is plist-serialised and cannot carry JSON
      // null, so the D29 Watch producer OMITS nil optionals (Swift
      // JSONEncoder drops nil → the key arrives ABSENT). Normalise absent
      // → null for the five nullable set fields. `?? null` collapses ONLY
      // null/undefined — a real 0 stays 0 — so a malformed non-null value
      // (e.g. a string weight) still fails its type guard below. Required
      // fields (setId/ordinal/set_kind/is_logged) stay strict.
      const weight = rawSet.weight ?? null;
      const reps = rawSet.reps ?? null;
      const rpe = rawSet.rpe ?? null;
      const rest_sec = rawSet.rest_sec ?? null;
      const notes = rawSet.notes ?? null;
      // Dropset-chain parent. Like the other nullables it travels ABSENT for a
      // non-follower (Watch JSONEncoder drops nil) → normalise absent → null.
      const parent_set_id = rawSet.parent_set_id ?? null;
      if (typeof setId !== 'string' || setId.length === 0) return null;
      if (typeof ordinal !== 'number' || !Number.isFinite(ordinal)) return null;
      if (!isNullableFiniteNumber(weight)) return null;
      if (!isNullableFiniteNumber(reps)) return null;
      if (!isNullableFiniteNumber(rpe)) return null;
      if (!isNullableFiniteNumber(rest_sec)) return null;
      if (notes !== null && typeof notes !== 'string') return null;
      if (parent_set_id !== null && typeof parent_set_id !== 'string') return null;
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
        parent_set_id: parent_set_id as string | null,
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

  const result: SessionSnapshot = {
    sessionId,
    title,
    startedAt,
    exercises: parsedExercises,
  };

  // Bidirectional sync optional fields (slice 13d sync-refactor, 2026-05-31).
  // Absent is valid — legacy producers (pre-refactor Watch) omit them. A
  // PRESENT-but-malformed field fails the whole parse → bad-payload → tick
  // dropped (self-heals on the next snapshot).
  const { rev, originator, deletedIds } = ctx;
  if (rev !== undefined) {
    if (typeof rev !== 'number' || !Number.isFinite(rev)) return null;
    result.rev = rev;
  }
  if (originator !== undefined) {
    if (originator !== 'watch' && originator !== 'iphone') return null;
    result.originator = originator;
  }
  if (deletedIds !== undefined) {
    if (!isObject(deletedIds)) return null;
    // Each sub-array is independently optional (absent → empty).
    const exRaw = deletedIds.exerciseIds === undefined ? [] : deletedIds.exerciseIds;
    const setRaw = deletedIds.setIds === undefined ? [] : deletedIds.setIds;
    if (!isStringArray(exRaw) || !isStringArray(setRaw)) return null;
    result.deletedIds = { exerciseIds: exRaw, setIds: setRaw };
  }

  return result;
}

function isNullableFiniteNumber(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
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
  // Anti-reorder guard (sync fast lane). Drop a stale / out-of-order
  // redelivery (typically a late applicationContext backstop arriving after
  // a fresher sendMessage already applied). Claim the high-water mark BEFORE
  // the `await` below so a concurrent older delivery from the other channel
  // can't pass its own check in the gap between this check and the DB write.
  let claimedRev = false;
  let prevRev: number | undefined;
  if (snapshot.rev != null) {
    prevRev = lastAppliedRev.get(snapshot.sessionId);
    if (prevRev != null && snapshot.rev <= prevRev) {
      return {
        ok: false,
        code: 'stale',
        message: `live-mirror rev ${snapshot.rev} <= applied ${prevRev} (dropped)`,
      };
    }
    lastAppliedRev.set(snapshot.sessionId, snapshot.rev);
    claimedRev = true;
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
    // The rev claim above advanced the high-water mark BEFORE this write
    // (correct for the concurrency race). But the write didn't land, and the
    // dual-fired backstop carries the SAME rev → it would now be gated out as
    // `stale`, leaving the mirror stale-rendered until the NEXT Watch
    // mutation. Roll the claim back so the backstop (or a retry) can re-apply
    // this exact rev and self-heal. (overnight review MED, 2026-06-01.)
    if (claimedRev) {
      if (prevRev === undefined) lastAppliedRev.delete(snapshot.sessionId);
      else lastAppliedRev.set(snapshot.sessionId, prevRev);
    }
    return {
      ok: false,
      code: 'db-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
