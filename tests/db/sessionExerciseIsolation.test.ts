import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  updateSetFields,
  deleteSet,
} from '../../src/adapters/sqlite/setRepository';
import { deleteSessionExerciseAndSets } from '../../src/adapters/sqlite/sessionRepository';

/**
 * v019 within-session isolation integration test (slice 10c #17).
 *
 * Scenario: one session contains TWO session_exercise rows that share the
 * SAME exercise_id (e.g. RS A-side Cable Crossover + a solo Cable Crossover
 * card added separately). Without v019, operations on one card leaked into
 * the other because the set table was keyed only by (session_id, exercise_id).
 *
 * This file is the load-bearing regression protection — if anything starts
 * failing here it means we re-introduced the leak. The other v019 tests
 * (v019SetSessionExerciseId.test.ts, setSessionExerciseIdInsert.test.ts)
 * cover individual operations; this one tests the END-TO-END isolation
 * the user actually cares about.
 */
describe('session_exercise isolation — two cards sharing exercise_id', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-1';
  const aId = 'se-A'; // cluster A side (or "first card")
  const bId = 'se-B'; // solo card (or "second card")
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    // Two session_exercise rows, SAME session, SAME exercise. This is the
    // bug scenario the v019 column exists to fix.
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      aId,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0)`,
      bId,
      sessionId,
      benchId,
    );
    // A side: 2 sets. B side: 1 set. All same exercise_id but tagged
    // independently via session_exercise_id.
    await insertSessionSet(db, {
      id: 'A1',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 50,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: aId,
    });
    await insertSessionSet(db, {
      id: 'A2',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 55,
      reps: 5,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: aId,
    });
    await insertSessionSet(db, {
      id: 'B1',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 100,
      reps: 1,
      is_skipped: 0,
      ordering: 3,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: bId,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('A side has 2 sets and B side has 1 — list filter is card-scoped', async () => {
    const sets = await listSetsBySession(db, sessionId);
    const aSets = sets.filter((s) => s.session_exercise_id === aId);
    const bSets = sets.filter((s) => s.session_exercise_id === bId);
    expect(aSets.map((s) => s.id).sort()).toEqual(['A1', 'A2']);
    expect(bSets.map((s) => s.id)).toEqual(['B1']);
  });

  it('updating notes on an A-side set does NOT bleed into the B-side', async () => {
    await updateSetFields(db, 'A1', { notes: '感覺 RPE 8' });
    const sets = await listSetsBySession(db, sessionId);
    const a1 = sets.find((s) => s.id === 'A1');
    const b1 = sets.find((s) => s.id === 'B1');
    expect(a1?.notes).toBe('感覺 RPE 8');
    expect(b1?.notes).toBeNull();
  });

  it('updating weight on an A-side set does NOT touch the B-side row', async () => {
    await updateSetFields(db, 'A1', { weight_kg: 60 });
    const sets = await listSetsBySession(db, sessionId);
    const a1 = sets.find((s) => s.id === 'A1');
    const b1 = sets.find((s) => s.id === 'B1');
    expect(a1?.weight_kg).toBe(60);
    expect(b1?.weight_kg).toBe(100); // unchanged
  });

  it('hard-deleting one A set leaves the other A set + B set intact', async () => {
    await deleteSet(db, 'A1');
    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id).sort()).toEqual(['A2', 'B1']);
  });

  it('deleteSessionExerciseAndSets on A wipes only A — B side survives', async () => {
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: benchId,
      session_exercise_id: aId,
    });
    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id)).toEqual(['B1']);
    // session_exercise A row gone, B still present.
    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(ses.map((s) => s.id)).toEqual([bId]);
  });

  it('deleteSessionExerciseAndSets on B wipes only B — A side (RS) survives', async () => {
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: benchId,
      session_exercise_id: bId,
    });
    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id).sort()).toEqual(['A1', 'A2']);
    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(ses.map((s) => s.id)).toEqual([aId]);
  });

  it('toggling is_logged on an A set does NOT flip the B set', async () => {
    await updateSetFields(db, 'A1', { is_logged: 1 });
    const sets = await listSetsBySession(db, sessionId);
    const a1 = sets.find((s) => s.id === 'A1');
    const a2 = sets.find((s) => s.id === 'A2');
    const b1 = sets.find((s) => s.id === 'B1');
    expect(a1?.is_logged).toBe(1);
    expect(a2?.is_logged).toBe(0);
    expect(b1?.is_logged).toBe(0);
  });
});
