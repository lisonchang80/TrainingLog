/**
 * Reorder-revert repro (2026-06-27 device feedback) — does applying a Watch
 * live-mirror snapshot UNDO an iPhone exercise-card reorder?
 *
 * Device symptom: during Watch live-sync, the user reorders exercise cards on
 * the iPhone; the cards then bounce back to the original order ("跳回原狀").
 *
 * This test reproduces the exact data sequence that the bidirectional sync
 * produces, to settle whether the revert lives in the TS apply path
 * (`replaceLiveMirror`) or is purely a UI/timing race on the device:
 *
 *   1. Session has exercises A,B,C (ordering 1,2,3).
 *   2. iPhone reorders to C,A,B → `reorderSessionExercises` rewrites
 *      `session_exercise.ordering` to C=1, A=2, B=3.
 *   3. The Watch forward-pushes a snapshot. Its exercises ARRAY is in the new
 *      display order [C,A,B] (the Watch applied `exerciseOrderOverride`), but
 *      each exercise still carries its IMMUTABLE BASE `ordering` value
 *      (A=1,B=2,C=3 — `LiveMirrorProducer.project` sends `ordering: ex.ordering`,
 *      NOT a value re-derived from the override) AND the iPhone's REAL
 *      session_exercise ids (a cast carries real ids).
 *   4. `replaceLiveMirror` applies it.
 *
 * EXPECTATION: ordering stays C=1,A=2,B=3. The matched-exercise path updates
 * only `planned_sets` (never `ordering`), and exercise matching is by
 * `exercise_id` occurrence (order-independent), so a stale-ordering snapshot
 * must NOT revert the iPhone reorder. If this test ever fails, the revert IS in
 * the data path and the fix is here; if it passes, the device revert is a
 * UI/timing race outside `replaceLiveMirror`.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  reorderSessionExercises,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const SESSION = 'sess-reorder';
const EX = {
  A: 'aaaa1111-0000-4000-8000-000000000001',
  B: 'bbbb2222-0000-4000-8000-000000000002',
  C: 'cccc3333-0000-4000-8000-000000000003',
};
// session_exercise ids (a cast carries the iPhone's REAL ids onto the Watch).
const SE = { A: 'se-A', B: 'se-B', C: 'se-C' };

async function seedThreeExerciseSession(db: BetterSqliteDatabase): Promise<void> {
  for (const [key, id] of Object.entries(EX)) {
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, 'loaded', 1)`,
      id,
      `Exercise ${key}`,
    );
  }
  await db.runAsync(
    `INSERT INTO session (id, started_at, title) VALUES (?, ?, 'Reorder Day')`,
    SESSION,
    1_700_000_000_000,
  );
  // Append A,B,C → ordering 1,2,3 (appendSessionExercise uses MAX(ordering)+1).
  let i = 0;
  for (const key of ['A', 'B', 'C'] as const) {
    await appendSessionExercise(db, {
      id: SE[key],
      session_id: SESSION,
      exercise_id: EX[key],
      planned_sets: 1,
    });
    await insertSessionSet(db, {
      id: `set-${key}`,
      session_id: SESSION,
      exercise_id: EX[key],
      weight_kg: 50,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_001 + i,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: SE[key],
    });
    i += 1;
  }
}

/** One wire set for an exercise (content irrelevant to the ordering assertion). */
function wireSet(key: 'A' | 'B' | 'C') {
  return {
    setId: `set-${key}`,
    ordinal: 1,
    weight: 50,
    reps: 5,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind: 'working' as const,
    parent_set_id: null,
    is_logged: false,
  };
}

/** The forward snapshot the Watch sends AFTER the iPhone reorder to C,A,B:
 *  array in new display order, but each exercise carries its STALE BASE
 *  `ordering` (A=1,B=2,C=3) + the iPhone's real session_exercise id. */
function watchSnapshotNewArrayStaleOrdering(): SessionSnapshot {
  const ex = (key: 'A' | 'B' | 'C', baseOrdering: number) => ({
    sessionExerciseId: SE[key],
    exerciseId: EX[key],
    exerciseName: `Exercise ${key}`,
    ordering: baseOrdering,
    plannedSets: 1,
    sets: [wireSet(key)],
  });
  return {
    sessionId: SESSION,
    title: 'Reorder Day',
    startedAt: 1_700_000_000_000,
    // Display order C,A,B; stale base ordering values A=1,B=2,C=3.
    exercises: [ex('C', 3), ex('A', 1), ex('B', 2)],
  };
}

describe('replaceLiveMirror — exercise reorder survives a stale-ordering Watch snapshot', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedThreeExerciseSession(db);
  });

  afterEach(() => {
    db.close();
  });

  async function orderingById(): Promise<Record<string, number>> {
    const rows = await db.getAllAsync<{ id: string; ordering: number }>(
      `SELECT id, ordering FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
      SESSION,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.ordering]));
  }

  it('iPhone reorder to C,A,B is NOT reverted by the Watch forward snapshot', async () => {
    // 1. Reorder C,A,B.
    await reorderSessionExercises(db, {
      session_id: SESSION,
      orderedIds: [SE.C, SE.A, SE.B],
    });
    expect(await orderingById()).toEqual({ [SE.C]: 1, [SE.A]: 2, [SE.B]: 3 });

    // 2. Apply the Watch forward snapshot (new array order, stale ordering).
    await replaceLiveMirror(db, watchSnapshotNewArrayStaleOrdering());

    // 3. Ordering must be UNCHANGED — no revert in the data path.
    expect(await orderingById()).toEqual({ [SE.C]: 1, [SE.A]: 2, [SE.B]: 3 });
  });
});
