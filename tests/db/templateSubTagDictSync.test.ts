import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  listProgramSubTags,
} from '../../src/adapters/sqlite/programRepository';
import {
  attachTemplateToProgram,
  cloneTemplateWithSubTag,
  createTemplate,
  listDistinctSubTagsByProgram,
} from '../../src/adapters/sqlite/templateRepository';
import { migrate } from '../../src/db/migrate';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Regression coverage for the user-reported scenario (2026-05-29):
 *
 *   1. 訓練 tab → 「+ 新建模板」加 1 動作
 *   2. 「儲存」→ TemplateMetaSheet → 新增計畫 + inline 新增強度 → 「儲存」
 *   3. 計畫 tab → 該計畫詳細頁 → row 下方「套用強度到此 row」section
 *   4. 預期：剛建的強度可點 / 套用
 *   5. 實際 (bug)：顯示「無」、看不到剛建的強度
 *
 * Root cause — `attachTemplateToProgram` (template editor save sheet) and
 * `cloneTemplateWithSubTag` (start-template-sheet inline add) wrote
 * `template.sub_tag` but did NOT call `recordProgramSubTag`, so v022's
 * `program_sub_tag` dictionary stayed empty. The Programs tab row-apply
 * picker reads the dict (+ cells with sub_tag), so a freshly-classified
 * template that hadn't been placed in any cell was invisible.
 *
 * The fix made the two write helpers also write into the v022 dict.
 * `program-sub-tag-union-source` skill encodes the canonical invariant:
 * any path that lands a sub_tag onto `template.sub_tag` (or `program_cell
 * .sub_tag`) must also call `recordProgramSubTag`.
 *
 * These tests assert both the write helper's invariant (v022 dict +
 * classified list both return the new sub_tag) AND the skill's UNION
 * read pattern returns the chip even when one side is empty.
 */

let counter = 0;
const uuid = () => `u${++counter}`;

const buildProgram = (
  id: string,
  over: Partial<ProgramCore> = {},
): ProgramCore => ({
  id,
  name: 'P-test',
  main_tag: null,
  cycle_length: 3,
  cycle_count: 1,
  start_date: '2026-05-29',
  is_active: 0,
  ...over,
});

async function setup(): Promise<{
  db: BetterSqliteDatabase;
  programId: string;
}> {
  counter = 0;
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  const programId = 'prog-A';
  await createProgram(db, { program: buildProgram(programId) });
  return { db, programId };
}

