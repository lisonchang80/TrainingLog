import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  getProgram,
  swapProgramCells,
  upsertCell,
} from '../../src/adapters/sqlite/programRepository';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';
import { migrate } from '../../src/db/migrate';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 17 (2026-05-21) — swap (template_id, sub_tag) between two cells.
 *
 * Schema is sparse: missing rows render as 「休息」. The 4 cases:
 *   1. Both rows exist → UPDATE both in place
 *   2. Only A row exists → move A's content to B, DELETE A
 *   3. Only B row exists → mirror of case 2
 *   4. Neither row exists → no-op
 * Plus same-cell guard → early return.
 *
 * Plus the persistent label dictionary (program_sub_tag, v022) gets
 * re-registered for any non-null sub_tag involved (defensive, mostly no-op).
 */

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: 'Swap-Test',
  main_tag: '增肌',
  cycle_length: 5,
  cycle_count: 3,
  start_date: '2026-05-01',
  is_active: 0,
  ...over,
});

async function setup(): Promise<{
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
  await createProgram(db, { program });
  return { db, programId: program.id, templateAId, templateBId };
}

describe('swapProgramCells', () => {
  it('case 1: both rows exist → swap (template_id, sub_tag) in place', async () => {
    const { db, programId, templateAId, templateBId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 1,
      template_id: templateAId,
      sub_tag: 'heavy',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 2,
      day_index: 3,
      template_id: templateBId,
      sub_tag: 'light',
      uuid,
    });

    const before = await getProgram(db, programId);
    const idA = before?.cells.find(
      (c) => c.cycle_index === 0 && c.day_index === 1,
    )?.id;
    const idB = before?.cells.find(
      (c) => c.cycle_index === 2 && c.day_index === 3,
    )?.id;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();

    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 1 },
      b: { cycle_index: 2, day_index: 3 },
      uuid,
    });

    const after = await getProgram(db, programId);
    const cellA = after?.cells.find(
      (c) => c.cycle_index === 0 && c.day_index === 1,
    );
    const cellB = after?.cells.find(
      (c) => c.cycle_index === 2 && c.day_index === 3,
    );
    // Row ids preserved (UPDATE in place, not DELETE+INSERT).
    expect(cellA?.id).toBe(idA);
    expect(cellB?.id).toBe(idB);
    // Content swapped.
    expect(cellA?.template_id).toBe(templateBId);
    expect(cellA?.sub_tag).toBe('light');
    expect(cellB?.template_id).toBe(templateAId);
    expect(cellB?.sub_tag).toBe('heavy');
    db.close();
  });

  it('case 2: only A row exists → A content moves to B, A row deleted', async () => {
    const { db, programId, templateAId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'x',
      uuid,
    });

    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 0 },
      b: { cycle_index: 1, day_index: 2 },
      uuid,
    });

    const after = await getProgram(db, programId);
    // No row at (0,0); content moved to (1,2).
    expect(
      after?.cells.find((c) => c.cycle_index === 0 && c.day_index === 0),
    ).toBeUndefined();
    const moved = after?.cells.find(
      (c) => c.cycle_index === 1 && c.day_index === 2,
    );
    expect(moved?.template_id).toBe(templateAId);
    expect(moved?.sub_tag).toBe('x');
    // Total cell count = 1 (sparse).
    expect(after?.cells.length).toBe(1);
    db.close();
  });

  it('case 3: only B row exists → B content moves to A, B row deleted', async () => {
    const { db, programId, templateBId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 2,
      day_index: 4,
      template_id: templateBId,
      sub_tag: 'y',
      uuid,
    });

    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 0 },
      b: { cycle_index: 2, day_index: 4 },
      uuid,
    });

    const after = await getProgram(db, programId);
    expect(
      after?.cells.find((c) => c.cycle_index === 2 && c.day_index === 4),
    ).toBeUndefined();
    const moved = after?.cells.find(
      (c) => c.cycle_index === 0 && c.day_index === 0,
    );
    expect(moved?.template_id).toBe(templateBId);
    expect(moved?.sub_tag).toBe('y');
    expect(after?.cells.length).toBe(1);
    db.close();
  });

  it('case 4: neither row exists → no-op (both stay rest)', async () => {
    const { db, programId } = await setup();
    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 0 },
      b: { cycle_index: 1, day_index: 1 },
      uuid,
    });
    const after = await getProgram(db, programId);
    expect(after?.cells.length).toBe(0);
    db.close();
  });

  it('same cell → early return, no DB writes', async () => {
    const { db, programId, templateAId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 1,
      template_id: templateAId,
      sub_tag: 'z',
      uuid,
    });
    const before = await getProgram(db, programId);
    const beforeUpdatedAt = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM program WHERE id = ?`,
      programId,
    );

    // Wait a tick so any UPDATE program would show a different timestamp.
    await new Promise((r) => setTimeout(r, 5));

    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 1, day_index: 1 },
      b: { cycle_index: 1, day_index: 1 },
      uuid,
    });

    const after = await getProgram(db, programId);
    const afterUpdatedAt = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM program WHERE id = ?`,
      programId,
    );
    expect(after?.cells.length).toBe(before?.cells.length);
    expect(after?.cells[0]).toMatchObject({
      cycle_index: 1,
      day_index: 1,
      template_id: templateAId,
      sub_tag: 'z',
    });
    // updated_at unchanged (early return skipped the UPDATE program statement).
    expect(afterUpdatedAt?.updated_at).toBe(beforeUpdatedAt?.updated_at);
    db.close();
  });

  it('records sub_tags in program_sub_tag dictionary (defensive)', async () => {
    const { db, programId, templateAId, templateBId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: 'alpha',
      uuid,
    });
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 1,
      day_index: 1,
      template_id: templateBId,
      sub_tag: 'beta',
      uuid,
    });
    // Manually clear the dictionary so we can verify swap re-registers.
    await db.runAsync(`DELETE FROM program_sub_tag WHERE program_id = ?`, programId);
    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 0 },
      b: { cycle_index: 1, day_index: 1 },
      uuid,
    });
    const rows = await db.getAllAsync<{ sub_tag: string }>(
      `SELECT sub_tag FROM program_sub_tag WHERE program_id = ? ORDER BY sub_tag ASC`,
      programId,
    );
    expect(rows.map((r) => r.sub_tag)).toEqual(['alpha', 'beta']);
    db.close();
  });

  it('updates program.updated_at on successful swap', async () => {
    const { db, programId, templateAId } = await setup();
    await upsertCell(db, {
      program_id: programId,
      cycle_index: 0,
      day_index: 0,
      template_id: templateAId,
      sub_tag: null,
      uuid,
    });
    const beforeRow = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM program WHERE id = ?`,
      programId,
    );
    await swapProgramCells(db, {
      program_id: programId,
      a: { cycle_index: 0, day_index: 0 },
      b: { cycle_index: 1, day_index: 0 },
      uuid,
      now: () => (beforeRow?.updated_at ?? 0) + 1000,
    });
    const afterRow = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM program WHERE id = ?`,
      programId,
    );
    expect(afterRow?.updated_at).toBe((beforeRow?.updated_at ?? 0) + 1000);
    db.close();
  });
});
