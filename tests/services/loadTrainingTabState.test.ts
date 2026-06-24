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
 * `loadTrainingTabState` — report 09 #3 extraction of the Training tab's
 * `refresh()` query fan-out + derivation. Previously closure-trapped in
 * app/(tabs)/index.tsx (untestable); now asserted against a fixture DB.
 */
describe('loadTrainingTabState', () => {
  let db: BetterSqliteDatabase;
  const exId = '00000000-0000-4000-8000-000000000001'; // v002 seeded exercise
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('idle (no active session): session-scoped fields empty, base fields populated', async () => {
    const s = await loadTrainingTabState(db, { now: () => now });

    // No active session → everything session-scoped is its empty value.
    expect(s.activeSession).toBeNull();
    expect(s.setsInSession).toEqual([]);
    expect(s.plan).toEqual([]);
    expect(s.prSnapshotById).toEqual({});
    expect(s.bwSnapshotKg).toBeNull();
    expect(s.sessionTitle).toBe('');
    // No active program seeded (v017 None program is_active=0) → null cell.
    expect(s.programCellToday).toBeNull();
    expect(s.activeProgram).toBeNull();

    // Base reads still happen unconditionally.
    expect(s.exercises.length).toBeGreaterThan(0); // v002 seed
    expect(s.unit).toBe('kg');
    expect(s.autoPopupTimer).toBe(true); // getAutoPopupRestTimer defaults ON
    expect(s.templatesById).toEqual({});
  });

  it('active session: returns sets / plan / title / bw + per-exercise PR snapshot', async () => {
    const sessionId = 'sess-active';
    await createSession(db, {
      id: sessionId,
      started_at: now,
      bodyweight_snapshot_kg: 70,
      title: 'Leg Day',
    });
    const seId = 'se-1';
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: exId,
      ordering: 1,
      planned_sets: 3,
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
    // PR snapshot only counts logged sets.
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, sessionId);

    const s = await loadTrainingTabState(db, { now: () => now });

    expect(s.activeSession?.id).toBe(sessionId);
    expect(s.sessionTitle).toBe('Leg Day');
    expect(s.bwSnapshotKg).toBe(70);
    expect(s.plan).toHaveLength(1);
    expect(s.plan[0].exercise_id).toBe(exId);
    expect(s.setsInSession).toHaveLength(1);
    expect(s.setsInSession[0].weight_kg).toBe(100);
    // PR snapshot fan-out keyed by planned exercise id.
    expect(s.prSnapshotById[exId]).toBeDefined();
    // Loaded exercise → effectiveLoad is identity, so the raw weight is the PR.
    expect(s.prSnapshotById[exId]?.topWeightSet?.weight_kg).toBe(100);
  });

  it('assisted exercise: PR ranks by effectiveLoad (bw − assist), excludes warmups', async () => {
    // 2026-06-25 audit 🟠 regression guard: for load_type='assisted', weight_kg
    // is the *assist* amount, so a higher raw weight = MORE help = LESS strength.
    // The Today PR card must rank by effectiveLoad (bw − assist) and exclude
    // warmups, matching the per-exercise history page.
    const assistedExId = '00000000-0000-4000-8000-0000000000bc'; // 引體向上（輔助）, v028 seed
    const sessionId = 'sess-assisted';
    await createSession(db, {
      id: sessionId,
      started_at: now,
      bodyweight_snapshot_kg: 80,
      title: 'Pull Day',
    });
    const seId = 'se-assist';
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: assistedExId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    const mkSet = (
      weight_kg: number,
      ordering: number,
      set_kind: 'working' | 'warmup',
    ) =>
      insertSessionSet(db, {
        id: randomUUID(),
        session_id: sessionId,
        exercise_id: assistedExId,
        weight_kg,
        reps: 8,
        is_skipped: 0,
        ordering,
        created_at: now,
        set_kind,
        parent_set_id: null,
        session_exercise_id: seId,
      });
    await mkSet(40, 1, 'working'); // eff = 80 − 40 = 40
    await mkSet(10, 2, 'working'); // eff = 80 − 10 = 70  (strongest)
    await mkSet(5, 3, 'warmup'); //  eff = 75 — MUST be excluded (warmup)
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, sessionId);

    const s = await loadTrainingTabState(db, { now: () => now });
    const snap = s.prSnapshotById[assistedExId];

    // Strongest = least-assisted working set (eff 70), NOT the most-assisted
    // (eff 40) and NOT the warmup (eff 75 — excluded).
    expect(snap?.topWeightSet?.weight_kg).toBe(70);
    // Volume PR uses effectiveLoad too: 70 × 8 = 560 (not raw assist×reps).
    expect(snap?.volumePR).toBe(560);
  });

  it('clears prior session state when no session is active (no orphan carry-over)', async () => {
    // Sanity: two calls on the same idle DB are stable + empty (the else-branch
    // resets, mirroring the screen clearing stale state when a session ends).
    const a = await loadTrainingTabState(db, { now: () => now });
    const b = await loadTrainingTabState(db, { now: () => now });
    expect(a.plan).toEqual([]);
    expect(b.plan).toEqual([]);
    expect(b.prSnapshotById).toEqual({});
  });
});
