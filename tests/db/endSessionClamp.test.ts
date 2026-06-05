import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  endSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Grill 2026-06-05 Q5 — endSession defensive ended_at floor.
 *
 * A Watch-led finish carries the Watch's clock-stamped endedAt straight into
 * endSession; clock skew can make it ≤ started_at, persisting a backwards
 * interval (which downstream becomes an inverted HKWorkout / kcal-HR window).
 * The repository now floors any ended_at ≤ started_at to started_at + 1ms.
 */
describe('endSession ended_at floor (Q5)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists a normal forward ended_at unchanged', async () => {
    await createSession(db, { id: 's1', started_at: 1_000 });
    await endSession(db, { id: 's1', ended_at: 5_000 });
    expect((await getSession(db, 's1'))?.ended_at).toBe(5_000);
  });

  it('floors ended_at < started_at to started_at + 1', async () => {
    await createSession(db, { id: 's2', started_at: 10_000 });
    // Watch clock skew → end stamped BEFORE start.
    await endSession(db, { id: 's2', ended_at: 9_000 });
    expect((await getSession(db, 's2'))?.ended_at).toBe(10_001);
  });

  it('floors ended_at === started_at (zero-duration) to started_at + 1', async () => {
    await createSession(db, { id: 's3', started_at: 7_000 });
    await endSession(db, { id: 's3', ended_at: 7_000 });
    expect((await getSession(db, 's3'))?.ended_at).toBe(7_001);
  });

  it('missing row is a silent no-op (no throw)', async () => {
    await expect(
      endSession(db, { id: 'nope', ended_at: 1_000 }),
    ).resolves.toBeUndefined();
    expect(await getSession(db, 'nope')).toBeNull();
  });
});
