import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  countFilledCellsOutsideBounds,
  createProgram,
  getProgram,
  resizeProgram,
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
});
