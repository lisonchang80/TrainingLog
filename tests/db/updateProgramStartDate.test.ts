import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  getProgram,
  updateProgramStartDate,
} from '../../src/adapters/sqlite/programRepository';
import { migrate } from '../../src/db/migrate';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 17 (2026-05-21) — updateProgramStartDate.
 *
 * Cells are NOT moved — start_date update just shifts the displayed date
 * labels (computed by `cellDate` in the renderer from the new start_date).
 * Verifies: start_date column changes, updated_at ticks, no-op on missing.
 */

const buildProgram = (id: string, start_date: string): ProgramCore => ({
  id,
  name: 'StartDate-Test',
  main_tag: null,
  cycle_length: 5,
  cycle_count: 3,
  start_date,
  is_active: 0,
});

describe('updateProgramStartDate', () => {
  it('updates start_date in place and ticks updated_at', async () => {
    const db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const program = buildProgram('p1', '2026-05-01');
    await createProgram(db, { program });
    const before = await db.getFirstAsync<{
      start_date: string;
      updated_at: number;
    }>(`SELECT start_date, updated_at FROM program WHERE id = ?`, 'p1');
    expect(before?.start_date).toBe('2026-05-01');

    await updateProgramStartDate(db, {
      program_id: 'p1',
      start_date: '2026-06-15',
      now: () => (before?.updated_at ?? 0) + 5000,
    });

    const after = await db.getFirstAsync<{
      start_date: string;
      updated_at: number;
    }>(`SELECT start_date, updated_at FROM program WHERE id = ?`, 'p1');
    expect(after?.start_date).toBe('2026-06-15');
    expect(after?.updated_at).toBe((before?.updated_at ?? 0) + 5000);
    db.close();
  });

  it('no-op on non-existent program (does not throw)', async () => {
    const db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // Should not throw, just runs UPDATE matching 0 rows.
    await expect(
      updateProgramStartDate(db, {
        program_id: 'does-not-exist',
        start_date: '2026-01-01',
      }),
    ).resolves.toBeUndefined();
    db.close();
  });

  it('does not touch program_cell rows (cells stay at same position)', async () => {
    const db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const program = buildProgram('p2', '2026-05-01');
    await createProgram(db, {
      program,
      cells: [
        {
          id: 'c1',
          program_id: 'p2',
          cycle_index: 0,
          day_index: 0,
          template_id: null,
          sub_tag: 'leg',
        },
        {
          id: 'c2',
          program_id: 'p2',
          cycle_index: 1,
          day_index: 2,
          template_id: null,
          sub_tag: 'pull',
        },
      ],
    });
    const before = await getProgram(db, 'p2');

    await updateProgramStartDate(db, {
      program_id: 'p2',
      start_date: '2026-12-31',
    });

    const after = await getProgram(db, 'p2');
    expect(after?.program.start_date).toBe('2026-12-31');
    // Cells stay at the same (cycle_index, day_index) — only the displayed
    // dates shift in the renderer.
    expect(after?.cells.length).toBe(before?.cells.length);
    expect(after?.cells).toEqual(before?.cells);
    db.close();
  });
});
