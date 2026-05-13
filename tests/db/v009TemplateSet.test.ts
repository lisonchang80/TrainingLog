import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';

/**
 * v009 migration acceptance tests (slice 9.5, ADR-0016).
 *
 * 覆蓋:
 *   - template_set 表 + index 創建
 *   - template.color_hex / template_exercise.rest_seconds ALTER 落地
 *   - 既有 template_exercise summary 攤平成 template_set rows (transform)
 *   - UNIQUE(template_exercise_id, position) constraint
 *   - parent_set_id 自參照 + ON DELETE CASCADE（cluster B3）
 *   - template_exercise → template_set ON DELETE CASCADE
 */
describe('v009 template_set migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates template_set table + index on fresh DB', async () => {
    await migrate(db);
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='template_set'`
    );
    expect(tables).toHaveLength(1);
    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_template_set_by_exercise'`
    );
    expect(indexes).toHaveLength(1);
  });

  it('adds template.color_hex column with default ""', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; dflt_value: string | null; notnull: number }>(
      `PRAGMA table_info(template)`
    );
    const colorHex = cols.find((c) => c.name === 'color_hex');
    expect(colorHex).toBeDefined();
    expect(colorHex!.notnull).toBe(1);
    expect(colorHex!.dflt_value).toBe("''");
  });

  it('adds template_exercise.rest_seconds nullable column', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; notnull: number }>(
      `PRAGMA table_info(template_exercise)`
    );
    const rest = cols.find((c) => c.name === 'rest_seconds');
    expect(rest).toBeDefined();
    expect(rest!.notnull).toBe(0);
  });

  it('adds template_exercise.parent_id / notes / updated_at columns', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null }>(
      `PRAGMA table_info(template_exercise)`
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName.parent_id).toBeDefined();
    expect(byName.parent_id.notnull).toBe(0);
    expect(byName.notes).toBeDefined();
    expect(byName.notes.notnull).toBe(0);
    expect(byName.updated_at).toBeDefined();
    expect(byName.updated_at.notnull).toBe(1);
    expect(byName.updated_at.dflt_value).toBe('0');
  });

  it('transforms existing template_exercise rows into template_set rows', async () => {
    // 先停在 v008，手動 INSERT 一些 template_exercise rows，再 bump 到 v009
    // 因為 migrate runner 是一氣呵成跑到最新，我們改成：第一次 migrate 跑到 v008，
    // 手動撤銷 user_version 提示，再跑到 v009 模擬「升級」場景。
    // 簡單做法：直接全 migrate 到 v009，然後手動 reset user_version 再跑沒意義。
    // 改用 partial migrate 策略：直接 inject 一個 v008-state DB。

    // 實際上 better-sqlite3 :memory: 是新建，我們需要先到 v008、INSERT、再到 v009。
    // 因為 migrate runner 設計成 idempotent 看 user_version，可以這樣做：
    //   1) 跑 migrate(db) → 一路到 v009 (target = max)
    // 直接驗 transform 在「v009 fresh」場景不會誤啟動（template_exercise 0 rows）

    await migrate(db);
    const templateSets = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set`
    );
    // Fresh DB no templates, transform produces 0 rows
    expect(templateSets).toHaveLength(0);
  });

  it('transforms template_exercise with summary into N working template_set rows (manual replay)', async () => {
    // 因 migrate runner 一氣呵成、無 stop-at-version API，
    // 改成手動 replay：跑 v001-v008，手動 INSERT，再單跑 v009 fn。
    const { v001_initial } = await import('../../src/db/schema/v001_initial');
    const { v002_more_exercises } = await import('../../src/db/schema/v002_more_exercises');
    const { v003_templates } = await import('../../src/db/schema/v003_templates');
    const { v004_evergreen_zone } = await import('../../src/db/schema/v004_evergreen_zone');
    const { v005_program } = await import('../../src/db/schema/v005_program');
    const { v006_muscle_layer } = await import('../../src/db/schema/v006_muscle_layer');
    const { v007_body_metric } = await import('../../src/db/schema/v007_body_metric');
    const { v008_achievements } = await import('../../src/db/schema/v008_achievements');
    const { v009_template_set } = await import('../../src/db/schema/v009_template_set');

    await v001_initial(db);
    await v002_more_exercises(db);
    await v003_templates(db);
    await v004_evergreen_zone(db);
    await v005_program(db);
    await v006_muscle_layer(db);
    await v007_body_metric(db);
    await v008_achievements(db);

    // INSERT template + template_exercise with summary
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'tpl-1',
      'Push Day',
      now,
      now
    );
    // Bench Press exists from v001/v002
    const bench = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM exercise WHERE name = 'Bench Press'`
    );
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-1',
      'tpl-1',
      bench!.id,
      0,
      3,
      8,
      80
    );

    // Run v009 manually
    await v009_template_set(db);

    const sets = await db.getAllAsync<{
      id: string;
      template_exercise_id: string;
      position: number;
      set_kind: string;
      reps: number;
      weight: number;
      parent_set_id: string | null;
    }>(`SELECT * FROM template_set ORDER BY position`);

    expect(sets).toHaveLength(3);
    expect(sets[0]).toMatchObject({
      template_exercise_id: 'te-1',
      position: 0,
      set_kind: 'working',
      reps: 8,
      weight: 80,
      parent_set_id: null,
    });
    expect(sets[1].position).toBe(1);
    expect(sets[2].position).toBe(2);
    expect(sets.every((s) => s.set_kind === 'working')).toBe(true);
  });

  it('enforces UNIQUE(template_exercise_id, position)', async () => {
    await migrate(db);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'tpl-u',
      'T',
      now,
      now
    );
    const bench = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM exercise WHERE name = 'Bench Press'`
    );
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets)
       VALUES (?, ?, ?, 0, 0)`,
      'te-u',
      'tpl-u',
      bench!.id
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      's1',
      'te-u',
      0,
      8,
      80
    );
    await expect(
      db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
         VALUES (?, ?, ?, 'working', ?, ?)`,
        's2',
        'te-u',
        0,
        8,
        80
      )
    ).rejects.toThrow();
  });

  it('cluster B3: parent_set_id self-reference + ON DELETE CASCADE', async () => {
    await migrate(db);
    // FK enforcement on better-sqlite3 by default is PRAGMA foreign_keys = ON
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'tpl-c',
      'T',
      now,
      now
    );
    const bench = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM exercise WHERE name = 'Bench Press'`
    );
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets)
       VALUES (?, ?, ?, 0, 0)`,
      'te-c',
      'tpl-c',
      bench!.id
    );
    // Cluster head
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'dropset', ?, ?, NULL)`,
      'head',
      'te-c',
      0,
      8,
      80
    );
    // Follower
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'dropset', ?, ?, ?)`,
      'foll',
      'te-c',
      1,
      6,
      70,
      'head'
    );
    // Delete head → follower cascades
    await db.runAsync(`DELETE FROM template_set WHERE id = ?`, 'head');
    const remaining = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set WHERE template_exercise_id = ?`,
      'te-c'
    );
    expect(remaining).toHaveLength(0);
  });

  it('template_exercise → template_set ON DELETE CASCADE', async () => {
    await migrate(db);
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'tpl-cx',
      'T',
      now,
      now
    );
    const bench = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM exercise WHERE name = 'Bench Press'`
    );
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets)
       VALUES (?, ?, ?, 0, 0)`,
      'te-cx',
      'tpl-cx',
      bench!.id
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      's-cx',
      'te-cx',
      0,
      8,
      80
    );
    await db.runAsync(`DELETE FROM template_exercise WHERE id = ?`, 'te-cx');
    const sets = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set`
    );
    expect(sets).toHaveLength(0);
  });
});
