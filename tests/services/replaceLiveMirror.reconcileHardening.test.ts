/**
 * Reconcile hardening (overnight 2026-06-05) — edge cases the existing
 * replaceLiveMirror / endSnapshotReconcile suites leave genuinely uncovered.
 *
 * The existing suites are deep, so this file is deliberately small and
 * targets only the gaps verified to be missing:
 *
 *   1. Dropset cluster reconcile under REORDER + GROW/SHRINK across ticks.
 *      The existing tests cover head+follower INSERT, canonical-head
 *      resolution, deconstruct, single middle-follower delete, dangling
 *      parent, re-sync retro-fix, and cycle-non-last-to-dropset. They do NOT
 *      cover: a 2-follower chain whose HEAD moves display position via
 *      `display_rank` while every follower stays attached, nor GROWING a chain
 *      (adding a 3rd follower) then SHRINKING it (removing the head's middle
 *      follower) across consecutive live ticks with the per-exercise set purge
 *      composing — asserting parent linkage + no orphan/duplicate followers.
 *
 *   2. Multi-exercise divergent-id BEYOND the current 2-occurrence tests.
 *      Existing: same exercise_id twice (occurrence keying) + first/middle/
 *      tail delete under divergent canonical ids. NOT covered: the SAME
 *      exercise_id THREE times (3 occurrences, FIFO ordering ASC keying held
 *      across ticks), and an exercise REMOVED (live purge) then RE-ADDED at a
 *      DIFFERENT position on a later tick (freestyle re-add → fresh INSERT,
 *      not a resurrected canonical row).
 *
 *   3. displayRank FRACTIONAL insert-between — the wire-ordinal vs display_rank
 *      DIVERGENCE. Existing v025 tests cover INSERT/UPDATE/absent + a basic
 *      2-set swap. NOT covered: inserting a set BETWEEN two existing sets with
 *      a fractional `display_rank` (e.g. 1.5 between ranks 1 and 2) where the
 *      mid-inserted row's wire `ordinal` (→ `set.ordering`, the reconcile
 *      identity key) is the APPEND value (3), proving the render order driven
 *      by `sortSetsByDisplayRank` (`display_rank ?? ordering`) is monotonic +
 *      stable while identity stays keyed on `ordering`.
 *
 * Real DB via better-sqlite3 in-memory; same fixture conventions + real
 * builtin exercise ids (foreign_keys=ON) as the existing suites.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';
import type {
  SessionSnapshot,
  SessionSnapshotSet,
} from '../../src/adapters/watch/handshake';

const EX_A = '00000000-0000-4000-8000-000000000001'; // Bench Press
const EX_B = '00000000-0000-4000-8000-000000000002'; // Back Squat
const EX_C = '00000000-0000-4000-8000-000000000003'; // Deadlift

async function seedLiveSession(
  db: BetterSqliteDatabase,
  id = 'sess-1',
  startedAt = 1_700_000_000_000,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, '')`,
    id,
    startedAt,
  );
}

/** A single snapshot set with sensible defaults; pass overrides per field. */
function s(
  overrides: Partial<SessionSnapshotSet> &
    Pick<SessionSnapshotSet, 'setId' | 'ordinal'>,
): SessionSnapshotSet {
  return {
    weight: 80,
    reps: 8,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind: 'working',
    is_logged: true,
    ...overrides,
  };
}

// =====================================================================
// 1. Dropset cluster reconcile under reorder + grow/shrink across ticks
// =====================================================================

