import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionExercise,
  listSessionExercisesWithName,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Slice 10e bundle 1 — exercise.notes JOIN coverage on
 * `listSessionExercisesWithName`.
 *
 * Notes lives on `exercise.notes` (per ADR-0013 amendment / ADR-0017 — global
 * per-Exercise, not per-template/session). The session-side helper used by
 * ExerciseCard / EditableExerciseCard JOINs the column so the expanded body
 * can render the notes inline. Tests:
 *
 *   1. Updating `exercise.notes` flows through to the next read (live JOIN).
 *   2. NULL notes surface as NULL (don't coerce to empty string).
 *   3. Two session rows targeting the same exercise both reflect the same
 *      `exercise.notes` (one source of truth).
 */

const BENCH = '00000000-0000-4000-8000-000000000001'; // Bench Press (v001/v002 seed)
const SQUAT = '00000000-0000-4000-8000-000000000002'; // Back Squat

describe('listSessionExercisesWithName surfaces exercise.notes', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-notes-test';
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('returns NULL exercise_notes when exercise.notes is NULL (seed default)', async () => {
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: BENCH,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].exercise_id).toBe(BENCH);
    expect(rows[0].exercise_notes).toBeNull();
  });

  it('reflects UPDATEs to exercise.notes on subsequent reads (live JOIN, not snapshot)', async () => {
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: BENCH,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });

    // First read: NULL
    let rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows[0].exercise_notes).toBeNull();

    // Write notes onto exercise (global write, mirror template-editor flow)
    await db.runAsync(
      `UPDATE exercise SET notes = ? WHERE id = ?`,
      '保持挺胸 keep chest up',
      BENCH,
    );

    // Re-read: notes show up
    rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows[0].exercise_notes).toBe('保持挺胸 keep chest up');
  });

  it('two session rows targeting the same exercise share exercise.notes (single source of truth)', async () => {
    // Two solo entries for BENCH within one session (re-add scenario)
    await db.runAsync(
      `UPDATE exercise SET notes = ? WHERE id = ?`,
      '槓在乳線',
      BENCH,
    );
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: BENCH,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: SQUAT,
      ordering: 2,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await db.runAsync(
      `UPDATE exercise SET notes = ? WHERE id = ?`,
      '腳跟貼地 heels down',
      SQUAT,
    );

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows).toHaveLength(2);
    const bench = rows.find((r) => r.exercise_id === BENCH);
    const squat = rows.find((r) => r.exercise_id === SQUAT);
    expect(bench?.exercise_notes).toBe('槓在乳線');
    expect(squat?.exercise_notes).toBe('腳跟貼地 heels down');
  });

  it('returns empty string when exercise.notes is empty (preserves user intent)', async () => {
    await db.runAsync(
      `UPDATE exercise SET notes = ? WHERE id = ?`,
      '',
      BENCH,
    );
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: BENCH,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows[0].exercise_notes).toBe('');
  });
});
