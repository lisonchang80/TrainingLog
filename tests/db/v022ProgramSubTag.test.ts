import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v022_program_sub_tag } from '../../src/db/schema/v022_program_sub_tag';

/**
 * v022 migration acceptance tests — `program_sub_tag` persistent dictionary
 * (ADR-0021; wave 16 / round 15 polish 2026-05-21).
 *
 * Coverage:
 *   - Forward: `program_sub_tag` table + index created after full migrate
 *   - Backfill from `template.sub_tag` (program_id NOT NULL, sub_tag non-empty)
 *   - Backfill from `program_cell.sub_tag` (sub_tag non-empty)
 *   - Idempotency: re-running v022 against an already-populated schema is a
 *     safe no-op (CREATE IF NOT EXISTS + INSERT OR IGNORE)
 *   - CASCADE: `DELETE FROM program WHERE id = ?` removes the program's
 *     dictionary rows via the FK
 */
describe('v022 program_sub_tag dictionary migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates program_sub_tag table after full migrate', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
    }>(`PRAGMA table_info(program_sub_tag)`);
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('program_id')?.type).toBe('TEXT');
    expect(byName.get('program_id')?.notnull).toBe(1);
    expect(byName.get('sub_tag')?.type).toBe('TEXT');
    expect(byName.get('sub_tag')?.notnull).toBe(1);
    expect(byName.get('created_at')?.type).toBe('INTEGER');
    expect(byName.get('created_at')?.notnull).toBe(1);
  });

  it('creates idx_program_sub_tag_program index', async () => {
    await migrate(db);
    const idx = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type='index' AND name='idx_program_sub_tag_program'`,
    );
    expect(idx).toHaveLength(1);
  });

  it('backfills from template.sub_tag and program_cell.sub_tag (DISTINCT per program)', async () => {
    await migrate(db);
    const pid = 'prog-backfill';
    // Seed a program directly (bypasses createProgram dup-name guard).
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      pid,
      'P-back',
      null,
      5,
      3,
      '2026-05-01',
      1_000,
      1_000,
    );
    // Seed a template with sub_tag 'X' under this program.
    await db.runAsync(
      `INSERT INTO template
         (id, name, color_hex, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      'tpl-1',
      'Push',
      1_000,
      1_000,
      pid,
      'X',
    );
    // Seed a program_cell row with sub_tag 'Y' (no template attached).
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, 0, 0, NULL, ?)`,
      'cell-1',
      pid,
      'Y',
    );
    // Clear out anything `migrate` may have already backfilled, then re-run
    // v022 to exercise the backfill paths in isolation.
    await db.runAsync(
      `DELETE FROM program_sub_tag WHERE program_id = ?`,
      pid,
    );
    await v022_program_sub_tag(db);

    const rows = await db.getAllAsync<{
      program_id: string;
      sub_tag: string;
    }>(
      `SELECT program_id, sub_tag FROM program_sub_tag
        WHERE program_id = ?
        ORDER BY sub_tag ASC`,
      pid,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sub_tag)).toEqual(['X', 'Y']);
  });

  it('does NOT backfill empty-string or NULL sub_tag rows', async () => {
    await migrate(db);
    const pid = 'prog-empty';
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      pid,
      'P-empty',
      null,
      5,
      3,
      '2026-05-01',
      1_000,
      1_000,
    );
    await db.runAsync(
      `INSERT INTO template
         (id, name, color_hex, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      'tpl-empty',
      'Push',
      1_000,
      1_000,
      pid,
      '',
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, 0, 0, NULL, NULL)`,
      'cell-empty',
      pid,
    );
    await db.runAsync(
      `DELETE FROM program_sub_tag WHERE program_id = ?`,
      pid,
    );
    await v022_program_sub_tag(db);
    const rows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ?`,
      pid,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('is idempotent — re-running v022 against a populated schema is a safe no-op', async () => {
    await migrate(db);
    const pid = 'prog-idem';
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      pid,
      'P-idem',
      null,
      5,
      3,
      '2026-05-01',
      1_000,
      1_000,
    );
    await db.runAsync(
      `INSERT INTO template
         (id, name, color_hex, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      'tpl-idem',
      'Push',
      1_000,
      1_000,
      pid,
      'II-1',
    );
    // First v022 (already run via migrate); second invocation should not throw
    // and should not duplicate rows.
    await expect(v022_program_sub_tag(db)).resolves.toBeUndefined();
    await expect(v022_program_sub_tag(db)).resolves.toBeUndefined();
    const rows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag
        WHERE program_id = ? AND sub_tag = ?`,
      pid,
      'II-1',
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('cascades on DELETE FROM program — dictionary rows vanish with the parent', async () => {
    await migrate(db);
    const pid = 'prog-cascade';
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      pid,
      'P-casc',
      null,
      5,
      3,
      '2026-05-01',
      1_000,
      1_000,
    );
    // Seed dictionary rows directly.
    await db.runAsync(
      `INSERT INTO program_sub_tag (program_id, sub_tag, created_at)
       VALUES (?, ?, ?)`,
      pid,
      'A',
      1_000,
    );
    await db.runAsync(
      `INSERT INTO program_sub_tag (program_id, sub_tag, created_at)
       VALUES (?, ?, ?)`,
      pid,
      'B',
      1_000,
    );
    // Sanity — both rows present.
    let cnt = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ?`,
      pid,
    );
    expect(cnt?.n).toBe(2);

    // CASCADE: SQLite requires PRAGMA foreign_keys=ON for FK cascade to run.
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    // Clear `program_cell` rows that reference this program to avoid FK
    // conflicts (program_cell has its own FK to program; we deleted nothing
    // there, but defensive cleanup keeps the test focused).
    await db.runAsync(`DELETE FROM program_cell WHERE program_id = ?`, pid);
    await db.runAsync(`DELETE FROM program WHERE id = ?`, pid);

    cnt = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ?`,
      pid,
    );
    expect(cnt?.n).toBe(0);
  });

  it('skips a dangling template.program_id without tripping the FK (M1 brick guard)', async () => {
    // Regression for the "no-FK-source backfill brick": `template.program_id`
    // (v005 ALTER) has no DB-level FK, so it can hold a ghost program id. The
    // backfill INSERTs into `program_sub_tag` which DOES carry a real FK, and
    // `INSERT OR IGNORE` does NOT swallow FK violations. With foreign_keys=ON
    // (prod migrate condition) an orphaned source row would throw SQLite 19 and
    // brick boot. The `program_id IN (SELECT id FROM program)` guard must skip
    // it instead. Reverting the guard makes this test throw.
    await migrate(db);
    const validPid = 'prog-valid';
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      validPid,
      'P-valid',
      null,
      5,
      3,
      '2026-05-01',
      1_000,
      1_000,
    );
    // Template under a real program → should backfill.
    await db.runAsync(
      `INSERT INTO template
         (id, name, color_hex, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      'tpl-valid',
      'Push',
      1_000,
      1_000,
      validPid,
      'GOOD',
    );
    // Template pointing at a program that does NOT exist (dangling). Allowed
    // because template.program_id has no FK. This is the brick trigger.
    await db.runAsync(
      `INSERT INTO template
         (id, name, color_hex, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      'tpl-orphan',
      'Ghost',
      1_000,
      1_000,
      'prog-ghost-does-not-exist',
      'ORPHAN',
    );
    // Clear what migrate already backfilled, then reproduce the prod condition
    // (FK enforcement ON) before exercising the backfill in isolation.
    await db.runAsync(`DELETE FROM program_sub_tag`);
    await db.execAsync(`PRAGMA foreign_keys = ON`);

    // Must NOT throw — guard filters the orphan out.
    await expect(v022_program_sub_tag(db)).resolves.toBeUndefined();

    const rows = await db.getAllAsync<{ program_id: string; sub_tag: string }>(
      `SELECT program_id, sub_tag FROM program_sub_tag ORDER BY sub_tag ASC`,
    );
    expect(rows.map((r) => r.sub_tag)).toEqual(['GOOD']);
    expect(rows.some((r) => r.sub_tag === 'ORPHAN')).toBe(false);
  });

  it('runs automatically as part of the full migration runner (user_version >= 22)', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(row?.user_version).toBeGreaterThanOrEqual(22);
  });
});
