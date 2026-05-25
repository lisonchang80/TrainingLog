import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  listTemplateVariantsByName,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

/**
 * Slice 10c overnight #54 — `listTemplateVariantsByName` repo helper.
 *
 * Templates tab swipe-to-delete needs every same-name 三元組 sibling so the
 * confirm Alert can enumerate them AND the cascade can hit each via
 * `deleteTemplate(db, id)`. The list view itself is dedupe-by-name
 * (`listTemplateGroupsByName`), so this is the inverse: expand a single
 * representative row back into its full sibling set.
 */
describe('listTemplateVariantsByName (overnight #54)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await createProgram(db, {
      program: {
        id: 'prog-A',
        name: 'Program A',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createProgram(db, {
      program: {
        id: 'prog-B',
        name: 'Program B',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  async function seedTemplate(args: {
    id: string;
    name: string;
    program_id: string | null;
    sub_tag: string | null;
    updated_at: number;
  }) {
    await createTemplate(db, { id: args.id, name: args.name });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ?, updated_at = ? WHERE id = ?`,
      args.program_id,
      args.sub_tag,
      args.updated_at,
      args.id
    );
  }

  it('returns [] when no template with that name exists', async () => {
    await seedTemplate({
      id: 'tpl-other',
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 1000,
    });
    const rows = await listTemplateVariantsByName(db, 'Smoke');
    expect(rows).toEqual([]);
  });

  it('returns the single variant when only one sibling shares the name', async () => {
    await seedTemplate({
      id: 'tpl-lone',
      name: 'Pull',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
      updated_at: 1000,
    });
    const rows = await listTemplateVariantsByName(db, 'Pull');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tpl-lone');
    expect(rows[0].program_id).toBe('prog-A');
    expect(rows[0].sub_tag).toBe('TEST-1');
  });

  it('returns every same-name variant ordered by updated_at DESC', async () => {
    await seedTemplate({
      id: 'tpl-old',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-mid',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-2',
      updated_at: 2000,
    });
    await seedTemplate({
      id: 'tpl-newest',
      name: 'Smoke',
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
      updated_at: 3000,
    });
    // Sibling with different name MUST NOT appear in the result set.
    await seedTemplate({
      id: 'tpl-different-name',
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 5000,
    });

    const rows = await listTemplateVariantsByName(db, 'Smoke');
    expect(rows.map((r) => r.id)).toEqual(['tpl-newest', 'tpl-mid', 'tpl-old']);
    // Triple identity preserved for the Alert enumeration.
    expect(rows[0]).toMatchObject({
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
    });
    expect(rows[2]).toMatchObject({
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
  });

  it('includes 通用 variants (program_id IS NULL OR sub_tag IS NULL) in the result', async () => {
    await seedTemplate({
      id: 'tpl-universal',
      name: 'Smoke',
      program_id: null,
      sub_tag: null,
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-program-null-sub',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 1500,
    });
    await seedTemplate({
      id: 'tpl-concrete',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
      updated_at: 2000,
    });

    const rows = await listTemplateVariantsByName(db, 'Smoke');
    expect(rows).toHaveLength(3);
    // Callers use this set to detect 通用 variants and gate swipe-delete.
    const hasUniversal = rows.some(
      (r) => r.program_id === null || r.sub_tag === null
    );
    expect(hasUniversal).toBe(true);
  });
});
