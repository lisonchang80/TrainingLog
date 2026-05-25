import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';

/**
 * Slice-1 era helpers (`recordSetAsAutoSession`, `listAllSets`,
 * `listAllSetsWithExercise`) were removed in the dead-code wave 4 sweep
 * — they were replaced by `recordSetInSession` + the proper Session
 * Manager lifecycle in slice 2. The tests that exercised those helpers
 * went with them; the two remaining canaries (seed exercise count + idempotent
 * migration) live here because there's no obvious better home.
 */
describe('setRepository — seed + migration canaries', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds the built-in Bench Press exercise via v001 + more via v002', async () => {
    const exercises = await listExercises(db);
    // v001 seeds Bench Press; v002 (slice 2) adds 6 more compound lifts;
    // v006 (slice 6) adds the rest of the Exercise Library — 66 total.
    expect(exercises).toHaveLength(66);
    const bench = exercises.find((e) => e.name === 'Bench Press');
    expect(bench).toMatchObject({
      load_type: 'loaded',
      is_builtin: 1,
      is_archived: 0,
    });
  });

  it('migration is idempotent — running twice does not create extra exercise rows', async () => {
    await migrate(db); // already ran in beforeEach; this is the second call
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(66);
  });
});
