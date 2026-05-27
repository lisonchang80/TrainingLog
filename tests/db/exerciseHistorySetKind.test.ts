import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createSession } from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import {
  listExerciseHistorySets,
  listExerciseHistoryBySession,
  listPriorSetsForExercise,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';
import type { Database } from '../../src/db/types';

/**
 * Slice 10c overnight #22 — history queries must surface set_kind +
 * parent_set_id so the Exercise History page expanded-card row labels
 * (`熱` / `1` / `D1` …) can be computed by `computeHistorySetLabels`.
 *
 * Pre-#22 the SELECT pegged `set_kind` to `null` (legacy behaviour from
 * before v015 added the column). These tests assert the new SELECT
 * returns the real enum values that `insertSessionSet` wrote in.
 */

async function insertLoggedSet(
  db: Database,
  args: {
    id: string;
    session_id: string;
    exercise_id: string;
    weight_kg: number;
    reps: number;
    ordering: number;
    created_at: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id?: string | null;
  }
): Promise<void> {
  await insertSessionSet(db, {
    id: args.id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    weight_kg: args.weight_kg,
    reps: args.reps,
    is_skipped: 0,
    ordering: args.ordering,
    created_at: args.created_at,
    set_kind: args.set_kind,
    parent_set_id: args.parent_set_id ?? null,
  });
  // insertSessionSet defaults `is_logged=0`; history queries filter `is_logged=1`
  // so flip it on for these fixtures (matches the helper pattern in
  // exerciseHistory.test.ts).
  await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
}

describe('exerciseHistoryRepository — set_kind + parent_set_id (slice 10c #22)', () => {
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

  it('listExerciseHistorySets returns set_kind for each row (mixed warmup / working / dropset)', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    // 1 warmup, 3 working, 1 dropset (head — parent_set_id NULL)
    await insertLoggedSet(db, {
      id: 's-wu',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 40,
      reps: 12,
      ordering: 1,
      created_at: 1_001,
      set_kind: 'warmup',
    });
    await insertLoggedSet(db, {
      id: 's-w1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      ordering: 2,
      created_at: 1_002,
      set_kind: 'working',
    });
    await insertLoggedSet(db, {
      id: 's-w2',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 9,
      ordering: 3,
      created_at: 1_003,
      set_kind: 'working',
    });
    await insertLoggedSet(db, {
      id: 's-w3',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 4,
      created_at: 1_004,
      set_kind: 'working',
    });
    // dropset follower — parent_set_id points at the last working row
    await insertLoggedSet(db, {
      id: 's-d1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 6,
      ordering: 5,
      created_at: 1_005,
      set_kind: 'dropset',
      parent_set_id: 's-w3',
    });

    const sets = await listExerciseHistorySets(db, benchId);
    expect(sets).toHaveLength(5);

    // Latest-first ordering = newest created_at = the dropset
    const byId = new Map(sets.map((s) => [s.set_id, s]));
    expect(byId.get('s-wu')!.set_kind).toBe('warmup');
    expect(byId.get('s-wu')!.parent_set_id).toBeNull();
    expect(byId.get('s-w1')!.set_kind).toBe('working');
    expect(byId.get('s-w1')!.parent_set_id).toBeNull();
    expect(byId.get('s-w2')!.set_kind).toBe('working');
    expect(byId.get('s-w3')!.set_kind).toBe('working');
    expect(byId.get('s-d1')!.set_kind).toBe('dropset');
    expect(byId.get('s-d1')!.parent_set_id).toBe('s-w3');
  });

  it('listExerciseHistoryBySession returns set_kind for each row, grouped per session', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertLoggedSet(db, {
      id: 's-wu',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 40,
      reps: 12,
      ordering: 1,
      created_at: 1_001,
      set_kind: 'warmup',
    });
    await insertLoggedSet(db, {
      id: 's-w1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      ordering: 2,
      created_at: 1_002,
      set_kind: 'working',
    });
    await insertLoggedSet(db, {
      id: 's-d1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 6,
      ordering: 3,
      created_at: 1_003,
      set_kind: 'dropset',
      parent_set_id: 's-w1',
    });

    const grouped = await listExerciseHistoryBySession(db, benchId);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].sets).toHaveLength(3);
    // Within-session ordering ASC
    expect(grouped[0].sets[0].set_kind).toBe('warmup');
    expect(grouped[0].sets[0].parent_set_id).toBeNull();
    expect(grouped[0].sets[1].set_kind).toBe('working');
    expect(grouped[0].sets[1].parent_set_id).toBeNull();
    expect(grouped[0].sets[2].set_kind).toBe('dropset');
    expect(grouped[0].sets[2].parent_set_id).toBe('s-w1');
  });

  it('defaults to set_kind = "working" when callers use plain insertSet (legacy fixtures)', async () => {
    // Sanity check: a plain `insertSessionSet` writing 'working' (no
    // override) flows through as 'working' on read — guards against typos
    // in the SELECT alias.
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertLoggedSet(db, {
      id: 's-1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      ordering: 1,
      created_at: 1_001,
      set_kind: 'working',
    });
    const sets = await listExerciseHistorySets(db, benchId);
    expect(sets).toHaveLength(1);
    expect(sets[0].set_kind).toBe('working');
    expect(sets[0].parent_set_id).toBeNull();
  });
});