describe('replaceLiveMirror — dropset cluster reconcile under reorder + grow/shrink', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db, 'sess-1');
  });

  afterEach(() => db.close());

  /** One exercise carrying the given dropset sets. */
  const chainSnap = (sets: SessionSnapshotSet[]): SessionSnapshot => ({
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: EX_A,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 3,
        sets,
      },
    ],
  });

  it('a head + 2 followers chain whose HEAD is reordered (display_rank) keeps every parent linkage', async () => {
    // Seed: head h (rank 0) + followers f1 (rank 1) + f2 (rank 2).
    await replaceLiveMirror(
      db,
      chainSnap([
        s({ setId: 'h', ordinal: 0, set_kind: 'dropset', parent_set_id: null, display_rank: 0 }),
        s({ setId: 'f1', ordinal: 1, weight: 60, set_kind: 'dropset', parent_set_id: 'h', display_rank: 1 }),
        s({ setId: 'f2', ordinal: 2, weight: 40, set_kind: 'dropset', parent_set_id: 'h', display_rank: 2 }),
      ]),
    );

    // The user long-press reorders the WHOLE chain to the front of the list
    // (the chain still moves as a unit on the Watch). The wire `ordinal`
    // (identity key) is UNCHANGED; only `display_rank` moves. Both followers
    // remain parented to the head.
    await replaceLiveMirror(
      db,
      chainSnap([
        s({ setId: 'h', ordinal: 0, set_kind: 'dropset', parent_set_id: null, display_rank: -3 }),
        s({ setId: 'f1', ordinal: 1, weight: 60, set_kind: 'dropset', parent_set_id: 'h', display_rank: -2 }),
        s({ setId: 'f2', ordinal: 2, weight: 40, set_kind: 'dropset', parent_set_id: 'h', display_rank: -1 }),
      ]),
    );

    const rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
      ordering: number;
      display_rank: number | null;
      weight_kg: number | null;
    }>(
      `SELECT id, parent_set_id, ordering, display_rank, weight_kg FROM "set"
        WHERE session_id = 'sess-1' ORDER BY ordering ASC`,
    );
    // Exactly 3 rows — no duplication. Identity ordinal unchanged; rank moved;
    // both followers still parented to the head.
    expect(rows).toEqual([
      { id: 'h', parent_set_id: null, ordering: 0, display_rank: -3, weight_kg: 80 },
      { id: 'f1', parent_set_id: 'h', ordering: 1, display_rank: -2, weight_kg: 60 },
      { id: 'f2', parent_set_id: 'h', ordering: 2, display_rank: -1, weight_kg: 40 },
    ]);
  });

  it('GROW then SHRINK a chain across ticks — add a 3rd follower, then drop the MIDDLE follower (per-exercise purge), no orphans', async () => {
    // Tick 1: head + 2 followers.
    await replaceLiveMirror(
      db,
      chainSnap([
        s({ setId: 'h', ordinal: 0, set_kind: 'dropset', parent_set_id: null }),
        s({ setId: 'f1', ordinal: 1, weight: 60, set_kind: 'dropset', parent_set_id: 'h' }),
        s({ setId: 'f2', ordinal: 2, weight: 40, set_kind: 'dropset', parent_set_id: 'h' }),
      ]),
    );

    // Tick 2 (GROW): add a 3rd follower f3 at ordinal 3.
    await replaceLiveMirror(
      db,
      chainSnap([
        s({ setId: 'h', ordinal: 0, set_kind: 'dropset', parent_set_id: null }),
        s({ setId: 'f1', ordinal: 1, weight: 60, set_kind: 'dropset', parent_set_id: 'h' }),
        s({ setId: 'f2', ordinal: 2, weight: 40, set_kind: 'dropset', parent_set_id: 'h' }),
        s({ setId: 'f3', ordinal: 3, weight: 20, set_kind: 'dropset', parent_set_id: 'h' }),
      ]),
    );
    let rows: { id: string; parent_set_id: string | null; weight_kg?: number | null }[] =
      await db.getAllAsync<{ id: string; parent_set_id: string | null }>(
        `SELECT id, parent_set_id FROM "set" WHERE session_id = 'sess-1' ORDER BY ordering ASC`,
      );
    expect(rows).toEqual([
      { id: 'h', parent_set_id: null },
      { id: 'f1', parent_set_id: 'h' },
      { id: 'f2', parent_set_id: 'h' },
      { id: 'f3', parent_set_id: 'h' },
    ]);

    // Tick 3 (SHRINK): the Watch deletes the MIDDLE follower f2 and re-numbers
    // the survivors so f3's data slides up to ordinal 2 (the Watch re-emits its
    // current chain compacted). The (session_exercise_id, ordinal) reconcile
    // updates the on-device ordinal-2 row in place (id 'f2') with f3's value,
    // and the per-exercise purge drops the now-orphan ordinal-3 row. Net: a
    // head + 2 followers, all still parented, no orphan/dup. (The id realigns
    // to the ordinal slot — expected for the live mirror; canonical history id
    // only matters at end-session.)
    await replaceLiveMirror(
      db,
      chainSnap([
        s({ setId: 'h', ordinal: 0, set_kind: 'dropset', parent_set_id: null }),
        s({ setId: 'f1', ordinal: 1, weight: 60, set_kind: 'dropset', parent_set_id: 'h' }),
        s({ setId: 'f3', ordinal: 2, weight: 20, set_kind: 'dropset', parent_set_id: 'h' }),
      ]),
    );
    rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
      weight_kg: number | null;
    }>(
      `SELECT id, parent_set_id, weight_kg FROM "set" WHERE session_id = 'sess-1' ORDER BY ordering ASC`,
    );
    // Exactly 3 rows — the deleted middle follower's value (40) is gone, every
    // remaining follower still links to the head, head intact.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'h', parent_set_id: null, weight_kg: 80 });
    expect(rows[1]).toMatchObject({ parent_set_id: 'h', weight_kg: 60 });
    expect(rows[2]).toMatchObject({ parent_set_id: 'h', weight_kg: 20 });
    // No row carries the deleted middle follower's weight (40) anywhere.
    expect(rows.some((r) => r.weight_kg === 40)).toBe(false);
    // Every non-head row points at the head (no dangling / orphan parent).
    const followers = rows.filter((r) => r.parent_set_id !== null);
    expect(followers.every((r) => r.parent_set_id === 'h')).toBe(true);
  });
});

