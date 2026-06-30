import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { loadTrainingTabState } from '../../src/services/loadTrainingTabState';

/**
 * Edge / branch coverage for `src/services/loadTrainingTabState.ts`.
 *
 * The base suite (`loadTrainingTabState.test.ts`) covers the idle/active happy
 * paths + assisted-effectiveLoad ranking; this one pins the remaining defensive
 * PR-filter branches and the production `Date.now` default:
 *   - `opts?.now ?? Date.now` default (call with no opts)        — line 78
 *   - a set with null reps is dropped from the PR input          — line 138
 *   - an over-assisted set (eff ≤ 0, assist ≥ bw) is dropped      — line 141
 * Mirrors the base suite's fixture builders (createSession / insertSessionExercise
 * / insertSessionSet on an in-memory better-sqlite3 DB).
 */
describe('loadTrainingTabState — branch edges', () => {
  let db: BetterSqliteDatabase;
  const exId = '00000000-0000-4000-8000-000000000001'; // v002 seeded exercise
  const assistedExId = '00000000-0000-4000-8000-0000000000bc'; // v028 assisted seed
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('uses Date.now by default when no `now` injector is passed', async () => {
    // No active program seeded → programCellToday is null regardless of the
    // clock, but the call must not throw when `opts` is omitted (the
    // `opts?.now ?? Date.now` default-branch is exercised).
    const s = await loadTrainingTabState(db);
    expect(s.programCellToday).toBeNull();
    expect(s.exercises.length).toBeGreaterThan(0);
    expect(s.activeSession).toBeNull();
  });

  it('drops a working set with null reps from the PR input', async () => {
    const sessionId = 'sess-nullreps';
    await createSession(db, {
      id: sessionId,
      started_at: now,
      bodyweight_snapshot_kg: 70,
      title: 'Null reps',
    });
    const seId = 'se-null';
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: exId,
      ordering: 1,
      planned_sets: 2,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    // One valid set + one with null reps (should be ignored by the PR fan-out).
    await insertSessionSet(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: exId,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    await insertSessionSet(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: exId,
      weight_kg: 200, // heavier, but null reps → not a PR candidate
      reps: null,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, sessionId);

    const s = await loadTrainingTabState(db, { now: () => now });
    // The null-reps set (200kg) is excluded → top weight is the 100kg set.
    expect(s.prSnapshotById[exId]?.topWeightSet?.weight_kg).toBe(100);
  });

  it('null bw snapshot + null title: fields fall back to null/empty and assisted PR is dropped (eff null)', async () => {
    // A session with NO bodyweight snapshot and NO title exercises the
    // `?? null` (bwSnapshotKg) + `?? ''` (sessionTitle) fallbacks, and makes an
    // assisted set non-rankable (effectiveLoad returns null without a snapshot).
    const sessionId = 'sess-nobw';
    await createSession(db, {
      id: sessionId,
      started_at: now,
      bodyweight_snapshot_kg: null,
      // title omitted → stored NULL → exercises the `?? ''` fallback.
    });
    const seId = 'se-nobw';
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: assistedExId,
      ordering: 1,
      planned_sets: 1,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionSet(db, {
      id: randomUUID(),
      session_id: sessionId,
      exercise_id: assistedExId,
      weight_kg: 20,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, sessionId);

    const s = await loadTrainingTabState(db, { now: () => now });
    expect(s.bwSnapshotKg).toBeNull();
    expect(s.sessionTitle).toBe('');
    // assisted + no bw snapshot → effectiveLoad null → no PR candidate.
    expect(s.prSnapshotById[assistedExId]?.topWeightSet).toBeNull();
  });

  it('drops an over-assisted set whose effective load is ≤ 0', async () => {
    const sessionId = 'sess-overassist';
    await createSession(db, {
      id: sessionId,
      started_at: now,
      bodyweight_snapshot_kg: 80,
      title: 'Over-assisted',
    });
    const seId = 'se-over';
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: assistedExId,
      ordering: 1,
      planned_sets: 2,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    const mkSet = (weight_kg: number, ordering: number) =>
      insertSessionSet(db, {
        id: randomUUID(),
        session_id: sessionId,
        exercise_id: assistedExId,
        weight_kg,
        reps: 8,
        is_skipped: 0,
        ordering,
        created_at: now,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: seId,
      });
    // bw snapshot = 80.
    await mkSet(30, 1); // eff = 80 − 30 = 50 (valid, strongest)
    await mkSet(80, 2); // eff = 80 − 80 = 0  → eff ≤ 0 → MUST be dropped
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, sessionId);

    const s = await loadTrainingTabState(db, { now: () => now });
    const snap = s.prSnapshotById[assistedExId];
    // Only the eff=50 set survives; the over-assisted eff=0 set is excluded.
    expect(snap?.topWeightSet?.weight_kg).toBe(50);
    expect(snap?.volumePR).toBe(400); // 50 × 8
  });
});
