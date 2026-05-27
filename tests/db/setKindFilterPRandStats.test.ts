import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createSession } from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { loadReplayRecords } from '../../src/adapters/sqlite/achievementRepository';
import { loadStatsSetRecords } from '../../src/adapters/sqlite/statsRepository';
import type { Database } from '../../src/db/types';

/**
 * 2026-05-27 — Sibling fixes to listPriorSetsForExercise's set_kind filter.
 *
 * - achievementRepository.loadReplayRecords feeds PR engine (prReplay) → must
 *   exclude warmup + dropset cluster (ADR-0012 line 173 / line 100).
 * - statsRepository.loadStatsSetRecords feeds stats volume → must exclude
 *   warmup only (ADR-0012 line 174; dropset counts toward volume).
 *
 * Pre-fix, both queries returned every row regardless of set_kind, so the
 * achievement system was awarding PRs based on warmup/dropset weights and
 * stats volume was inflated by warmup contribution.
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
  await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
}

describe('loadReplayRecords — set_kind filter for PR engine (ADR-0012 line 173/100)', () => {
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

  it('excludes warmup rows', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
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

    const records = await loadReplayRecords(db);
    expect(records).toHaveLength(1);
    expect(records[0].set_id).toBe('s-work');
  });

  it('excludes the dropset cluster (parent root + followers)', async () => {
    await createSession(db, { id: 'sess-B', started_at: 2_000 });
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

    const records = await loadReplayRecords(db);
    expect(records).toHaveLength(1);
    expect(records[0].set_id).toBe('s-baseline');
  });

  it('keeps chronological order + maps is_logged correctly', async () => {
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
    await insertLoggedSet(db, {
      id: 's-2',
      session_id: 'sess-C',
      exercise_id: benchId,
      weight_kg: 85,
      reps: 5,
      ordering: 2,
      created_at: 3_002,
      set_kind: 'working',
    });

    const records = await loadReplayRecords(db);
    expect(records).toHaveLength(2);
    expect(records[0].set_id).toBe('s-1');
    expect(records[1].set_id).toBe('s-2');
    expect(records[0].is_logged).toBe(true);
    expect(records[1].is_logged).toBe(true);
  });
});

describe('loadStatsSetRecords — set_kind filter for volume (ADR-0012 line 174)', () => {
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

  it('excludes warmup rows from stats volume', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertLoggedSet(db, {
      id: 's-warm',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 40,
      reps: 12,
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

    const records = await loadStatsSetRecords(db, {
      start_ms: 0,
      end_ms: 10_000,
    });
    expect(records).toHaveLength(1);
    expect(records[0].set_id).toBe('s-work');
  });

  it('INCLUDES dropset cluster rows in stats volume (different from PR rules)', async () => {
    await createSession(db, { id: 'sess-B', started_at: 2_000 });
    await insertLoggedSet(db, {
      id: 's-work',
      session_id: 'sess-B',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      created_at: 2_001,
      set_kind: 'working',
    });
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

    const records = await loadStatsSetRecords(db, {
      start_ms: 0,
      end_ms: 10_000,
    });
    // working + both dropset rows (cluster counts toward volume per line 174)
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.set_id).sort()).toEqual([
      's-cluster-follow',
      's-cluster-root',
      's-work',
    ]);
  });

  it('respects time window alongside the kind filter', async () => {
    await createSession(db, { id: 'sess-C', started_at: 5_000 });
    await insertLoggedSet(db, {
      id: 's-in-window',
      session_id: 'sess-C',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      created_at: 5_001,
      set_kind: 'working',
    });
    await createSession(db, { id: 'sess-D', started_at: 20_000 });
    await insertLoggedSet(db, {
      id: 's-out-window',
      session_id: 'sess-D',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      created_at: 20_001,
      set_kind: 'working',
    });

    const records = await loadStatsSetRecords(db, {
      start_ms: 0,
      end_ms: 10_000,
    });
    expect(records).toHaveLength(1);
    expect(records[0].set_id).toBe('s-in-window');
  });
});
