import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { insertSessionSet, deleteSet } from '../../src/adapters/sqlite/setRepository';
import {
  captureSessionSnapshot,
  restoreSessionFromSnapshot,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * `restoreSessionFromSnapshot` × dropset chain preservation
 *
 * Test gap from `docs/audit/2026-05-24-test-gap-and-dead-code.md` § 5 #2.
 * `captureSessionSnapshot` / `restoreSessionFromSnapshot` SELECT/INSERT the
 * `parent_set_id` column verbatim — behavior is structurally correct because
 * snapshotted sets keep their original `id` on restore, so any chain link
 * (follower.parent_set_id = head.id) survives the round-trip. No test
 * previously made this dropset-chain invariant explicit.
 *
 * Covers (per task brief):
 *   1. Single chain (1 root + 2 children): restore preserves chain integrity
 *      and parent_set_id correctly references the restored head's id.
 *   2. Multiple chains in same session: each chain stays isolated; head A's
 *      followers point at head A, head B's at head B.
 *   3. Mixed solo + chain: solo restored independently, chain links intact.
 *   4. Orphan child (parent removed mid-edit before snapshot? No — snapshot
 *      itself is the source of truth; this case tests a hand-crafted snapshot
 *      where a follower row references a parent_set_id that's NOT in the
 *      snapshot's sets array. The restore should still succeed (parent_set_id
 *      is preserved verbatim) — the follower becomes a true orphan referencing
 *      a non-existent id. We lock in this behavior so a future "validate
 *      snapshot integrity" guard doesn't silently change semantics without an
 *      accompanying test update.
 *
 * Schema note: `set.parent_set_id` has no DB-level FK in v015 (declarative-only
 * — confirmed by `tests/db/sessionDropsetRow.test.ts` patterns); cascade /
 * orphan handling is enforced at the repository layer, not by SQLite. This is
 * why orphan child case (4) doesn't blow up on INSERT.
 */

const EX_A = '00000000-0000-4000-8000-000000000001';
const EX_B = '00000000-0000-4000-8000-000000000002';

describe('restoreSessionFromSnapshot × dropset chain preservation', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-chain';
  const seA = 'se-chain-A';
  const seB = 'se-chain-B';
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      sessionId,
      now,
      now + 60_000,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0, NULL)`,
      seA,
      sessionId,
      EX_A,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0, NULL)`,
      seB,
      sessionId,
      EX_B,
    );
  });

  afterEach(() => db.close());

  it('Case 1: single chain (1 root + 2 followers) — restore preserves parent_set_id linkage', async () => {
    // Seed: root + 2 dropset followers on session_exercise A.
    await insertSessionSet(db, {
      id: 'root-1',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'dropset', // root of a dropset chain
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'child-1a',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 80,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: now + 1000,
      set_kind: 'dropset',
      parent_set_id: 'root-1',
    });
    await insertSessionSet(db, {
      id: 'child-1b',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 60,
      reps: 5,
      is_skipped: 0,
      ordering: 3,
      created_at: now + 2000,
      set_kind: 'dropset',
      parent_set_id: 'root-1',
    });

    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap).not.toBeNull();
    expect(snap!.sets).toHaveLength(3);
    // Verify snapshot captures parent_set_id verbatim.
    const snapByid = new Map(snap!.sets.map((s) => [s.id, s]));
    expect(snapByid.get('root-1')!.parent_set_id).toBeNull();
    expect(snapByid.get('child-1a')!.parent_set_id).toBe('root-1');
    expect(snapByid.get('child-1b')!.parent_set_id).toBe('root-1');

    // Simulate edit: delete the entire chain.
    await deleteSet(db, 'root-1'); // deleteSet cascades to children via parent_set_id
    const mid = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ?`,
      sessionId,
    );
    expect(mid).toHaveLength(0);

    // Restore: chain integrity preserved.
    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getAllAsync<{
      id: string;
      set_kind: string;
      parent_set_id: string | null;
      weight_kg: number;
    }>(
      `SELECT id, set_kind, parent_set_id, weight_kg
         FROM "set" WHERE session_id = ?
         ORDER BY ordering ASC`,
      sessionId,
    );
    expect(after).toEqual([
      { id: 'root-1', set_kind: 'dropset', parent_set_id: null, weight_kg: 100 },
      {
        id: 'child-1a',
        set_kind: 'dropset',
        parent_set_id: 'root-1',
        weight_kg: 80,
      },
      {
        id: 'child-1b',
        set_kind: 'dropset',
        parent_set_id: 'root-1',
        weight_kg: 60,
      },
    ]);
  });

  it('Case 2: multiple chains in same session — each chain stays isolated after restore', async () => {
    // Chain A on session_exercise A (root + 1 child)
    await insertSessionSet(db, {
      id: 'rootA',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'childA',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 75,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: now + 1000,
      set_kind: 'dropset',
      parent_set_id: 'rootA',
    });
    // Chain B on session_exercise B (root + 2 children)
    await insertSessionSet(db, {
      id: 'rootB',
      session_id: sessionId,
      exercise_id: EX_B,
      session_exercise_id: seB,
      weight_kg: 50,
      reps: 10,
      is_skipped: 0,
      ordering: 3,
      created_at: now + 2000,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'childB1',
      session_id: sessionId,
      exercise_id: EX_B,
      session_exercise_id: seB,
      weight_kg: 40,
      reps: 8,
      is_skipped: 0,
      ordering: 4,
      created_at: now + 3000,
      set_kind: 'dropset',
      parent_set_id: 'rootB',
    });
    await insertSessionSet(db, {
      id: 'childB2',
      session_id: sessionId,
      exercise_id: EX_B,
      session_exercise_id: seB,
      weight_kg: 30,
      reps: 6,
      is_skipped: 0,
      ordering: 5,
      created_at: now + 4000,
      set_kind: 'dropset',
      parent_set_id: 'rootB',
    });

    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.sets).toHaveLength(5);

    // Edit: wipe everything.
    await db.runAsync(`DELETE FROM "set" WHERE session_id = ?`, sessionId);

    // Restore.
    await restoreSessionFromSnapshot(db, snap!);

    // Chain A: childA still points at rootA — not bled into rootB.
    const chainAChild = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = 'childA'`,
    );
    expect(chainAChild?.parent_set_id).toBe('rootA');

    // Chain B: both children point at rootB.
    const chainBChildren = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
    }>(`SELECT id, parent_set_id FROM "set" WHERE parent_set_id = 'rootB' ORDER BY id ASC`);
    expect(chainBChildren).toEqual([
      { id: 'childB1', parent_set_id: 'rootB' },
      { id: 'childB2', parent_set_id: 'rootB' },
    ]);

    // No cross-bleed: rootA has 1 follower, rootB has 2 followers.
    const followersOfA = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM "set" WHERE parent_set_id = 'rootA'`,
    );
    expect(followersOfA?.c).toBe(1);
    const followersOfB = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM "set" WHERE parent_set_id = 'rootB'`,
    );
    expect(followersOfB?.c).toBe(2);
  });

  it('Case 3: mixed solo + chain — solo restored independently, chain links intact', async () => {
    // Solo working set (no chain involvement)
    await insertSessionSet(db, {
      id: 'solo-1',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 120,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
    });
    // Dropset chain on the SAME session_exercise (exercise A)
    await insertSessionSet(db, {
      id: 'head-A',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: now + 1000,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'drop-A1',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 70,
      reps: 6,
      is_skipped: 0,
      ordering: 3,
      created_at: now + 2000,
      set_kind: 'dropset',
      parent_set_id: 'head-A',
    });

    const snap = await captureSessionSnapshot(db, sessionId);

    // Edit: clear all sets.
    await db.runAsync(`DELETE FROM "set" WHERE session_id = ?`, sessionId);

    await restoreSessionFromSnapshot(db, snap!);

    // Solo restored.
    const solo = await db.getFirstAsync<{
      set_kind: string;
      parent_set_id: string | null;
      weight_kg: number;
    }>(`SELECT set_kind, parent_set_id, weight_kg FROM "set" WHERE id = 'solo-1'`);
    expect(solo).toEqual({
      set_kind: 'working',
      parent_set_id: null,
      weight_kg: 120,
    });

    // Chain intact.
    const head = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = 'head-A'`,
    );
    expect(head?.parent_set_id).toBeNull();
    const follower = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = 'drop-A1'`,
    );
    expect(follower?.parent_set_id).toBe('head-A');

    // Solo did NOT get linked into the chain by accident.
    const followersOfHead = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE parent_set_id = 'head-A'`,
    );
    expect(followersOfHead.map((r) => r.id)).toEqual(['drop-A1']);
  });

  it('Case 4: snapshot with orphan follower (parent_set_id references id NOT in snapshot.sets) — INSERTs verbatim, becomes a true orphan', async () => {
    // Seed only a follower row (no head); the snapshot will carry the
    // follower's parent_set_id pointing at a non-existent 'ghost-head'.
    // Production code never produces this — `captureSessionSnapshot` reads
    // every set within session_id range. We hand-craft the snapshot to
    // exercise the restore code's verbatim-preserve contract.
    await insertSessionSet(db, {
      id: 'orphan-1',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 50,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'dropset',
      // Point at a head that does NOT exist in DB. parent_set_id has no FK,
      // so this insert succeeds.
      parent_set_id: 'ghost-head',
    });

    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.sets).toHaveLength(1);
    expect(snap!.sets[0].parent_set_id).toBe('ghost-head');

    // Edit: delete the orphan.
    await db.runAsync(`DELETE FROM "set" WHERE session_id = ?`, sessionId);

    // Restore: the orphan's parent_set_id is preserved verbatim — no validation
    // / repair pass. This locks in the current behavior so any future change
    // (e.g. "drop orphan followers during restore") gets explicit attention.
    await restoreSessionFromSnapshot(db, snap!);
    const after = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = 'orphan-1'`,
    );
    expect(after?.parent_set_id).toBe('ghost-head');
    // True orphan: no set with id 'ghost-head' exists.
    const ghost = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE id = 'ghost-head'`,
    );
    expect(ghost).toBeNull();
  });

  it('Case 5: ordering preserved across restore — followers keep their relative position to head', async () => {
    // Important: the slice 10c set logger renders rows in `ordering ASC`. If
    // restore shuffled ordering even by one slot, the chain visual (head
    // first, then D1, D2) would flip → user confusion. Lock it down.
    await insertSessionSet(db, {
      id: 'h',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: 10,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'd1',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 80,
      reps: 6,
      is_skipped: 0,
      ordering: 20,
      created_at: now + 1000,
      set_kind: 'dropset',
      parent_set_id: 'h',
    });
    await insertSessionSet(db, {
      id: 'd2',
      session_id: sessionId,
      exercise_id: EX_A,
      session_exercise_id: seA,
      weight_kg: 60,
      reps: 5,
      is_skipped: 0,
      ordering: 30,
      created_at: now + 2000,
      set_kind: 'dropset',
      parent_set_id: 'h',
    });

    const snap = await captureSessionSnapshot(db, sessionId);
    await db.runAsync(`DELETE FROM "set" WHERE session_id = ?`, sessionId);
    await restoreSessionFromSnapshot(db, snap!);

    const rows = await db.getAllAsync<{ id: string; ordering: number }>(
      `SELECT id, ordering FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(rows).toEqual([
      { id: 'h', ordering: 10 },
      { id: 'd1', ordering: 20 },
      { id: 'd2', ordering: 30 },
    ]);
  });
});
