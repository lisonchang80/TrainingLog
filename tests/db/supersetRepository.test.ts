import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  deleteReusableSuperset,
  findExistingReusableSupersetByPair,
  getReusableSupersetSessionCount,
  getReusableSupersetSessionCounts,
  getReusableSupersetWithExercises,
  incrementUseCount,
  insertReusableSuperset,
  listReusableSupersets,
  listReusableSupersetsWithExercises,
  listSlotsForSuperset,
  updateReusableSupersetName,
} from '../../src/adapters/sqlite/supersetRepository';
import {
  createSession,
  endSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import type { ReusableSupersetDraft } from '../../src/domain/superset/supersetManager';

const BENCH = '00000000-0000-4000-8000-000000000001';
const ROW = '00000000-0000-4000-8000-000000000005';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const DEADLIFT = '00000000-0000-4000-8000-000000000003';

const draft = (over: Partial<ReusableSupersetDraft> = {}): ReusableSupersetDraft => ({
  name: 'Bench + Row',
  color_hex: '#34c759',
  exercise_ids: [BENCH, ROW],
  ...over,
});

describe('supersetRepository', () => {
  let db: BetterSqliteDatabase;
  let uuidCounter = 0;
  const uuid = () => `ss-${++uuidCounter}`;
  let clock = 1000;
  const now = () => clock;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
    clock = 1000;
  });

  afterEach(() => {
    db.close();
  });

  describe('insertReusableSuperset', () => {
    it('inserts superset + 2 link rows in transaction', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, now);
      expect(id).toBe('ss-1');
      const slots = await listSlotsForSuperset(db, id);
      expect(slots).toEqual([
        { superset_id: 'ss-1', position: 0, exercise_id: BENCH },
        { superset_id: 'ss-1', position: 1, exercise_id: ROW },
      ]);
      const list = await listReusableSupersets(db);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Bench + Row');
      expect(list[0].color_hex).toBe('#34c759');
      expect(list[0].use_count).toBe(0);
      expect(list[0].created_at).toBe(1000);
      expect(list[0].updated_at).toBe(1000);
    });

    it('trims name before INSERT', async () => {
      await insertReusableSuperset(db, draft({ name: '  PR Day  ' }), uuid, now);
      const list = await listReusableSupersets(db);
      expect(list[0].name).toBe('PR Day');
    });

    it('stores null color_hex when draft has null', async () => {
      await insertReusableSuperset(db, draft({ color_hex: null }), uuid, now);
      const list = await listReusableSupersets(db);
      expect(list[0].color_hex).toBeNull();
    });
  });

  /**
   * Slice 10c overnight #26 — block creating duplicate RS templates.
   * Same pair {A, B} (order-insensitive) is no longer allowed; the helper
   * surfaces the existing id so UI can offer "go to existing".
   */
  describe('findExistingReusableSupersetByPair (#26)', () => {
    it('returns null when DB has no RS templates', async () => {
      expect(await findExistingReusableSupersetByPair(db, BENCH, ROW)).toBeNull();
    });

    it('finds an existing RS by the same (A, B) order', async () => {
      const id = await insertReusableSuperset(
        db,
        draft({ exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      expect(await findExistingReusableSupersetByPair(db, BENCH, ROW)).toBe(id);
    });

    it('finds an existing RS by the reverse (B, A) order — order-insensitive', async () => {
      const id = await insertReusableSuperset(
        db,
        draft({ exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      expect(await findExistingReusableSupersetByPair(db, ROW, BENCH)).toBe(id);
    });

    it('returns null when the pair is different', async () => {
      await insertReusableSuperset(
        db,
        draft({ exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      expect(await findExistingReusableSupersetByPair(db, BENCH, SQUAT)).toBeNull();
    });

    it('disambiguates among multiple existing RS templates', async () => {
      const ab = await insertReusableSuperset(
        db,
        draft({ name: 'AB', exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      const cd = await insertReusableSuperset(
        db,
        draft({ name: 'CD', exercise_ids: [SQUAT, ROW] }),
        uuid,
        now
      );
      expect(await findExistingReusableSupersetByPair(db, BENCH, ROW)).toBe(ab);
      expect(await findExistingReusableSupersetByPair(db, ROW, BENCH)).toBe(ab);
      expect(await findExistingReusableSupersetByPair(db, SQUAT, ROW)).toBe(cd);
      expect(await findExistingReusableSupersetByPair(db, ROW, SQUAT)).toBe(cd);
      expect(await findExistingReusableSupersetByPair(db, BENCH, SQUAT)).toBeNull();
    });

    it('insertReusableSuperset throws on duplicate pair (reverse order) and leaves DB unchanged', async () => {
      const id = await insertReusableSuperset(
        db,
        draft({ exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      await expect(
        insertReusableSuperset(
          db,
          draft({ name: 'dup', exercise_ids: [ROW, BENCH] }),
          uuid,
          now
        )
      ).rejects.toThrow(/duplicate RS pair/);
      const list = await listReusableSupersets(db);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
      // No orphan link rows from a partially-applied insert.
      const slots = await listSlotsForSuperset(db, id);
      expect(slots).toHaveLength(2);
    });
  });

  describe('listReusableSupersets ordering', () => {
    it('sorts by use_count DESC, updated_at DESC', async () => {
      // Distinct exercise pairs per RS — insertReusableSuperset rejects
      // duplicate pairs (#26); ordering only cares about use_count/updated_at.
      // a: use_count=0, updated_at=1000
      const a = await insertReusableSuperset(
        db,
        draft({ name: 'A', exercise_ids: [BENCH, ROW] }),
        uuid,
        () => 1000
      );
      // b: use_count=2, updated_at=2000
      const b = await insertReusableSuperset(
        db,
        draft({ name: 'B', exercise_ids: [BENCH, SQUAT] }),
        uuid,
        () => 2000
      );
      // c: use_count=2, updated_at=3000
      const c = await insertReusableSuperset(
        db,
        draft({ name: 'C', exercise_ids: [BENCH, DEADLIFT] }),
        uuid,
        () => 3000
      );
      await incrementUseCount(db, b, () => 2000);
      await incrementUseCount(db, b, () => 2000);
      await incrementUseCount(db, c, () => 3000);
      await incrementUseCount(db, c, () => 3000);

      const list = await listReusableSupersets(db);
      // C (use_count=2, updated_at=3000) → B (use_count=2, updated_at=2000) → A
      expect(list.map((s) => s.name)).toEqual(['C', 'B', 'A']);
      void a;
    });
  });

  describe('listReusableSupersetsWithExercises', () => {
    it('hydrates exercises in position order', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, now);
      const hydrated = await listReusableSupersetsWithExercises(db);
      expect(hydrated).toHaveLength(1);
      expect(hydrated[0].superset.id).toBe(id);
      expect(hydrated[0].exercises.map((e) => e.id)).toEqual([BENCH, ROW]);
      // Hydrated exercise columns reflect v010 additions
      expect(typeof hydrated[0].exercises[0].equipment).toBe('string');
    });

    it('returns empty array when no supersets exist', async () => {
      const hydrated = await listReusableSupersetsWithExercises(db);
      expect(hydrated).toEqual([]);
    });
  });

  describe('getReusableSupersetWithExercises', () => {
    it('returns null when not found', async () => {
      expect(await getReusableSupersetWithExercises(db, 'missing')).toBeNull();
    });

    it('hydrates by id', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, now);
      const got = await getReusableSupersetWithExercises(db, id);
      expect(got).not.toBeNull();
      expect(got!.exercises.map((e) => e.id)).toEqual([BENCH, ROW]);
    });
  });

  describe('updates', () => {
    it('updateReusableSupersetName trims + bumps updated_at', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, () => 1000);
      await updateReusableSupersetName(db, id, '  Push Pull  ', () => 2000);
      const got = await getReusableSupersetWithExercises(db, id);
      expect(got!.superset.name).toBe('Push Pull');
      expect(got!.superset.updated_at).toBe(2000);
    });

    it('incrementUseCount bumps both counter + updated_at', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, () => 1000);
      await incrementUseCount(db, id, () => 2000);
      await incrementUseCount(db, id, () => 3000);
      const got = await getReusableSupersetWithExercises(db, id);
      expect(got!.superset.use_count).toBe(2);
      expect(got!.superset.updated_at).toBe(3000);
    });
  });

  describe('deleteReusableSuperset', () => {
    it('cascades to superset_exercise rows', async () => {
      await db.execAsync(`PRAGMA foreign_keys = ON`);
      const id = await insertReusableSuperset(db, draft(), uuid, now);
      await deleteReusableSuperset(db, id);
      expect(await listReusableSupersets(db)).toEqual([]);
      expect(await listSlotsForSuperset(db, id)).toEqual([]);
    });

    it('does NOT affect other supersets sharing one exercise', async () => {
      const a = await insertReusableSuperset(
        db,
        draft({ name: 'A', exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      const b = await insertReusableSuperset(
        db,
        draft({ name: 'B', exercise_ids: [BENCH, SQUAT] }),
        uuid,
        now
      );
      await deleteReusableSuperset(db, a);
      const remaining = await listReusableSupersets(db);
      expect(remaining.map((s) => s.id)).toEqual([b]);
      expect((await listSlotsForSuperset(db, b)).map((s) => s.exercise_id)).toEqual([
        BENCH,
        SQUAT,
      ]);
    });
  });

  /**
   * Slice 10c overnight #24 — dynamic "N 次" badge for the RS template card.
   * "N 次" = count of ended sessions that recorded at least one logged
   * (is_logged=1, is_skipped=0) set against a session_exercise carrying
   * `reusable_superset_id = this RS template`.
   */
  describe('getReusableSupersetSessionCount / Counts (#24)', () => {
    async function seedRsSession(args: {
      session_id: string;
      session_exercise_id_a: string;
      session_exercise_id_b: string;
      rs_id: string;
      set_id_a: string;
      set_id_b: string;
      started_at: number;
      ended_at: number | null;
      a_is_logged: 0 | 1;
      b_is_logged: 0 | 1;
    }): Promise<void> {
      await createSession(db, {
        id: args.session_id,
        started_at: args.started_at,
      });
      // A side
      await insertSessionExercise(db, {
        id: args.session_exercise_id_a,
        session_id: args.session_id,
        exercise_id: BENCH,
        ordering: 0,
        planned_sets: 3,
        planned_reps: null,
        planned_weight_kg: null,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: args.rs_id,
      });
      // B side (parent points back to A)
      await insertSessionExercise(db, {
        id: args.session_exercise_id_b,
        session_id: args.session_id,
        exercise_id: ROW,
        ordering: 1,
        planned_sets: 3,
        planned_reps: null,
        planned_weight_kg: null,
        template_id: null,
        is_evergreen: 0,
        parent_id: args.session_exercise_id_a,
        reusable_superset_id: args.rs_id,
      });
      // One set per side, session_exercise_id wired through
      await insertSessionSet(db, {
        id: args.set_id_a,
        session_id: args.session_id,
        exercise_id: BENCH,
        weight_kg: 80,
        reps: 10,
        is_skipped: 0,
        ordering: 1,
        created_at: args.started_at + 1,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: args.session_exercise_id_a,
      });
      await insertSessionSet(db, {
        id: args.set_id_b,
        session_id: args.session_id,
        exercise_id: ROW,
        weight_kg: 60,
        reps: 12,
        is_skipped: 0,
        ordering: 2,
        created_at: args.started_at + 2,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: args.session_exercise_id_b,
      });
      if (args.a_is_logged === 1) {
        await db.runAsync(
          `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
          args.set_id_a
        );
      }
      if (args.b_is_logged === 1) {
        await db.runAsync(
          `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
          args.set_id_b
        );
      }
      if (args.ended_at !== null) {
        await endSession(db, { id: args.session_id, ended_at: args.ended_at });
      }
    }

    it('counts an ended session with A+B logged sets as 1', async () => {
      const rsId = await insertReusableSuperset(db, draft(), uuid, now);
      await seedRsSession({
        session_id: 'sess-1',
        session_exercise_id_a: 'se-1a',
        session_exercise_id_b: 'se-1b',
        rs_id: rsId,
        set_id_a: 's-1a',
        set_id_b: 's-1b',
        started_at: 10_000,
        ended_at: 11_000,
        a_is_logged: 1,
        b_is_logged: 1,
      });
      expect(await getReusableSupersetSessionCount(db, rsId)).toBe(1);
      const map = await getReusableSupersetSessionCounts(db);
      expect(map.get(rsId)).toBe(1);
    });

    it('does NOT count an active (ended_at IS NULL) session even when sets logged', async () => {
      const rsId = await insertReusableSuperset(db, draft(), uuid, now);
      await seedRsSession({
        session_id: 'sess-active',
        session_exercise_id_a: 'se-a-a',
        session_exercise_id_b: 'se-a-b',
        rs_id: rsId,
        set_id_a: 's-a-a',
        set_id_b: 's-a-b',
        started_at: 10_000,
        ended_at: null,
        a_is_logged: 1,
        b_is_logged: 1,
      });
      expect(await getReusableSupersetSessionCount(db, rsId)).toBe(0);
      const map = await getReusableSupersetSessionCounts(db);
      expect(map.has(rsId)).toBe(false);
    });

    it('does NOT count an ended session whose sets are all is_logged=0', async () => {
      const rsId = await insertReusableSuperset(db, draft(), uuid, now);
      await seedRsSession({
        session_id: 'sess-unticked',
        session_exercise_id_a: 'se-u-a',
        session_exercise_id_b: 'se-u-b',
        rs_id: rsId,
        set_id_a: 's-u-a',
        set_id_b: 's-u-b',
        started_at: 10_000,
        ended_at: 11_000,
        a_is_logged: 0,
        b_is_logged: 0,
      });
      expect(await getReusableSupersetSessionCount(db, rsId)).toBe(0);
      const map = await getReusableSupersetSessionCounts(db);
      expect(map.has(rsId)).toBe(false);
    });

    it('counts 2 distinct ended sessions using the same RS template as 2', async () => {
      const rsId = await insertReusableSuperset(db, draft(), uuid, now);
      await seedRsSession({
        session_id: 'sess-1',
        session_exercise_id_a: 'se-1a',
        session_exercise_id_b: 'se-1b',
        rs_id: rsId,
        set_id_a: 's-1a',
        set_id_b: 's-1b',
        started_at: 10_000,
        ended_at: 11_000,
        a_is_logged: 1,
        b_is_logged: 1,
      });
      await seedRsSession({
        session_id: 'sess-2',
        session_exercise_id_a: 'se-2a',
        session_exercise_id_b: 'se-2b',
        rs_id: rsId,
        set_id_a: 's-2a',
        set_id_b: 's-2b',
        started_at: 20_000,
        ended_at: 21_000,
        a_is_logged: 1,
        b_is_logged: 0, // only A logged — session still counts (DISTINCT session_id)
      });
      expect(await getReusableSupersetSessionCount(db, rsId)).toBe(2);
      const map = await getReusableSupersetSessionCounts(db);
      expect(map.get(rsId)).toBe(2);
    });

    it('batch variant scopes counts per-RS (different templates do not bleed)', async () => {
      // Two distinct RS templates — different pairs since insertReusableSuperset
      // now rejects duplicate-pair inserts.
      const rsA = await insertReusableSuperset(
        db,
        draft({ name: 'A', exercise_ids: [BENCH, ROW] }),
        uuid,
        now
      );
      const rsB = await insertReusableSuperset(
        db,
        draft({ name: 'B', exercise_ids: [BENCH, SQUAT] }),
        uuid,
        now
      );
      await seedRsSession({
        session_id: 'sess-A',
        session_exercise_id_a: 'se-A-a',
        session_exercise_id_b: 'se-A-b',
        rs_id: rsA,
        set_id_a: 's-A-a',
        set_id_b: 's-A-b',
        started_at: 10_000,
        ended_at: 11_000,
        a_is_logged: 1,
        b_is_logged: 1,
      });
      const map = await getReusableSupersetSessionCounts(db);
      expect(map.get(rsA)).toBe(1);
      expect(map.has(rsB)).toBe(false);
      expect(await getReusableSupersetSessionCount(db, rsB)).toBe(0);
    });
  });
});
