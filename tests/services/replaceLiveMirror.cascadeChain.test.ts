/**
 * Grill 2026-06-05 Q7 (WC #2 + S7b) — cascade-delete dropset chain on head
 * delete. Decision「連 head 刪整鏈」: when a dropset head is removed (via the
 * end-session purgeTail OR a tombstone), surviving followers pointing at it are
 * deleted too rather than left as a dangling FK. Covers BOTH delete paths.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { reconcileSessionTree } from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const BENCH = '00000000-0000-4000-8000-000000000001';

async function seedHeadPlusFollower(db: BetterSqliteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT INTO session (id, started_at, title) VALUES ('sess-1', 1000, '')`,
  );
  await db.runAsync(
    `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets)
     VALUES ('se-1', 'sess-1', ?, 0, 2)`,
    BENCH,
  );
  // head H (ordering 0) + follower F (ordering 1, parent = H)
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
       weight_kg, reps, notes, set_kind, is_logged, ordering, created_at, parent_set_id)
     VALUES ('H', 'sess-1', ?, 'se-1', 100, 8, NULL, 'dropset', 1, 0, 1000, NULL)`,
    BENCH,
  );
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
       weight_kg, reps, notes, set_kind, is_logged, ordering, created_at, parent_set_id)
     VALUES ('F', 'sess-1', ?, 'se-1', 80, 5, NULL, 'dropset', 1, 1, 1000, 'H')`,
    BENCH,
  );
}

async function liveSetIds(db: BetterSqliteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM "set" WHERE session_id = 'sess-1' ORDER BY id`,
  );
  return rows.map((r) => r.id);
}

describe('reconcileSessionTree — cascade-delete dropset chain (Q7)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedHeadPlusFollower(db);
  });

  afterEach(() => {
    db.close();
  });

  it('purgeTail: deleting the head also removes the surviving follower', async () => {
    // End snapshot the Watch sent after deleting ONLY the head: the follower
    // (ordinal 1, id F) is still present, the head (ordinal 0) is gone.
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            {
              setId: 'F',
              ordinal: 1,
              weight: 80,
              reps: 5,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'dropset',
              parent_set_id: 'H', // dangling — head omitted from snapshot
              is_logged: true,
            },
          ],
        },
      ],
    };
    await reconcileSessionTree(db, snapshot, { purgeTail: true });
    // Head purged (absent), follower cascade-deleted (parent gone) → empty.
    expect(await liveSetIds(db)).toEqual([]);
  });

  it('tombstone: tombstoning the head also removes the surviving follower', async () => {
    // A live tick that still lists head + follower but tombstones the head id.
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            {
              setId: 'H',
              ordinal: 0,
              weight: 100,
              reps: 8,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'dropset',
              parent_set_id: null,
              is_logged: true,
            },
            {
              setId: 'F',
              ordinal: 1,
              weight: 80,
              reps: 5,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'dropset',
              parent_set_id: 'H',
              is_logged: true,
            },
          ],
        },
      ],
      deletedIds: { exerciseIds: [], setIds: ['H'] },
    };
    await reconcileSessionTree(db, snapshot, { purgeTail: false });
    // Head tombstoned, follower cascade-deleted (parent gone) → empty.
    expect(await liveSetIds(db)).toEqual([]);
  });

  it('a healthy chain (head present) is left intact', async () => {
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            {
              setId: 'H',
              ordinal: 0,
              weight: 100,
              reps: 8,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'dropset',
              parent_set_id: null,
              is_logged: true,
            },
            {
              setId: 'F',
              ordinal: 1,
              weight: 80,
              reps: 5,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'dropset',
              parent_set_id: 'H',
              is_logged: true,
            },
          ],
        },
      ],
    };
    await reconcileSessionTree(db, snapshot, { purgeTail: true });
    expect(await liveSetIds(db)).toEqual(['F', 'H']);
  });
});
