/**
 * 🟠-A (overnight 2026-07-07) — DEMONSTRATION test (NOT a regression fix).
 *
 * Pins the CURRENT behaviour of `reconcileEndSnapshot` when the Watch's
 * end-session snapshot is PARTIALLY TRUNCATED (a serialization glitch that
 * drops one or more exercises but leaves ≥1, with the sessionId still matching).
 *
 * The three Q3 guards (endSnapshotReconcile.ts:57-99) defend:
 *   - unparseable snapshot        → bad-payload
 *   - sessionId mismatch          → session-mismatch
 *   - ZERO-exercise snapshot vs non-empty DB → suspicious-empty
 * A PARTIAL truncation (3 exercises → 1 arrives) passes ALL of them — it is
 * BYTE-IDENTICAL to a legitimate "user deleted exercises B & C on the Watch
 * mid-session" (the E2 fix, covered in endSnapshotReconcile.test.ts). So the
 * `purgeTail: true` pass deletes the dropped exercises' real `is_logged = 1`
 * rows.
 *
 * ⚠️ This test therefore ASSERTS THE DATA LOSS as the current contract — it is
 * a risk demonstration for the report, NOT a fix. It must be reviewed by a
 * human: the finding is confirmed, but a safe fix (a transport-integrity
 * count/checksum on the wire — see report P1) is a cross-TS/Swift wire-schema
 * change gated on device smoke, deliberately OUT OF SCOPE for this branch (the
 * dropset/reconcile/data-deletion hot zone must not be patched blind).
 *
 * If a future fix lands (P1 checksum), THIS test's expectation flips (the
 * truncated exercises survive) — update it then, alongside the real fix.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { reconcileEndSnapshot } from '../../src/services/endSnapshotReconcile';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

// Real seeded builtin exercise ids (FK: session_exercise/set.exercise_id
// REFERENCES exercise(id), enforced). Distinct + sorted.
const EX_A = '00000000-0000-4000-8000-000000000001'; // Bench Press
const EX_B = '00000000-0000-4000-8000-000000000002'; // Back Squat
const EX_C = '00000000-0000-4000-8000-000000000003'; // Deadlift

const SESSION_ID = 'sess-trunc';
const STARTED_AT = 1_700_000_000_000;

/**
 * Seed a live session tree with 3 exercises, each with a single `is_logged = 1`
 * set (real work the user performed). iPhone-minted ids (as
 * `startSessionFromTemplate` would produce).
 */
async function seedThreeLoggedExercises(db: BetterSqliteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT INTO session (id, started_at, title) VALUES (?, ?, ?)`,
    SESSION_ID,
    STARTED_AT,
    'Full Body',
  );
  const defs = [
    { seId: 'se-A', exerciseId: EX_A, weight: 60 },
    { seId: 'se-B', exerciseId: EX_B, weight: 100 },
    { seId: 'se-C', exerciseId: EX_C, weight: 140 },
  ];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      d.seId,
      SESSION_ID,
      d.exerciseId,
      i + 1,
      1,
      'tmpl-1',
    );
    await db.runAsync(
      `INSERT INTO "set"
         (id, session_id, exercise_id, session_exercise_id,
          weight_kg, reps, notes, set_kind, is_logged, ordering, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `set-${d.seId}`,
      SESSION_ID,
      d.exerciseId,
      d.seId,
      d.weight,
      5,
      null,
      'working',
      1, // is_logged = 1 — REAL performed work
      1,
      STARTED_AT,
    );
  }
}

/** Watch-shaped snapshot carrying only the given exercise defs. */
function watchSnapshot(
  defs: { exerciseId: string; weight: number }[],
): SessionSnapshot {
  return {
    sessionId: SESSION_ID,
    title: 'Full Body',
    startedAt: STARTED_AT,
    exercises: defs.map((d, idx) => ({
      sessionExerciseId: `SE-${idx}-${d.exerciseId}`,
      exerciseId: d.exerciseId,
      exerciseName: 'X',
      ordering: idx,
      plannedSets: 1,
      sets: [
        {
          setId: `SET-${idx}-0`,
          ordinal: 1,
          weight: d.weight,
          reps: 5,
          rpe: null,
          rest_sec: null,
          notes: null,
          set_kind: 'working' as const,
          is_logged: true,
        },
      ],
    })),
  };
}

async function loggedExerciseIds(db: BetterSqliteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ exercise_id: string }>(
    `SELECT DISTINCT se.exercise_id AS exercise_id
       FROM session_exercise se
       JOIN "set" s ON s.session_exercise_id = se.id
      WHERE se.session_id = ? AND s.is_logged = 1
      ORDER BY se.exercise_id`,
    SESSION_ID,
  );
  return rows.map((r) => r.exercise_id);
}

describe('🟠-A — partial-truncation end snapshot (DEMONSTRATES data loss — human review required)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedThreeLoggedExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  it('sanity: all three logged exercises are present before reconcile', async () => {
    expect(await loggedExerciseIds(db)).toEqual([EX_A, EX_B, EX_C]);
  });

  it('a full (untruncated) end snapshot keeps all three logged exercises', async () => {
    // The healthy path: the Watch really did end with all 3 exercises → no purge.
    const result = await reconcileEndSnapshot(
      db,
      SESSION_ID,
      watchSnapshot([
        { exerciseId: EX_A, weight: 60 },
        { exerciseId: EX_B, weight: 100 },
        { exerciseId: EX_C, weight: 140 },
      ]),
    );
    expect(result).toMatchObject({ purged: true, purgedExercises: 0, purgedSets: 0 });
    expect(await loggedExerciseIds(db)).toEqual([EX_A, EX_B, EX_C]);
  });

  it('⚠️ CURRENT BEHAVIOUR: a partially-truncated snapshot PURGES the dropped logged exercises', async () => {
    // A serialization glitch drops EX_B and EX_C from the end snapshot; EX_A
    // remains, sessionId still matches. This passes all 3 Q3 guards (parses,
    // sessionId matches, exercises.length === 1 !== 0). The purgeTail pass then
    // deletes EX_B + EX_C's rows — including their REAL is_logged = 1 sets.
    //
    // This is INDISTINGUISHABLE at the data layer from the user genuinely
    // deleting B & C on the Watch (the E2 delete-exercise feature). Hence the
    // finding is CONFIRMED but a safe fix needs a transport-integrity signal
    // (P1 in the report), not a change to this reconcile core.
    const result = await reconcileEndSnapshot(
      db,
      SESSION_ID,
      watchSnapshot([{ exerciseId: EX_A, weight: 60 }]),
    );

    // purgeTail deleted the two absent exercises + their sets.
    expect(result).toMatchObject({ purged: true, purgedExercises: 2, purgedSets: 2 });
    // DATA LOSS: only EX_A's logged work survives; EX_B + EX_C are gone.
    expect(await loggedExerciseIds(db)).toEqual([EX_A]);
  });
});
