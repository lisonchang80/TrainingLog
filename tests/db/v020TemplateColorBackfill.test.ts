import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v020_template_color_backfill } from '../../src/db/schema/v020_template_color_backfill';
import {
  TEMPLATE_COLOR_PALETTE,
  colorForTemplateName,
} from '../../src/domain/template/templateColor';

/**
 * v020 migration tests — backfill `template.color_hex` for rows still on
 * the v009 `DEFAULT ''` sentinel. ADR-0015 § Storage 設計.
 *
 * Coverage:
 *   - Empty color_hex rows get a hashed palette color.
 *   - Explicit color_hex values are NOT overwritten on re-run (idempotent).
 *   - A no-row table is a safe no-op.
 *   - Migration also runs as part of the normal `migrate(db)` runner.
 */
describe('v020 template color_hex backfill migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('fills color_hex for rows that still hold the v009 DEFAULT empty string', async () => {
    // Migrate up through v019 first, then reset the template color manually
    // to mimic a pre-v020 row state, then run v020 directly.
    await migrate(db);
    await db.runAsync(
      `INSERT INTO template (id, name, color_hex, created_at, updated_at) VALUES (?, ?, '', ?, ?)`,
      'tpl-x',
      '胸日 A',
      1_000,
      1_000
    );
    await db.runAsync(
      `INSERT INTO template (id, name, color_hex, created_at, updated_at) VALUES (?, ?, '', ?, ?)`,
      'tpl-y',
      'Pull Day',
      2_000,
      2_000
    );

    await v020_template_color_backfill(db);

    const x = await db.getFirstAsync<{ color_hex: string }>(
      `SELECT color_hex FROM template WHERE id = 'tpl-x'`
    );
    const y = await db.getFirstAsync<{ color_hex: string }>(
      `SELECT color_hex FROM template WHERE id = 'tpl-y'`
    );
    expect(x?.color_hex).toBe(colorForTemplateName('胸日 A'));
    expect(y?.color_hex).toBe(colorForTemplateName('Pull Day'));
    // Sanity: both colors come from the canonical palette.
    expect(TEMPLATE_COLOR_PALETTE).toContain(x?.color_hex);
    expect(TEMPLATE_COLOR_PALETTE).toContain(y?.color_hex);
  });

  it('does not overwrite explicit color_hex values (idempotent re-run safe)', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO template (id, name, color_hex, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      'tpl-set',
      'User Picked',
      '#ABCDEF',
      1_000,
      1_000
    );
    await v020_template_color_backfill(db);
    const row = await db.getFirstAsync<{ color_hex: string }>(
      `SELECT color_hex FROM template WHERE id = 'tpl-set'`
    );
    expect(row?.color_hex).toBe('#ABCDEF');
  });

  it('is a no-op on an empty template table', async () => {
    await migrate(db);
    await expect(v020_template_color_backfill(db)).resolves.toBeUndefined();
  });

  it('runs automatically as part of the full migration runner', async () => {
    // migrate(db) on a fresh DB should bring user_version up to v020.
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    expect(row?.user_version).toBeGreaterThanOrEqual(20);
  });
});
