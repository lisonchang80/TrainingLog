import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  prefillSessionExerciseFromLastSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c — [+ 動作] picker post-add: copy last session's set list verbatim
 * so user only needs to tick. Per user "如果有以前的記錄，會載入最後一次的紀錄".
 */

describe('prefillSessionExerciseFromLastSession', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';

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

  async function addSet(
    id: string,
    session_id: string,
    exercise_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    set_kind: 'warmup' | 'working' | 'dropset' = 'working',
    created_at = 1_700_000_000_000,
    is_logged: 0 | 1 = 1, // default to logged — existing tests assume fully-completed prior session
  ) {
    await insertSessionSet(db, {
      id,
      session_id,
      exercise_id,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at,
      set_kind,
      parent_set_id: null,
    });
    if (is_logged === 1) {
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, id);
    }
  }

  it('copies last session sets into current (weight / reps / set_kind verbatim)', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 50, 12, 'warmup', 1_100_000);
    await addSet('p2', 'past', exA, 2, 80, 5, 'working', 1_200_000);
    await addSet('p3', 'past', exA, 3, 85, 5, 'working', 1_300_000);

    await createSession('current', 2_000_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(3);
    const rows = await listSetsBySession(db, 'current');
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind })))
      .toEqual([
        { w: 50, r: 12, k: 'warmup' },
        { w: 80, r: 5, k: 'working' },
        { w: 85, r: 5, k: 'working' },
      ]);
    // is_logged 0 for all (fresh, user must tick)
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
  });

  it('returns 0 when no prior session exists for this exercise', async () => {
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

  it('appends after current session MAX(ordering) — preserves earlier rows', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 80, 5, 'working', 1_100_000);

    await createSession('current', 2_000_000);
    // Already have 2 sets of exB in current.
    await addSet('c1', 'current', exB, 1, 60, 8, 'working', 2_100_000);
    await addSet('c2', 'current', exB, 2, 65, 8, 'working', 2_200_000);

    await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(3);
    // ordering ASC = c1(1), c2(2), prefilled(3)
    expect(rows[0].id).toBe('c1');
    expect(rows[1].id).toBe('c2');
    expect(rows[2].exercise_id).toBe(exA);
    expect(rows[2].weight_kg).toBe(80);
    expect(rows[2].reps).toBe(5);
  });

  it('finds the MOST recent session (not arbitrary one)', async () => {
    await createSession('old', 1_000_000);
    await addSet('o1', 'old', exA, 1, 70, 5, 'working', 1_100_000);

    await createSession('mid', 1_500_000);
    await addSet('m1', 'mid', exA, 1, 85, 5, 'working', 1_500_100);

    await createSession('current', 2_000_000);
    await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(85); // mid is latest before current
  });

  it('does NOT copy from the same (current) session if user re-adds same exercise', async () => {
    await createSession('current', 2_000_000);
    // User already has a set of exA in current session.
    await addSet('c1', 'current', exA, 1, 100, 3, 'working', 2_100_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(0); // Current excluded; no prior session → 0.
  });

  it('skips is_skipped rows', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 80, 5, 'working', 1_100_000);
    // Mark p1 as skipped manually.
    await db.runAsync(`UPDATE "set" SET is_skipped = 1 WHERE id = ?`, 'p1');

    await createSession('current', 2_000_000);
    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(0);
  });

  /**
   * Regression (2026-05-20 wave 12 bite-back): When the previous session's
   * sets for the picked exercise included a dropset chain (head + followers
   * linked via `parent_set_id`), prefill used to null out parent_set_id on
   * every copied row. The chain decomposed into a sequence of orphan dropset
   * "heads" — UI showed two "D1" rows each with its own ✓ slot (instead of
   * one D1 + D2 follower row chained together). Fix remaps source.id →
   * new.id and threads remapped parent_set_id through the insert.
   *
   * User-facing symptom: Today [+動作] → Assisted Dip (whose last session was
   * a dropset chain) showed two parallel rows that didn't behave as a chain.
   */
  describe('dropset chain preservation on prefill', () => {
    it('preserves D1 head + D2 follower chain (parent_set_id remap)', async () => {
      await createSession('past', 1_000_000);
      // Head row in source session (orphan, parent_set_id NULL).
      await addSet('pH', 'past', exA, 1, 60, 12, 'dropset', 1_100_000);
      // Follower row — parent_set_id points at head 'pH'. Insert via
      // insertSessionSet directly so we can set parent_set_id (the local
      // addSet helper hardcodes NULL).
      await insertSessionSet(db, {
        id: 'pF',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 40,
        reps: 10,
        is_skipped: 0,
        ordering: 2,
        created_at: 1_200_000,
        set_kind: 'dropset',
        parent_set_id: 'pH',
      });
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id IN ('pH','pF')`);

      await createSession('current', 2_000_000);
      const count = await prefillSessionExerciseFromLastSession(db, {
        session_id: 'current',
        exercise_id: exA,
        uuid: randomUUID,
      });
      expect(count).toBe(2);

      const rows = await listSetsBySession(db, 'current');
      expect(rows).toHaveLength(2);
      // ordering ASC: head first, follower second.
      const [head, follower] = rows;
      expect(head.set_kind).toBe('dropset');
      expect(follower.set_kind).toBe('dropset');
      // Head is orphan, follower's parent_set_id points at the NEW head id
      // (not the source 'pH' which doesn't exist in current session).
      expect(head.parent_set_id).toBeNull();
      expect(follower.parent_set_id).toBe(head.id);
      // Sanity: the source id 'pH' should NOT appear in current session.
      expect(rows.map((r) => r.id)).not.toContain('pH');
    });

    it('preserves a 3-deep dropset chain (D1 → D2 → D3)', async () => {
      await createSession('past', 1_000_000);
      await addSet('h', 'past', exA, 1, 60, 12, 'dropset', 1_100_000);
      await insertSessionSet(db, {
        id: 'f1',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 40,
        reps: 10,
        is_skipped: 0,
        ordering: 2,
        created_at: 1_200_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      await insertSessionSet(db, {
        id: 'f2',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 25,
        reps: 8,
        is_skipped: 0,
        ordering: 3,
        created_at: 1_300_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      await db.runAsync(
        `UPDATE "set" SET is_logged = 1 WHERE id IN ('h','f1','f2')`,
      );

      await createSession('current', 2_000_000);
      await prefillSessionExerciseFromLastSession(db, {
        session_id: 'current',
        exercise_id: exA,
        uuid: randomUUID,
      });
      const rows = await listSetsBySession(db, 'current');
      expect(rows).toHaveLength(3);
      const [head, fol1, fol2] = rows;
      expect(head.parent_set_id).toBeNull();
      expect(fol1.parent_set_id).toBe(head.id);
      expect(fol2.parent_set_id).toBe(head.id);
    });

    /**
     * Regression (2026-05-20 night bite-back, sibling of `138cc0a`):
     * `prefillSessionExerciseFromLastSession` originally filtered source
     * sets with `WHERE is_logged = 1` in SQL. Dropset followers' DB
     * is_logged stays 0 (UI tap-✓ writes the head only; followers inherit
     * via chain-aware filter at render time), so the SELECT excluded
     * followers entirely. Prefill brought in heads only — the chain
     * shape was lost even though `parent_set_id` got carried through.
     * User reload-reported: prefill showed 3 lone "D1/D2/D3 heads" with
     * no follower rows on a session where the source had 3 chains × 3
     * rows each.
     *
     * Fix: SELECT all non-skipped rows, then filter in JS so a follower
     * passes when its head's is_logged === 1.
     */
    it('pulls dropset followers when head is_logged=1 (follower DB is_logged stays 0 — chain-aware filter)', async () => {
      await createSession('past', 1_000_000);
      // Head logged via tap-✓; followers stay is_logged=0 in DB (UI inherits
      // via chain-aware filter at render — same applies to prefill source).
      await addSet('h', 'past', exA, 1, 60, 12, 'dropset', 1_100_000, 1);
      await insertSessionSet(db, {
        id: 'f1',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 30,
        reps: 12,
        is_skipped: 0,
        ordering: 2,
        created_at: 1_200_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      await insertSessionSet(db, {
        id: 'f2',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 15,
        reps: 12,
        is_skipped: 0,
        ordering: 3,
        created_at: 1_300_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      // f1 + f2 DELIBERATELY stay is_logged=0 (mirror production behavior).

      await createSession('current', 2_000_000);
      const count = await prefillSessionExerciseFromLastSession(db, {
        session_id: 'current',
        exercise_id: exA,
        uuid: randomUUID,
      });
      expect(count).toBe(3);

      const rows = await listSetsBySession(db, 'current');
      expect(rows).toHaveLength(3);
      const [head, fol1, fol2] = rows;
      // Chain is intact: head + 2 followers all dropset, weights cascading.
      expect(head.set_kind).toBe('dropset');
      expect(head.parent_set_id).toBeNull();
      expect(head.weight_kg).toBe(60);
      expect(fol1.set_kind).toBe('dropset');
      expect(fol1.parent_set_id).toBe(head.id);
      expect(fol1.weight_kg).toBe(30);
      expect(fol2.set_kind).toBe('dropset');
      expect(fol2.parent_set_id).toBe(head.id);
      expect(fol2.weight_kg).toBe(15);
      // All copied rows start unticked (user re-ticks in new session).
      expect(rows.every((r) => r.is_logged === 0)).toBe(true);
    });

    it('does NOT pull followers whose head is UNLOGGED (partial-log invariant)', async () => {
      // Source session: head is_logged=0 (user partially logged), followers
      // is_logged=0 → entire chain excluded. Mirrors solo working-set rule
      // ("a partially-logged prior session must only contribute the sets
      // the user actually ticked").
      await createSession('past', 1_000_000);
      // Logged working set to anchor the lookup.
      await addSet('wk', 'past', exA, 1, 80, 5, 'working', 1_100_000, 1);
      // Unlogged dropset chain (head + 2 followers, NONE is_logged).
      await addSet('h', 'past', exA, 2, 60, 12, 'dropset', 1_200_000, 0);
      await insertSessionSet(db, {
        id: 'f1',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 30,
        reps: 12,
        is_skipped: 0,
        ordering: 3,
        created_at: 1_300_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      // f1.is_logged=0 by default.

      await createSession('current', 2_000_000);
      await prefillSessionExerciseFromLastSession(db, {
        session_id: 'current',
        exercise_id: exA,
        uuid: randomUUID,
      });
      const rows = await listSetsBySession(db, 'current');
      // Only `wk` carried over; unlogged chain stays out.
      expect(rows).toHaveLength(1);
      expect(rows[0].weight_kg).toBe(80);
      expect(rows[0].set_kind).toBe('working');
    });

    it('working + dropset mixed: warmup keeps NULL, dropset chain stays linked', async () => {
      await createSession('past', 1_000_000);
      await addSet('w1', 'past', exA, 1, 30, 15, 'warmup', 1_050_000);
      await addSet('h', 'past', exA, 2, 60, 12, 'dropset', 1_100_000);
      await insertSessionSet(db, {
        id: 'f1',
        session_id: 'past',
        exercise_id: exA,
        weight_kg: 40,
        reps: 10,
        is_skipped: 0,
        ordering: 3,
        created_at: 1_200_000,
        set_kind: 'dropset',
        parent_set_id: 'h',
      });
      await db.runAsync(
        `UPDATE "set" SET is_logged = 1 WHERE id IN ('w1','h','f1')`,
      );

      await createSession('current', 2_000_000);
      await prefillSessionExerciseFromLastSession(db, {
        session_id: 'current',
        exercise_id: exA,
        uuid: randomUUID,
      });
      const rows = await listSetsBySession(db, 'current');
      expect(rows).toHaveLength(3);
      const [warmup, head, follower] = rows;
      expect(warmup.set_kind).toBe('warmup');
      expect(warmup.parent_set_id).toBeNull();
      expect(head.set_kind).toBe('dropset');
      expect(head.parent_set_id).toBeNull();
      expect(follower.set_kind).toBe('dropset');
      expect(follower.parent_set_id).toBe(head.id);
    });
  });
});
