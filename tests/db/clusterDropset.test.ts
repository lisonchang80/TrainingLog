import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  deleteSet,
  addSessionDropsetCluster,
} from '../../src/adapters/sqlite/setRepository';
import { deleteSessionExerciseAndSets } from '../../src/adapters/sqlite/sessionRepository';
import { computeSessionSetLayout } from '../../src/domain/set/sessionSetLayout';

/**
 * Slice 10c overnight wave — cluster × dropset integration tests.
 *
 * Validates that dropset chain semantics (head + followers via
 * `parent_set_id`) correctly compose with cluster scoping (per-side
 * `session_exercise_id` isolation, two-side cascade delete). The active
 * session UI lets the user own a dropset chain on EITHER side of a cluster
 * card independently — these tests pin the structural invariants so future
 * refactors of `deleteSet` / `deleteSessionExerciseAndSets` /
 * `addSessionDropsetCluster` can't quietly break:
 *
 *   - delete-on-head cascades only to followers of THAT head, not to the
 *     other side's chain (parent_set_id is the cascade key, not exercise_id)
 *   - cluster delete (two sequential deleteSessionExerciseAndSets per side)
 *     wipes both sides cleanly regardless of dropset structure on either
 *   - no orphan rows survive: every set whose parent_set_id pointed to a
 *     deleted head must also be gone (deleteSet cascade)
 *   - addSessionDropsetCluster inherits session_exercise_id from the source
 *     row — adding a chain via A-side row never lands rows scoped to B
 *
 * Setup shape (helper `seedCluster`):
 *
 *   Cluster A (session_exercise aSeId, exercise = exA):
 *     A1 ord 1 set_kind=dropset (head)
 *     A2 ord 2 set_kind=dropset (follower, parent=A1)
 *     A3 ord 3 set_kind=dropset (follower, parent=A1)
 *
 *   Cluster B (session_exercise bSeId, exercise = exB, parent_id=aSeId):
 *     B1 ord 1 set_kind=working
 *     B2 ord 2 set_kind=working
 */
