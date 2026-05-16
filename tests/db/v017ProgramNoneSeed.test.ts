import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v017_program_none_seed } from '../../src/db/schema/v017_program_none_seed';
import {
  PROGRAM_NONE_SEED,
  RESERVED_NONE_PROGRAM_ID,
} from '../../src/db/seed/v017ProgramNone';
import { listPrograms } from '../../src/adapters/sqlite/programRepository';

/**
 * v017 migration tests — seed the reserved 「無」 program entity (slice 10a
 * foundation per ADR-0019 § (N1) + 留尾 Q1+Q1b 拍板).
 *
 * Coverage:
 *   - The seed row exists with the expected nil UUID id, name '無', and
 *     all required columns populated from PROGRAM_NONE_SEED.
 *   - RESERVED_NONE_PROGRAM_ID constant matches the seeded row id (catches
 *     future drift if either the seed file or migration changes the value).
 *   - INSERT OR IGNORE prevents duplicate rows on re-run.
 *   - The seed row is filtered out of `listPrograms` (Programs tab UI
 *     contract) — it's a sentinel, not a user-editable program.
 *   - The seed row is still resolvable by id via direct query (downstream
 *     consumers that need to display 「無」 as a session/template's program
 *     label).
 */
describe('v017 「無」 program seed migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('seeds the reserved 「無」 program row with nil UUID id', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{
      id: string;
      name: string;
      main_tag: string | null;
      cycle_length: number;
      cycle_count: number;
      start_date: string;
      is_active: number;
    }>(
      `SELECT id, name, main_tag, cycle_length, cycle_count, start_date, is_active
         FROM program WHERE id = ?`,
      RESERVED_NONE_PROGRAM_ID,
    );

    expect(row).toBeDefined();
    expect(row!.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(row!.name).toBe('無');
    expect(row!.main_tag).toBeNull();
    expect(row!.cycle_length).toBe(3);
    expect(row!.cycle_count).toBe(1);
    expect(row!.start_date).toBe('1970-01-01');
    expect(row!.is_active).toBe(0);
  });

  it('RESERVED_NONE_PROGRAM_ID constant matches PROGRAM_NONE_SEED.id (no drift)', () => {
    expect(RESERVED_NONE_PROGRAM_ID).toBe(PROGRAM_NONE_SEED.id);
    expect(RESERVED_NONE_PROGRAM_ID).toBe('00000000-0000-0000-0000-000000000000');
    expect(PROGRAM_NONE_SEED.name).toBe('無');
  });

  it('INSERT OR IGNORE — re-running v017 does not duplicate the seed', async () => {
    await migrate(db);
    await expect(v017_program_none_seed(db)).resolves.not.toThrow();

    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM program WHERE id = ?`,
      RESERVED_NONE_PROGRAM_ID,
    );
    expect(rows).toHaveLength(1);
  });

  it('listPrograms filters out the 「無」 sentinel row', async () => {
    await migrate(db);
    const list = await listPrograms(db);
    // Fresh DB — no user-created programs; sentinel must be filtered out
    expect(list.find((p) => p.id === RESERVED_NONE_PROGRAM_ID)).toBeUndefined();
    expect(list).toHaveLength(0);
  });

  it('the 「無」 row is still resolvable by id via direct query', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM program WHERE id = ?`,
      RESERVED_NONE_PROGRAM_ID,
    );
    expect(row?.name).toBe('無');
  });
});
