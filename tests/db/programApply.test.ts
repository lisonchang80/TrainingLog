import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  applyTagToRow,
  applyTemplateToColumn,
  createProgram,
  getProgram,
  upsertCell,
} from '../../src/adapters/sqlite/programRepository';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';
import { migrate } from '../../src/db/migrate';
import { expandWizardDraft } from '../../src/domain/program/programManager';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 15 (2026-05-21) — column-apply / row-apply / upsertCell.
 *
 * Spec Q3:
 *   - applyTemplateToColumn(template_id=X) keeps each row's existing sub_tag.
 *   - applyTemplateToColumn(template_id=null) clears both template_id and
 *     sub_tag (rest occupies both visual slots).
 *   - applyTagToRow only touches non-rest cells.
 */

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: '增肌-Q1',
  main_tag: '增肌',
  cycle_length: 5,
  cycle_count: 3,
  start_date: '2026-05-01',
  is_active: 0,
  ...over,
});

async function setupProgramWithTemplate(): Promise<{
  db: BetterSqliteDatabase;
  programId: string;
  templateAId: string;
  templateBId: string;
}> {
  counter = 0;
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  const templateAId = uuid();
  const templateBId = uuid();
  await createTemplate(db, { id: templateAId, name: 'T-A' });
  await createTemplate(db, { id: templateBId, name: 'T-B' });
  const program = buildProgram();
  const cells = expandWizardDraft({
    program,
    dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
    uuid,
  });
  await createProgram(db, { program, cells });
  return { db, programId: program.id, templateAId, templateBId };
}

describe('upsertCell', () => {
  it('INSERTs when no row exists at (program, cycle, day)', async () => {
    const { db, programId, templateAId } = await setupProgramWithTemplate();
    // Clear the seeded grid first (expandWizardDraft fills all positions).
    await db.runAsync(`DELETE FROM program_cell WHERE program_id = ?`, programId);
    const cellId = await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 2,
      template_id: templateAId,
      sub_tag: 'heavy',
      uuid,
    });
    expect(typeof cellId).toBe('string');
    const got = await getProgram(db, programId);
    expect(got?.cells).toHaveLength(1);
    expect(got?.cells[0]).toMatchObject({
      id: cellId,
      cycle_index: 1,
      day_index: 2,
      template_id: templateAId,
      sub_tag: 'heavy',
    });
    db.close();
  });

  it('UPDATEs existing row in place (same id)', async () => {
    const { db, programId, templateAId, templateBId } =
      await setupProgramWithTemplate();
    const firstId = await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'A',
      uuid,
    });
    const secondId = await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateBId,
      sub_tag: 'B',
      uuid,
    });
    expect(secondId).toBe(firstId);
    const got = await getProgram(db, programId);
    const cell = got?.cells.find(
      (c) => c.cycle_index === 0 && c.day_index === 0
    );
    expect(cell?.template_id).toBe(templateBId);
    expect(cell?.sub_tag).toBe('B');
    db.close();
  });
});

describe('applyTemplateToColumn', () => {
  it('applies template to all rows in the column, preserves existing sub_tag', async () => {
    const { db, programId, templateAId, templateBId } =
      await setupProgramWithTemplate();
    // Seed row 0 with template B + sub_tag='light'; row 1 with sub_tag='heavy' but no template;
    // row 2 stays rest (default).
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 2,
      template_id: templateBId,
      sub_tag: 'light',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 2,
      template_id: null,
      sub_tag: 'heavy',
      uuid,
    });

    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 2,
      template_id: templateAId,
      uuid,
    });

    const got = await getProgram(db, programId);
    const col = got?.cells.filter((c) => c.day_index === 2) ?? [];
    expect(col).toHaveLength(3);
    const byCycle = new Map(col.map((c) => [c.cycle_index, c]));
    expect(byCycle.get(0)?.template_id).toBe(templateAId);
    expect(byCycle.get(0)?.sub_tag).toBe('light'); // preserved
    expect(byCycle.get(1)?.template_id).toBe(templateAId);
    expect(byCycle.get(1)?.sub_tag).toBe('heavy'); // preserved
    expect(byCycle.get(2)?.template_id).toBe(templateAId);
    expect(byCycle.get(2)?.sub_tag).toBeNull(); // newly inserted, no prior sub_tag
    db.close();
  });

  it('applies rest (template_id=null) clears template AND sub_tag in existing rows', async () => {
    const { db, programId, templateBId } = await setupProgramWithTemplate();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 1,
      template_id: templateBId,
      sub_tag: 'X',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 1,
      template_id: templateBId,
      sub_tag: 'Y',
      uuid,
    });
    // Clear column to rest
    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 1,
      template_id: null,
      uuid,
    });
    const got = await getProgram(db, programId);
    const col = got?.cells.filter((c) => c.day_index === 1) ?? [];
    for (const c of col) {
      expect(c.template_id).toBeNull();
      expect(c.sub_tag).toBeNull();
    }
    db.close();
  });

  it('does not insert sparse rest rows for missing positions when applying rest', async () => {
    const { db, programId } = await setupProgramWithTemplate();
    await db.runAsync(`DELETE FROM program_cell WHERE program_id = ?`, programId);
    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 0,
      template_id: null,
      uuid,
    });
    const got = await getProgram(db, programId);
    expect(got?.cells).toHaveLength(0);
    db.close();
  });
});

describe('applyTagToRow', () => {
  it('updates sub_tag on non-rest cells, skips rest cells', async () => {
    const { db, programId, templateAId } = await setupProgramWithTemplate();
    // Row 0: day 0 = filled, day 1 = rest, day 2 = filled
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'old',
      uuid,
    });
    // (cycle 0, day 1) intentionally absent → rest by missing-row
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 2,
      template_id: templateAId,
      sub_tag: 'old',
      uuid,
    });
    // Sibling row 1 should not be touched
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'untouched',
      uuid,
    });

    await applyTagToRow(db, {
      program_id: programId,
      cycle_index: 0,
      sub_tag: 'NEW',
    });

    const got = await getProgram(db, programId);
    const r0 = got?.cells.filter((c) => c.cycle_index === 0) ?? [];
    expect(
      r0.find((c) => c.day_index === 0)?.sub_tag
    ).toBe('NEW');
    expect(
      r0.find((c) => c.day_index === 2)?.sub_tag
    ).toBe('NEW');
    // Sibling row untouched
    const r1Cell = got?.cells.find(
      (c) => c.cycle_index === 1 && c.day_index === 0
    );
    expect(r1Cell?.sub_tag).toBe('untouched');
    db.close();
  });

  it('clearing sub_tag (null) is allowed', async () => {
    const { db, programId, templateAId } = await setupProgramWithTemplate();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'heavy',
      uuid,
    });
    await applyTagToRow(db, {
      program_id: programId,
      cycle_index: 0,
      sub_tag: null,
    });
    const got = await getProgram(db, programId);
    const cell = got?.cells.find(
      (c) => c.cycle_index === 0 && c.day_index === 0
    );
    expect(cell?.sub_tag).toBeNull();
    db.close();
  });
});
