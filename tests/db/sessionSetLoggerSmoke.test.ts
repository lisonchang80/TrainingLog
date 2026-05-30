import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  deleteSet,
  insertSessionSet,
  listSetsBySession,
  recordSetInSession,
  updateSetFields,
} from '../../src/adapters/sqlite/setRepository';
import { cycleSessionSetKind } from '../../src/domain/set/cycleSessionSetKind';
import { computeSetLabels } from '../../src/domain/set/setLabels';

/**
 * Slice 10c Phase 2 commit 10 — integration smoke test.
 *
 * Exercises the full session set logger flow at the DB + domain layer:
 *   - record sets via recordSetInSession
 *   - read back via listSetsBySession (with v015/v018 columns surfaced)
 *   - cycle set_kind: working → warmup → dropset (+ follower insert)
 *   - cycle back: dropset head → working (+ follower delete)
 *   - update weight/reps via updateSetFields
 *   - update notes (v018)
 *   - toggle is_logged
 *   - delete a set via deleteSet
 *   - computeSetLabels produces correct labels at each stage
 *
 * Mirrors what the UI does end-to-end so we can catch wiring bugs without
 * a real RN integration test (which jest + node env can't run anyway).
 */
describe('session set logger — DB + domain smoke', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-1';
  const now = Date.now();
  let counter = 0;
  const uuid = () => `set-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    counter = 0;
  });

  afterEach(() => {
    db.close();
  });

  async function listForExercise(exId: string) {
    const all = await listSetsBySession(db, sessionId);
    return all.filter((s) => s.exercise_id === exId);
  }

  it('records two working sets and labels them as "1", "2"', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 70, reps: 8 },
      uuid,
    });
    const sets = await listForExercise(benchId);
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.set_kind)).toEqual(['working', 'working']);
    expect(sets.map((s) => s.is_logged)).toEqual([0, 0]);
    const labels = computeSetLabels(
      sets.map((s) => ({ kind: s.set_kind, parent_set_id: s.parent_set_id })),
    );
    expect(labels).toEqual(['1', '2']);
  });

  it('cycle working → warmup updates kind, labels reflect 熱', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    let sets = await listForExercise(benchId);
    const targetId = sets[0].id;
    // Apply the op manually as the UI handler does
    const ops = cycleSessionSetKind(
      sets.map((s) => ({
        id: s.id,
        set_kind: s.set_kind,
        parent_set_id: s.parent_set_id,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
      targetId,
      uuid(),
    );
    for (const op of ops) {
      if (op.type === 'update') {
        await updateSetFields(db, op.set_id, op.patch);
      }
    }
    sets = await listForExercise(benchId);
    expect(sets[0].set_kind).toBe('warmup');
    const labels = computeSetLabels(
      sets.map((s) => ({ kind: s.set_kind, parent_set_id: s.parent_set_id })),
    );
    expect(labels).toEqual(['熱']);
  });

  it('cycle warmup → dropset inserts follower with same reps/weight', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    let sets = await listForExercise(benchId);
    const headId = sets[0].id;
    // Pre-cycle: working → warmup
    await updateSetFields(db, headId, { set_kind: 'warmup' });
    sets = await listForExercise(benchId);
    expect(sets[0].set_kind).toBe('warmup');

    // Now cycle warmup → dropset
    const ops = cycleSessionSetKind(
      sets.map((s) => ({
        id: s.id,
        set_kind: s.set_kind,
        parent_set_id: s.parent_set_id,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
      headId,
      'new-follower-1',
    );
    let appendOffset = 1;
    const maxOrdering = Math.max(...sets.map((s) => s.ordering), 0);
    for (const op of ops) {
      if (op.type === 'update') {
        await updateSetFields(db, op.set_id, op.patch);
      } else if (op.type === 'insertFollower') {
        await insertSessionSet(db, {
          id: op.new_set_id,
          session_id: sessionId,
          exercise_id: benchId,
          weight_kg: op.weight_kg,
          reps: op.reps,
          is_skipped: 0,
          ordering: maxOrdering + appendOffset,
          created_at: now + 1,
          set_kind: 'dropset',
          parent_set_id: op.parent_set_id,
        });
        appendOffset += 1;
      }
    }

    sets = await listForExercise(benchId);
    expect(sets).toHaveLength(2);
    expect(sets[0].set_kind).toBe('dropset');
    expect(sets[0].parent_set_id).toBeNull();
    expect(sets[1].set_kind).toBe('dropset');
    expect(sets[1].parent_set_id).toBe(headId);
    expect(sets[1].reps).toBe(10);
    expect(sets[1].weight_kg).toBe(60);
    const labels = computeSetLabels(
      sets.map((s) => ({ kind: s.set_kind, parent_set_id: s.parent_set_id })),
    );
    expect(labels).toEqual(['D1', '']);
  });

  it('cycle dropset head → working cascades follower delete', async () => {
    // Set up dropset cluster: head + 2 followers
    await insertSessionSet(db, {
      id: 'head',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'f1',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 45,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: 'head',
    });
    await insertSessionSet(db, {
      id: 'f2',
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: 30,
      reps: 6,
      is_skipped: 0,
      ordering: 3,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: 'head',
    });

    let sets = await listForExercise(benchId);
    const ops = cycleSessionSetKind(
      sets.map((s) => ({
        id: s.id,
        set_kind: s.set_kind,
        parent_set_id: s.parent_set_id,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
      'head',
      'unused',
    );
    for (const op of ops) {
      if (op.type === 'update') {
        await updateSetFields(db, op.set_id, op.patch);
      } else if (op.type === 'delete') {
        await deleteSet(db, op.set_id);
      }
    }

    sets = await listForExercise(benchId);
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe('head');
    expect(sets[0].set_kind).toBe('working');
    expect(sets[0].parent_set_id).toBeNull();
  });

  it('updateSetFields persists weight / reps / notes / is_logged independently', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    let sets = await listForExercise(benchId);
    const id = sets[0].id;

    await updateSetFields(db, id, { weight_kg: 65 });
    sets = await listForExercise(benchId);
    expect(sets[0].weight_kg).toBe(65);
    expect(sets[0].reps).toBe(10); // unchanged

    await updateSetFields(db, id, { reps: 12 });
    sets = await listForExercise(benchId);
    expect(sets[0].reps).toBe(12);

    await updateSetFields(db, id, { notes: 'felt good' });
    sets = await listForExercise(benchId);
    expect(sets[0].notes).toBe('felt good');

    await updateSetFields(db, id, { is_logged: 1 });
    sets = await listForExercise(benchId);
    expect(sets[0].is_logged).toBe(1);

    // Clearing notes back to NULL
    await updateSetFields(db, id, { notes: null });
    sets = await listForExercise(benchId);
    expect(sets[0].notes).toBeNull();
  });

  it('updateSetFields is a no-op when given an empty patch (no columns to set)', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    let sets = await listForExercise(benchId);
    const id = sets[0].id;

    // Empty patch — the early return guard must fire (no malformed
    // "UPDATE set SET  WHERE id = ?" SQL), leaving the row untouched.
    await expect(updateSetFields(db, id, {})).resolves.toBeUndefined();
    sets = await listForExercise(benchId);
    expect(sets[0].weight_kg).toBe(60);
    expect(sets[0].reps).toBe(10);
  });

  it('deleteSet hard-deletes the row', async () => {
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    let sets = await listForExercise(benchId);
    expect(sets).toHaveLength(1);
    await deleteSet(db, sets[0].id);
    sets = await listForExercise(benchId);
    expect(sets).toHaveLength(0);
  });

  it('end-to-end mixed sequence: warmup + working + working + dropset cluster', async () => {
    // Record 3 working sets
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 40, reps: 12 },
      uuid,
    });
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 60, reps: 10 },
      uuid,
    });
    await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: benchId, weight_kg: 70, reps: 8 },
      uuid,
    });

    // Cycle the first to warmup
    let sets = await listForExercise(benchId);
    await updateSetFields(db, sets[0].id, { set_kind: 'warmup' });

    // Cycle the last (now still working) to dropset (creates follower)
    sets = await listForExercise(benchId);
    const lastId = sets[2].id;
    const ops = cycleSessionSetKind(
      sets.map((s) => ({
        id: s.id,
        set_kind: s.set_kind,
        parent_set_id: s.parent_set_id,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
      lastId,
      'follower-1',
    );
    // To get to dropset from working we need TWO cycles (working → warmup
    // → dropset). For this smoke just simulate via direct update first
    // (since cycleSessionSetKind from working only goes to warmup).
    await updateSetFields(db, lastId, { set_kind: 'warmup' });
    sets = await listForExercise(benchId);
    const ops2 = cycleSessionSetKind(
      sets.map((s) => ({
        id: s.id,
        set_kind: s.set_kind,
        parent_set_id: s.parent_set_id,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
      lastId,
      'follower-1',
    );
    const maxOrdering = Math.max(...sets.map((s) => s.ordering), 0);
    let appendOffset = 1;
    for (const op of ops2) {
      if (op.type === 'update') {
        await updateSetFields(db, op.set_id, op.patch);
      } else if (op.type === 'insertFollower') {
        await insertSessionSet(db, {
          id: op.new_set_id,
          session_id: sessionId,
          exercise_id: benchId,
          weight_kg: op.weight_kg,
          reps: op.reps,
          is_skipped: 0,
          ordering: maxOrdering + appendOffset,
          created_at: now + 1,
          set_kind: 'dropset',
          parent_set_id: op.parent_set_id,
        });
        appendOffset += 1;
      }
    }
    // Reference ops just to keep the variable used.
    expect(ops.length).toBeGreaterThanOrEqual(1);

    sets = await listForExercise(benchId);
    expect(sets).toHaveLength(4); // 1 warmup + 1 working + dropset head + 1 follower
    const labels = computeSetLabels(
      sets.map((s) => ({ kind: s.set_kind, parent_set_id: s.parent_set_id })),
    );
    expect(labels).toEqual(['熱', '1', 'D1', '']);
  });
});
