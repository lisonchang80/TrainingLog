import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  findTemplateByTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

/**
 * Round 38 polish — `findTemplateByTriple` repo func.
 *
 * NULL-safe lookup of a template by (name, program_id, sub_tag). Used by the
 * `templates.tsx::onStart` lookup-or-spawn rule so picking an existing
 * (program, sub_tag) sibling re-aims the session-start template_id at the
 * sibling instead of leaving it on the source row (which would cause a later
 * 「儲存模板」 to silently overwrite the source).
 */
describe('findTemplateByTriple (round 38 polish)', () => {
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

  /**
   * Helper — seed a template row with arbitrary (name, program_id, sub_tag).
   * createTemplate seeds program_id + sub_tag as NULL by default; we patch
   * them in via UPDATE so we can exercise all four NULL/non-NULL combos.
   */
  async function seedTemplate(args: {
    id: string;
    name: string;
    program_id: string | null;
    sub_tag: string | null;
  }) {
    await createTemplate(db, { id: args.id, name: args.name });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
      args.program_id,
      args.sub_tag,
      args.id
    );
  }

  it('finds a row with the all-NULL triple (free template, no sub_tag)', async () => {
    await seedTemplate({
      id: 'tpl-free',
      name: 'Smoke',
      program_id: null,
      sub_tag: null,
    });
    const result = await findTemplateByTriple(db, {
      name: 'Smoke',
      program_id: null,
      sub_tag: null,
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tpl-free');
  });

  it('finds a row matching all three non-null fields exactly', async () => {
    await seedTemplate({
      id: 'tpl-A1',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
    // Decoy row — same name but different program / sub_tag.
    await seedTemplate({
      id: 'tpl-B1',
      name: 'Smoke',
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
    });

    const result = await findTemplateByTriple(db, {
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tpl-A1');
  });

  it('returns null when no row matches (mismatch on any field)', async () => {
    await seedTemplate({
      id: 'tpl-A1',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
    // Mismatch on sub_tag.
    const r1 = await findTemplateByTriple(db, {
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-2',
    });
    expect(r1).toBeNull();
    // Mismatch on program_id.
    const r2 = await findTemplateByTriple(db, {
      name: 'Smoke',
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
    });
    expect(r2).toBeNull();
    // Mismatch on name.
    const r3 = await findTemplateByTriple(db, {
      name: 'Other',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
    expect(r3).toBeNull();
    // NULL probe against a non-NULL row (should NOT match — IS-NULL semantics).
    const r4 = await findTemplateByTriple(db, {
      name: 'Smoke',
      program_id: null,
      sub_tag: null,
    });
    expect(r4).toBeNull();
  });
});
