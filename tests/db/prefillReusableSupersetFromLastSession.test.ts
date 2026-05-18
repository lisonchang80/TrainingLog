import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';
import {
  insertSessionSet,
  listSetsBySession,
  prefillReusableSupersetFromLastSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c overnight #25 — RS pick prefills from SAME RS template history.
 *
 * Distinct from `prefillSessionExerciseFromLastSession` (solo): the lookup
 * key is `reusable_superset_id`, not `exercise_id`. We do NOT bleed a
 * solo-bench history into an RS Bench-side card.
 *
 * Coverage:
 *   Case 1 — Happy path: prior ended session with RS template X (A: 3 logged,
 *            B: 2 logged) → new RS card prefills 3 + 2, is_logged all 0.
 *   Case 2 — No history: empty DB → return 0, new card stays empty.
 *   Case 3 — Active-only history: source session ended_at IS NULL → ignored
 *            (return 0).
 *   Case 4 — Cross-template isolation: ended session has RS template Y (same
 *            exercises) → new card for template X returns 0 (precision by
 *            reusable_superset_id).
 *   Case 5 — set_kind preservation: source mixes warmup + working + dropset
 *            → target mirrors all three kinds (and dropset parent_set_id
 *            remap is handled by replayClusterCardSetsFromHistoricalSession).
 *   Case 6 — Asymmetric source: A side has 3 logged sets, B has 0 → A
 *            prefills 3, B stays empty (no error).
 */

const BENCH = '00000000-0000-4000-8000-000000000001'; // Bench Press
const CHEST_DIP = '00000000-0000-4000-8000-000000000002'; // (seed: Back Squat — treat as the B side for tests)
const ROW = '00000000-0000-4000-8000-000000000005'; // Bent-over Row

describe('prefillReusableSupersetFromLastSession', () => {
  let db: BetterSqliteDatabase;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  async function mkEndedSession(id: string, started_at: number) {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      id,
      started_at,
      started_at + 3600_000,
    );
  }

  async function mkActiveSession(id: string, started_at: number) {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, NULL)`,
      id,
      started_at,
    );
  }

  async function addLoggedSet(args: {
    id: string;
    session_id: string;
    exercise_id: string;
    se_id: string;
    ordering: number;
    weight_kg: number;
    reps: number;
    set_kind?: 'warmup' | 'working' | 'dropset';
    parent_set_id?: string | null;
  }) {
    await insertSessionSet(db, {
      id: args.id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      weight_kg: args.weight_kg,
      reps: args.reps,
      is_skipped: 0,
      ordering: args.ordering,
      created_at: now + args.ordering * 1000,
      set_kind: args.set_kind ?? 'working',
      parent_set_id: args.parent_set_id ?? null,
      session_exercise_id: args.se_id,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
  }

  /**
   * Helper: create an RS template, then explode it into a past ended session
   * with provided per-side sets. Returns the RS id + side ids so tests can
   * write sets / assert per-side behavior.
   */
  async function setupPastSessionWithRS(args: {
    rs_name: string;
    rs_exercises: [string, string];
    past_session_id: string;
    past_started_at: number;
  }): Promise<{ rs_id: string; past_a_id: string; past_b_id: string }> {
    const rs_id = await insertReusableSuperset(
      db,
      {
        name: args.rs_name,
        color_hex: '#34c759',
        exercise_ids: args.rs_exercises,
      },
      randomUUID,
      () => now,
    );
    await mkEndedSession(args.past_session_id, args.past_started_at);
    const { a_id, b_id } = await appendReusableSupersetToSession(db, {
      session_id: args.past_session_id,
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });
    return { rs_id, past_a_id: a_id, past_b_id: b_id };
  }

  it('Case 1 — happy path: prefills 3 A-side + 2 B-side from same RS template history', async () => {
    const { rs_id, past_a_id, past_b_id } = await setupPastSessionWithRS({
      rs_name: 'Bench + Squat',
      rs_exercises: [BENCH, CHEST_DIP],
      past_session_id: 'past-1',
      past_started_at: 1_000_000,
    });
    await addLoggedSet({ id: 'pa1', session_id: 'past-1', exercise_id: BENCH, se_id: past_a_id, ordering: 1, weight_kg: 50, reps: 12, set_kind: 'warmup' });
    await addLoggedSet({ id: 'pa2', session_id: 'past-1', exercise_id: BENCH, se_id: past_a_id, ordering: 2, weight_kg: 80, reps: 5 });
    await addLoggedSet({ id: 'pa3', session_id: 'past-1', exercise_id: BENCH, se_id: past_a_id, ordering: 3, weight_kg: 85, reps: 5 });
    await addLoggedSet({ id: 'pb1', session_id: 'past-1', exercise_id: CHEST_DIP, se_id: past_b_id, ordering: 4, weight_kg: 100, reps: 8 });
    await addLoggedSet({ id: 'pb2', session_id: 'past-1', exercise_id: CHEST_DIP, se_id: past_b_id, ordering: 5, weight_kg: 100, reps: 8 });

    // Current active session — add same RS template.
    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    expect(count).toBe(5);
    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === cur_a);
    const bRows = rows.filter((r) => r.session_exercise_id === cur_b);
    expect(aRows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind }))).toEqual([
      { w: 50, r: 12, k: 'warmup' },
      { w: 80, r: 5, k: 'working' },
      { w: 85, r: 5, k: 'working' },
    ]);
    expect(bRows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind }))).toEqual([
      { w: 100, r: 8, k: 'working' },
      { w: 100, r: 8, k: 'working' },
    ]);
    // is_logged 0 for every prefilled row — user must re-tick.
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
  });

  it('Case 2 — no history: returns 0 and target cards remain empty', async () => {
    // RS exists but has never been used in any session.
    const rs_id = await insertReusableSuperset(
      db,
      { name: 'Brand New', color_hex: '#ff0000', exercise_ids: [BENCH, CHEST_DIP] },
      randomUUID,
      () => now,
    );
    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    expect(count).toBe(0);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows).toHaveLength(0);
  });

  it('Case 3 — only an in-progress session used the RS: ended_at IS NULL → ignored', async () => {
    const rs_id = await insertReusableSuperset(
      db,
      { name: 'In-progress Only', color_hex: '#ff0000', exercise_ids: [BENCH, CHEST_DIP] },
      randomUUID,
      () => now,
    );
    // Past session — but still active (ended_at NULL).
    await mkActiveSession('past-active', 1_000_000);
    const { a_id: past_a, b_id: past_b } = await appendReusableSupersetToSession(db, {
      session_id: 'past-active',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });
    await addLoggedSet({ id: 'pa1', session_id: 'past-active', exercise_id: BENCH, se_id: past_a, ordering: 1, weight_kg: 80, reps: 5 });
    await addLoggedSet({ id: 'pb1', session_id: 'past-active', exercise_id: CHEST_DIP, se_id: past_b, ordering: 2, weight_kg: 60, reps: 8 });

    // Current — a different active session.
    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });

    // Wait — appendReusableSupersetToSession duplicate guard fires on
    // (session_id, reusable_superset_id). Two DIFFERENT sessions reusing the
    // same RS is fine. But the guard inside appendReusableSupersetToSession
    // would have already thrown if it scoped across sessions — it does NOT,
    // it scopes within a single session. So this branch is reachable.

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    expect(count).toBe(0); // past-active has ended_at NULL → not considered.
    const rows = await listSetsBySession(db, 'cur');
    expect(rows).toHaveLength(0);
  });

  it('Case 4 — cross-template isolation: ended session with RS Y is not picked when target asks for RS X', async () => {
    // RS Y (Bench + Squat) had a past ended session with logged sets.
    const { rs_id: rs_y_id, past_a_id: y_a, past_b_id: y_b } = await setupPastSessionWithRS({
      rs_name: 'RS Y',
      rs_exercises: [BENCH, CHEST_DIP],
      past_session_id: 'past-y',
      past_started_at: 1_000_000,
    });
    await addLoggedSet({ id: 'ya1', session_id: 'past-y', exercise_id: BENCH, se_id: y_a, ordering: 1, weight_kg: 80, reps: 5 });
    await addLoggedSet({ id: 'yb1', session_id: 'past-y', exercise_id: CHEST_DIP, se_id: y_b, ordering: 2, weight_kg: 60, reps: 8 });

    // RS X — separate template, never logged anywhere.
    const rs_x_id = await insertReusableSuperset(
      db,
      { name: 'RS X', color_hex: '#0000ff', exercise_ids: [BENCH, CHEST_DIP] },
      randomUUID,
      () => now,
    );

    // Sanity: rs_x_id differs from rs_y_id.
    expect(rs_x_id).not.toBe(rs_y_id);

    // Current active session adds RS X.
    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_x_id,
      uuid: randomUUID,
    });

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_x_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    // RS Y's history is NOT pulled into RS X's prefill.
    expect(count).toBe(0);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows).toHaveLength(0);
  });

  it('Case 5 — set_kind preserved (warmup + working + dropset)', async () => {
    const { rs_id, past_a_id, past_b_id } = await setupPastSessionWithRS({
      rs_name: 'Mixed Kinds',
      rs_exercises: [BENCH, CHEST_DIP],
      past_session_id: 'past-mixed',
      past_started_at: 1_000_000,
    });
    // A side: warmup → working → dropset (chain).
    await addLoggedSet({ id: 'pa1', session_id: 'past-mixed', exercise_id: BENCH, se_id: past_a_id, ordering: 1, weight_kg: 40, reps: 12, set_kind: 'warmup' });
    await addLoggedSet({ id: 'pa2', session_id: 'past-mixed', exercise_id: BENCH, se_id: past_a_id, ordering: 2, weight_kg: 100, reps: 5 });
    await addLoggedSet({ id: 'pa3', session_id: 'past-mixed', exercise_id: BENCH, se_id: past_a_id, ordering: 3, weight_kg: 80, reps: 8, set_kind: 'dropset', parent_set_id: 'pa2' });
    // B side: working only.
    await addLoggedSet({ id: 'pb1', session_id: 'past-mixed', exercise_id: CHEST_DIP, se_id: past_b_id, ordering: 4, weight_kg: 60, reps: 8 });

    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    expect(count).toBe(4);
    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === cur_a);
    expect(aRows.map((r) => r.set_kind)).toEqual(['warmup', 'working', 'dropset']);
    // Dropset follower's parent_set_id must point at the NEW head, not the
    // stale source id (re-mint via replayCluster... UUID map).
    const newHead = aRows.find((r) => r.set_kind === 'working');
    const newDrop = aRows.find((r) => r.set_kind === 'dropset');
    expect(newDrop!.parent_set_id).toBe(newHead!.id);
    expect(newDrop!.parent_set_id).not.toBe('pa2');
  });

  it('Case 6 — asymmetric source: A side has 3 logged sets, B side 0 → A prefills 3, B stays empty', async () => {
    const { rs_id, past_a_id } = await setupPastSessionWithRS({
      rs_name: 'A-only',
      rs_exercises: [BENCH, CHEST_DIP],
      past_session_id: 'past-asymm',
      past_started_at: 1_000_000,
    });
    // Only A side has logged sets — B side skipped.
    await addLoggedSet({ id: 'pa1', session_id: 'past-asymm', exercise_id: BENCH, se_id: past_a_id, ordering: 1, weight_kg: 60, reps: 10 });
    await addLoggedSet({ id: 'pa2', session_id: 'past-asymm', exercise_id: BENCH, se_id: past_a_id, ordering: 2, weight_kg: 60, reps: 10 });
    await addLoggedSet({ id: 'pa3', session_id: 'past-asymm', exercise_id: BENCH, se_id: past_a_id, ordering: 3, weight_kg: 60, reps: 10 });

    await mkActiveSession('cur', 2_000_000);
    const { a_id: cur_a, b_id: cur_b } = await appendReusableSupersetToSession(db, {
      session_id: 'cur',
      reusable_superset_id: rs_id,
      uuid: randomUUID,
    });

    const count = await prefillReusableSupersetFromLastSession(db, {
      current_session_id: 'cur',
      reusable_superset_id: rs_id,
      new_a_session_exercise_id: cur_a,
      new_b_session_exercise_id: cur_b,
      uuid: randomUUID,
    });

    expect(count).toBe(3);
    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === cur_a);
    const bRows = rows.filter((r) => r.session_exercise_id === cur_b);
    expect(aRows).toHaveLength(3);
    expect(bRows).toHaveLength(0);
    expect(aRows.every((r) => r.weight_kg === 60 && r.reps === 10)).toBe(true);
  });
});
