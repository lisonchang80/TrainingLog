import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
  insertSessionExercise,
  listSessionExercisesWithName,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertReusableSuperset,
} from '../../src/adapters/sqlite/supersetRepository';

/**
 * Cluster RS color threading — slice 10c overnight 第 2 點.
 *
 * `listSessionExercisesWithName` LEFT JOINs `superset` so the cluster card
 * can render its left accent bar in the RS's color (per ADR-0019 Q8 (c) H1).
 *
 * Coverage:
 *   - Cluster session (RS-explode via `appendReusableSupersetToSession`)
 *     surfaces `reusable_superset_color_hex` on BOTH A and B rows.
 *   - Solo session_exercise rows (no reusable_superset_id) return NULL color.
 *   - When the source RS has `color_hex = NULL` (manual / no color picked),
 *     both cluster rows still come back from the LEFT JOIN with NULL color
 *     (verifies LEFT JOIN doesn't drop rows and the column propagates).
 */

const BENCH = '00000000-0000-4000-8000-000000000001'; // Bench Press (v001/v002 seed)
const SQUAT = '00000000-0000-4000-8000-000000000002'; // Back Squat
const ROW = '00000000-0000-4000-8000-000000000005'; // Bent-over Row

describe('cluster RS color threading via listSessionExercisesWithName', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-color-test';
  const now = 1700000000000;
  let uuidCounter = 0;
  const uuid = () => `uid-${++uuidCounter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('cluster rows carry the source RS color_hex on both A and B sides', async () => {
    const rsId = await insertReusableSuperset(
      db,
      { name: 'Bench + Squat', color_hex: '#34c759', exercise_ids: [BENCH, SQUAT] },
      uuid,
      () => now,
    );
    await appendReusableSupersetToSession(db, {
      session_id: sessionId,
      reusable_superset_id: rsId,
      uuid,
    });

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0].parent_id).toBeNull(); // A side
    expect(rows[0].reusable_superset_id).toBe(rsId);
    expect(rows[0].reusable_superset_color_hex).toBe('#34c759');
    expect(rows[1].parent_id).toBe(rows[0].id); // B follower
    expect(rows[1].reusable_superset_id).toBe(rsId);
    expect(rows[1].reusable_superset_color_hex).toBe('#34c759');
  });

  it('solo session_exercise rows have NULL color_hex', async () => {
    await insertSessionExercise(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: BENCH,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reusable_superset_id).toBeNull();
    expect(rows[0].reusable_superset_color_hex).toBeNull();
  });

  it('cluster from RS with NULL color still returns both rows (LEFT JOIN safety)', async () => {
    const rsId = await insertReusableSuperset(
      db,
      { name: 'No-color RS', color_hex: null, exercise_ids: [BENCH, ROW] },
      uuid,
      () => now,
    );
    await appendReusableSupersetToSession(db, {
      session_id: sessionId,
      reusable_superset_id: rsId,
      uuid,
    });

    const rows = await listSessionExercisesWithName(db, sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0].reusable_superset_color_hex).toBeNull();
    expect(rows[1].reusable_superset_color_hex).toBeNull();
  });

});
