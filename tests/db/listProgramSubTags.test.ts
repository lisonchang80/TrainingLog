import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  listProgramSubTags,
  recordProgramSubTag,
} from '../../src/adapters/sqlite/programRepository';
import { migrate } from '../../src/db/migrate';
import type { ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 16 / v022 — `listProgramSubTags` direct unit coverage (ADR-0021).
 *
 * Spec:
 *   - empty program → []
 *   - results sorted alphabetical (ORDER BY sub_tag ASC)
 *   - cross-program isolation: program B's tags do not leak into program A's
 */

const buildProgram = (
  id: string,
  name: string,
  over: Partial<ProgramCore> = {},
): ProgramCore => ({
  id,
  name,
  main_tag: null,
  cycle_length: 5,
  cycle_count: 3,
  start_date: '2026-05-01',
  is_active: 0,
  ...over,
});

async function setupTwoPrograms(): Promise<{
  db: BetterSqliteDatabase;
  progA: string;
  progB: string;
}> {
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  const progA = 'pid-A';
  const progB = 'pid-B';
  await createProgram(db, { program: buildProgram(progA, 'A-prog') });
  await createProgram(db, { program: buildProgram(progB, 'B-prog') });
  return { db, progA, progB };
}

describe('listProgramSubTags', () => {
  it('returns [] when the program has no registered sub_tags', async () => {
    const { db, progA } = await setupTwoPrograms();
    const result = await listProgramSubTags(db, progA);
    expect(result).toEqual([]);
    db.close();
  });

  it('returns sub_tags sorted alphabetically', async () => {
    const { db, progA } = await setupTwoPrograms();
    // Insert deliberately out of alpha order to confirm SQL ordering applies.
    await recordProgramSubTag(db, progA, 'II-2');
    await recordProgramSubTag(db, progA, 'I');
    await recordProgramSubTag(db, progA, 'II-1');
    const result = await listProgramSubTags(db, progA);
    expect(result).toEqual(['I', 'II-1', 'II-2']);
    db.close();
  });

  it('isolates results per program (B-program sub_tags do not leak into A-program)', async () => {
    const { db, progA, progB } = await setupTwoPrograms();
    await recordProgramSubTag(db, progA, 'II-2');
    await recordProgramSubTag(db, progA, 'I');
    await recordProgramSubTag(db, progB, 'III-1');
    expect(await listProgramSubTags(db, progA)).toEqual(['I', 'II-2']);
    expect(await listProgramSubTags(db, progB)).toEqual(['III-1']);
    db.close();
  });
});
