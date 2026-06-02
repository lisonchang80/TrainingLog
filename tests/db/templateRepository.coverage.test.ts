import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  cloneTemplateWithSubTag,
  commitTemplateDraft,
  createTemplate,
  previewTemplateDeletion,
} from '../../src/adapters/sqlite/templateRepository';
import type { Template } from '../../src/domain/template/types';

/**
 * Coverage fill (overnight 2026-06-03 r2) — reachable branches the prior
 * waves left uncovered in templateRepository.ts:
 *
 *   - previewTemplateDeletion: unknown id → `{ templates: [], affectedCells: [] }`
 *     early return (template == null). Existing deleteTemplatesByName test only
 *     hits the happy path.
 *   - cloneTemplateWithSubTag: SOURCE_TEMPLATE_NOT_FOUND throw (existing clone
 *     test only covers the dup-triple guard).
 *   - commitTemplateDraft: the template-level name/color CHANGE branch (existing
 *     V2 tests only commit drafts where name + color stay identical → the
 *     `updated_at`-only ELSE branch).
 */

const NOW = 1_700_000_000_000;

describe('templateRepository coverage fill', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('previewTemplateDeletion: unknown id returns empty templates + cells', async () => {
    const preview = await previewTemplateDeletion(db, 'no-such-template');
    expect(preview.templates).toEqual([]);
    expect(preview.affectedCells).toEqual([]);
  });

  it('cloneTemplateWithSubTag: throws SOURCE_TEMPLATE_NOT_FOUND for missing source', async () => {
    // The source-template lookup runs (and throws) before any program access,
    // so no program row is needed.
    await expect(
      cloneTemplateWithSubTag(db, {
        source_template_id: 'ghost',
        new_program_id: 'prog-1',
        new_sub_tag: 'heavy',
        uuid: () => 'uid-1',
        now: () => NOW,
      }),
    ).rejects.toThrow('SOURCE_TEMPLATE_NOT_FOUND');
  });

  it('commitTemplateDraft: writes name + color when the template header changes', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: () => NOW });
    await db.runAsync(
      `UPDATE template SET color_hex = '#FF0000' WHERE id = 'tpl-1'`,
    );
    const committed: Template = {
      id: 'tpl-1',
      name: 'Push',
      color_hex: '#FF0000',
      exercises: [],
    };
    const draft: Template = {
      ...committed,
      name: 'Pull',
      color_hex: '#00FF00',
    };

    await commitTemplateDraft(db, { committed, draft, now: () => NOW + 1000 });

    const row = await db.getFirstAsync<{
      name: string;
      color_hex: string | null;
      updated_at: number;
    }>(`SELECT name, color_hex, updated_at FROM template WHERE id = 'tpl-1'`);
    expect(row!.name).toBe('Pull');
    expect(row!.color_hex).toBe('#00FF00');
    expect(row!.updated_at).toBe(NOW + 1000);
  });
});
