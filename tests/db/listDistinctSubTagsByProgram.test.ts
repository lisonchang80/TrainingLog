import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  attachTemplateToProgram,
  listDistinctSubTagsByProgram,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

/**
 * 5/18 polish round 30 — TemplateMetaSheet 強度標籤 per-program filter.
 *
 * `listDistinctSubTagsByProgram(db, program_id)` should:
 *   - return [] when no template under that program has a sub_tag
 *   - return distinct sub_tags scoped to a single program (no cross-program bleed)
 *   - skip null / empty-string sub_tags
 */
describe('listDistinctSubTagsByProgram (5/18 polish round 30)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // Two programs for cross-program isolation testing.
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

  it('returns [] when no template under the program has a sub_tag', async () => {
    const tags = await listDistinctSubTagsByProgram(db, 'prog-A');
    expect(tags).toEqual([]);
  });

  it('returns distinct sub_tags for templates under the given program', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: () => 1 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-1',
      program_id: 'prog-A',
      sub_tag: '5x5',
    });
    await createTemplate(db, { id: 'tpl-2', name: 'Pull', now: () => 2 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-2',
      program_id: 'prog-A',
      sub_tag: '8RM',
    });
    // Duplicate sub_tag — should collapse to one in the DISTINCT result.
    await createTemplate(db, { id: 'tpl-3', name: 'Legs', now: () => 3 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-3',
      program_id: 'prog-A',
      sub_tag: '5x5',
    });

    const tags = await listDistinctSubTagsByProgram(db, 'prog-A');
    expect(tags).toEqual(['5x5', '8RM']);
  });

  it('does not bleed sub_tags from other programs', async () => {
    // Program A: only "5x5".
    await createTemplate(db, { id: 'tpl-a1', name: 'Push', now: () => 1 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-a1',
      program_id: 'prog-A',
      sub_tag: '5x5',
    });
    // Program B: "12RM" + "10RM".
    await createTemplate(db, { id: 'tpl-b1', name: 'Push', now: () => 2 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-b1',
      program_id: 'prog-B',
      sub_tag: '12RM',
    });
    await createTemplate(db, { id: 'tpl-b2', name: 'Pull', now: () => 3 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-b2',
      program_id: 'prog-B',
      sub_tag: '10RM',
    });

    const aTags = await listDistinctSubTagsByProgram(db, 'prog-A');
    const bTags = await listDistinctSubTagsByProgram(db, 'prog-B');
    expect(aTags).toEqual(['5x5']);
    expect(bTags).toEqual(['10RM', '12RM']);
  });

  it('skips null / empty-string sub_tags', async () => {
    // null sub_tag (attach without one).
    await createTemplate(db, { id: 'tpl-null', name: 'Free', now: () => 1 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-null',
      program_id: 'prog-A',
      sub_tag: null,
    });
    // empty-string sub_tag (explicitly written).
    await createTemplate(db, { id: 'tpl-empty', name: 'Free 2', now: () => 2 });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
      'prog-A',
      '',
      'tpl-empty'
    );
    // One real sub_tag to confirm filter works in tandem.
    await createTemplate(db, { id: 'tpl-real', name: 'Pull', now: () => 3 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-real',
      program_id: 'prog-A',
      sub_tag: '5x5',
    });

    const tags = await listDistinctSubTagsByProgram(db, 'prog-A');
    expect(tags).toEqual(['5x5']);
  });
});
