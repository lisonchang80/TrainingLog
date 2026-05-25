import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSet } from '../../src/adapters/sqlite/setRepository';
import {
  queryExerciseHistory,
  queryReusableSupersetHistory,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';

/**
 * Slice 9.8c data layer — queryExerciseHistory + queryReusableSupersetHistory.
 *
 * Two repositories of behaviour:
 *
 *   A. queryExerciseHistory — single-exercise timeline:
 *      empty / multi-session ordering / pagination / rep bucket filter.
 *
 *   B. queryReusableSupersetHistory — cluster pairing through template
 *      snapshot indirection (see repo file header for schema-gap context).
 *
 * Convention: every test uses `migrate()` to land at v013, then seeds the
 * minimum (session + session_exercise + template + template_exercise + set
 * rows) needed for the path under test. Built-in seeded exercises from v002
 * provide several `loaded` exercises (Bench Press, Back Squat, Deadlift,
 * Overhead Press) — we use these instead of inserting custom ones, matching
 * the style of `tests/db/exerciseHistory.test.ts`.
 */

const NOW_MS = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface TestExercises {
  bench: string;
  squat: string;
  deadlift: string;
}

async function pickThreeExercises(
  db: BetterSqliteDatabase
): Promise<TestExercises> {
  const all = await listExercises(db);
  const bench = all.find((e) => e.name === 'Bench Press')!.id;
  const squat = all.find((e) => e.name === 'Back Squat')!.id;
  const deadlift = all.find((e) => e.name === 'Deadlift')!.id;
  return { bench, squat, deadlift };
}

/**
 * Convenience: insert one set into an existing session.
 * Caller already created the session.
 *
 * Sets `is_logged = 1` post-insert (history queries filter by it per
 * slice 10c overnight #10 — a row without is_logged=1 is "planned but
 * not yet performed" and is invisible to history).
 */
async function seedSet(
  db: BetterSqliteDatabase,
  args: {
    set_id: string;
    session_id: string;
    exercise_id: string;
    reps: number;
    weight_kg: number;
    ordering: number;
    /** ms relative to NOW_MS; falls back to session_started_at + ordering. */
    created_at?: number;
  }
): Promise<void> {
  await insertSet(db, {
    id: args.set_id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    weight_kg: args.weight_kg,
    reps: args.reps,
    is_skipped: 0,
    ordering: args.ordering,
    created_at: args.created_at ?? NOW_MS + args.ordering,
  });
  await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.set_id);
}

// --------------------------------------------------------------------------
// Function A — queryExerciseHistory
// --------------------------------------------------------------------------

