import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createSession } from '../../src/adapters/sqlite/sessionRepository';
import { insertSet, updateSetFields } from '../../src/adapters/sqlite/setRepository';
import {
  getExerciseHistoryHeader,
  listExerciseHistoryBySession,
  listExerciseHistorySets,
  queryExerciseHistory,
  listPriorSetsForExercise,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';

/**
 * Regression — slice 10c overnight #10.
 *
 * Bug: in-progress session's planned-but-unticked sets were bleeding into
 * the 動作歷史頁 / PR detection / 動作記憶 prefill because the SQL only
 * filtered `is_skipped=0` and not `is_logged=1`. Spec (user confirmed +
 * ADR-0019 Q16): `is_logged=1` is single source of truth for "this set
 * actually happened" — independent of session.ended_at.
 *
 * These tests assert the filter is in place across the three main query
 * shapes the user sees (session-grouped, flat, paginated) plus the
 * tap-✓ → un-tap reversibility behaviour.
 */
describe('exerciseHistoryRepository — is_logged filter (slice 10c #10)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const all = await listExercises(db);
    benchId = all.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => {
    db.close();
  });

  // Helper — mark a set as logged after insertSet (insertSet itself defaults
  // is_logged=0 so we explicitly flip when the test wants a "completed" row).
  async function markLogged(set_id: string): Promise<void> {
    await updateSetFields(db, set_id, { is_logged: 1 });
  }

  it('case 1: in one session, only logged sets appear; unlogged ones are filtered out', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });

    // Set #1: logged
    await insertSet(db, {
      id: 'set-logged',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_001,
    });
    await markLogged('set-logged');

    // Set #2: planned but not yet ticked (default is_logged=0)
    await insertSet(db, {
      id: 'set-unlogged',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering: 2,
      created_at: 1_002,
    });

    const grouped = await listExerciseHistoryBySession(db, benchId);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].session_id).toBe('sess-A');
    expect(grouped[0].sets).toHaveLength(1);
    expect(grouped[0].sets[0].set_id).toBe('set-logged');

    // Flat list — same expectation.
    const flat = await listExerciseHistorySets(db, benchId);
    expect(flat).toHaveLength(1);
    expect(flat[0].set_id).toBe('set-logged');

    // queryExerciseHistory (Function A — used by chart + detail page) — same.
    const fnA = await queryExerciseHistory(db, benchId);
    expect(fnA).toHaveLength(1);
    expect(fnA[0].set_id).toBe('set-logged');
  });

  it('case 2: a session whose every set is unlogged (planned-only) disappears entirely from history', async () => {
    // Past session — fully logged
    await createSession(db, { id: 'sess-past', started_at: 1_000 });
    await insertSet(db, {
      id: 'set-past',
      session_id: 'sess-past',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_001,
    });
    await markLogged('set-past');

    // Current in-progress session — 2 planned sets, neither ticked
    await createSession(db, { id: 'sess-now', started_at: 2_000 });
    await insertSet(db, {
      id: 'set-now-1',
      session_id: 'sess-now',
      exercise_id: benchId,
      weight_kg: 75,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 2_001,
    });
    await insertSet(db, {
      id: 'set-now-2',
      session_id: 'sess-now',
      exercise_id: benchId,
      weight_kg: 75,
      reps: 10,
      is_skipped: 0,
      ordering: 2,
      created_at: 2_002,
    });

    const grouped = await listExerciseHistoryBySession(db, benchId);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].session_id).toBe('sess-past');

    // listPriorSetsForExercise (prefill 動作記憶 / PR detection) must also
    // ignore the planned-only session — the "most recent" set should be the
    // logged one from sess-past, NOT the planned 75kg row from sess-now.
    const priors = await listPriorSetsForExercise(db, benchId, Date.now());
    expect(priors).toHaveLength(1);
    expect(priors[0].set_id).toBe('set-past');
    expect(priors[0].weight_kg).toBe(70);
  });

  it('case 4: getExerciseHistoryHeader aggregates exclude planned-only sessions', async () => {
    const NOW = 1_700_000_000_000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Old (30d ago) logged session — counts toward total but NOT 7d
    await createSession(db, {
      id: 'sess-old-logged',
      started_at: NOW - 30 * ONE_DAY_MS,
    });
    await insertSet(db, {
      id: 'set-old',
      session_id: 'sess-old-logged',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW - 30 * ONE_DAY_MS,
    });
    await markLogged('set-old');

    // Recent (2d ago) logged session — counts toward both
    await createSession(db, {
      id: 'sess-recent-logged',
      started_at: NOW - 2 * ONE_DAY_MS,
    });
    await insertSet(db, {
      id: 'set-recent',
      session_id: 'sess-recent-logged',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW - 2 * ONE_DAY_MS,
    });
    await markLogged('set-recent');

    // Recent (1d ago) PLANNED-ONLY session — must NOT count anywhere
    await createSession(db, {
      id: 'sess-recent-planned',
      started_at: NOW - 1 * ONE_DAY_MS,
    });
    await insertSet(db, {
      id: 'set-planned',
      session_id: 'sess-recent-planned',
      exercise_id: benchId,
      weight_kg: 75,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW - 1 * ONE_DAY_MS,
    });
    // Deliberately NOT calling markLogged — this row stays is_logged=0

    const h = await getExerciseHistoryHeader(db, benchId, () => NOW);
    expect(h).not.toBeNull();
    expect(h!.total_sessions).toBe(2); // old logged + recent logged
    expect(h!.sessions_last_7_days).toBe(1); // recent logged only
  });

  it('case 3: tap-✓ then un-tap (is_logged 0→1→0) — the row appears, then disappears, on each query', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });

    await insertSet(db, {
      id: 'set-toggle',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_001,
    });

    // Initial state: unlogged → absent
    expect(await listExerciseHistoryBySession(db, benchId)).toHaveLength(0);

    // tap ✓: is_logged 0 → 1
    await markLogged('set-toggle');
    const afterTap = await listExerciseHistoryBySession(db, benchId);
    expect(afterTap).toHaveLength(1);
    expect(afterTap[0].sets).toHaveLength(1);
    expect(afterTap[0].sets[0].set_id).toBe('set-toggle');

    // un-tap: is_logged 1 → 0 (mirror the cluster-aware "rollback to planned")
    await updateSetFields(db, 'set-toggle', { is_logged: 0 });
    expect(await listExerciseHistoryBySession(db, benchId)).toHaveLength(0);
    expect(await listExerciseHistorySets(db, benchId)).toHaveLength(0);
    expect(await queryExerciseHistory(db, benchId)).toHaveLength(0);
  });
});
