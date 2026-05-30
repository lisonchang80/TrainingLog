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
    parent_set_id?: string | null;
    id?: string;
  }): Promise<string> {
    const seq = setSeq++;
    const id = opts.id ?? `set-${seq}`;
    await db.runAsync(
      `INSERT INTO "set"
         (id, session_id, exercise_id, weight_kg, reps, is_skipped, ordering,
          created_at, set_kind, parent_set_id, is_logged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      id,
      opts.session_id,
      opts.exercise_id,
      opts.weight_kg,
      opts.reps,
      opts.is_skipped ?? 0,
      seq,
      seq,
      opts.set_kind ?? 'working',
      opts.parent_set_id ?? null
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

  it('is_skipped set is KEPT as a record but is_logged=false, volume=null', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 100, reps: 5, is_skipped: 1 });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(1);
    expect(records[0].is_logged).toBe(false);
    expect(records[0].volume).toBeNull();
  });

  it('null weight or null reps → not logged, null volume', async () => {
    await addExercise('ex1', 'chest');
    await addSession('s1', 5000);
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: null, reps: 5 });
    await addSet({ session_id: 's1', exercise_id: 'ex1', weight_kg: 80, reps: null });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.is_logged === false)).toBe(true);
    expect(records.every((r) => r.volume === null)).toBe(true);
  });

  it('reps < 1 is treated as not-logged', async () => {
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

  // --- dropset double-count guard --------------------------------------

  it('dropset head + follower each yield their own record (both count toward volume)', async () => {
    await addExercise('ex1', 'back');
    await addSession('s1', 5000);
    const head = await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 100,
      reps: 8,
      set_kind: 'dropset',
    });
    await addSet({
      session_id: 's1',
      exercise_id: 'ex1',
      weight_kg: 80,
      reps: 6,
      set_kind: 'dropset',
      parent_set_id: head,
    });

    const records = await loadStatsSetRecords(db, FULL_RANGE);
    // both dropset rows are distinct sets → 2 records, NOT collapsed
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.is_logged === true)).toBe(true);
    const total = records.reduce((acc, r) => acc + (r.volume ?? 0), 0);
    expect(total).toBe(100 * 8 + 80 * 6); // 800 + 480 = 1280
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
});
