import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  prefillSessionExerciseFromLastSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c smoke fix (Overnight #14A) — regression guard for the bug
 * where `prefillSessionExerciseFromLastSession` pulled `is_logged = 0`
 * planned rows from a half-finished prior session and copied their
 * (mid-edit, never confirmed) values into the new session.
 *
 * Single source of truth: `is_logged = 1` (ADR-0019). Mirrors the
 * exerciseHistoryRepository sibling fix in commit 1f255f5.
 */

describe('prefillSessionExerciseFromLastSession — is_logged filter', () => {
  let db: BetterSqliteDatabase;
  // Reuse a built-in seeded exercise (Bench Press) — migrate() inserts it, so
  // the FK from "set".exercise_id is satisfied without extra seed code.
  const exA = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  async function createSession(id: string, started_at: number) {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      id,
      started_at,
      started_at + 3600_000,
    );
  }

  async function addSet(args: {
    id: string;
    session_id: string;
    exercise_id: string;
    ordering: number;
    weight_kg: number;
    reps: number;
    is_logged: 0 | 1;
    set_kind?: 'warmup' | 'working' | 'dropset';
    created_at?: number;
  }) {
    await insertSessionSet(db, {
      id: args.id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      weight_kg: args.weight_kg,
      reps: args.reps,
      is_skipped: 0,
      ordering: args.ordering,
      created_at: args.created_at ?? 1_700_000_000_000,
      set_kind: args.set_kind ?? 'working',
      parent_set_id: null,
    });
    if (args.is_logged === 1) {
      await db.runAsync(
        `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
        args.id,
      );
    }
  }

  it('case 1: prior session fully logged → prefill copies all sets (regression baseline)', async () => {
    await createSession('past', 1_000_000);
    await addSet({
      id: 'p1',
      session_id: 'past',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 80,
      reps: 5,
      is_logged: 1,
      created_at: 1_100_000,
    });
    await addSet({
      id: 'p2',
      session_id: 'past',
      exercise_id: exA,
      ordering: 2,
      weight_kg: 85,
      reps: 5,
      is_logged: 1,
      created_at: 1_200_000,
    });

    await createSession('current', 2_000_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(2);
    const rows = await listSetsBySession(db, 'current');
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps }))).toEqual([
      { w: 80, r: 5 },
      { w: 85, r: 5 },
    ]);
  });

  it('case 2: prior session mixed (1 logged, 1 unlogged) → only logged set is prefilled', async () => {
    await createSession('past', 1_000_000);
    // p1: user actually completed this rep (e.g. 80 × 5, ticked ✓)
    await addSet({
      id: 'p1',
      session_id: 'past',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 80,
      reps: 5,
      is_logged: 1,
      created_at: 1_100_000,
    });
    // p2: user planned 100 × 3 but never tapped ✓ (abandoned mid-session,
    // perhaps after editing the planned values). Must NOT be prefilled.
    await addSet({
      id: 'p2',
      session_id: 'past',
      exercise_id: exA,
      ordering: 2,
      weight_kg: 100,
      reps: 3,
      is_logged: 0,
      created_at: 1_200_000,
    });

    await createSession('current', 2_000_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(1);
    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(80);
    expect(rows[0].reps).toBe(5);
    // 100 × 3 (the unlogged, mid-edit planned row) must not appear.
    expect(rows.find((r) => r.weight_kg === 100)).toBeUndefined();
  });

  it('case 3: prior session ENTIRELY unlogged → falls back to "no history" (returns 0)', async () => {
    // Edge case: every set in the last session is is_logged=0 — that session
    // shouldn't even be picked as "the last session". Lookup should fall
    // through to an older logged session, or return 0 if none exists.
    await createSession('past', 1_000_000);
    await addSet({
      id: 'p1',
      session_id: 'past',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 999,
      reps: 99,
      is_logged: 0,
      created_at: 1_100_000,
    });

    await createSession('current', 2_000_000);
    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(0);
    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(0);
  });

  it('case 4: most-recent session unlogged, older session logged → uses the OLDER logged one', async () => {
    // User abandoned today's session entirely, but had a real workout
    // yesterday. Prefill must dig past the dead session to find the
    // actually-completed one.
    await createSession('older', 1_000_000);
    await addSet({
      id: 'o1',
      session_id: 'older',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 70,
      reps: 8,
      is_logged: 1,
      created_at: 1_100_000,
    });

    await createSession('abandoned', 1_500_000);
    await addSet({
      id: 'a1',
      session_id: 'abandoned',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 200,
      reps: 1,
      is_logged: 0,
      created_at: 1_600_000,
    });

    await createSession('current', 2_000_000);
    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(1);
    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(70);
    expect(rows[0].reps).toBe(8);
  });
});