describe('template sub_tag write helpers — v022 dict sync', () => {
  describe('attachTemplateToProgram', () => {
    it('records the (program_id, sub_tag) pair into v022 dict so picker can see it', async () => {
      const { db, programId } = await setup();
      // Mimic the template editor「儲存」flow: create a template then attach it
      // to a program with a freshly typed sub_tag.
      const templateId = uuid();
      await createTemplate(db, { id: templateId, name: 'Bench day' });

      await attachTemplateToProgram(db, {
        template_id: templateId,
        program_id: programId,
        sub_tag: 'GG-NEW',
      });

      // v022 dict should now know about it.
      const dict = await listProgramSubTags(db, programId);
      expect(dict).toEqual(['GG-NEW']);

      // The template-classification view should also see it.
      const classified = await listDistinctSubTagsByProgram(db, programId);
      expect(classified).toEqual(['GG-NEW']);

      db.close();
    });

    it('is a no-op for v022 dict when sub_tag is null (通用 attach)', async () => {
      const { db, programId } = await setup();
      const templateId = uuid();
      await createTemplate(db, { id: templateId, name: 'Generic' });

      await attachTemplateToProgram(db, {
        template_id: templateId,
        program_id: programId,
        sub_tag: null,
      });

      const dict = await listProgramSubTags(db, programId);
      expect(dict).toEqual([]);

      db.close();
    });

    it('is a no-op for v022 dict when program_id is null (detach to free template)', async () => {
      const { db, programId } = await setup();
      const templateId = uuid();
      await createTemplate(db, { id: templateId, name: 'T' });

      // First attach so the row has a program + sub_tag, then detach.
      await attachTemplateToProgram(db, {
        template_id: templateId,
        program_id: programId,
        sub_tag: 'GG-1',
      });
      await attachTemplateToProgram(db, {
        template_id: templateId,
        program_id: null,
        sub_tag: null,
      });

      // The detach should not touch the dict for any program (we have no
      // program_id to address). The dict from the original attach stays.
      const dict = await listProgramSubTags(db, programId);
      expect(dict).toEqual(['GG-1']);

      db.close();
    });
  });

  describe('cloneTemplateWithSubTag', () => {
    it('records the cloned (program_id, new_sub_tag) into v022 dict', async () => {
      const { db, programId } = await setup();
      // Seed a source template under another program so the clone is a
      // pure-INSERT path (no UPDATE side).
      const sourceProgramId = 'prog-source';
      await createProgram(db, {
        program: buildProgram(sourceProgramId, { name: 'P-src' }),
      });
      const sourceId = uuid();
      await createTemplate(db, { id: sourceId, name: 'Source' });
      await attachTemplateToProgram(db, {
        template_id: sourceId,
        program_id: sourceProgramId,
        sub_tag: 'SRC-1',
      });

      // start-template-sheet「+ 新增強度」 → cloneTemplateWithSubTag spawns a
      // new template under (programId, 'CLONE-NEW').
      await cloneTemplateWithSubTag(db, {
        source_template_id: sourceId,
        new_program_id: programId,
        new_sub_tag: 'CLONE-NEW',
        uuid,
      });

      const dict = await listProgramSubTags(db, programId);
      expect(dict).toEqual(['CLONE-NEW']);
      const classified = await listDistinctSubTagsByProgram(db, programId);
      expect(classified).toEqual(['CLONE-NEW']);

      db.close();
    });

    it('is a no-op for v022 dict when new_sub_tag is null (clone to 通用 sub_tag)', async () => {
      const { db, programId } = await setup();
      const sourceProgramId = 'prog-source';
      await createProgram(db, {
        program: buildProgram(sourceProgramId, { name: 'P-src' }),
      });
      const sourceId = uuid();
      await createTemplate(db, { id: sourceId, name: 'Source' });

      await cloneTemplateWithSubTag(db, {
        source_template_id: sourceId,
        new_program_id: programId,
        new_sub_tag: null,
        uuid,
      });

      const dict = await listProgramSubTags(db, programId);
      expect(dict).toEqual([]);

      db.close();
    });
  });

  describe('UNION read pattern (skill: program-sub-tag-union-source)', () => {
    it('dict-only entry (no template references it) is still surfaced via union', async () => {
      const { db, programId } = await setup();
      // No template attached — but a sub_tag was registered via row-apply
      // OR wizard Step 1. distinctSubTagsByProgram returns [], dict returns
      // ['DICT-ONLY']. The union must include it.
      const { recordProgramSubTag } = await import(
        '../../src/adapters/sqlite/programRepository'
      );
      await recordProgramSubTag(db, programId, 'DICT-ONLY');

      const [dict, classified] = await Promise.all([
        listProgramSubTags(db, programId),
        listDistinctSubTagsByProgram(db, programId),
      ]);
      const union = Array.from(new Set([...dict, ...classified]));
      expect(union).toEqual(['DICT-ONLY']);

      db.close();
    });

    it('template-classification entry is surfaced even when dict accidentally empty (defense-in-depth)', async () => {
      const { db, programId } = await setup();
      // Simulate a future regression: a write helper forgot to update the
      // dict. The classified side still keeps the chip available.
      const templateId = uuid();
      await createTemplate(db, { id: templateId, name: 'T-classified' });
      // Direct UPDATE bypassing attachTemplateToProgram to emulate the
      // forgotten-dict scenario.
      await db.runAsync(
        `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
        programId,
        'CLASSIFIED-ONLY',
        templateId,
      );

      const [dict, classified] = await Promise.all([
        listProgramSubTags(db, programId),
        listDistinctSubTagsByProgram(db, programId),
      ]);
      const union = Array.from(new Set([...dict, ...classified]));
      expect(dict).toEqual([]);
      expect(union).toEqual(['CLASSIFIED-ONLY']);

      db.close();
    });
  });
});
