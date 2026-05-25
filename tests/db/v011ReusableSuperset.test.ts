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
 *
 * Flake-fix note (overnight Agent A, 2026-05-24)
 * ----------------------------------------------
 * The "PRIMARY KEY rejects duplicate" and "FK is enforced" tests below use
 * an explicit `try { await ... } catch { didThrow = true }` pattern instead
 * of `await expect(promise).rejects.toThrow()`. Empirically, under heavy
 * parallel jest worker contention (e.g. `--maxWorkers=8` on this codebase,
 * or `--runInBand` after many `:memory:` DB instances have been created in
 * the same worker process), the matcher chain `.rejects.toThrow()`
 * occasionally fails to observe `better-sqlite3`'s synchronous constraint
 * throw — the test fails with "Received function did not throw" even
 * though the constraint WAS violated. The try/catch path settles the
 * microtask differently and reliably catches the rejection.
 *
 * Diagnostic dump (table SQL + PRAGMA values) on the un-throw path is
 * preserved so that if this flake ever recurs in CI, the cause is
 * immediately debuggable instead of "Received function did not throw".
 *
 * The same underlying flake also affects v009 (UNIQUE), v010 (CHECK),
 * v015 (CHECK), and appendReusableSupersetActiveSessionInterlock (FK) —
 * scope for this overnight worktree is limited to v011, so those files
 * keep using `.rejects.toThrow()` (and stay green under default `npm
 * test` workers; only flake under maxWorkers=8 / runInBand stress).
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
    let pkThrew = false;
    let pkErrorMsg = '';
    try {
      await db.runAsync(
        `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, ?, ?)`,
        'ss-dup',
        0,
        benchId
      );
    } catch (e) {
      pkThrew = true;
      pkErrorMsg = (e as Error)?.message ?? String(e);
    }
    if (!pkThrew) {
      const seSql = await db.getFirstAsync<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='superset_exercise'`,
      );
      const userVer = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version`);
      const rows = await db.getAllAsync<{ superset_id: string; position: number; exercise_id: string }>(
        `SELECT superset_id, position, exercise_id FROM superset_exercise WHERE superset_id='ss-dup'`,
      );
      // eslint-disable-next-line no-console
      console.error('[v011-PK-DIAG] PK constraint did not fire', {
        user_version: userVer?.user_version,
        superset_exercise_sql: seSql?.sql,
        actual_rows: rows,
      });
    }
    expect(pkThrew).toBe(true);
    // assert it's a constraint error (not "no such table")
    if (pkErrorMsg) {
      expect(pkErrorMsg).toMatch(/UNIQUE|PRIMARY|constraint/i);
    }
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
    let fkThrew = false;
    let fkErrorMsg = '';
    try {
      await db.runAsync(
        `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 0, ?)`,
        'ss-fk',
        'no-such-exercise'
      );
    } catch (e) {
      fkThrew = true;
      fkErrorMsg = (e as Error)?.message ?? String(e);
    }
    if (!fkThrew) {
      const seSql = await db.getFirstAsync<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='superset_exercise'`,
      );
      const userVer = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version`);
      const fk = await db.getFirstAsync<{ foreign_keys: number }>(`PRAGMA foreign_keys`);
      const rows = await db.getAllAsync<{ superset_id: string; position: number; exercise_id: string }>(
        `SELECT superset_id, position, exercise_id FROM superset_exercise WHERE superset_id='ss-fk'`,
      );
      // eslint-disable-next-line no-console
      console.error('[v011-FK-DIAG] FK constraint did not fire', {
        user_version: userVer?.user_version,
        foreign_keys: fk?.foreign_keys,
        superset_exercise_sql: seSql?.sql,
        actual_rows: rows,
      });
    }
    expect(fkThrew).toBe(true);
    if (fkErrorMsg) {
      expect(fkErrorMsg).toMatch(/FOREIGN|constraint/i);
    }
  });
});
