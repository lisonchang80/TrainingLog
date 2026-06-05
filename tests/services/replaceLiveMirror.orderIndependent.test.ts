/**
 * Grill 2026-06-05 Q6 (WC #1) — order-independent dropset reconcile.
 *
 * The Watch sorts the wire `sets[]` by display_rank, so a long-press reorder
 * can deliver a dropset follower BEFORE its head. The old single-pass reconcile
 * resolved a follower's parent via a map populated in array order, so a
 * follower-before-head wire produced an orphan `parent_set_id = null` (broken
 * chain → unnumbered orphan in history). The two-pass (pre-map) reconcile must
 * resolve the parent regardless of wire order.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const BENCH = '00000000-0000-4000-8000-000000000001';

async function seedLiveSession(db: BetterSqliteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, '')`,
    'sess-1',
    1_700_000_000_000,
  );
}

/** Build a one-exercise snapshot whose two sets are a dropset head + follower
 *  delivered in the given wire order. */
function dropsetSnapshot(order: 'head-first' | 'follower-first'): SessionSnapshot {
  const head = {
    setId: 'set-head',
    ordinal: order === 'head-first' ? 0 : 1,
    weight: 100,
    reps: 8,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind: 'dropset' as const,
    parent_set_id: null,
    is_logged: true,
  };
  const follower = {
    setId: 'set-follower',
    ordinal: order === 'head-first' ? 1 : 0,
    weight: 80,
    reps: 5,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind: 'dropset' as const,
    parent_set_id: 'set-head', // wire parent = head's wire setId
    is_logged: true,
  };
  return {
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: BENCH,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 2,
        sets: order === 'head-first' ? [head, follower] : [follower, head],
      },
    ],
  };
}

describe('replaceLiveMirror — order-independent dropset reconcile (Q6)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db);
  });

  afterEach(() => {
    db.close();
  });

  async function followerParent(): Promise<string | null> {
    const row = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = ?`,
      'set-follower',
    );
    return row?.parent_set_id ?? null;
  }

  it('head-first wire resolves the follower parent (regression)', async () => {
    await replaceLiveMirror(db, dropsetSnapshot('head-first'));
    expect(await followerParent()).toBe('set-head');
  });

  it('follower-first wire STILL resolves the follower parent (the fix)', async () => {
    await replaceLiveMirror(db, dropsetSnapshot('follower-first'));
    // Pre-fix this was null (orphan). Two-pass pre-map keeps the chain intact.
    expect(await followerParent()).toBe('set-head');
  });
});
