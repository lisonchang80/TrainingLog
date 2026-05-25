import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getExerciseName,
  listExercises,
} from '../../src/adapters/sqlite/exerciseRepository';

/**
 * Slice 10c overnight #11 — `getExerciseName` lookup helper used by the
 * cluster A↔B switcher on the per-Exercise history / chart pages. Two cases:
 * existing id → name, non-existing id → null.
 */
describe('exerciseRepository — getExerciseName', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns the exercise name when id exists', async () => {
    const all = await listExercises(db);
    const bench = all.find((e) => e.name === 'Bench Press')!;
    const name = await getExerciseName(db, bench.id);
    expect(name).toBe('Bench Press');
  });

  it('returns null when id does not exist', async () => {
    const name = await getExerciseName(db, 'non-existent-id');
    expect(name).toBeNull();
  });
});
