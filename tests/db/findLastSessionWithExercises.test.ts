import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  findLastSessionWithExercises,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Phase B (autostart-prefill) — `findLastSessionWithExercises` picks the most
 * recent session (by started_at) that actually has ≥1 exercise, so the 極簡
 * 通用-template prefill pulls from the user's last real workout and skips empty
 * / freestyle sessions that never had an exercise added.
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';

describe('findLastSessionWithExercises', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;

  const seedSession = (id: string, started_at: number) =>
    db.runAsync(`INSERT INTO session (id, started_at) VALUES (?, ?)`, id, started_at);

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when there are no sessions', async () => {
    expect(await findLastSessionWithExercises(db)).toBeNull();
  });

  it('returns null when the only session has no exercises', async () => {
    await seedSession('s-empty', 1000);
    expect(await findLastSessionWithExercises(db)).toBeNull();
  });

  it('skips empty/later sessions and returns the most recent one WITH exercises', async () => {
    await seedSession('s-old-with-ex', 1000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's-old-with-ex',
      exercise_id: BENCH,
    });
    // A newer but EMPTY session must not win.
    await seedSession('s-new-empty', 2000);
    expect(await findLastSessionWithExercises(db)).toBe('s-old-with-ex');
  });

  it('returns the most recent session by started_at among those with exercises', async () => {
    await seedSession('s1', 1000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's1',
      exercise_id: BENCH,
    });
    await seedSession('s2', 3000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's2',
      exercise_id: SQUAT,
    });
    expect(await findLastSessionWithExercises(db)).toBe('s2');
  });

  it('breaks a started_at tie deterministically by id DESC', async () => {
    // Two sessions share the same started_at; the ORDER BY ... s.id DESC
    // tiebreak must pick the larger id deterministically (no DB-order luck).
    await seedSession('s-aaa', 5000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's-aaa',
      exercise_id: BENCH,
    });
    await seedSession('s-zzz', 5000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's-zzz',
      exercise_id: SQUAT,
    });
    expect(await findLastSessionWithExercises(db)).toBe('s-zzz');
  });

  it('ignores a session whose exercises were all removed (no session_exercise rows left)', async () => {
    // A session that briefly had an exercise but now has none must not win over
    // an older session that still has one — the EXISTS subquery is live, not a
    // historical "ever had" flag.
    await seedSession('s-old', 1000);
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: 's-old',
      exercise_id: BENCH,
    });
    await seedSession('s-new', 2000);
    const exId = uuid();
    await appendSessionExercise(db, {
      id: exId,
      session_id: 's-new',
      exercise_id: SQUAT,
    });
    // Remove the newer session's only exercise.
    await db.runAsync(`DELETE FROM session_exercise WHERE id = ?`, exId);
    expect(await findLastSessionWithExercises(db)).toBe('s-old');
  });
});
