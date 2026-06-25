import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  countFilledCells,
  countFilledCellsOutsideBounds,
  createProgram,
  getProgram,
  resizeProgram,
  updateProgramStartDate,
} from '../../src/adapters/sqlite/programRepository';
import { migrate } from '../../src/db/migrate';
import { expandWizardDraft } from '../../src/domain/program/programManager';
import {
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 15 (2026-05-21) — programs tab edit-mode resize.
 *   - `countFilledCellsOutsideBounds`: count of cells with template_id != null
 *     that would be deleted by a hypothetical resize. Drives the
 *     "縮小將砍掉 N 格已填內容" Alert.
 *   - `resizeProgram`: atomic resize — UPDATE program dimensions + DELETE
 *     out-of-bounds cells. Missing in-bounds positions stay sparse (the
 *     renderer treats no-row as 「休息」).
 */

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: '增肌-Q1',
  main_tag: '增肌',
  cycle_length: 7,
  cycle_count: 2,
  start_date: '2026-05-01',
  is_active: 0,
  ...over,
});

describe('programRepository — resize (wave 15)', () => {
  let db: BetterSqliteDatabase;
  let templateAId: string;

  beforeEach(async () => {
    counter = 0;
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    templateAId = uuid();
    await createTemplate(db, {
      id: templateAId,
      name: 'T-A',
    });
  });

  afterEach(() => {
    db.close();
  });

  async function seed7x2WithSomeFilled(): Promise<string> {
    const program = buildProgram();
    // Default expandWizardDraft fills every (c, d) with template_id=null
    // (rest cells). We then UPDATE some positions to have template_id
    // so we can verify "filled vs rest" count.
    const cells = expandWizardDraft({
      program,
      dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
      uuid,
    });
    await createProgram(db, { program, cells });

    // Fill 3 specific cells:
    //   (cycle 0, day 0) — bounded keeper
    //   (cycle 0, day 6) — outside if cycle_length=5
    //   (cycle 1, day 0) — outside if cycle_count=1
    await db.runAsync(
      `UPDATE program_cell SET template_id = ?, sub_tag = 'heavy'
        WHERE program_id = ? AND cycle_index = 0 AND day_index = 0`,
      templateAId,
      program.id
    );
    await db.runAsync(
      `UPDATE program_cell SET template_id = ?, sub_tag = 'light'
        WHERE program_id = ? AND cycle_index = 0 AND day_index = 6`,
      templateAId,
      program.id
    );
    await db.runAsync(
      `UPDATE program_cell SET template_id = ?, sub_tag = 'normal'
        WHERE program_id = ? AND cycle_index = 1 AND day_index = 0`,
      templateAId,
      program.id
    );
    return program.id;
  }

  describe('countFilledCellsOutsideBounds', () => {
    it('counts only template_id != NULL cells outside new bounds', async () => {
      const program_id = await seed7x2WithSomeFilled();
      // Shrink to 5×1: only (cycle 0, day 0) survives; (0,6) and (1,0) lost
      const lost = await countFilledCellsOutsideBounds(db, {
        program_id,
        new_cycle_length: 5,
        new_cycle_count: 1,
      });
      expect(lost).toBe(2);
    });

    it('returns 0 when growing (all old cells still in bounds)', async () => {
      const program_id = await seed7x2WithSomeFilled();
      const lost = await countFilledCellsOutsideBounds(db, {
        program_id,
        new_cycle_length: 14,
        new_cycle_count: 4,
      });
      expect(lost).toBe(0);
    });

    it('returns 0 when same dimensions', async () => {
      const program_id = await seed7x2WithSomeFilled();
      const lost = await countFilledCellsOutsideBounds(db, {
        program_id,
        new_cycle_length: 7,
        new_cycle_count: 2,
      });
      expect(lost).toBe(0);
    });

    it('ignores rest cells (template_id IS NULL) outside bounds', async () => {
      // Seed program with 0 filled cells; resize to 3×1 → no content lost
      const program = buildProgram({ cycle_length: 7, cycle_count: 2 });
      const cells = expandWizardDraft({
        program,
        dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
        uuid,
      });
      await createProgram(db, { program, cells });
      const lost = await countFilledCellsOutsideBounds(db, {
        program_id: program.id,
        new_cycle_length: 3,
        new_cycle_count: 1,
      });
      expect(lost).toBe(0);
    });
  });

  // 2026-06-25 audit 🟠 — the wizard 載入計劃 → 覆蓋 path uses countFilledCells to
  // warn the user how many filled cells an overwrite will erase (覆蓋 DELETEs the
  // whole grid; 「載入計劃」 only copied the name).
  describe('countFilledCells', () => {
    it('counts every template_id != NULL cell across the whole grid', async () => {
      const program_id = await seed7x2WithSomeFilled(); // fills 3 cells
      expect(await countFilledCells(db, program_id)).toBe(3);
    });

    it('returns 0 for a grid with only rest (NULL-template) cells', async () => {
      const program = buildProgram({ cycle_length: 7, cycle_count: 2 });
      const cells = expandWizardDraft({
        program,
        dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
        uuid,
      });
      await createProgram(db, { program, cells });
      expect(await countFilledCells(db, program.id)).toBe(0);
    });
  });

  describe('resizeProgram', () => {
    it('shrinking deletes out-of-bounds cells + updates dimensions', async () => {
      const program_id = await seed7x2WithSomeFilled();
      await resizeProgram(db, {
        program_id,
        new_cycle_length: 5,
        new_cycle_count: 1,
      });
      const after = await getProgram(db, program_id);
      expect(after?.program.cycle_length).toBe(5);
      expect(after?.program.cycle_count).toBe(1);
      // No cell with cycle_index >= 1 OR day_index >= 5 should remain
      for (const c of after?.cells ?? []) {
        expect(c.cycle_index).toBeLessThan(1);
        expect(c.day_index).toBeLessThan(5);
      }
      // The in-bounds filled cell (0,0) survives
      const survivor = after?.cells.find(
        (c) => c.cycle_index === 0 && c.day_index === 0
      );
      expect(survivor?.template_id).toBe(templateAId);
      expect(survivor?.sub_tag).toBe('heavy');
    });

    it('growing keeps existing cells + leaves new positions sparse (no auto-insert)', async () => {
      const program_id = await seed7x2WithSomeFilled();
      const before = await getProgram(db, program_id);
      const beforeCellCount = before?.cells.length ?? 0;
      await resizeProgram(db, {
        program_id,
        new_cycle_length: 10,
        new_cycle_count: 3,
      });
      const after = await getProgram(db, program_id);
      expect(after?.program.cycle_length).toBe(10);
      expect(after?.program.cycle_count).toBe(3);
      // Cell count unchanged (no auto-insert for new positions)
      expect(after?.cells.length).toBe(beforeCellCount);
    });

    it('updates program.updated_at', async () => {
      const program_id = await seed7x2WithSomeFilled();
      const before = await db.getFirstAsync<{ updated_at: number }>(
        `SELECT updated_at FROM program WHERE id = ?`,
        program_id
      );
      await resizeProgram(db, {
        program_id,
        new_cycle_length: 5,
        new_cycle_count: 1,
        now: () => (before?.updated_at ?? 0) + 1_000_000,
      });
      const after = await db.getFirstAsync<{ updated_at: number }>(
        `SELECT updated_at FROM program WHERE id = ?`,
        program_id
      );
      expect(after?.updated_at).toBeGreaterThan(before?.updated_at ?? 0);
    });
  });

  // 2026-06-25 audit 🟡 F1 (report 20) — defense-in-depth: resizeProgram /
  // updateProgramStartDate now JS-pre-validate (mirroring the wizard's
  // validateStep 'CycleConfig' bounds) and throw a typed error BEFORE the
  // write, instead of letting an out-of-range value hit a raw SQLITE_CONSTRAINT
  // or a malformed start_date reach the scheduler (`isoDateToUtcMs`).
  describe('resizeProgram — dimension pre-validation', () => {
    const baseline = { new_cycle_length: 7, new_cycle_count: 2 };

    it.each([
      ['cycle_length below 3', { new_cycle_length: 2, new_cycle_count: 2 }],
      ['cycle_length above 14', { new_cycle_length: 15, new_cycle_count: 2 }],
      ['cycle_length zero', { new_cycle_length: 0, new_cycle_count: 2 }],
      ['cycle_length non-integer', { new_cycle_length: 7.5, new_cycle_count: 2 }],
      ['cycle_count below 1', { new_cycle_length: 7, new_cycle_count: 0 }],
      ['cycle_count negative', { new_cycle_length: 7, new_cycle_count: -1 }],
      ['cycle_count non-integer', { new_cycle_length: 7, new_cycle_count: 2.3 }],
    ])('throws INVALID_PROGRAM_DIMENSIONS for %s', async (_label, dims) => {
      const program_id = await seed7x2WithSomeFilled();
      await expect(
        resizeProgram(db, { program_id, ...dims })
      ).rejects.toThrow('INVALID_PROGRAM_DIMENSIONS');
      // No partial write: dimensions unchanged
      const after = await getProgram(db, program_id);
      expect(after?.program.cycle_length).toBe(7);
      expect(after?.program.cycle_count).toBe(2);
    });

    it.each([
      ['min length / min count', { new_cycle_length: 3, new_cycle_count: 1 }],
      ['max length', { new_cycle_length: 14, new_cycle_count: 2 }],
      ['baseline still works', baseline],
    ])('accepts valid dimensions (%s)', async (_label, dims) => {
      const program_id = await seed7x2WithSomeFilled();
      await expect(
        resizeProgram(db, { program_id, ...dims })
      ).resolves.toBeUndefined();
      const after = await getProgram(db, program_id);
      expect(after?.program.cycle_length).toBe(dims.new_cycle_length);
      expect(after?.program.cycle_count).toBe(dims.new_cycle_count);
    });
  });

  describe('updateProgramStartDate — start_date pre-validation', () => {
    it.each([
      ['empty string', ''],
      ['garbage', 'not-a-date'],
      ['wrong format (slashes)', '2026/05/01'],
      ['missing day', '2026-05'],
      ['too short', '26-5-1'],
    ])('throws INVALID_START_DATE for %s', async (_label, bad) => {
      const program_id = await seed7x2WithSomeFilled();
      await expect(
        updateProgramStartDate(db, { program_id, start_date: bad })
      ).rejects.toThrow('INVALID_START_DATE');
      // No write: start_date unchanged
      const after = await getProgram(db, program_id);
      expect(after?.program.start_date).toBe('2026-05-01');
    });

    it('accepts a valid yyyy-mm-dd and writes it', async () => {
      const program_id = await seed7x2WithSomeFilled();
      await expect(
        updateProgramStartDate(db, { program_id, start_date: '2027-01-15' })
      ).resolves.toBeUndefined();
      const after = await getProgram(db, program_id);
      expect(after?.program.start_date).toBe('2027-01-15');
    });
  });
});
