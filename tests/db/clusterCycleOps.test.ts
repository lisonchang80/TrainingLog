import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  addClusterCycleAtEnd,
  cloneClusterCycle,
  deleteClusterCycle,
  insertSessionSet,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Atomic cluster cycle ops (slice 10c cluster card drift fix —
 * mirror template editor's `deleteSupersetRowAt` / `cloneSupersetRowAt` /
 * `addSetToSuperset` for in-session cluster cards).
 *
 * Coverage:
 *   - deleteClusterCycle: both sides deleted atomically; asymmetric (one null)
 *     ok; unknown id no-op
 *   - cloneClusterCycle: weight/reps/set_kind copied from source; is_logged
 *     reset to 0; ordering = MAX+1 per exercise
 *   - addClusterCycleAtEnd: new pair inserted with caller-supplied defaults;
 *     ordering MAX+1 per side
 */

describe('Atomic cluster cycle ops', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat
  const sessionId = 'sess-cyc';
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertSet(
    id: string,
    exercise_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    is_logged: 0 | 1 = 0,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
    });
    if (is_logged === 1) {
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, id);
    }
  }

  // ── deleteClusterCycle ──────────────────────────────────────────────────────

  describe('deleteClusterCycle', () => {
    it('deletes both A and B set in one transaction', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('b1', exB, 1, 60, 8);
      await insertSet('a2', exA, 2, 85, 5);
      await insertSet('b2', exB, 2, 60, 8);

      await deleteClusterCycle(db, { a_set_id: 'a1', b_set_id: 'b1' });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows.map((r) => r.id).sort()).toEqual(['a2', 'b2']);
    });

    it('asymmetric short side: b_set_id null → only A is deleted', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('a2', exA, 2, 85, 5);
      await insertSet('b1', exB, 1, 60, 8);

      await deleteClusterCycle(db, { a_set_id: 'a2', b_set_id: null });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows.map((r) => r.id).sort()).toEqual(['a1', 'b1']);
    });

    it('both ids null → no-op (zero rows touched)', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('b1', exB, 1, 60, 8);

      await deleteClusterCycle(db, { a_set_id: null, b_set_id: null });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows).toHaveLength(2);
    });

    it('unknown id is silent no-op (matches SQLite DELETE semantics)', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('b1', exB, 1, 60, 8);

      await deleteClusterCycle(db, {
        a_set_id: 'nonexistent',
        b_set_id: 'b1',
      });

      const rows = await listSetsBySession(db, sessionId);
      // a1 still there; b1 gone
      expect(rows.map((r) => r.id).sort()).toEqual(['a1']);
    });
  });

  // ── cloneClusterCycle ───────────────────────────────────────────────────────

  describe('cloneClusterCycle', () => {
    it('copies weight/reps from source pair; is_logged reset to 0 on new rows', async () => {
      await insertSet('a1', exA, 1, 80, 5, 1); // logged source
      await insertSet('b1', exB, 1, 60, 8, 1);

      await cloneClusterCycle(db, {
        a_source: { id: 'a1', exercise_id: exA },
        b_source: { id: 'b1', exercise_id: exB },
        session_id: sessionId,
        new_a_set_id: 'a2',
        new_b_set_id: 'b2',
      });

      const rows = await listSetsBySession(db, sessionId);
      const a2 = rows.find((r) => r.id === 'a2');
      const b2 = rows.find((r) => r.id === 'b2');
      expect(a2?.weight_kg).toBe(80);
      expect(a2?.reps).toBe(5);
      expect(a2?.is_logged).toBe(0);
      expect(b2?.weight_kg).toBe(60);
      expect(b2?.reps).toBe(8);
      expect(b2?.is_logged).toBe(0);
    });

    it('new ordering is MAX(existing per exercise) + 1', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('a2', exA, 2, 85, 5);
      await insertSet('b1', exB, 1, 60, 8);

      await cloneClusterCycle(db, {
        a_source: { id: 'a2', exercise_id: exA },
        b_source: { id: 'b1', exercise_id: exB },
        session_id: sessionId,
        new_a_set_id: 'a3',
        new_b_set_id: 'b2',
      });

      const rows = await listSetsBySession(db, sessionId);
      const a3 = rows.find((r) => r.id === 'a3');
      const b2 = rows.find((r) => r.id === 'b2');
      expect(a3?.ordering).toBe(3);
      expect(b2?.ordering).toBe(2);
    });

    it('asymmetric clone: b_source null → only A side inserted', async () => {
      await insertSet('a1', exA, 1, 80, 5);

      await cloneClusterCycle(db, {
        a_source: { id: 'a1', exercise_id: exA },
        b_source: null,
        session_id: sessionId,
        new_a_set_id: 'a2',
        new_b_set_id: 'b1-unused',
      });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    });

    it('source not found → silent no-op on that side (defensive)', async () => {
      await insertSet('a1', exA, 1, 80, 5);

      await cloneClusterCycle(db, {
        a_source: { id: 'a1', exercise_id: exA },
        b_source: { id: 'b-nonexistent', exercise_id: exB },
        session_id: sessionId,
        new_a_set_id: 'a2',
        new_b_set_id: 'b2',
      });

      const rows = await listSetsBySession(db, sessionId);
      // a2 inserted, b2 silently skipped
      expect(rows.map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    });
  });

  // ── addClusterCycleAtEnd ────────────────────────────────────────────────────

  describe('addClusterCycleAtEnd', () => {
    it('inserts new A+B pair with caller-supplied defaults; ordering MAX+1', async () => {
      await insertSet('a1', exA, 1, 80, 5);
      await insertSet('a2', exA, 2, 85, 5);
      await insertSet('b1', exB, 1, 60, 8);

      await addClusterCycleAtEnd(db, {
        session_id: sessionId,
        a: { exercise_id: exA, new_set_id: 'a3', weight_kg: 90, reps: 5 },
        b: { exercise_id: exB, new_set_id: 'b2', weight_kg: 65, reps: 8 },
      });

      const rows = await listSetsBySession(db, sessionId);
      const a3 = rows.find((r) => r.id === 'a3');
      const b2 = rows.find((r) => r.id === 'b2');
      expect(a3?.ordering).toBe(3);
      expect(a3?.weight_kg).toBe(90);
      expect(a3?.reps).toBe(5);
      expect(b2?.ordering).toBe(2);
      expect(b2?.weight_kg).toBe(65);
      expect(b2?.reps).toBe(8);
    });

    it('new rows default to is_logged=0 and set_kind=working', async () => {
      await addClusterCycleAtEnd(db, {
        session_id: sessionId,
        a: { exercise_id: exA, new_set_id: 'a1', weight_kg: 80, reps: 5 },
        b: { exercise_id: exB, new_set_id: 'b1', weight_kg: 60, reps: 8 },
      });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows.every((r) => r.is_logged === 0)).toBe(true);
      expect(rows.every((r) => r.set_kind === 'working')).toBe(true);
    });

    it('respects custom set_kind when caller passes it (e.g. warmup)', async () => {
      await addClusterCycleAtEnd(db, {
        session_id: sessionId,
        a: { exercise_id: exA, new_set_id: 'a1', weight_kg: 40, reps: 12 },
        b: { exercise_id: exB, new_set_id: 'b1', weight_kg: 30, reps: 12 },
        set_kind: 'warmup',
      });

      const rows = await listSetsBySession(db, sessionId);
      expect(rows.every((r) => r.set_kind === 'warmup')).toBe(true);
    });
  });
});