describe('cluster × dropset structural integration', () => {
  let db: BetterSqliteDatabase;
  // Reuse seeded built-in exercises (FK to `exercise` table enforced):
  //   ...000001 = Bench Press, ...000002 = Back Squat. Choice is arbitrary —
  //   these tests don't care about exercise identity, just that the two
  //   cluster sides have DIFFERENT exercise_id.
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-cd-1';
  const aSeId = 'se-A';
  const bSeId = 'se-B';
  const now = Date.now();

  async function seedCluster(): Promise<void> {
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    // Cluster A (parent) — exercise A
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0, NULL)`,
      aSeId,
      sessionId,
      exA,
    );
    // Cluster B (follower) — exercise B, parent_id = aSeId
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 2, NULL, NULL, NULL, 0, ?)`,
      bSeId,
      sessionId,
      exB,
      aSeId,
    );

    // A side: dropset chain (D1 head + 2 followers)
    await insertSessionSet(db, {
      id: 'A1',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 40,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: null,
      session_exercise_id: aSeId,
    });
    await insertSessionSet(db, {
      id: 'A2',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 30,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: 'A1',
      session_exercise_id: aSeId,
    });
    await insertSessionSet(db, {
      id: 'A3',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 20,
      reps: 6,
      is_skipped: 0,
      ordering: 3,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: 'A1',
      session_exercise_id: aSeId,
    });

    // B side: 2 working sets, untouched by any A-side op
    await insertSessionSet(db, {
      id: 'B1',
      session_id: sessionId,
      exercise_id: exB,
      weight_kg: 0,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: bSeId,
    });
    await insertSessionSet(db, {
      id: 'B2',
      session_id: sessionId,
      exercise_id: exB,
      weight_kg: 0,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: bSeId,
    });
  }

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedCluster();
  });

  afterEach(() => {
    db.close();
  });

  it('baseline: 5 sets, A side owns 3-row dropset chain, B side owns 2 working', async () => {
    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id).sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);

    const aSets = sets.filter((s) => s.session_exercise_id === aSeId);
    expect(aSets.map((s) => s.id).sort()).toEqual(['A1', 'A2', 'A3']);
    expect(aSets.every((s) => s.set_kind === 'dropset')).toBe(true);

    const aHead = aSets.find((s) => s.parent_set_id === null);
    expect(aHead?.id).toBe('A1');
    const aFollowers = aSets.filter((s) => s.parent_set_id !== null);
    expect(aFollowers.map((s) => s.parent_set_id)).toEqual(['A1', 'A1']);

    const bSets = sets.filter((s) => s.session_exercise_id === bSeId);
    expect(bSets.map((s) => s.id).sort()).toEqual(['B1', 'B2']);
    expect(bSets.every((s) => s.set_kind === 'working')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test A1 — deleteSet on A-side D1 head cascades to A-side followers only
  // -------------------------------------------------------------------------
  it('A1: deleteSet on A-side dropset head wipes A1+A2+A3, B side untouched', async () => {
    await deleteSet(db, 'A1');

    const sets = await listSetsBySession(db, sessionId);
    // All 3 A-side rows gone (A1 head, A2 + A3 followers via parent_set_id cascade)
    expect(sets.map((s) => s.id).sort()).toEqual(['B1', 'B2']);

    // B side rows untouched and still scoped to bSeId
    expect(sets.every((s) => s.session_exercise_id === bSeId)).toBe(true);
    expect(sets.find((s) => s.id === 'B1')?.reps).toBe(8);
    expect(sets.find((s) => s.id === 'B2')?.reps).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Test A2 — deleteSessionExerciseAndSets two-side cascade (#18 semantics)
  // -------------------------------------------------------------------------
  it('A2: cluster delete (A then B) wipes BOTH session_exercise rows AND every set on either side', async () => {
    // Mirror UI flow: two sequential calls per cluster "刪除超級組"
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: exA,
      session_exercise_id: aSeId,
    });
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: exB,
      session_exercise_id: bSeId,
    });

    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(ses).toEqual([]);

    const sets = await listSetsBySession(db, sessionId);
    expect(sets).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test A3 — no orphan rows after head-cascade
  // -------------------------------------------------------------------------
  it('A3: after deleteSet(A1), zero rows where parent_set_id references the deleted head', async () => {
    await deleteSet(db, 'A1');

    // Defensive: query raw set table — bypass listSetsBySession's JOIN —
    // and confirm no surviving row points at A1 via parent_set_id.
    const orphans = await db.getAllAsync<{ id: string; parent_set_id: string | null }>(
      `SELECT id, parent_set_id FROM "set" WHERE parent_set_id = ?`,
      'A1',
    );
    expect(orphans).toEqual([]);

    // Belt-and-suspenders: scan EVERY surviving row's parent_set_id —
    // none should reference a deleted set id.
    const allSurviving = await db.getAllAsync<{ id: string; parent_set_id: string | null }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = ?`,
      sessionId,
    );
    const survivingIds = new Set(allSurviving.map((r) => r.id));
    for (const row of allSurviving) {
      if (row.parent_set_id !== null) {
        expect(survivingIds.has(row.parent_set_id)).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Priority 2 — label correctness when both sides have independent shapes
  // -------------------------------------------------------------------------
  describe('Priority 2: two-side independent dropset labels (#61)', () => {
    // Reseed with the spec's specific two-side shape; the outer beforeEach
    // already set up a generic seed, but this test family needs a different
    // shape (A: [warmup, D1-head, D1-follower, working], B: [working, D1-head,
    // working, D1-follower-orphan-shape]) so we wipe the outer seed first.
    beforeEach(async () => {
      // Clear all sets from prior seed (keep session + session_exercise rows
      // since exercise_id / session_exercise_id mappings still apply).
      await db.runAsync(`DELETE FROM "set" WHERE session_id = ?`, sessionId);

      // A side: warmup, dropset head, dropset follower (of head), working
      await insertSessionSet(db, {
        id: 'aW', session_id: sessionId, exercise_id: exA,
        weight_kg: 20, reps: 10, is_skipped: 0, ordering: 1, created_at: now,
        set_kind: 'warmup', parent_set_id: null, session_exercise_id: aSeId,
      });
      await insertSessionSet(db, {
        id: 'aDh', session_id: sessionId, exercise_id: exA,
        weight_kg: 40, reps: 8, is_skipped: 0, ordering: 2, created_at: now,
        set_kind: 'dropset', parent_set_id: null, session_exercise_id: aSeId,
      });
      await insertSessionSet(db, {
        id: 'aDf', session_id: sessionId, exercise_id: exA,
        weight_kg: 30, reps: 6, is_skipped: 0, ordering: 3, created_at: now,
        set_kind: 'dropset', parent_set_id: 'aDh', session_exercise_id: aSeId,
      });
      await insertSessionSet(db, {
        id: 'aWk', session_id: sessionId, exercise_id: exA,
        weight_kg: 50, reps: 8, is_skipped: 0, ordering: 4, created_at: now,
        set_kind: 'working', parent_set_id: null, session_exercise_id: aSeId,
      });

      // B side: working, dropset head, working, dropset orphan-follower
      // (parent_set_id points at a non-existent id — defensive shape)
      await insertSessionSet(db, {
        id: 'bWk1', session_id: sessionId, exercise_id: exB,
        weight_kg: 0, reps: 8, is_skipped: 0, ordering: 1, created_at: now,
        set_kind: 'working', parent_set_id: null, session_exercise_id: bSeId,
      });
      await insertSessionSet(db, {
        id: 'bDh', session_id: sessionId, exercise_id: exB,
        weight_kg: 0, reps: 6, is_skipped: 0, ordering: 2, created_at: now,
        set_kind: 'dropset', parent_set_id: null, session_exercise_id: bSeId,
      });
      await insertSessionSet(db, {
        id: 'bWk2', session_id: sessionId, exercise_id: exB,
        weight_kg: 0, reps: 5, is_skipped: 0, ordering: 3, created_at: now,
        set_kind: 'working', parent_set_id: null, session_exercise_id: bSeId,
      });
      await insertSessionSet(db, {
        id: 'bDfOrphan', session_id: sessionId, exercise_id: exB,
        weight_kg: 0, reps: 4, is_skipped: 0, ordering: 4, created_at: now,
        set_kind: 'dropset', parent_set_id: 'bDh-DOES-NOT-EXIST',
        session_exercise_id: bSeId,
      });
    });

    it('B1: A side labels = [熱, D1, "", 1]; B side labels per orphan-defensive rules', async () => {
      const sets = await listSetsBySession(db, sessionId);
      const aSets = sets
        .filter((s) => s.session_exercise_id === aSeId)
        .map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        }));
      const bSets = sets
        .filter((s) => s.session_exercise_id === bSeId)
        .map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        }));

      const aLayout = computeSessionSetLayout(aSets);
      // Expected by reading sessionSetLayout.ts header doc:
      //   warmup → '熱'
      //   dropset HEAD (parent_set_id = null) → 'D1' (1st head)
      //   dropset FOLLOWER → ''
      //   working → '1' (first working set)
      expect(aLayout.labels.get('aW')).toBe('熱');
      expect(aLayout.labels.get('aDh')).toBe('D1');
      expect(aLayout.labels.get('aDf')).toBe('');
      expect(aLayout.labels.get('aWk')).toBe('1');
      // 3 groups: warmup (standalone), dropset head (with 1 follower), working (standalone)
      expect(aLayout.groups.map((g) => g.head.id)).toEqual(['aW', 'aDh', 'aWk']);
      expect(aLayout.groups[1].followers.map((f) => f.id)).toEqual(['aDf']);

      const bLayout = computeSessionSetLayout(bSets);
      // Expected:
      //   bWk1 working → '1'
      //   bDh dropset head → 'D1'
      //   bWk2 working → '2'
      //   bDfOrphan dropset orphan-follower (parent missing) → '' (label rule
      //     treats any dropset with non-null parent as follower → empty label)
      expect(bLayout.labels.get('bWk1')).toBe('1');
      expect(bLayout.labels.get('bDh')).toBe('D1');
      expect(bLayout.labels.get('bWk2')).toBe('2');
      expect(bLayout.labels.get('bDfOrphan')).toBe('');
      // Groups: bDh's followers list must be empty (no row has parent=bDh).
      // bDfOrphan renders as its own standalone group (per header doc:
      // "orphan follower … treated as its own standalone group").
      expect(bLayout.groups.map((g) => g.head.id)).toEqual([
        'bWk1', 'bDh', 'bWk2', 'bDfOrphan',
      ]);
      expect(bLayout.groups[1].followers).toEqual([]); // bDh has no contiguous follower with parent=bDh
      expect(bLayout.groups[3].followers).toEqual([]); // orphan is standalone
    });
  });

  // -------------------------------------------------------------------------
  // Priority 3 — addSessionDropsetCluster respects session_exercise_id scope
  // -------------------------------------------------------------------------
  describe('Priority 3: addSessionDropsetCluster session_exercise_id scoping', () => {
    it('C1: invoking on A-side source set lands new chain scoped to aSeId; B side untouched', async () => {
      // Source = A1 (A-side dropset head, session_exercise_id = aSeId).
      // Per addSessionDropsetCluster impl, src.session_exercise_id is read
      // off the source row and threaded into every new INSERT — so the new
      // chain MUST land on aSeId, regardless of exercise_id collision.
      const beforeSets = await listSetsBySession(db, sessionId);
      const beforeBIds = beforeSets
        .filter((s) => s.session_exercise_id === bSeId)
        .map((s) => ({ id: s.id, ord: s.ordering, reps: s.reps, w: s.weight_kg }))
        .sort((a, b) => a.id.localeCompare(b.id));

      let uuidSeq = 0;
      const result = await addSessionDropsetCluster(db, {
        session_id: sessionId,
        after_set_id: 'A1',
        uuid: () => `new-${uuidSeq++}`,
        now: () => now + 1000,
      });

      // Source chain has 3 rows (A1 + A2 + A3), so new chain clones 3 rows
      // (1 head + 2 followers).
      expect(result.follower_ids.length).toBe(2);

      const afterSets = await listSetsBySession(db, sessionId);
      const newRows = afterSets.filter((s) => s.id.startsWith('new-'));

      // Every new row scoped to aSeId — never to bSeId
      expect(newRows.length).toBe(3);
      expect(newRows.every((s) => s.session_exercise_id === aSeId)).toBe(true);
      // Every new row marked set_kind='dropset'
      expect(newRows.every((s) => s.set_kind === 'dropset')).toBe(true);
      // Every new row scoped to exA (NOT exB)
      expect(newRows.every((s) => s.exercise_id === exA)).toBe(true);

      // New head ordering = last source row ord (3) + 1 = 4; followers 5, 6
      const newHead = newRows.find((r) => r.parent_set_id === null);
      expect(newHead?.ordering).toBe(4);
      const newFollowers = newRows
        .filter((r) => r.parent_set_id !== null)
        .sort((a, b) => a.ordering - b.ordering);
      expect(newFollowers.map((r) => r.ordering)).toEqual([5, 6]);
      // Followers' parent_set_id all point at the new head
      expect(newFollowers.every((r) => r.parent_set_id === newHead!.id)).toBe(true);

      // B side untouched: same ids, ordering values, weight, reps
      const afterBIds = afterSets
        .filter((s) => s.session_exercise_id === bSeId)
        .map((s) => ({ id: s.id, ord: s.ordering, reps: s.reps, w: s.weight_kg }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(afterBIds).toEqual(beforeBIds);
    });
  });
});
