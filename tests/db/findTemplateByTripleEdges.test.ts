/**
 * Edge cases for `findTemplateByTriple` not covered by
 * `tests/db/findTemplateByTriple.test.ts`.
 *
 *   - Sibling routing: among multiple same-name siblings under different
 *     (program, sub_tag) tuples, the correct sibling is returned.
 *   - Empty-string sub_tag vs NULL sub_tag treated as distinct identities
 *     (the SQL uses `(IS NULL AND ? IS NULL) OR = ?`, so '' falls into the
 *     `=` arm — '' matches '' but NOT NULL).
 *   - Name match is case-sensitive (no LOWER on the read path).
 *   - LIMIT 1 returns deterministic single result when a dup-triple slips
 *     past the dup-guard (defensive — should never happen in production).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  findTemplateByTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

describe('findTemplateByTriple — edge cases', () => {
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
  }) {
    await createTemplate(db, { id: args.id, name: args.name });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
      args.program_id,
      args.sub_tag,
      args.id,
    );
  }

  it('sibling routing: 3 same-name templates under 3 different (program, sub_tag) tuples — picks the requested one', async () => {
    await seedTemplate({ id: 'tpl-1', name: 'Push', program_id: 'prog-A', sub_tag: 'V1' });
    await seedTemplate({ id: 'tpl-2', name: 'Push', program_id: 'prog-A', sub_tag: 'V2' });
    await seedTemplate({ id: 'tpl-3', name: 'Push', program_id: 'prog-B', sub_tag: 'V1' });

    const r1 = await findTemplateByTriple(db, {
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: 'V1',
    });
    expect(r1?.id).toBe('tpl-1');

    const r2 = await findTemplateByTriple(db, {
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: 'V2',
    });
    expect(r2?.id).toBe('tpl-2');

    const r3 = await findTemplateByTriple(db, {
      name: 'Push',
      program_id: 'prog-B',
      sub_tag: 'V1',
    });
    expect(r3?.id).toBe('tpl-3');
  });

  it('empty-string sub_tag is distinct from NULL sub_tag', async () => {
    await seedTemplate({ id: 'tpl-empty', name: 'P', program_id: 'prog-A', sub_tag: '' });
    await seedTemplate({ id: 'tpl-null', name: 'P', program_id: 'prog-A', sub_tag: null });

    // Probe for empty-string sub_tag → matches the empty-string row.
    const r1 = await findTemplateByTriple(db, {
      name: 'P',
      program_id: 'prog-A',
      sub_tag: '',
    });
    expect(r1?.id).toBe('tpl-empty');

    // Probe for null sub_tag → matches the null row (IS NULL arm).
    const r2 = await findTemplateByTriple(db, {
      name: 'P',
      program_id: 'prog-A',
      sub_tag: null,
    });
    expect(r2?.id).toBe('tpl-null');
  });

  it('name match is case-sensitive', async () => {
    await seedTemplate({ id: 'tpl-up', name: 'Push', program_id: 'prog-A', sub_tag: 'V1' });

    const wrongCase = await findTemplateByTriple(db, {
      name: 'push',
      program_id: 'prog-A',
      sub_tag: 'V1',
    });
    expect(wrongCase).toBeNull();

    const exact = await findTemplateByTriple(db, {
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: 'V1',
    });
    expect(exact?.id).toBe('tpl-up');
  });

  it('finds the all-NULL-program row when a non-NULL-program sibling shares the name + sub_tag', async () => {
    await seedTemplate({ id: 'tpl-free', name: 'Free', program_id: null, sub_tag: 'X' });
    await seedTemplate({ id: 'tpl-attached', name: 'Free', program_id: 'prog-A', sub_tag: 'X' });

    const r = await findTemplateByTriple(db, {
      name: 'Free',
      program_id: null,
      sub_tag: 'X',
    });
    expect(r?.id).toBe('tpl-free');
  });

  it('defensive: dup-triple slip-through returns a single row deterministically (LIMIT 1)', async () => {
    // The ADR-0003 dup-triple guard lives at the createTemplate path. Here we
    // forcibly seed two rows with the same triple to confirm the read helper
    // doesn't throw and returns exactly one match.
    await seedTemplate({ id: 'tpl-dup-a', name: 'Push', program_id: 'prog-A', sub_tag: 'V1' });
    await seedTemplate({ id: 'tpl-dup-b', name: 'Push', program_id: 'prog-A', sub_tag: 'V1' });

    const r = await findTemplateByTriple(db, {
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: 'V1',
    });
    expect(r).not.toBeNull();
    expect(['tpl-dup-a', 'tpl-dup-b']).toContain(r!.id);
  });
});