// =====================================================================
// 2. Multi-exercise divergent-id beyond the 2-occurrence tested cases
// =====================================================================

describe('replaceLiveMirror — multi-exercise occurrence keying (3 occurrences + remove-then-readd)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db, 'sess-1');
  });

  afterEach(() => db.close());

  const exerciseRows = async () =>
    db.getAllAsync<{ id: string; exercise_id: string; ordering: number }>(
      `SELECT id, exercise_id, ordering FROM session_exercise
        WHERE session_id = 'sess-1' ORDER BY ordering ASC`,
    );

  it('the SAME exercise_id THREE times maps each occurrence onto its own canonical row (FIFO ordering ASC), stable across ticks', async () => {
    // Seed a canonical (template-built) tree: EX_A appears THREE times with
    // iPhone-minted ids + re-indexed ordering 1..3 + distinct set weights.
    await db.runAsync(
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'A',
    );
    for (let i = 0; i < 3; i++) {
      await db.runAsync(
        `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `ios-occ-${i}`,
        'sess-1',
        EX_A,
        i + 1, // canonical 1-based re-index
        1,
        'tpl-X',
      );
      await db.runAsync(
        `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
           weight_kg, reps, set_kind, is_logged, ordering, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `ios-occ-${i}-set`,
        'sess-1',
        EX_A,
        `ios-occ-${i}`,
        10 * (i + 1), // 10, 20, 30 — unlogged template default
        8,
        'working',
        0,
        1, // canonical 1-based set ordering
        1_700_000_000_000,
      );
    }

    // Watch mirror: 3 occurrences of EX_A with its OWN ids, raw 0-based
    // ordering, distinct LOGGED weights (100/200/300).
    const watchSnap: SessionSnapshot = {
      sessionId: 'sess-1',
      title: 'A',
      startedAt: 1_700_000_000_000,
      exercises: [0, 1, 2].map((i) => ({
        sessionExerciseId: `w-occ-${i}`,
        exerciseId: EX_A,
        exerciseName: 'Bench Press',
        ordering: i, // raw 0-based
        plannedSets: 1,
        sets: [s({ setId: `w-occ-${i}-set`, ordinal: 1, weight: 100 * (i + 1) })],
      })),
    };
    await replaceLiveMirror(db, watchSnap);
    await replaceLiveMirror(db, watchSnap); // second tick must not re-map

    // Exactly THREE canonical session_exercise rows — no parallel tree, no
    // collapse onto one row. Each keeps its own canonical id + template linkage.
    const rows = await exerciseRows();
    expect(rows.map((r) => r.id)).toEqual(['ios-occ-0', 'ios-occ-1', 'ios-occ-2']);
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_A, EX_A]);

    // Each occurrence carries its OWN logged weight — proof the FIFO
    // occurrence mapping (N-th snapshot occ → N-th canonical row) held and the
    // occurrences did not cross-contaminate.
    const weights = await db.getAllAsync<{ session_exercise_id: string; weight_kg: number }>(
      `SELECT session_exercise_id, weight_kg FROM "set" WHERE session_id = 'sess-1'
        ORDER BY session_exercise_id ASC`,
    );
    expect(weights).toEqual([
      { session_exercise_id: 'ios-occ-0', weight_kg: 100 },
      { session_exercise_id: 'ios-occ-1', weight_kg: 200 },
      { session_exercise_id: 'ios-occ-2', weight_kg: 300 },
    ]);

    // Exactly 3 sets total — no duplication across the two ticks.
    const setCount = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "set" WHERE session_id = 'sess-1'`,
    );
    expect(setCount?.n).toBe(3);
  });

  it('exercise REMOVED (live purge) then RE-ADDED at a different position → a fresh freestyle INSERT, not a resurrected row', async () => {
    // Tick 1: three exercises A, B, C (all freestyle / Watch-authored).
    const threeEx = (order: { id: string; ex: string }[]): SessionSnapshot => ({
      sessionId: 'sess-1',
      title: 'Push',
      startedAt: 1_700_000_000_000,
      exercises: order.map((o, idx) => ({
        sessionExerciseId: o.id,
        exerciseId: o.ex,
        exerciseName: 'X',
        ordering: idx,
        plannedSets: 1,
        sets: [s({ setId: `${o.id}-set`, ordinal: 0, weight: 50 })],
      })),
    });

    await replaceLiveMirror(
      db,
      threeEx([
        { id: 'se-a', ex: EX_A },
        { id: 'se-b', ex: EX_B },
        { id: 'se-c', ex: EX_C },
      ]),
    );
    expect((await exerciseRows()).map((r) => r.exercise_id)).toEqual([EX_A, EX_B, EX_C]);

    // Tick 2: the user DELETES EX_B on the Watch → the live exercise purge
    // removes se-b + its set immediately (purgeExercisesAbsentFromSnapshot).
    const afterDelete = await replaceLiveMirror(
      db,
      threeEx([
        { id: 'se-a', ex: EX_A },
        { id: 'se-c', ex: EX_C },
      ]),
    );
    expect(afterDelete.purgedExercises).toBe(1); // se-b gone
    expect((await exerciseRows()).map((r) => r.exercise_id)).toEqual([EX_A, EX_C]);
    const bGone = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_exercise WHERE id = 'se-b'`,
    );
    expect(bGone?.n).toBe(0);

    // Tick 3: the user RE-ADDS EX_B but now at the END (a different position),
    // with a NEW Watch-minted id (se-b2) and a new logged weight. Because no
    // unclaimed canonical row exists for that EX_B occurrence, the reconcile
    // must INSERT a fresh row — NOT resurrect the purged se-b.
    await replaceLiveMirror(
      db,
      threeEx([
        { id: 'se-a', ex: EX_A },
        { id: 'se-c', ex: EX_C },
        { id: 'se-b2', ex: EX_B },
      ]),
    );
    const rows = await exerciseRows();
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_C, EX_B]);
    expect(rows.map((r) => r.id)).toEqual(['se-a', 'se-c', 'se-b2']); // fresh id at the end
    // The old purged id stays gone (no resurrection).
    expect(rows.some((r) => r.id === 'se-b')).toBe(false);
    // EX_B's re-added set is present under the NEW exercise row.
    const bSet = await db.getFirstAsync<{ session_exercise_id: string }>(
      `SELECT session_exercise_id FROM "set" s
         JOIN session_exercise se ON s.session_exercise_id = se.id
        WHERE se.exercise_id = ? AND se.session_id = 'sess-1'`,
      EX_B,
    );
    expect(bSet?.session_exercise_id).toBe('se-b2');
  });
});