describe('queryExerciseHistory (Function A)', () => {
  let db: BetterSqliteDatabase;
  let ex: TestExercises;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    ex = await pickThreeExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns [] for an exercise that has never been logged', async () => {
    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toEqual([]);
  });

  it('orders newest first across multiple sessions', async () => {
    // Older session — 30 days ago — 2 sets
    await createSession(db, {
      id: 'sess-old',
      started_at: NOW_MS - 30 * ONE_DAY_MS,
    });
    await seedSet(db, {
      set_id: 'old-1',
      session_id: 'sess-old',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 70,
      ordering: 1,
    });
    await seedSet(db, {
      set_id: 'old-2',
      session_id: 'sess-old',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 70,
      ordering: 2,
    });
    // Recent session — 1 day ago — 1 set
    await createSession(db, {
      id: 'sess-new',
      started_at: NOW_MS - 1 * ONE_DAY_MS,
    });
    await seedSet(db, {
      set_id: 'new-1',
      session_id: 'sess-new',
      exercise_id: ex.bench,
      reps: 5,
      weight_kg: 85,
      ordering: 1,
    });

    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(3);
    // Newest session first
    expect(rows[0].session_id).toBe('sess-new');
    expect(rows[0].set_id).toBe('new-1');
    // Within older session, ordering ASC
    expect(rows[1].set_id).toBe('old-1');
    expect(rows[2].set_id).toBe('old-2');
  });

  it('paginates via limit + offset (newest first)', async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    for (let i = 1; i <= 10; i++) {
      await seedSet(db, {
        set_id: `s${i}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps: 8,
        weight_kg: 60 + i,
        ordering: i,
      });
    }
    const page1 = await queryExerciseHistory(db, ex.bench, { limit: 3 });
    expect(page1).toHaveLength(3);
    expect(page1.map((r) => r.set_id)).toEqual(['s1', 's2', 's3']);

    const page2 = await queryExerciseHistory(db, ex.bench, {
      limit: 3,
      offset: 3,
    });
    expect(page2.map((r) => r.set_id)).toEqual(['s4', 's5', 's6']);

    const tail = await queryExerciseHistory(db, ex.bench, {
      limit: 100,
      offset: 8,
    });
    expect(tail.map((r) => r.set_id)).toEqual(['s9', 's10']);
  });

  it('classifies rep_bucket per BUCKETS provider', async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    const repsToOrdering: [number, number, string][] = [
      [2, 1, 'max_strength'],
      [5, 2, 'strength'],
      [8, 3, 'hypertrophy'],
      [12, 4, 'muscle_endurance'],
      [20, 5, 'endurance'],
    ];
    for (const [reps, ord] of repsToOrdering) {
      await seedSet(db, {
        set_id: `s-${ord}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps,
        weight_kg: 50,
        ordering: ord,
      });
    }
    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      const expected = repsToOrdering.find((rt) => rt[1] === r.ordering)![2];
      expect(r.rep_bucket).toBe(expected);
    }
  });

  it("filter: 'all' returns every row", async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    for (let i = 1; i <= 5; i++) {
      await seedSet(db, {
        set_id: `s${i}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps: i * 3, // 3, 6, 9, 12, 15 — spreads across buckets
        weight_kg: 50,
        ordering: i,
      });
    }
    const all = await queryExerciseHistory(db, ex.bench, { repBucket: 'all' });
    expect(all).toHaveLength(5);
  });

  it("filter: 'max_strength' narrows to reps 1-3 only", async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    // 5 sets: reps 2 / 4 / 8 / 12 / 18 → only the first falls in max_strength
    const repsList = [2, 4, 8, 12, 18];
    for (let i = 0; i < repsList.length; i++) {
      await seedSet(db, {
        set_id: `s${i + 1}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps: repsList[i],
        weight_kg: 50,
        ordering: i + 1,
      });
    }
    const narrow = await queryExerciseHistory(db, ex.bench, {
      repBucket: 'max_strength',
    });
    expect(narrow).toHaveLength(1);
    expect(narrow[0].reps).toBe(2);
    expect(narrow[0].rep_bucket).toBe('max_strength');
  });

  it("filter: 'muscle_endurance' narrows to reps 11-15 only", async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    const repsList = [3, 7, 11, 15, 16];
    for (let i = 0; i < repsList.length; i++) {
      await seedSet(db, {
        set_id: `s${i + 1}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps: repsList[i],
        weight_kg: 50,
        ordering: i + 1,
      });
    }
    const narrow = await queryExerciseHistory(db, ex.bench, {
      repBucket: 'muscle_endurance',
    });
    expect(narrow.map((r) => r.reps).sort((a, b) => a! - b!)).toEqual([11, 15]);
  });

  it("filter: 'endurance' is open-ended (reps >= 16)", async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    const repsList = [15, 16, 20, 30];
    for (let i = 0; i < repsList.length; i++) {
      await seedSet(db, {
        set_id: `s${i + 1}`,
        session_id: 'sess-A',
        exercise_id: ex.bench,
        reps: repsList[i],
        weight_kg: 50,
        ordering: i + 1,
      });
    }
    const narrow = await queryExerciseHistory(db, ex.bench, {
      repBucket: 'endurance',
    });
    expect(narrow.map((r) => r.reps).sort((a, b) => a! - b!)).toEqual([
      16, 20, 30,
    ]);
  });

  it('excludes is_skipped=1 sets', async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    await seedSet(db, {
      set_id: 'keep',
      session_id: 'sess-A',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });
    await insertSet(db, {
      id: 'skip',
      session_id: 'sess-A',
      exercise_id: ex.bench,
      weight_kg: 80,
      reps: 8,
      is_skipped: 1,
      ordering: 2,
      created_at: NOW_MS + 2,
    });
    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(1);
    expect(rows[0].set_id).toBe('keep');
  });

  it('does not leak sets from other exercises', async () => {
    await createSession(db, { id: 'sess-A', started_at: NOW_MS });
    await seedSet(db, {
      set_id: 'b1',
      session_id: 'sess-A',
      exercise_id: ex.bench,
      reps: 5,
      weight_kg: 100,
      ordering: 1,
    });
    await seedSet(db, {
      set_id: 'q1',
      session_id: 'sess-A',
      exercise_id: ex.squat,
      reps: 5,
      weight_kg: 120,
      ordering: 2,
    });
    const bench = await queryExerciseHistory(db, ex.bench);
    const squat = await queryExerciseHistory(db, ex.squat);
    expect(bench.map((r) => r.set_id)).toEqual(['b1']);
    expect(squat.map((r) => r.set_id)).toEqual(['q1']);
  });

  it('exposes session bw_snapshot + load_type for downstream math', async () => {
    await createSession(db, {
      id: 'sess-A',
      started_at: NOW_MS,
      bodyweight_snapshot_kg: 75,
    });
    await seedSet(db, {
      set_id: 's1',
      session_id: 'sess-A',
      exercise_id: ex.bench,
      reps: 5,
      weight_kg: 90,
      ordering: 1,
    });
    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows[0].bw_snapshot_kg).toBe(75);
    expect(rows[0].load_type).toBe('loaded');
    // set_kind always null in v1 — placeholder for future migration
    expect(rows[0].set_kind).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Function B — queryReusableSupersetHistory
//
// Each test seeds:
//   1. A reusable superset with 2 exercises (slots position 0 / 1)
//   2. A template containing a 2-row exploded cluster stamped with rs_id
//   3. Session(s) snapshotted from that template (session_exercise rows
//      with template_id = the cluster's source template)
//   4. set rows for those sessions
// --------------------------------------------------------------------------

interface SeededSuperset {
  rs_id: string;
  exA_id: string;
  exB_id: string;
  template_id: string;
}

async function seedReusableSupersetTemplate(
  db: BetterSqliteDatabase,
  args: {
    rs_id?: string;
    exA_id: string;
    exB_id: string;
    template_id?: string;
  }
): Promise<SeededSuperset> {
  const rs_id = args.rs_id ?? 'rs-1';
  const template_id = args.template_id ?? 'tpl-rs';
  const t = NOW_MS;

  await db.runAsync(
    `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
     VALUES (?, '胸+深', NULL, 0, ?, ?)`,
    rs_id,
    t,
    t
  );
  await db.runAsync(
    `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 0, ?)`,
    rs_id,
    args.exA_id
  );
  await db.runAsync(
    `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES (?, 1, ?)`,
    rs_id,
    args.exB_id
  );

  await db.runAsync(
    `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, 'Push', ?, ?)`,
    template_id,
    t,
    t
  );
  // Parent row (position 0 inside the exploded cluster).
  await db.runAsync(
    `INSERT INTO template_exercise
       (id, template_id, exercise_id, ordering, default_sets,
        parent_id, reusable_superset_id, updated_at)
     VALUES ('te-par', ?, ?, 0, 3, NULL, ?, ?)`,
    template_id,
    args.exA_id,
    rs_id,
    t
  );
  await db.runAsync(
    `INSERT INTO template_exercise
       (id, template_id, exercise_id, ordering, default_sets,
        parent_id, reusable_superset_id, updated_at)
     VALUES ('te-chi', ?, ?, 1, 3, 'te-par', ?, ?)`,
    template_id,
    args.exB_id,
    rs_id,
    t
  );

  return { rs_id, template_id, exA_id: args.exA_id, exB_id: args.exB_id };
}

/**
 * Seed one session that snapshotted from `seed.template_id`. Inserts
 * session_exercise rows for both sides, plus the caller-supplied set rows.
 */
async function seedClusterSession(
  db: BetterSqliteDatabase,
  args: {
    seed: SeededSuperset;
    session_id: string;
    started_at: number;
    a_sets: { reps: number; weight_kg: number; ordering: number }[];
    b_sets: { reps: number; weight_kg: number; ordering: number }[];
  }
): Promise<void> {
  await createSession(db, {
    id: args.session_id,
    started_at: args.started_at,
  });
  // session_exercise rows pointing at the source template (snapshot link).
  await insertSessionExercise(db, {
    id: `${args.session_id}-seA`,
    session_id: args.session_id,
    exercise_id: args.seed.exA_id,
    ordering: 0,
    planned_sets: 3,
    planned_reps: null,
    planned_weight_kg: null,
    template_id: args.seed.template_id,
    is_evergreen: 0,
    parent_id: null,
    reusable_superset_id: null,
  });
  await insertSessionExercise(db, {
    id: `${args.session_id}-seB`,
    session_id: args.session_id,
    exercise_id: args.seed.exB_id,
    ordering: 1,
    planned_sets: 3,
    planned_reps: null,
    planned_weight_kg: null,
    template_id: args.seed.template_id,
    is_evergreen: 0,
    parent_id: null,
    reusable_superset_id: null,
  });

  for (const s of args.a_sets) {
    await seedSet(db, {
      set_id: `${args.session_id}-a${s.ordering}`,
      session_id: args.session_id,
      exercise_id: args.seed.exA_id,
      reps: s.reps,
      weight_kg: s.weight_kg,
      ordering: s.ordering,
    });
  }
  for (const s of args.b_sets) {
    await seedSet(db, {
      set_id: `${args.session_id}-b${s.ordering}`,
      session_id: args.session_id,
      exercise_id: args.seed.exB_id,
      reps: s.reps,
      weight_kg: s.weight_kg,
      ordering: s.ordering,
    });
  }
}

describe('queryReusableSupersetHistory (Function B)', () => {
  let db: BetterSqliteDatabase;
  let ex: TestExercises;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    ex = await pickThreeExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns [] for an unknown reusable superset id', async () => {
    const rows = await queryReusableSupersetHistory(db, 'no-such-rs');
    expect(rows).toEqual([]);
  });

  it('returns [] for a reusable superset that was created but never used in any session', async () => {
    await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toEqual([]);
  });

  it('returns one paired entry when both sides were performed in a single session', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-1',
      started_at: NOW_MS,
      a_sets: [
        { reps: 8, weight_kg: 80, ordering: 1 },
        { reps: 8, weight_kg: 80, ordering: 2 },
      ],
      b_sets: [
        { reps: 10, weight_kg: 100, ordering: 3 },
        { reps: 10, weight_kg: 100, ordering: 4 },
      ],
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.session_id).toBe('sess-1');
    expect(r.sides[0].position).toBe(0);
    expect(r.sides[0].exercise_id).toBe(ex.bench);
    expect(r.sides[0].exercise_name).toBe('Bench Press');
    expect(r.sides[0].sets).toHaveLength(2);
    expect(r.sides[1].position).toBe(1);
    expect(r.sides[1].exercise_id).toBe(ex.squat);
    expect(r.sides[1].exercise_name).toBe('Back Squat');
    expect(r.sides[1].sets).toHaveLength(2);
  });

  it('drops sessions where only ONE side was performed (not a complete cluster instance)', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    // Session 1: both sides — should appear
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-both',
      started_at: NOW_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });
    // Session 2: only A — should be dropped
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-A-only',
      started_at: NOW_MS - ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [],
    });
    // Session 3: only B — should be dropped
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-B-only',
      started_at: NOW_MS - 2 * ONE_DAY_MS,
      a_sets: [],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 1 }],
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-both');
  });

  it('orders multiple paired sessions newest first', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-old',
      started_at: NOW_MS - 10 * ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 70, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 90, ordering: 2 }],
    });
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-mid',
      started_at: NOW_MS - 5 * ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 75, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 95, ordering: 2 }],
    });
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-new',
      started_at: NOW_MS - 1 * ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });
    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows.map((r) => r.session_id)).toEqual([
      'sess-new',
      'sess-mid',
      'sess-old',
    ]);
  });

  it("filter: 'all' returns every paired session", async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    await seedClusterSession(db, {
      seed,
      session_id: 's1',
      started_at: NOW_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });
    const rows = await queryReusableSupersetHistory(db, 'rs-1', {
      repBucket: 'all',
    });
    expect(rows).toHaveLength(1);
  });

  it('filter narrows when at least one side has a set in the bucket', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    // s1: A reps 5 (strength) + B reps 12 (muscle_endurance) — keeps for both
    await seedClusterSession(db, {
      seed,
      session_id: 's1',
      started_at: NOW_MS - 1 * ONE_DAY_MS,
      a_sets: [{ reps: 5, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 12, weight_kg: 100, ordering: 2 }],
    });
    // s2: A reps 8 (hypertrophy) + B reps 8 (hypertrophy) — keeps only for hypertrophy
    await seedClusterSession(db, {
      seed,
      session_id: 's2',
      started_at: NOW_MS - 2 * ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 70, ordering: 1 }],
      b_sets: [{ reps: 8, weight_kg: 90, ordering: 2 }],
    });

    const strength = await queryReusableSupersetHistory(db, 'rs-1', {
      repBucket: 'strength',
    });
    expect(strength.map((r) => r.session_id)).toEqual(['s1']);

    const me = await queryReusableSupersetHistory(db, 'rs-1', {
      repBucket: 'muscle_endurance',
    });
    expect(me.map((r) => r.session_id)).toEqual(['s1']);

    const hyper = await queryReusableSupersetHistory(db, 'rs-1', {
      repBucket: 'hypertrophy',
    });
    expect(hyper.map((r) => r.session_id)).toEqual(['s2']);

    const power = await queryReusableSupersetHistory(db, 'rs-1', {
      repBucket: 'max_strength',
    });
    expect(power).toEqual([]);
  });

  it('paginates via limit + offset (newest first)', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    for (let i = 0; i < 5; i++) {
      await seedClusterSession(db, {
        seed,
        session_id: `s${i}`,
        started_at: NOW_MS - i * ONE_DAY_MS, // s0 newest, s4 oldest
        a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
        b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
      });
    }
    const page1 = await queryReusableSupersetHistory(db, 'rs-1', {
      limit: 2,
    });
    expect(page1.map((r) => r.session_id)).toEqual(['s0', 's1']);
    const page2 = await queryReusableSupersetHistory(db, 'rs-1', {
      limit: 2,
      offset: 2,
    });
    expect(page2.map((r) => r.session_id)).toEqual(['s2', 's3']);
    const tail = await queryReusableSupersetHistory(db, 'rs-1', {
      limit: 10,
      offset: 4,
    });
    expect(tail.map((r) => r.session_id)).toEqual(['s4']);
  });

  it('does not leak in solo (non-cluster) sets even when same exercise was logged separately', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });

    // Separate (solo) template that uses the same Bench Press exercise but
    // WITHOUT the reusable_superset_id stamp.
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES ('tpl-solo', 'Solo', ?, ?)`,
      NOW_MS,
      NOW_MS
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('te-solo', 'tpl-solo', ?, 0, 3, NULL, NULL, ?)`,
      ex.bench,
      NOW_MS
    );
    // Solo session — Bench only, snapshotted from tpl-solo (NOT from the rs cluster template).
    await createSession(db, { id: 'sess-solo', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'sess-solo-se',
      session_id: 'sess-solo',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: 'tpl-solo',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'solo-1',
      session_id: 'sess-solo',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });
    // Also a real cluster session — both sides performed.
    await seedClusterSession(db, {
      seed,
      session_id: 'sess-cluster',
      started_at: NOW_MS - 1 * ONE_DAY_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-cluster');
    // sess-solo must NOT appear — it never had the squat side performed.
    expect(rows.map((r) => r.session_id)).not.toContain('sess-solo');
  });

  it('excludes is_skipped sets when building the pairing', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    // A side: 1 real set + 1 skipped. B side: all skipped → pairing should drop
    await createSession(db, { id: 'sess-skip', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'sess-skip-A',
      session_id: 'sess-skip',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await insertSessionExercise(db, {
      id: 'sess-skip-B',
      session_id: 'sess-skip',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'a-real',
      session_id: 'sess-skip',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });
    await insertSet(db, {
      id: 'b-skipped',
      session_id: 'sess-skip',
      exercise_id: ex.squat,
      weight_kg: 100,
      reps: 10,
      is_skipped: 1,
      ordering: 2,
      created_at: NOW_MS + 2,
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toEqual([]);
  });

  it('returns [] when the reusable superset has been deleted (cascade wipes superset_exercise)', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    await seedClusterSession(db, {
      seed,
      session_id: 's1',
      started_at: NOW_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });
    // Sanity — pairing works before delete
    expect(await queryReusableSupersetHistory(db, 'rs-1')).toHaveLength(1);

    // Now DELETE the superset — superset_exercise cascades, slot lookup
    // returns 0 rows → function emits [].
    await db.runAsync(`DELETE FROM superset WHERE id = 'rs-1'`);
    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // ADR-0018 v014 — queryReusableSupersetHistory augment with fallback
  // ───────────────────────────────────────────────────────────────────────

  it('PRIMARY path: matches sessions with session_exercise.reusable_superset_id directly', async () => {
    // Seed the superset slots + template (the indirection path needs it
    // because we want to verify the PRIMARY path bypasses it).
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    // Session with rs_id stamped on session_exercise rows directly (post-v014
    // backfill, or new templated session via snapshotForSession).
    await createSession(db, { id: 's-primary', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 's-primary-A',
      session_id: 's-primary',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: 'rs-1',
    });
    await insertSessionExercise(db, {
      id: 's-primary-B',
      session_id: 's-primary',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: 's-primary-A',
      reusable_superset_id: 'rs-1',
    });
    await seedSet(db, {
      set_id: 'set-pri-a',
      session_id: 's-primary',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });
    await seedSet(db, {
      set_id: 'set-pri-b',
      session_id: 's-primary',
      exercise_id: ex.squat,
      reps: 10,
      weight_kg: 100,
      ordering: 2,
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('s-primary');
    expect(rows[0].sides[0].sets[0].set_id).toBe('set-pri-a');
    expect(rows[0].sides[1].sets[0].set_id).toBe('set-pri-b');
  });

  it('FALLBACK path: matches sessions whose se.rs_id IS NULL via template_exercise indirection', async () => {
    // This is exactly what seedClusterSession does (rs_id NULL on se rows) —
    // confirms the fallback path stays alive for β'-skipped + pre-v014 data.
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });
    await seedClusterSession(db, {
      seed,
      session_id: 's-fallback',
      started_at: NOW_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('s-fallback');
  });

  it('UNION: returns sessions from BOTH paths without duplication', async () => {
    const seed = await seedReusableSupersetTemplate(db, {
      exA_id: ex.bench,
      exB_id: ex.squat,
    });

    // Session A — primary path (rs_id stamped on session_exercise)
    await createSession(db, { id: 's-new', started_at: NOW_MS + 1000 });
    await insertSessionExercise(db, {
      id: 's-new-A',
      session_id: 's-new',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: 'rs-1',
    });
    await insertSessionExercise(db, {
      id: 's-new-B',
      session_id: 's-new',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: seed.template_id,
      is_evergreen: 0,
      parent_id: 's-new-A',
      reusable_superset_id: 'rs-1',
    });
    await seedSet(db, {
      set_id: 'set-new-a',
      session_id: 's-new',
      exercise_id: ex.bench,
      reps: 6,
      weight_kg: 85,
      ordering: 1,
    });
    await seedSet(db, {
      set_id: 'set-new-b',
      session_id: 's-new',
      exercise_id: ex.squat,
      reps: 8,
      weight_kg: 105,
      ordering: 2,
    });

    // Session B — fallback path (rs_id NULL, indirection via template_exercise)
    await seedClusterSession(db, {
      seed,
      session_id: 's-old',
      started_at: NOW_MS,
      a_sets: [{ reps: 8, weight_kg: 80, ordering: 1 }],
      b_sets: [{ reps: 10, weight_kg: 100, ordering: 2 }],
    });

    const rows = await queryReusableSupersetHistory(db, 'rs-1');
    // Both sessions present, newest first
    expect(rows.map((r) => r.session_id)).toEqual(['s-new', 's-old']);
    // No duplicate sets within either side
    expect(rows[0].sides[0].sets).toHaveLength(1);
    expect(rows[1].sides[0].sets).toHaveLength(1);
  });
});
