import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v019_set_session_exercise_id } from '../../src/db/schema/v019_set_session_exercise_id';

/**
 * v019 migration tests — ADD set.session_exercise_id + backfill from
 * session_exercise.id when (session_id, exercise_id) matches uniquely.
 *
 * Coverage:
 *   - Column added (TEXT, nullable)
 *   - Index idx_set_session_exercise created
 *   - Existing set rows are backfilled with the matching session_exercise.id
 *   - Already-populated session_exercise_id values are not overwritten
 *     (idempotent re-run)
 *   - When multiple session_exercise rows share (session_id, exercise_id),
 *     the LOWEST ordering wins (deterministic tie-breaker)
 */
describe('v019 set table session_exercise_id column migration', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-1';
  const now = Date.now();

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds session_exercise_id column (TEXT, nullable, default NULL)', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info("set")`);

    const col = cols.find((c) => c.name === 'session_exercise_id');
    expect(col).toBeDefined();
    expect(col!.type).toBe('TEXT');
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
  });

  it('creates idx_set_session_exercise index', async () => {
    await migrate(db);
    const idx = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_set_session_exercise'`,
    );
    expect(idx.length).toBe(1);
  });

  it('backfills set.session_exercise_id from the unique matching session_exercise.id', async () => {
    await migrate(db);
    // Setup: 1 session, 1 session_exercise pointing at Bench, 1 set
    // referencing the same (session, exercise) — directly NULL out the
    // session_exercise_id to simulate the pre-v019 state.
    const seId = 'se-A';
    const setId = 'set-A';
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      seId,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, ordering, created_at)
       VALUES (?, ?, ?, 1, ?)`,
      setId,
      sessionId,
      benchId,
      now,
    );
    // Null out session_exercise_id to simulate pre-v019 row, then re-run
    // v019 to trigger the backfill UPDATE.
    await db.runAsync(
      `UPDATE "set" SET session_exercise_id = NULL WHERE id = ?`,
      setId,
    );
    await v019_set_session_exercise_id(db);

    const row = await db.getFirstAsync<{ session_exercise_id: string | null }>(
      `SELECT session_exercise_id FROM "set" WHERE id = ?`,
      setId,
    );
    expect(row?.session_exercise_id).toBe(seId);
  });

  it('does not overwrite already-populated session_exercise_id (idempotent re-run)', async () => {
    await migrate(db);
    const seId = 'se-A';
    const otherSeId = 'se-OTHER';
    const setId = 'set-A';
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      seId,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, ordering, created_at, session_exercise_id)
       VALUES (?, ?, ?, 1, ?, ?)`,
      setId,
      sessionId,
      benchId,
      now,
      otherSeId, // explicit value the backfill must not clobber
    );
    await v019_set_session_exercise_id(db);
    const row = await db.getFirstAsync<{ session_exercise_id: string | null }>(
      `SELECT session_exercise_id FROM "set" WHERE id = ?`,
      setId,
    );
    expect(row?.session_exercise_id).toBe(otherSeId);
  });

  it('picks LOWEST ordering when multiple session_exercise rows share (session, exercise)', async () => {
    await migrate(db);
    // Two cards same session same exercise — the bug scenario. Backfill
    // must deterministically pick the one with lower ordering.
    const seFirst = 'se-first';
    const seSecond = 'se-second';
    const setId = 'set-A';
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      seFirst,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0)`,
      seSecond,
      sessionId,
      benchId,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, ordering, created_at)
       VALUES (?, ?, ?, 1, ?)`,
      setId,
      sessionId,
      benchId,
      now,
    );
    await db.runAsync(
      `UPDATE "set" SET session_exercise_id = NULL WHERE id = ?`,
      setId,
    );
    await v019_set_session_exercise_id(db);
    const row = await db.getFirstAsync<{ session_exercise_id: string | null }>(
      `SELECT session_exercise_id FROM "set" WHERE id = ?`,
      setId,
    );
    expect(row?.session_exercise_id).toBe(seFirst);
  });

  it('is idempotent — re-running v019 on already-migrated DB does not duplicate column', async () => {
    await migrate(db);
    await v019_set_session_exercise_id(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info("set")`,
    );
    const count = cols.filter((c) => c.name === 'session_exercise_id').length;
    expect(count).toBe(1);
  });
});
