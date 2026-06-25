/**
 * Stats Repository edge coverage (src/adapters/sqlite/statsRepository.ts).
 *
 * `loadStatsSetRecords` feeds 統計頁 per-MG volume + per-Session frequency
 * coloring. It was reached only INDIRECTLY before this file (via
 * achievementsAndStats / statsEngine), so the documented miscount pitfalls
 * (warmup exclusion, is_skipped / unlogged exclusion, dropset double-count)
 * were not asserted at the SQL boundary directly.
 *
 * These tests pin:
 *   - empty period → []
 *   - closed-open [start, end) windowing on session.started_at
 *   - single-MG happy path with correct volume
 *   - warmup excluded from the result set entirely (SQL set_kind != 'warmup')
 *   - is_skipped / null weight|reps / reps<1 → record KEPT but is_logged=false,
 *     volume=null (filter is per-set in TS, not row exclusion)
 *   - frequency = COUNT(DISTINCT session) per MG (one MG hit twice in a
 *     session is one distinct session)
 *   - dropset double-count guard — head + follower each yield their OWN
 *     record (each row is one set; not collapsed)
 *
 * Overnight 2026-05-30 — agent C (DB/domain edge tests).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { loadStatsSetRecords } from '../../src/adapters/sqlite/statsRepository';
import { loadHistoryListRows } from '../../src/adapters/sqlite/sessionRepository';
import type { LoadType } from '../../src/domain/exercise/types';

describe('loadStatsSetRecords', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- builders ---------------------------------------------------------

  // The `exercise.muscle_group_id` FK (v006) references the seeded muscle_group
  // table. `mg` here is a SHORT key (e.g. 'chest'); the builder maps it to the
  // real seeded id ('mg-chest') so the FK is satisfied. null → no MG.
  let exSeq = 0;
  async function addExercise(
    id: string,
    mg: string | null,
    load_type: LoadType = 'loaded'
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO exercise
         (id, name, load_type, is_builtin, is_archived, muscle_group_id,
          is_custom, equipment)
       VALUES (?, ?, ?, 0, 0, ?, 1, '其他')`,
      id,
      `Ex ${id}-${exSeq++}`,
      load_type,
      mg === null ? null : `mg-${mg}`
    );
  }

  async function addSession(
    id: string,
    startedAt: number,
    bwKg: number | null = null
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
       VALUES (?, ?, ?, ?)`,
      id,
      startedAt,
      startedAt + 1000,
      bwKg
    );
  }

  let setSeq = 0;
  async function addSet(opts: {
    session_id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    set_kind?: 'working' | 'warmup' | 'dropset';
    is_skipped?: 0 | 1;
    // Defaults to 1 (logged/performed) — that's what a checked-off set carries
    // and what stats volume counts (F3 fix). Pass 0 for planned-but-unchecked.
    is_logged?: 0 | 1;
    parent_set_id?: string | null;
    id?: string;
  }): Promise<string> {
    const seq = setSeq++;
    const id = opts.id ?? `set-${seq}`;
    await db.runAsync(
      `INSERT INTO "set"
         (id, session_id, exercise_id, weight_kg, reps, is_skipped, ordering,
          created_at, set_kind, parent_set_id, is_logged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      opts.session_id,
      opts.exercise_id,
      opts.weight_kg,
      opts.reps,
      opts.is_skipped ?? 0,
      seq,
      seq,
      opts.set_kind ?? 'working',
      opts.parent_set_id ?? null,
      opts.is_logged ?? 1
    );
    return id;
  }

  const FULL_RANGE = { start_ms: 0, end_ms: 10_000_000 };

  // --- empty period -----------------------------------------------------

  it('returns [] for an empty period', async () => {
    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toEqual([]);
  });

  it('windows on session.started_at with closed-open [start, end) semantics', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s-before', 100);
    await addSession('s-in', 5000);
    await addSession('s-at-end', 9999); // exactly end → excluded (half-open)
    await addSet({ session_id: 's-before', exercise_id: 'ex1', weight_kg: 50, reps: 5 });
    await addSet({ session_id: 's-in', exercise_id: 'ex1', weight_kg: 60, reps: 5 });
    await addSet({ session_id: 's-at-end', exercise_id: 'ex1', weight_kg: 70, reps: 5 });

    const records = await loadStatsSetRecords(db, { start_ms: 1000, end_ms: 9999 });
    expect(records.map((r) => r.session_id)).toEqual(['s-in']);
  });

  // --- single MG happy path --------------------------------------------

  it('maps a single working set with correct volume + is_logged', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(1);
    expect(records[0].mg_id).toBe('mg-chest');
    expect(records[0].is_logged).toBe(true);
    expect(records[0].volume).toBe(500); // loaded: 100 * 5
  });

  // --- warmup exclusion -------------------------------------------------

  it('excludes warmup sets from the result set entirely (SQL set_kind filter)', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 40, reps: 8, set_kind: 'warmup' });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, set_kind: 'working' });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    // the warmup row is filtered in SQL — only the working set survives
    expect(records).toHaveLength(1);
    expect(records[0].volume).toBe(500);
  });

  it('a session of only warmup sets yields no records', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 40, reps: 8, set_kind: 'warmup' });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 50, reps: 8, set_kind: 'warmup' });

    expect(await loadStatsSetRecords(db, FULL_RANGE)).toEqual([]);
  });

  // --- is_logged exclusion (skip / null / reps<1) ----------------------

  it('unchecked planned set (is_logged=0) is EXCLUDED by the SQL filter (F3)', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    // A planned-but-never-checked set: real weight/reps (template default) but
    // is_logged=0 because the user never tapped ✓. Must NOT reach stats.
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 0 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toEqual([]);
  });

  it('logged set with null weight or null reps → is_logged=false (value guard), null volume', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    // is_logged=1 in DB but no usable weight/reps → the JS value guard keeps
    // the row but reports is_logged=false + null volume (no NaN).
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: null, reps: 5 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 80, reps: null });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.is_logged === false)).toBe(true);
    expect(records.every((r) => r.volume === null)).toBe(true);
  });

  it('logged set with reps < 1 → value guard reports not-logged, null volume', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 0 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(1);
    expect(records[0].is_logged).toBe(false);
    expect(records[0].volume).toBeNull();
  });

  // --- frequency = COUNT(DISTINCT session) per MG ----------------------

  it('two sets of the same MG in one session → one distinct session', async () => {
    await addExercise('ex1', 'chest');
    await addExercise('ex2', 'chest'); // same MG, different exercise
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5 });
    await addSet({ session_id: 's1', exercise_id: 'ex2', weight_kg: 50, reps: 10 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    const chest = records.filter((r) => r.mg_id === 'mg-chest');
    expect(chest).toHaveLength(2);
    expect(new Set(chest.map((r) => r.session_id)).size).toBe(1);
  });

  it('same MG across two sessions → two distinct sessions', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 4000);
    await addSession('s2', 6000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5 });
    await addSet({ session_id: 's2', exercise_id: 'ex1', weight_kg: 110, reps: 5 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    const distinct = new Set(records.filter((r) => r.mg_id === 'mg-chest').map((r) => r.session_id));
    expect(distinct.size).toBe(2);
  });

  // --- dropset chain: mirror History (head's is_logged only) -----------

  it('dropset head (is_logged=1) counts; follower (DB is_logged=0) is excluded — mirrors History', async () => {
    await addExercise('ex1', 'back');
    await addSession('s1', 5000);
    // Real chain DB shape: user taps ✓ on the HEAD only, so the head carries
    // is_logged=1 and the follower stays is_logged=0 (dropset-chain-semantics
    // DB invariant #2). The History-tab per-session volume uses plain
    // `is_logged = 1`, so it counts the head only — stats must agree.
    const head = await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 100,
      reps: 8,
      set_kind: 'dropset',
      is_logged: 1,
    });
    await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 80,
      reps: 6,
      set_kind: 'dropset',
      parent_set_id: head,
      is_logged: 0,
    });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    // Only the head survives the SQL `is_logged = 1` filter.
    expect(records).toHaveLength(1);
    expect(records[0].is_logged).toBe(true);
    const total = records.reduce((acc, r) => acc + (r.volume ?? 0), 0);
    expect(total).toBe(100 * 8); // 800 — follower's 480 is NOT counted (matches History)
  });

  // --- load_type asymmetry passes through ------------------------------

  it('bodyweight set with null weight → not logged, null volume', async () => {
    await addExercise('ex1', 'back', 'bodyweight');
    await addSession('s1', 5000, 75);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: null, reps: 10 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(1);
    expect(records[0].is_logged).toBe(false);
    expect(records[0].volume).toBeNull();
  });

  it('bodyweight set with weight=0 is logged; volume = weight×reps (0 here)', async () => {
    await addExercise('ex1', 'back', 'bodyweight');
    await addSession('s1', 5000, 75);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 0, reps: 10 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records[0].is_logged).toBe(true);
    // volumeEngine: bodyweight uses effectiveLoad(weight, ...) = weight; 0*10 = 0
    expect(records[0].volume).toBe(0);
  });

  it('assisted set uses (bw_snapshot − weight) × reps', async () => {
    await addExercise('ex1', 'back', 'assisted');
    await addSession('s1', 5000, 80);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 30, reps: 10 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records[0].is_logged).toBe(true);
    expect(records[0].volume).toBe((80 - 30) * 10); // 500
  });

  it('assisted set with no bodyweight snapshot → volume null', async () => {
    await addExercise('ex1', 'back', 'assisted');
    await addSession('s1', 5000, null); // no snapshot
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 30, reps: 10 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    // is_logged is true (weight+reps present) but volume is undefined for C-class
    expect(records[0].is_logged).toBe(true);
    expect(records[0].volume).toBeNull();
  });

  it('null muscle_group_id passes through as mg_id null', async () => {
    await addExercise('ex1', null);
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 50, reps: 5 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records[0].mg_id).toBeNull();
  });

  // --- F3 regression: Stats volume == History volume ===================
  // The Stats-tab muscle-group volume and the History-tab per-session volume
  // must report the SAME number for the same session. Before the fix the
  // Stats query had no `is_logged = 1` clause, so planned-but-unchecked sets
  // (which `endSession` never purges) inflated stats volume vs History.

  it('F3: unchecked planned sets do NOT inflate stats volume; Stats == History', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    // Report repro: 5 working sets at 100kg×5; only the first 2 checked off.
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 1 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 1 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 0 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 0 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_logged: 0 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    const statsVolume = records.reduce((acc, r) => acc + (r.volume ?? 0), 0);
    // Only the 2 logged sets count: 2 × 100 × 5 = 1000 (NOT 2500).
    expect(records).toHaveLength(2);
    expect(statsVolume).toBe(1000);

    // History-tab path for the same session must agree exactly.
    const historyRows = await loadHistoryListRows(db);
    const historyRow = historyRows.find((r) => r.session.id === 's1');
    expect(historyRow?.volume).toBe(1000);
    expect(statsVolume).toBe(historyRow?.volume);
  });

  it('F3 chain-aware: stats counts dropset head only, agreeing with History', async () => {
    await addExercise('ex1', 'back');
    await addSession('s1', 5000);
    // A logged dropset chain: head ✓ (is_logged=1), 2 followers is_logged=0.
    // History counts the head only (plain is_logged=1 SUM); stats must match.
    const head = await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 100,
      reps: 8,
      set_kind: 'dropset',
      is_logged: 1,
    });
    await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 80,
      reps: 6,
      set_kind: 'dropset',
      parent_set_id: head,
      is_logged: 0,
    });
    await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 60,
      reps: 4,
      set_kind: 'dropset',
      parent_set_id: head,
      is_logged: 0,
    });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    const statsVolume = records.reduce((acc, r) => acc + (r.volume ?? 0), 0);
    expect(statsVolume).toBe(100 * 8); // 800 — head only

    const historyRows = await loadHistoryListRows(db);
    const historyRow = historyRows.find((r) => r.session.id === 's1');
    expect(historyRow?.volume).toBe(100 * 8);
    expect(statsVolume).toBe(historyRow?.volume);
  });
});
