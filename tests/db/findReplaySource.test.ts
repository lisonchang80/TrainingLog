import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  findSoloReplaySource,
  findClusterReplaySource,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * `findSoloReplaySource` / `findClusterReplaySource` — report 09 #6
 * (2026-06-20). Extracted from inline SELECTs in app/exercise-history/[id].tsx.
 *
 * #27 source isolation: resolve the source-side session_exercise CARD by shape
 * (parent_id / reusable_superset_id), NOT by exercise_id alone — a sibling
 * solo card sharing the same exercise_id in the same source session must not
 * be conflated with the RS A-side card.
 */
describe('find replay source cards', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'src-sess';
  // Real exercise ids from the v002 default seed (session_exercise.exercise_id
  // is FK-enforced against exercise(id)).
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(`INSERT INTO session (id, started_at) VALUES (?, ?)`, sessionId, 1700000000000);
    // session_exercise.reusable_superset_id FKs to superset(id) — seed the RS
    // template the cluster cards reference.
    await db.runAsync(
      `INSERT INTO superset (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'rs-1',
      'Test RS',
      1700000000000,
      1700000000000,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function mkSE(args: {
    id: string;
    exercise_id: string;
    ordering: number;
    parent_id?: string | null;
    reusable_superset_id?: string | null;
  }) {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen,
          parent_id, reusable_superset_id)
       VALUES (?, ?, ?, ?, 3, NULL, NULL, NULL, 0, ?, ?)`,
      args.id,
      sessionId,
      args.exercise_id,
      args.ordering,
      args.parent_id ?? null,
      args.reusable_superset_id ?? null,
    );
  }

  describe('findSoloReplaySource', () => {
    it('returns the solo card (parent_id NULL, reusable_superset_id NULL)', async () => {
      await mkSE({ id: 'solo-A', exercise_id: exA, ordering: 1 });
      const res = await findSoloReplaySource(db, {
        source_session_id: sessionId,
        exercise_id: exA,
      });
      expect(res?.id).toBe('solo-A');
    });

    it('ISOLATION: ignores an RS A-side card with the same exercise_id', async () => {
      // RS A-side card for exA (reusable_superset_id NOT NULL) — must NOT match.
      await mkSE({ id: 'rsA', exercise_id: exA, ordering: 1, reusable_superset_id: 'rs-1' });
      const res = await findSoloReplaySource(db, {
        source_session_id: sessionId,
        exercise_id: exA,
      });
      expect(res).toBeNull();
    });

    it('returns null when no solo card exists for the exercise', async () => {
      await mkSE({ id: 'solo-other', exercise_id: exB, ordering: 1 });
      const res = await findSoloReplaySource(db, {
        source_session_id: sessionId,
        exercise_id: exA,
      });
      expect(res).toBeNull();
    });
  });

  describe('findClusterReplaySource', () => {
    it('returns A (RS parent) + B (its follower by partner exercise_id)', async () => {
      await mkSE({ id: 'rsA', exercise_id: exA, ordering: 1, reusable_superset_id: 'rs-1' });
      await mkSE({ id: 'rsB', exercise_id: exB, ordering: 2, parent_id: 'rsA', reusable_superset_id: 'rs-1' });
      const res = await findClusterReplaySource(db, {
        source_session_id: sessionId,
        exercise_id_a: exA,
        exercise_id_b: exB,
      });
      expect(res.sourceA?.id).toBe('rsA');
      expect(res.sourceB?.id).toBe('rsB');
    });

    it('ISOLATION: A side skips a sibling solo card (reusable_superset_id NULL)', async () => {
      await mkSE({ id: 'solo-A', exercise_id: exA, ordering: 1 }); // solo, must be skipped
      await mkSE({ id: 'rsA', exercise_id: exA, ordering: 2, reusable_superset_id: 'rs-1' });
      await mkSE({ id: 'rsB', exercise_id: exB, ordering: 3, parent_id: 'rsA', reusable_superset_id: 'rs-1' });
      const res = await findClusterReplaySource(db, {
        source_session_id: sessionId,
        exercise_id_a: exA,
        exercise_id_b: exB,
      });
      expect(res.sourceA?.id).toBe('rsA');
      expect(res.sourceB?.id).toBe('rsB');
    });

    it('returns {null,null} when A side is missing (B never queried)', async () => {
      const res = await findClusterReplaySource(db, {
        source_session_id: sessionId,
        exercise_id_a: exA,
        exercise_id_b: exB,
      });
      expect(res.sourceA).toBeNull();
      expect(res.sourceB).toBeNull();
    });

    it('returns A but null B when the follower is absent', async () => {
      await mkSE({ id: 'rsA', exercise_id: exA, ordering: 1, reusable_superset_id: 'rs-1' });
      const res = await findClusterReplaySource(db, {
        source_session_id: sessionId,
        exercise_id_a: exA,
        exercise_id_b: exB,
      });
      expect(res.sourceA?.id).toBe('rsA');
      expect(res.sourceB).toBeNull();
    });
  });
});