// =====================================================================
// 3. displayRank fractional insert-between (wire-ordinal vs display_rank)
// =====================================================================

describe('replaceLiveMirror — display_rank fractional mid-insert (ordinal/rank divergence)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db, 'sess-1');
  });

  afterEach(() => db.close());

  const oneExercise = (sets: SessionSnapshotSet[]): SessionSnapshot => ({
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: EX_A,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 3,
        sets,
      },
    ],
  });

  it('a set inserted BETWEEN two sets (fractional display_rank, APPEND ordinal) renders in monotonic display order while identity stays keyed on ordering', async () => {
    // Tick 1: two working sets at ordinals 1 and 2, ranks 1 and 2.
    await replaceLiveMirror(
      db,
      oneExercise([
        s({ setId: 'a', ordinal: 1, weight: 80, display_rank: 1 }),
        s({ setId: 'b', ordinal: 2, weight: 90, display_rank: 2 }),
      ]),
    );

    // Tick 2: the user does「插下一行」between a and b. The Watch mints the new
    // set with the next APPEND ordinal (3 — wire ordinal is glued to identity,
    // so a mid-insert cannot renumber existing rows) but a FRACTIONAL
    // display_rank (1.5 — the midpoint between a's rank 1 and b's rank 2). This
    // is the ordinal/rank DIVERGENCE: ordinal says "appended last", rank says
    // "displayed in the middle".
    await replaceLiveMirror(
      db,
      oneExercise([
        s({ setId: 'a', ordinal: 1, weight: 80, display_rank: 1 }),
        s({ setId: 'b', ordinal: 2, weight: 90, display_rank: 2 }),
        s({ setId: 'mid', ordinal: 3, weight: 85, display_rank: 1.5 }),
      ]),
    );

    const rows = await db.getAllAsync<{
      id: string;
      ordering: number;
      display_rank: number | null;
    }>(
      `SELECT id, ordering, display_rank FROM "set" WHERE session_id = 'sess-1'
        ORDER BY ordering ASC`,
    );
    // Identity: each row kept its OWN wire ordinal (1 / 2 / 3) — the reconcile
    // identity key is unchanged, so a future mid-list delete still purges the
    // right row.
    expect(rows).toEqual([
      { id: 'a', ordering: 1, display_rank: 1 },
      { id: 'b', ordering: 2, display_rank: 2 },
      { id: 'mid', ordering: 3, display_rank: 1.5 },
    ]);

    // Display order: the shared `display_rank ?? ordering` comparator puts the
    // mid-inserted row BETWEEN a and b (rank 1.5), NOT last (ordinal 3). This
    // is the divergence resolving correctly — the bug v025 fixed.
    const displayOrder = sortSetsByDisplayRank(rows).map((r) => r.id);
    expect(displayOrder).toEqual(['a', 'mid', 'b']);

    // And the order is strictly monotonic on the sort key (no ties / inversions).
    const keys = sortSetsByDisplayRank(rows).map((r) => r.display_rank ?? r.ordering);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).toBeGreaterThan(keys[i - 1]);
    }
  });

  it('a second mid-insert between a and mid (rank 1.25) stays monotonic + stable on re-apply (idempotent)', async () => {
    // Build up: a(1), mid(1.5), b(2), then insert mid2 at rank 1.25 (between
    // a and mid) with the next append ordinal (4).
    const full = oneExercise([
      s({ setId: 'a', ordinal: 1, weight: 80, display_rank: 1 }),
      s({ setId: 'b', ordinal: 2, weight: 90, display_rank: 2 }),
      s({ setId: 'mid', ordinal: 3, weight: 85, display_rank: 1.5 }),
      s({ setId: 'mid2', ordinal: 4, weight: 82, display_rank: 1.25 }),
    ]);
    await replaceLiveMirror(db, full);
    // Re-apply the SAME snapshot (dual-fire redelivery) — must be a no-op.
    await replaceLiveMirror(db, full);

    const rows = await db.getAllAsync<{
      id: string;
      ordering: number;
      display_rank: number | null;
    }>(
      `SELECT id, ordering, display_rank FROM "set" WHERE session_id = 'sess-1'
        ORDER BY ordering ASC`,
    );
    // Exactly 4 rows after the redelivery (no duplication).
    expect(rows).toHaveLength(4);
    // Display order is a(1) → mid2(1.25) → mid(1.5) → b(2): strictly monotonic.
    const displayOrder = sortSetsByDisplayRank(rows).map((r) => r.id);
    expect(displayOrder).toEqual(['a', 'mid2', 'mid', 'b']);
    const keys = sortSetsByDisplayRank(rows).map((r) => r.display_rank ?? r.ordering);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).toBeGreaterThan(keys[i - 1]);
    }
  });
});
