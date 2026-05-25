import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  applyTagToRow,
  applyTemplateToColumn,
  createProgram,
  getProgram,
  listProgramSubTags,
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

  // Wave 16 / v022 (ADR-0021) — `sub_tag_override` branch coverage.
  //
  // The wave-16 `+建立新模板 → 建立並導入` flow passes a freshly-created
  // template's sub_tag through `applyTemplateToColumn` as an override so the
  // new label propagates to all cycles of the column at once. `sub_tag_override`
  // is detected via `hasOwnProperty` so `null` (clear all) is distinguishable
  // from absent (preserve per-row default).
  it('with sub_tag_override overrides per-row sub_tag', async () => {
    const { db, programId, templateAId, templateBId } =
      await setupProgramWithTemplate();
    // Pre-existing column: row0 with sub_tag='II-1', row1 with 'II-2'.
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 2,
      template_id: templateBId,
      sub_tag: 'II-1',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 2,
      template_id: templateBId,
      sub_tag: 'II-2',
      uuid,
    });

    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 2,
      template_id: templateAId,
      sub_tag_override: 'NEW',
      uuid,
    });

    const got = await getProgram(db, programId);
    const col = got?.cells.filter((c) => c.day_index === 2) ?? [];
    expect(col).toHaveLength(3);
    for (const c of col) {
      expect(c.template_id).toBe(templateAId);
      expect(c.sub_tag).toBe('NEW');
    }
    db.close();
  });

  it('with sub_tag_override registers the new label in program_sub_tag dictionary', async () => {
    const { db, programId, templateAId } = await setupProgramWithTemplate();
    await db.runAsync(
      `DELETE FROM program_cell WHERE program_id = ?`,
      programId,
    );
    // Sanity — dictionary is empty for a brand-new column apply.
    expect(await listProgramSubTags(db, programId)).toEqual([]);

    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 0,
      template_id: templateAId,
      sub_tag_override: 'NEW',
      uuid,
    });

    expect(await listProgramSubTags(db, programId)).toContain('NEW');
    db.close();
  });

  it('with sub_tag_override=null clears every row\'s sub_tag (and does NOT register null in the dictionary)', async () => {
    const { db, programId, templateAId, templateBId } =
      await setupProgramWithTemplate();
    // Pre-existing column with non-null sub_tag values.
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 2,
      template_id: templateBId,
      sub_tag: 'II-1',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 2,
      template_id: templateBId,
      sub_tag: 'II-2',
      uuid,
    });
    // Dictionary now contains II-1 + II-2 from the upsertCell side-effects.
    const before = await listProgramSubTags(db, programId);
    expect(before).toEqual(expect.arrayContaining(['II-1', 'II-2']));

    await applyTemplateToColumn(db, {
      program_id: programId,
      day_index: 2,
      template_id: templateAId,
      sub_tag_override: null,
      uuid,
    });

    const got = await getProgram(db, programId);
    const col = got?.cells.filter((c) => c.day_index === 2) ?? [];
    expect(col).toHaveLength(3);
    for (const c of col) {
      expect(c.template_id).toBe(templateAId);
      expect(c.sub_tag).toBeNull();
    }
    // Dictionary retains the previously-registered labels — we never garbage
    // collect on override-to-null (that's the whole point of the persistent
    // dictionary). Source code line 494 guards `args.sub_tag_override != null`
    // before registering, so null literally never enters the dictionary.
    const after = await listProgramSubTags(db, programId);
    expect(after).toEqual(expect.arrayContaining(['II-1', 'II-2']));
    expect(after).not.toContain('');
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

  // Wave 16 / v022 (ADR-0021) — applyTagToRow side-effect into the persistent
  // dictionary fires even when 0 cells get touched.
  //
  // The "all-rest row" scenario: user picks a strength label for a row whose
  // every cell is 「休息」. UPDATE matches 0 program_cell rows (filter requires
  // template_id IS NOT NULL), but the label should STILL land in the
  // dictionary so the picker chip can list it for future drag-fill / cell tap.
  it('registers sub_tag in dictionary even when 0 cells are touched (all-rest row)', async () => {
    const { db, programId } = await setupProgramWithTemplate();
    // Wipe the seeded grid so row 2 is genuinely all-rest (no rows present).
    await db.runAsync(
      `DELETE FROM program_cell WHERE program_id = ?`,
      programId,
    );
    // Sanity — row 2 has zero non-rest cells.
    const beforeRows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_cell
        WHERE program_id = ? AND cycle_index = 2 AND template_id IS NOT NULL`,
      programId,
    );
    expect(beforeRows[0]?.n).toBe(0);

    await applyTagToRow(db, {
      program_id: programId,
      cycle_index: 2,
      sub_tag: 'II-3',
    });

    // UPDATE matched zero rows (still no program_cell rows), but dictionary
    // received the label via `recordProgramSubTag` inside the transaction.
    const cells = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_cell WHERE program_id = ?`,
      programId,
    );
    expect(cells[0]?.n).toBe(0);

    const dict = await listProgramSubTags(db, programId);
    expect(dict).toContain('II-3');
    db.close();
  });
});