describe('listPriorSetsForExercise — set_kind filter (ADR-0012 line 100/173)', () => {
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

  it('excludes warmup rows from PR engine input', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    // 1 heavy warmup at 100kg + 1 lighter working at 80kg
    await insertLoggedSet(db, {
      id: 's-warm',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 100,
      reps: 5,
      ordering: 1,
      created_at: 1_001,
      set_kind: 'warmup',
    });
    await insertLoggedSet(db, {
      id: 's-work',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 2,
      created_at: 1_002,
      set_kind: 'working',
    });

    // Cutoff after both rows
    const priors = await listPriorSetsForExercise(db, benchId, 1_003);

    expect(priors).toHaveLength(1);
    expect(priors[0].set_id).toBe('s-work');
    expect(priors[0].weight_kg).toBe(80);
    expect(priors[0].set_kind).toBe('working');
  });

  it('excludes the dropset cluster (parent root + followers) from PR engine input', async () => {
    await createSession(db, { id: 'sess-B', started_at: 2_000 });
    // 1 working baseline + dropset cluster (root + 1 follower)
    await insertLoggedSet(db, {
      id: 's-baseline',
      session_id: 'sess-B',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      created_at: 2_001,
      set_kind: 'working',
    });
    // Cluster parent root — set_kind='dropset' AND parent_set_id=NULL
    // (this is the heaviest of the cluster, the user dropped from this)
    await insertLoggedSet(db, {
      id: 's-cluster-root',
      session_id: 'sess-B',
      exercise_id: benchId,
      weight_kg: 100,
      reps: 5,
      ordering: 2,
      created_at: 2_002,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    // Cluster follower — references root
    await insertLoggedSet(db, {
      id: 's-cluster-follow',
      session_id: 'sess-B',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 6,
      ordering: 3,
      created_at: 2_003,
      set_kind: 'dropset',
      parent_set_id: 's-cluster-root',
    });

    const priors = await listPriorSetsForExercise(db, benchId, 2_004);

    // ONLY the working baseline survives; both cluster root (100kg) and
    // follower (70kg) are excluded per ADR-0012 line 100/173.
    expect(priors).toHaveLength(1);
    expect(priors[0].set_id).toBe('s-baseline');
  });

  it('returns set_kind + parent_set_id + cluster_partner_exercise_id (SELECT no longer drops them)', async () => {
    await createSession(db, { id: 'sess-C', started_at: 3_000 });
    await insertLoggedSet(db, {
      id: 's-1',
      session_id: 'sess-C',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      created_at: 3_001,
      set_kind: 'working',
    });
    const priors = await listPriorSetsForExercise(db, benchId, 3_002);
    expect(priors).toHaveLength(1);
    // These three fields were previously declared in the return type but the
    // SQL didn't SELECT them — runtime was undefined. Guard against regression.
    expect(priors[0].set_kind).toBe('working');
    expect(priors[0].parent_set_id).toBeNull();
    expect(priors[0].cluster_partner_exercise_id).toBeNull();
  });

  it('cutoff (before_created_at) is still applied alongside the kind filter', async () => {
    await createSession(db, { id: 'sess-D', started_at: 4_000 });
    await insertLoggedSet(db, {
      id: 's-old',
      session_id: 'sess-D',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 8,
      ordering: 1,
      created_at: 4_001,
      set_kind: 'working',
    });
    await insertLoggedSet(db, {
      id: 's-new',
      session_id: 'sess-D',
      exercise_id: benchId,
      weight_kg: 90,
      reps: 5,
      ordering: 2,
      created_at: 4_010,
      set_kind: 'working',
    });
    // Cutoff between the two — only the older row is "prior"
    const priors = await listPriorSetsForExercise(db, benchId, 4_005);
    expect(priors).toHaveLength(1);
    expect(priors[0].set_id).toBe('s-old');
  });
});
