/**
 * Coverage fill (overnight 2026-06-03) — reconcileSessionTree tombstone purge
 * branches the main suite leaves uncovered.
 *
 * The existing `replaceLiveMirror.test.ts` tombstone block calls
 * `reconcileSessionTree(..., { purgeTail: false })` DIRECTLY (the bare
 * end-session-ish config), so it never exercises the tombstone purge as it
 * actually runs in production: via `replaceLiveMirror`, which ALSO sets
 * `purgeSetsInPresentExercises` + `purgeExercisesAbsentFromSnapshot` +
 * `requireExistingLiveSession`. This file drives tombstones through the real
 * `replaceLiveMirror` entry point and covers two genuinely-uncovered paths:
 *
 *   1. A tombstoned set whose on-device id was DIVERTED to the session-
 *      namespaced `${sessionId}::${wireId}` form (cross-session id collision,
 *      see replaceLiveMirror's `localizeSetId`). The tombstone DELETE builds
 *      BOTH the raw wire id AND the localized form, so a tombstone carrying the
 *      RAW wire id must still remove the diverted row — the `tomb.setIds.map`
 *      localize branch (replaceLiveMirror.ts ~597-600). No existing test feeds
 *      a tombstone for a diverted set.
 *   2. Tombstone purge co-occurring with the live exercise/set membership
 *      purge (both run in the same `replaceLiveMirror` transaction), proving
 *      the two deletion mechanisms compose without double-counting or leaving
 *      orphans.
 *
 * Real DB via better-sqlite3 in-memory; same fixtures style as the main suite.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const EX_A = '00000000-0000-4000-8000-000000000001'; // Bench Press
const EX_B = '00000000-0000-4000-8000-000000000002'; // Back Squat

async function seedLiveSession(
  db: BetterSqliteDatabase,
  id: string,
  startedAt = 1_700_000_000_000,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, '')`,
    id,
    startedAt,
  );
}

describe('replaceLiveMirror — tombstone purge through the LIVE entry point', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => db.close());

  /** A freestyle dropset HEAD + ONE follower whose wire id is "ADD-1". */
  const headPlusAdd1 = (sessionId: string, headWireId: string): SessionSnapshot => ({
    sessionId,
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: `se-${sessionId}`,
        exerciseId: EX_A,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 2,
        sets: [
          { setId: headWireId, ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: null },
          { setId: 'ADD-1', ordinal: 1, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: headWireId },
        ],
      },
    ],
  });

  it('tombstones a set whose on-device id was DIVERTED on a cross-session collision (raw wire id still matches)', async () => {
    // Session A mints "ADD-1" then ends → its row keeps the raw id "ADD-1".
    await seedLiveSession(db, 'sess-A');
    await replaceLiveMirror(db, headPlusAdd1('sess-A', 'headA'));
    await db.runAsync(`UPDATE session SET ended_at = ? WHERE id = ?`, 1_700_000_100_000, 'sess-A');

    // Session B (Watch relaunched, counter reset) mints "ADD-1" AGAIN → on a
    // cross-session collision its on-device id is diverted to "sess-B::ADD-1".
    await seedLiveSession(db, 'sess-B');
    await replaceLiveMirror(db, headPlusAdd1('sess-B', 'headB'));
    const diverted = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-B' AND parent_set_id IS NOT NULL`,
    );
    expect(diverted?.id).toBe('sess-B::ADD-1'); // confirms the divert happened

    // Now the Watch tombstones ONLY the follower (chain-complete: a follower-
    // only tombstone keeps the head, no orphan). The tombstone carries the RAW
    // wire id ("ADD-1") — but the on-device row is the LOCALIZED form
    // ("sess-B::ADD-1"). The tombstone purge tries BOTH forms, so the diverted
    // row must be removed via the localized match. The follower is kept in the
    // snapshot's `sets` so the per-exercise membership purge does NOT remove it
    // first — only the tombstone branch can — isolating the localize path.
    const tombstoneSnap: SessionSnapshot = {
      ...headPlusAdd1('sess-B', 'headB'),
      deletedIds: { exerciseIds: [], setIds: ['ADD-1'] },
    };
    const res = await replaceLiveMirror(db, tombstoneSnap);

    // The diverted follower row was removed by the tombstone's localized-form
    // match (raw wire id "ADD-1" → on-device "sess-B::ADD-1"). The head stays.
    expect(res.tombstonedSets).toBe(1);
    const bRows = await db.getAllAsync<{ id: string; parent_set_id: string | null }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = 'sess-B' ORDER BY id`,
    );
    expect(bRows.map((r) => r.id)).toEqual(['headB']); // only the head survives
    // Session A's untouched "ADD-1" survives — the tombstone is session-scoped.
    const aRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-A' ORDER BY id`,
    );
    expect(aRows.map((r) => r.id).sort()).toEqual(['ADD-1', 'headA']);
  });

  it('tombstone purge + live exercise purge compose in one tick (counts independent)', async () => {
    // Two exercises, each one set. Tick deletes EX_B by tombstone AND drops a
    // set under EX_A by tombstone, all in the live replaceLiveMirror path.
    await seedLiveSession(db, 'sess-1');
    const twoEx: SessionSnapshot = {
      sessionId: 'sess-1',
      title: 'Push',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: EX_A,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            { setId: 'a1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
            { setId: 'a2', ordinal: 1, weight: 80, reps: 6, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
        {
          sessionExerciseId: 'se-2',
          exerciseId: EX_B,
          exerciseName: 'Back Squat',
          ordering: 1,
          plannedSets: 1,
          sets: [
            { setId: 'b1', ordinal: 0, weight: 100, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: false },
          ],
        },
      ],
    };
    await replaceLiveMirror(db, twoEx);

    // Next tick: se-2 absent (live EXERCISE purge removes it + b1). Set a2 is
    // tombstoned but STILL LISTED under se-1 (so the per-exercise set purge
    // keeps it — only the precise tombstone branch can delete it). Both the
    // exercise-membership purge and the tombstone purge fire in one tick.
    const next: SessionSnapshot = {
      sessionId: 'sess-1',
      title: 'Push',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: EX_A,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            { setId: 'a1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
            { setId: 'a2', ordinal: 1, weight: 80, reps: 6, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
      ],
      deletedIds: { exerciseIds: [], setIds: ['a2'] },
    };
    const res = await replaceLiveMirror(db, next);

    // tombstone removed a2 (1 set); exercise purge removed se-2 + b1.
    expect(res.tombstonedSets).toBe(1);
    expect(res.tombstonedExercises).toBe(0);
    expect(res.purgedExercises).toBe(1); // se-2
    const setRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-1' ORDER BY id`,
    );
    expect(setRows.map((r) => r.id)).toEqual(['a1']);
    const exRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = 'sess-1' ORDER BY id`,
    );
    expect(exRows.map((r) => r.id)).toEqual(['se-1']);
  });

  it('tombstones a whole exercise + its sets through the live path (deletedIds.exerciseIds)', async () => {
    // The exercise-tombstone branch (deletedIds.exerciseIds) deletes the
    // exercise's sets first then the exercise row. Exercised here via the live
    // entry point where it coexists with the membership purge that would ALSO
    // remove it — the tombstone counts the removal, and there's no double-free.
    await seedLiveSession(db, 'sess-1');
    const seed: SessionSnapshot = {
      sessionId: 'sess-1',
      title: 'Push',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: EX_A,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 1,
          sets: [
            { setId: 'a1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
        {
          sessionExerciseId: 'se-2',
          exerciseId: EX_B,
          exerciseName: 'Back Squat',
          ordering: 1,
          plannedSets: 1,
          sets: [
            { setId: 'b1', ordinal: 0, weight: 100, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: false },
            { setId: 'b2', ordinal: 1, weight: 100, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: false },
          ],
        },
      ],
    };
    await replaceLiveMirror(db, seed);

    // se-2 is still PRESENT in the snapshot AND tombstoned — the tombstone
    // (precise) wins, deleting se-2 + its 2 sets even though it's not absent.
    const res = await replaceLiveMirror(db, {
      ...seed,
      deletedIds: { exerciseIds: ['se-2'], setIds: [] },
    });
    expect(res.tombstonedExercises).toBe(1);
    expect(res.tombstonedSets).toBe(2); // b1, b2 under se-2
    const exRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = 'sess-1' ORDER BY id`,
    );
    expect(exRows.map((r) => r.id)).toEqual(['se-1']);
    const setRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-1' ORDER BY id`,
    );
    expect(setRows.map((r) => r.id)).toEqual(['a1']);
  });
});
