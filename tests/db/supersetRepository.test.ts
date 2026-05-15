import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  deleteReusableSuperset,
  getReusableSupersetWithExercises,
  incrementUseCount,
  insertReusableSuperset,
  listReusableSupersets,
  listReusableSupersetsWithExercises,
  listSlotsForSuperset,
  updateReusableSupersetColor,
  updateReusableSupersetName,
} from '../../src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetDraft } from '../../src/domain/superset/supersetManager';

const BENCH = '00000000-0000-4000-8000-000000000001';
const ROW = '00000000-0000-4000-8000-000000000005';
const SQUAT = '00000000-0000-4000-8000-000000000002';

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

  describe('listReusableSupersets ordering', () => {
    it('sorts by use_count DESC, updated_at DESC', async () => {
      // a: use_count=0, updated_at=1000
      const a = await insertReusableSuperset(db, draft({ name: 'A' }), uuid, () => 1000);
      // b: use_count=2, updated_at=2000
      const b = await insertReusableSuperset(db, draft({ name: 'B' }), uuid, () => 2000);
      // c: use_count=2, updated_at=3000
      const c = await insertReusableSuperset(db, draft({ name: 'C' }), uuid, () => 3000);
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

    it('updateReusableSupersetColor accepts null', async () => {
      const id = await insertReusableSuperset(db, draft(), uuid, () => 1000);
      await updateReusableSupersetColor(db, id, null, () => 2000);
      const got = await getReusableSupersetWithExercises(db, id);
      expect(got!.superset.color_hex).toBeNull();
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
});
