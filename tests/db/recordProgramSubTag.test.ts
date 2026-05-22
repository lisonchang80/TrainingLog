import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  recordProgramSubTag,
} from '../../src/adapters/sqlite/programRepository';
import { migrate } from '../../src/db/migrate';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 16 / v022 — `recordProgramSubTag` direct unit coverage (ADR-0021).
 *
 * Spec:
 *   - null sub_tag → no row written (early return guard)
 *   - empty-string sub_tag → no row written (early return guard)
 *   - non-empty sub_tag → 1 row inserted into `program_sub_tag`
 *   - repeat same (program_id, sub_tag) → INSERT OR IGNORE keeps it at 1 row
 *   - `created_at` honors the injected `now()` clock (testable determinism).
 */

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: 'P-rec',
  main_tag: null,
  cycle_length: 5,
  cycle_count: 3,
  start_date: '2026-05-01',
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
  const program = buildProgram();
  await createProgram(db, { program });
  return { db, programId: program.id };
}

describe('recordProgramSubTag', () => {
  it('is a no-op when sub_tag is null', async () => {
    const { db, programId } = await setup();
    await recordProgramSubTag(db, programId, null);
    const rows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ?`,
      programId,
    );
    expect(rows[0]?.n).toBe(0);
    db.close();
  });

  it('is a no-op when sub_tag is empty string', async () => {
    const { db, programId } = await setup();
    await recordProgramSubTag(db, programId, '');
    const rows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ?`,
      programId,
    );
    expect(rows[0]?.n).toBe(0);
    db.close();
  });

  it('inserts exactly one row for a fresh (program_id, sub_tag) pair', async () => {
    const { db, programId } = await setup();
    await recordProgramSubTag(db, programId, 'II-1');
    const rows = await db.getAllAsync<{
      program_id: string;
      sub_tag: string;
    }>(`SELECT program_id, sub_tag FROM program_sub_tag WHERE program_id = ?`,
      programId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ program_id: programId, sub_tag: 'II-1' });
    db.close();
  });

  it('is idempotent — repeat insert of same (program_id, sub_tag) keeps the row count at 1', async () => {
    const { db, programId } = await setup();
    await recordProgramSubTag(db, programId, 'II-1');
    await recordProgramSubTag(db, programId, 'II-1');
    await recordProgramSubTag(db, programId, 'II-1');
    const rows = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_sub_tag WHERE program_id = ? AND sub_tag = ?`,
      programId,
      'II-1',
    );
    expect(rows[0]?.n).toBe(1);
    db.close();
  });

  it('honors the injected now() clock for created_at', async () => {
    const { db, programId } = await setup();
    const fixedNow = 1_700_000_000_000;
    await recordProgramSubTag(db, programId, 'II-2', () => fixedNow);
    const row = await db.getFirstAsync<{ created_at: number }>(
      `SELECT created_at FROM program_sub_tag
        WHERE program_id = ? AND sub_tag = ?`,
      programId,
      'II-2',
    );
    expect(row?.created_at).toBe(fixedNow);
    db.close();
  });
});
