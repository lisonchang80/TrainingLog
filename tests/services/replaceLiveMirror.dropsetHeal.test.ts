/**
 * 2026-06-28 cast rapid-tap race — dropset-chain integrity heal.
 *
 * A rapid working↔dropset cycle on the Watch DURING sync can land the head's
 * working-flip and the follower's row in different reconcile ticks, leaving an
 * ORPHAN follower (set_kind='dropset', parent → a row that is now 'working' or
 * was deleted). `setLabels.ts` renders that as a BLANK kind box; the Watch keeps
 * showing it as a "D1" head → role SPLIT. `reconcileSessionTree` now demotes such
 * an orphan to working + clears its parent (data-safe — only kind/parent change).
 *
 * Guards: a VALID chain (head still dropset) is untouched, and a follower whose
 * head is merely ABSENT-from-this-snapshot but still a dropset row in the DB is
 * LEFT ALONE (only a genuinely headless follower is demoted).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { reconcileSessionTree } from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const BENCH = '00000000-0000-4000-8000-000000000001';

async function seedEmptyExercise(db: BetterSqliteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT INTO session (id, started_at, title) VALUES ('sess-1', 1000, '')`,
  );
  await db.runAsync(
    `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets)
     VALUES ('se-1', 'sess-1', ?, 0, 0)`,
    BENCH,
  );
}

async function row(
  db: BetterSqliteDatabase,
  id: string,
): Promise<{ set_kind: string; parent_set_id: string | null } | null> {
  return db.getFirstAsync<{ set_kind: string; parent_set_id: string | null }>(
    `SELECT set_kind, parent_set_id FROM "set" WHERE id = ?`,
    id,
  );
}

function ex(sets: SessionSnapshot['exercises'][number]['sets']) {
  return {
    sessionExerciseId: 'se-1',
    exerciseId: BENCH,
    exerciseName: 'Bench Press',
    ordering: 0,
    plannedSets: sets.length,
    sets,
  };
}

function set(
  setId: string,
  ordinal: number,
  set_kind: 'working' | 'warmup' | 'dropset',
  parent_set_id: string | null,
) {
  return {
    setId,
    ordinal,
    weight: 100,
    reps: 8,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind,
    parent_set_id,
    is_logged: true,
  };
}

describe('reconcileSessionTree — dropset-chain integrity heal (rapid-tap race)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => db.close());

  it('demotes an orphan follower (head flipped to working) to working + null parent', async () => {
    await seedEmptyExercise(db);
    // The race end-state pushed to the iPhone: head X is now WORKING, but the
    // follower F still says dropset/parent=X → orphan.
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [ex([set('X', 0, 'working', null), set('F', 1, 'dropset', 'X')])],
    };
    await reconcileSessionTree(db, snapshot, {
      purgeTail: false,
      purgeSetsInPresentExercises: true,
    });
    expect(await row(db, 'X')).toEqual({ set_kind: 'working', parent_set_id: null });
    // F demoted: no longer a blank-box orphan, renders as a normal working set.
    expect(await row(db, 'F')).toEqual({ set_kind: 'working', parent_set_id: null });
  });

  it('leaves a VALID chain (head still dropset) intact', async () => {
    await seedEmptyExercise(db);
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [ex([set('H', 0, 'dropset', null), set('F', 1, 'dropset', 'H')])],
    };
    await reconcileSessionTree(db, snapshot, {
      purgeTail: false,
      purgeSetsInPresentExercises: true,
    });
    expect(await row(db, 'H')).toEqual({ set_kind: 'dropset', parent_set_id: null });
    expect(await row(db, 'F')).toEqual({ set_kind: 'dropset', parent_set_id: 'H' });
  });

  it('does NOT demote a follower whose head is absent-from-snapshot but still a dropset row in the DB', async () => {
    // Seed a real chain in the DB.
    await db.runAsync(
      `INSERT INTO session (id, started_at, title) VALUES ('sess-1', 1000, '')`,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets)
       VALUES ('se-1', 'sess-1', ?, 0, 2)`,
      BENCH,
    );
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
    // A tick that lists only the follower (head omitted from THIS snapshot).
    // Purge OFF so the head row survives in the DB as a dropset.
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-1',
      title: '',
      startedAt: 1000,
      exercises: [ex([set('F', 1, 'dropset', 'H')])],
    };
    await reconcileSessionTree(db, snapshot, {
      purgeTail: false,
      purgeSetsInPresentExercises: false,
    });
    // H still a dropset in the DB → F's parent IS a dropset → NOT demoted.
    expect(await row(db, 'H')).toEqual({ set_kind: 'dropset', parent_set_id: null });
    expect(await row(db, 'F')).toEqual({ set_kind: 'dropset', parent_set_id: 'H' });
  });
});
