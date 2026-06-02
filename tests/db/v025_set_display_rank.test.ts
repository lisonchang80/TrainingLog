import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v025_set_display_rank } from '../../src/db/schema/v025_set_display_rank';

/**
 * v025 migration acceptance tests — `set.display_rank REAL` (slice 13d
 * 2026-06-02, device bugs #1 拖曳換位 / #2 中插位置).
 *
 * Coverage (the only vNNN migration that shipped without its own test file):
 *   - PRAGMA table_info shape (column exists, REAL, nullable, no DEFAULT)
 *   - Backfill: existing set rows get display_rank = ordering after migrate
 *   - Fresh INSERT without explicit display_rank stays NULL (no DEFAULT)
 *   - NULL is permitted (sort key falls back to ordering — legacy / iPhone rows)
 *   - Round-trips a fractional mid-insert rank (e.g. 2.5) — REAL not INTEGER
 *   - Idempotency: re-running v025 against a migrated schema is a safe no-op
 *     and never overwrites a real display_rank (WHERE display_rank IS NULL)
 *   - PRAGMA user_version >= 25 after full migrate
 */
describe('v025 set.display_rank column migration', () => {
  let db: BetterSqliteDatabase;

  // Built-in exercise id guaranteed present after migrate (FK target —
  // jest DB has foreign_keys = ON).
  const EX_BENCH = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  async function seedSession(): Promise<void> {
    await db.runAsync(`INSERT INTO session (id, started_at) VALUES ('s1', 1)`);
  }

  it('creates set.display_rank as a nullable REAL column with no DEFAULT', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info("set")`);
    const col = cols.find((c) => c.name === 'display_rank');
    expect(col).toBeDefined();
    expect(col?.type).toBe('REAL');
    expect(col?.notnull).toBe(0);
    expect(col?.dflt_value).toBeNull();
  });

  it('backfills display_rank = ordering for rows that existed before the migration', async () => {
    // Stand up the schema, then simulate a pre-v025 row by NULLing the column
    // and re-running v025 (the backfill UPDATE is what we exercise).
    await migrate(db);
    await seedSession();
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, ordering, created_at, display_rank)
       VALUES ('set1','s1',?,50,10,4,1,NULL)`,
      EX_BENCH,
    );
    await v025_set_display_rank(db);
    const row = await db.getFirstAsync<{ display_rank: number }>(
      `SELECT display_rank FROM "set" WHERE id = 'set1'`,
    );
    expect(row?.display_rank).toBe(4);
  });

  it('a fresh INSERT without display_rank stays NULL (no DEFAULT)', async () => {
    await migrate(db);
    await seedSession();
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, ordering, created_at)
       VALUES ('set2','s1',?,60,8,0,1)`,
      EX_BENCH,
    );
    const row = await db.getFirstAsync<{ display_rank: number | null }>(
      `SELECT display_rank FROM "set" WHERE id = 'set2'`,
    );
    expect(row?.display_rank).toBeNull();
  });

  it('round-trips a fractional mid-insert rank (REAL, not INTEGER)', async () => {
    await migrate(db);
    await seedSession();
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, ordering, created_at, display_rank)
       VALUES ('set3','s1',?,55,9,1,1,2.5)`,
      EX_BENCH,
    );
    const row = await db.getFirstAsync<{ display_rank: number }>(
      `SELECT display_rank FROM "set" WHERE id = 'set3'`,
    );
    expect(row?.display_rank).toBe(2.5);
  });

  it('is idempotent — re-running v025 never overwrites a real display_rank', async () => {
    await migrate(db);
    await seedSession();
    // A row with an explicit (Watch-reordered) display_rank that differs from
    // its ordering — the backfill must NOT clobber it.
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, ordering, created_at, display_rank)
       VALUES ('set4','s1',?,70,6,0,1,9.0)`,
      EX_BENCH,
    );
    await expect(v025_set_display_rank(db)).resolves.toBeUndefined();
    await expect(v025_set_display_rank(db)).resolves.toBeUndefined();
    const row = await db.getFirstAsync<{ display_rank: number }>(
      `SELECT display_rank FROM "set" WHERE id = 'set4'`,
    );
    expect(row?.display_rank).toBe(9.0); // unchanged, not reset to ordering (0)
    // Column still single-occurrence (no duplicate ADD COLUMN).
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info("set")`,
    );
    expect(cols.filter((c) => c.name === 'display_rank')).toHaveLength(1);
  });

  it('runs automatically as part of the full migration runner (user_version >= 25)', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(row?.user_version).toBeGreaterThanOrEqual(25);
  });
});
