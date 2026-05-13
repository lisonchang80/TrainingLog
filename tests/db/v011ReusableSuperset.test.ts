import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';

/**
 * v011 migration acceptance tests (slice 9.6, ADR-0017 Q10).
 *
 * 覆蓋:
 *   - superset / superset_exercise tables + index 創建
 *   - use_count DEFAULT 0
 *   - superset_exercise PRIMARY KEY (superset_id, position) 拒絕 dup
 *   - superset → superset_exercise ON DELETE CASCADE
 *   - superset_exercise.exercise_id FK 指向 exercise(id)
 */
describe('v011 reusable superset migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates superset + superset_exercise tables + index', async () => {
    await migrate(db);
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('superset','superset_exercise')`
    );
    expect(tables.map((t) => t.name).sort()).toEqual([
      'superset',
      'superset_exercise',
    ]);
    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_superset_exercise_exercise'`
    );
    expect(indexes).toHaveLength(1);
  });

  it('superset.use_count defaults to 0', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(superset)`);
    const useCount = cols.find((c) => c.name === 'use_count');
    expect(useCount).toBeDefined();
    expect(useCount!.notnull).toBe(1);
    expect(useCount!.dflt_value).toBe('0');
  });

  it('inserts a superset with 2 exercises', async () => {
    await migrate(db);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ss-1',
      'Bench + Row',
      '#3B82F6',
      0,
      now,
      now
    );
    const benchId = '00000000-0000-4000-8000-000000000001'; // Bench Press
    const rowId = '00000000-0000-4000-8000-000000000005'; // Barbell Row
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, ?, ?)`,
      'ss-1',
      0,
      benchId
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, ?, ?)`,
      'ss-1',
      1,
      rowId
    );

    const links = await db.getAllAsync<{
      position: number;
      exercise_id: string;
    }>(
      `SELECT position, exercise_id FROM superset_exercise WHERE superset_id = ? ORDER BY position`,
      'ss-1'
    );
    expect(links).toHaveLength(2);
    expect(links[0].exercise_id).toBe(benchId);
    expect(links[1].exercise_id).toBe(rowId);
  });

  it('PRIMARY KEY (superset_id, position) rejects duplicate slot', async () => {
    await migrate(db);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ss-dup',
      'Dup',
      null,
      0,
      now,
      now
    );
    const benchId = '00000000-0000-4000-8000-000000000001';
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, ?, ?)`,
      'ss-dup',
      0,
      benchId
    );
    await expect(
      db.runAsync(
        `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, ?, ?)`,
        'ss-dup',
        0,
        benchId
      )
    ).rejects.toThrow();
  });

  it('ON DELETE CASCADE clears superset_exercise rows when superset deleted', async () => {
    await migrate(db);
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ss-cx',
      'Cascade',
      null,
      0,
      now,
      now
    );
    const benchId = '00000000-0000-4000-8000-000000000001';
    const rowId = '00000000-0000-4000-8000-000000000005';
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 0, ?)`,
      'ss-cx',
      benchId
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 1, ?)`,
      'ss-cx',
      rowId
    );

    await db.runAsync(`DELETE FROM superset WHERE id = ?`, 'ss-cx');
    const remaining = await db.getAllAsync<{ superset_id: string }>(
      `SELECT superset_id FROM superset_exercise WHERE superset_id = ?`,
      'ss-cx'
    );
    expect(remaining).toHaveLength(0);
  });

  it('superset_exercise.exercise_id FK is enforced', async () => {
    await migrate(db);
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ss-fk',
      'FK',
      null,
      0,
      now,
      now
    );
    await expect(
      db.runAsync(
        `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 0, ?)`,
        'ss-fk',
        'no-such-exercise'
      )
    ).rejects.toThrow();
  });
});
