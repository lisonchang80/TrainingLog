import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  recordSetInSession,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * v019 INSERT-path isolation tests (slice 10c #17).
 *
 * Verifies that the recently-mutated INSERT helpers (insertSessionSet,
 * recordSetInSession) pass through `session_exercise_id` correctly so two
 * session_exercise rows that share the same exercise_id can each own
 * their own sets without leakage.
 */
describe('setRepository INSERT — session_exercise_id pass-through', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-1';
  const seA = 'se-A';
  const seB = 'se-B';
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    // Two session_exercise rows in ONE session that target the SAME
    // exercise — the bug scenario the v019 column is here to disambiguate.
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      seA,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0)`,
      seB,
      sessionId,
      benchId,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('insertSessionSet stores explicit session_exercise_id', async () => {
    await insertSessionSet(db, {
      id: 'set-A1',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 50,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seA,
    });
    await insertSessionSet(db, {
      id: 'set-B1',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 60,
      reps: 3,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seB,
    });

    const sets = await listSetsBySession(db, sessionId);
    const a1 = sets.find((s) => s.id === 'set-A1');
    const b1 = sets.find((s) => s.id === 'set-B1');
    expect(a1?.session_exercise_id).toBe(seA);
    expect(b1?.session_exercise_id).toBe(seB);
  });

  it('insertSessionSet defaults to NULL when session_exercise_id not provided', async () => {
    // Legacy fixture path — caller doesn't pass session_exercise_id and the
    // DB stores NULL. The v019 migration's backfill would have caught such
    // a row at migration time; runtime-inserted NULL rows are explicitly
    // allowed so old tests don't blow up.
    await insertSessionSet(db, {
      id: 'set-legacy',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 50,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
    });
    const sets = await listSetsBySession(db, sessionId);
    const legacy = sets.find((s) => s.id === 'set-legacy');
    expect(legacy?.session_exercise_id).toBeNull();
  });

  it('recordSetInSession threads session_exercise_id into the new row', async () => {
    let counter = 0;
    const uuid = () => `set-${++counter}`;
    const result = await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 70, reps: 8 },
      uuid,
      now: () => now,
      session_exercise_id: seA,
    });
    const sets = await listSetsBySession(db, sessionId);
    const inserted = sets.find((s) => s.id === result.set_id);
    expect(inserted?.session_exercise_id).toBe(seA);
  });

  it('two cards same exercise — each card sees only its own sets when filtered by session_exercise_id', async () => {
    // Card A: 2 sets, card B: 1 set
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
      session_exercise_id: seA,
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
      session_exercise_id: seA,
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
      session_exercise_id: seB,
    });

    const sets = await listSetsBySession(db, sessionId);
    const aSets = sets.filter((s) => s.session_exercise_id === seA);
    const bSets = sets.filter((s) => s.session_exercise_id === seB);
    expect(aSets.length).toBe(2);
    expect(bSets.length).toBe(1);
    expect(aSets.map((s) => s.id).sort()).toEqual(['A1', 'A2']);
    expect(bSets.map((s) => s.id)).toEqual(['B1']);
  });
});
