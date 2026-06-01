/**
 * Slice 13d / NEW-Q50 (2026-05-29) — replaceLiveMirror unit tests.
 *
 * Covers the snapshot-replace semantics that supersede the deleted
 * 6-kind reducer + per-field LWW (D19/D20 simplification):
 *   - happy path: first-time snapshot creates session + exercises + sets
 *   - idempotency: re-applying same snapshot is a no-op
 *   - replace: re-applying with mutated values overwrites cleanly
 *   - empty exercises: snapshot with no exercises still upserts session
 *   - multiple sets per exercise: ordering preserved + all rows present
 *   - snapshot does NOT delete iPhone-side rows missing from snapshot
 *     (authority-but-not-purge contract — purge is end-session's job)
 *   - session-bound columns (ended_at, bodyweight_snapshot_kg) preserved
 *     across replace (only mirrored cols overwrite)
 *
 * Real DB via better-sqlite3 in-memory; SessionSnapshot built inline
 * (no WC bridge needed — pure SQL transform).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  replaceLiveMirror,
  reconcileSessionTree,
} from '../../src/services/replaceLiveMirror';
import type { SessionSnapshot } from '../../src/adapters/watch/handshake';

const BUILTIN_BENCH_PRESS_ID = '00000000-0000-4000-8000-000000000001';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: BUILTIN_BENCH_PRESS_ID,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 3,
        sets: [
          {
            setId: 'set-1',
            ordinal: 0,
            weight: 80,
            reps: 8,
            rpe: null,
            rest_sec: 90,
            notes: null,
            set_kind: 'working',
            is_logged: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('replaceLiveMirror — NEW-Q50 snapshot-replace', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('happy path — creates session + session_exercise + set rows on first apply', async () => {
    await replaceLiveMirror(db, snapshot());

    const session = await db.getFirstAsync<{
      id: string;
      started_at: number;
      title: string;
    }>('SELECT id, started_at, title FROM session WHERE id = ?', 'sess-1');
    expect(session).toEqual({
      id: 'sess-1',
      started_at: 1_700_000_000_000,
      title: 'Push Day',
    });

    const exercises = await db.getAllAsync<{
      id: string;
      session_id: string;
      ordering: number;
      planned_sets: number;
    }>(
      'SELECT id, session_id, ordering, planned_sets FROM session_exercise WHERE session_id = ?',
      'sess-1',
    );
    expect(exercises).toEqual([
      { id: 'se-1', session_id: 'sess-1', ordering: 0, planned_sets: 3 },
    ]);

    const sets = await db.getAllAsync<{
      id: string;
      weight_kg: number | null;
      reps: number | null;
      set_kind: string;
      is_logged: number;
      ordering: number;
    }>(
      `SELECT id, weight_kg, reps, set_kind, is_logged, ordering
       FROM "set" WHERE session_id = ?`,
      'sess-1',
    );
    expect(sets).toEqual([
      {
        id: 'set-1',
        weight_kg: 80,
        reps: 8,
        set_kind: 'working',
        is_logged: 1,
        ordering: 0,
      },
    ]);
  });

  it('dropset chain (freestyle) — head + follower both INSERT, follower keeps the wire head id', async () => {
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              {
                setId: 'h1',
                ordinal: 0,
                weight: 80,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: null,
              },
              {
                setId: 'f1',
                ordinal: 1,
                weight: 40,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: 'h1',
              },
            ],
          },
        ],
      }),
    );

    const rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
    }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(rows).toEqual([
      { id: 'h1', parent_set_id: null },
      { id: 'f1', parent_set_id: 'h1' },
    ]);
  });

  it('dropset chain (canonical head) — follower parent_set_id resolves to the on-device head id, not the wire id', async () => {
    // Pre-seed a canonical (template-built) tree: 1 working set with id 'c1'.
    await db.runAsync(
      `INSERT INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'Push Day',
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets)
       VALUES (?, ?, ?, ?, ?)`,
      'se-canonical',
      'sess-1',
      BUILTIN_BENCH_PRESS_ID,
      0,
      3,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
         weight_kg, reps, set_kind, is_logged, ordering, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'c1',
      'sess-1',
      BUILTIN_BENCH_PRESS_ID,
      'se-canonical',
      80,
      8,
      'working',
      0,
      0,
      1_700_000_000_000,
    );

    // Watch live-mirror: the user cycled the working set to a dropset HEAD
    // (wire id 'w-head', ≠ canonical 'c1') and added a follower whose parent
    // points at the WIRE head id.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-wire',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              {
                setId: 'w-head',
                ordinal: 0,
                weight: 80,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: null,
              },
              {
                setId: 'w-foll',
                ordinal: 1,
                weight: 40,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: 'w-head',
              },
            ],
          },
        ],
      }),
    );

    // Head matched the canonical row → UPDATE in place ('c1', now dropset,
    // parent still null). Follower INSERTed with the RESOLVED parent = the
    // on-device head id 'c1' (NOT the wire id 'w-head').
    const rows = await db.getAllAsync<{
      id: string;
      set_kind: string;
      parent_set_id: string | null;
      ordering: number;
    }>(
      `SELECT id, set_kind, parent_set_id, ordering FROM "set"
        WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(rows).toEqual([
      { id: 'c1', set_kind: 'dropset', parent_set_id: null, ordering: 0 },
      { id: 'w-foll', set_kind: 'dropset', parent_set_id: 'c1', ordering: 1 },
    ]);
  });

  it('dropset chain (re-sync) — an existing follower with NULL parent is retro-fixed via UPDATE', async () => {
    // Simulate a session whose follower was first synced by an OLDER reconcile
    // (no parent_set_id column written) → head 'c1' + follower 'f-old' (NULL).
    await db.runAsync(
      `INSERT INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'Push Day',
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets)
       VALUES (?, ?, ?, ?, ?)`,
      'se-1',
      'sess-1',
      BUILTIN_BENCH_PRESS_ID,
      0,
      2,
    );
    for (const [id, ord, parent] of [
      ['c1', 0, null],
      ['f-old', 1, null],
    ] as const) {
      await db.runAsync(
        `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
           weight_kg, reps, set_kind, is_logged, ordering, created_at, parent_set_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        'sess-1',
        BUILTIN_BENCH_PRESS_ID,
        'se-1',
        80,
        8,
        'dropset',
        0,
        ord,
        1_700_000_000_000,
        parent,
      );
    }

    // A fresh live-mirror tick carrying the chain link (Watch wire ids).
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-wire',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              {
                setId: 'w-head',
                ordinal: 0,
                weight: 80,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: null,
              },
              {
                setId: 'w-foll',
                ordinal: 1,
                weight: 40,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: 'w-head',
              },
            ],
          },
        ],
      }),
    );

    // 'f-old' matched by (session_exercise_id, ordinal) → UPDATE retro-wrote
    // its parent to the on-device head 'c1'. 'c1' stays a head (NULL).
    const rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
    }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(rows).toEqual([
      { id: 'c1', parent_set_id: null },
      { id: 'f-old', parent_set_id: 'c1' },
    ]);
  });

  it('idempotency — re-applying the same snapshot leaves the DB unchanged', async () => {
    await replaceLiveMirror(db, snapshot());
    await replaceLiveMirror(db, snapshot());

    const sessionCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session',
    );
    const exerciseCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session_exercise',
    );
    const setCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "set"',
    );
    expect(sessionCount?.n).toBe(1);
    expect(exerciseCount?.n).toBe(1);
    expect(setCount?.n).toBe(1);
  });

  it('replace — re-applying with mutated values overwrites cleanly', async () => {
    await replaceLiveMirror(db, snapshot());
    const updated = snapshot({
      title: 'Push Day v2',
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 4, // was 3
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: 85, // was 80
              reps: 6, // was 8
              rpe: null,
              rest_sec: 90,
              notes: 'felt easy',
              set_kind: 'working',
              is_logged: true,
            },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, updated);

    const session = await db.getFirstAsync<{ title: string }>(
      'SELECT title FROM session WHERE id = ?',
      'sess-1',
    );
    expect(session?.title).toBe('Push Day v2');

    const ex = await db.getFirstAsync<{ planned_sets: number }>(
      'SELECT planned_sets FROM session_exercise WHERE id = ?',
      'se-1',
    );
    expect(ex?.planned_sets).toBe(4);

    const set = await db.getFirstAsync<{
      weight_kg: number;
      reps: number;
      notes: string | null;
    }>(
      'SELECT weight_kg, reps, notes FROM "set" WHERE id = ?',
      'set-1',
    );
    expect(set).toEqual({ weight_kg: 85, reps: 6, notes: 'felt easy' });
  });

  it('empty exercises — snapshot with no exercises still upserts session row', async () => {
    await replaceLiveMirror(db, snapshot({ exercises: [] }));

    const session = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM session WHERE id = ?',
      'sess-1',
    );
    expect(session).not.toBeNull();

    const exCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session_exercise',
    );
    expect(exCount?.n).toBe(0);
  });

  it('multiple sets per exercise — all rows persisted with ordering preserved', async () => {
    const snap = snapshot({
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-a',
              ordinal: 0,
              weight: 60,
              reps: 10,
              rpe: null,
              rest_sec: 60,
              notes: null,
              set_kind: 'warmup',
              is_logged: true,
            },
            {
              setId: 'set-b',
              ordinal: 1,
              weight: 80,
              reps: 8,
              rpe: null,
              rest_sec: 90,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
            {
              setId: 'set-c',
              ordinal: 2,
              weight: 85,
              reps: 5,
              rpe: null,
              rest_sec: 120,
              notes: null,
              set_kind: 'working',
              is_logged: false,
            },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, snap);

    const sets = await db.getAllAsync<{
      id: string;
      ordering: number;
      set_kind: string;
      is_logged: number;
    }>(
      `SELECT id, ordering, set_kind, is_logged FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(sets).toEqual([
      { id: 'set-a', ordering: 0, set_kind: 'warmup', is_logged: 1 },
      { id: 'set-b', ordering: 1, set_kind: 'working', is_logged: 1 },
      { id: 'set-c', ordering: 2, set_kind: 'working', is_logged: 0 },
    ]);
  });

  it('live mirror DELETES a set the Watch dropped from a present exercise (per-exercise set purge)', async () => {
    // First snapshot: 2 sets under se-1.
    const initial = snapshot({
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: 80,
              reps: 8,
              rpe: null,
              rest_sec: 90,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
            {
              setId: 'set-2',
              ordinal: 1,
              weight: 80,
              reps: 8,
              rpe: null,
              rest_sec: 90,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, initial);

    // Second snapshot: only set-1 (set-2 vanished from Watch). The live
    // mirror keeps each PRESENT exercise's set list in lockstep with the
    // Watch (per-exercise purge), so set-2 is deleted now — not deferred to
    // end-session. (Absent EXERCISES stay end-session's job; this only
    // touches sets under exercises the snapshot still contains.)
    const reduced = snapshot({
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: 80,
              reps: 8,
              rpe: null,
              rest_sec: 90,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, reduced);

    const setIds = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? ORDER BY id ASC`,
      'sess-1',
    );
    expect(setIds.map((r) => r.id)).toEqual(['set-1']);
  });

  it('reconcile (Bug X / Approach A) — mirror onto an existing template-built tree UPDATES in place (no duplicate, template_id preserved)', async () => {
    // Simulate the iPhone's canonical template tree (what
    // startSessionFromTemplate builds): a session_exercise with an iPhone
    // UUID + template_id linkage + a planned set with an iPhone UUID, all
    // unlogged. The Watch live mirror then arrives carrying its OWN ids
    // ('se-1' / 'set-1') for the SAME logical exercise. Keyed by natural
    // position (ordering / ordinal) it must UPDATE the canonical rows —
    // NOT insert a parallel tree (the pre-Approach-A duplicate bug).
    await db.runAsync(
      `INSERT INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'A',
    );
    // Canonical exercise ordering = 1 (snapshotForSession re-indexes 1..N);
    // canonical set ordering = 1 (startSessionFromTemplate uses j+1).
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ios-se-uuid',
      'sess-1',
      BUILTIN_BENCH_PRESS_ID,
      1, // re-indexed 1-based
      3,
      'tpl-A',
    );
    await db.runAsync(
      `INSERT INTO "set"
         (id, session_id, exercise_id, session_exercise_id,
          weight_kg, reps, notes, set_kind, is_logged, ordering, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ios-set-uuid',
      'sess-1',
      BUILTIN_BENCH_PRESS_ID,
      'ios-se-uuid',
      20, // template default — not yet logged
      8,
      null,
      'working',
      0,
      1, // 1-based set position
      1_700_000_000_000,
    );

    // Watch mirror — different ids, and a DIFFERENT ordering convention:
    // ex.ordering = 0 (raw template_exercise.ordering) vs canonical's
    // re-indexed 1. Position-matching must still align them (the dup-bug
    // root cause: value-matching ordering 0≠1 inserted a parallel row).
    // Set ordinal = 1 (both sides 1-based → set value-match still holds).
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0, // raw template ordering (≠ canonical's 1)
            plannedSets: 3,
            sets: [
              {
                setId: 'set-1',
                ordinal: 1, // 1-based, matches canonical set ordering
                weight: 100, // logged on the Watch
                reps: 5,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'working',
                is_logged: true,
              },
            ],
          },
        ],
      }),
    );

    // Exactly ONE session_exercise — the canonical one, updated. No dup.
    const seRows = await db.getAllAsync<{
      id: string;
      template_id: string | null;
    }>(
      `SELECT id, template_id FROM session_exercise WHERE session_id = ?`,
      'sess-1',
    );
    expect(seRows).toHaveLength(1);
    expect(seRows[0].id).toBe('ios-se-uuid'); // canonical id kept
    expect(seRows[0].template_id).toBe('tpl-A'); // linkage preserved!

    // Exactly ONE set — the canonical one, updated with the logged values.
    const setRows = await db.getAllAsync<{
      id: string;
      weight_kg: number;
      reps: number;
      is_logged: number;
    }>(
      `SELECT id, weight_kg, reps, is_logged FROM "set" WHERE session_id = ?`,
      'sess-1',
    );
    expect(setRows).toHaveLength(1);
    expect(setRows[0].id).toBe('ios-set-uuid'); // canonical id kept
    expect(setRows[0].weight_kg).toBe(100); // logged value mirrored in place
    expect(setRows[0].reps).toBe(5);
    expect(setRows[0].is_logged).toBe(1);
  });

  it('deconstruct dropset — a follower cycled back to working has its stale parent_set_id CLEARED', async () => {
    // Seed a synced dropset chain: head 'h1' + follower 'f1' (parent = h1).
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              { setId: 'h1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: null },
              { setId: 'f1', ordinal: 1, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'h1' },
            ],
          },
        ],
      }),
    );
    // Sanity: f1 has the parent set.
    const before = await db.getFirstAsync<{ parent_set_id: string | null }>(
      `SELECT parent_set_id FROM "set" WHERE id = ?`,
      'f1',
    );
    expect(before?.parent_set_id).toBe('h1');

    // User "deconstructs" the dropset — f1 cycles back to a plain working set.
    // The Watch sends it as set_kind='working' WITHOUT a parent. The reconcile's
    // non-dropset branch must NULL out the stale parent so it can't silently
    // re-fold f1 into the chain if it later cycles to dropset again.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              { setId: 'h1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: null },
              { setId: 'f1', ordinal: 1, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: false, parent_set_id: null },
            ],
          },
        ],
      }),
    );

    const after = await db.getAllAsync<{
      id: string;
      set_kind: string;
      parent_set_id: string | null;
    }>(
      `SELECT id, set_kind, parent_set_id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(after).toEqual([
      { id: 'h1', set_kind: 'dropset', parent_set_id: null },
      { id: 'f1', set_kind: 'working', parent_set_id: null }, // stale parent cleared
    ]);
  });

  it('dropset middle-follower delete — per-exercise purge drops the middle follower, remaining chain links survive', async () => {
    // Chain: head h + 2 followers f1, f2 (both parent = h).
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              { setId: 'h', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: null },
              { setId: 'f1', ordinal: 1, weight: 60, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'h' },
              { setId: 'f2', ordinal: 2, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'h' },
            ],
          },
        ],
      }),
    );

    // Watch deletes the MIDDLE follower f1, re-numbers the survivors so the
    // remaining follower (f2's data) now sits at ordinal 1. The set reconcile
    // matches by (session_exercise_id, ordinal), so the on-device row at
    // ordinal 1 (id 'f1') is UPDATED in place to carry f2's values, and the
    // now-orphaned ordinal-2 row is dropped by the per-exercise purge. Net: the
    // chain shrinks to head + one follower (parent still resolves to head 'h').
    // The id realigns to the ordinal slot — expected for the live mirror; the
    // canonical history id only matters at end-session reconcile.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              { setId: 'h', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: null },
              { setId: 'f2', ordinal: 1, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'h' },
            ],
          },
        ],
      }),
    );

    const rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
      ordering: number;
      weight_kg: number | null;
    }>(
      `SELECT id, parent_set_id, ordering, weight_kg FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    // Exactly 2 rows — the chain shrank by one (the middle follower).
    expect(rows).toHaveLength(2);
    // Head unchanged.
    expect(rows[0]).toEqual({ id: 'h', parent_set_id: null, ordering: 0, weight_kg: 80 });
    // The surviving follower carries f2's value (40) and still links to head 'h'
    // (the deleted middle follower's weight 60 is gone). Id realigned to the
    // ordinal-1 slot ('f1') by the (session_exercise_id, ordinal) reconcile.
    expect(rows[1].ordering).toBe(1);
    expect(rows[1].parent_set_id).toBe('h');
    expect(rows[1].weight_kg).toBe(40);
    // The middle follower's old value (60) is no longer present anywhere.
    expect(rows.some((r) => r.weight_kg === 60)).toBe(false);
  });

  it('dangling parent — a follower whose head is absent from the snapshot collapses parent to NULL (no broken FK)', async () => {
    // The snapshot carries ONLY a follower whose parent_set_id references a head
    // id that never appears in this snapshot (e.g. a malformed / partial Watch
    // emit). setIdMap.get returns undefined → resolvedParentId = null. The row
    // INSERTs with parent_set_id NULL rather than a dangling reference.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 1,
            sets: [
              { setId: 'orphan', ordinal: 0, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'head-never-sent' },
            ],
          },
        ],
      }),
    );

    const row = await db.getFirstAsync<{ id: string; parent_set_id: string | null }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = ?`,
      'sess-1',
    );
    expect(row).toEqual({ id: 'orphan', parent_set_id: null });
  });

  it('preserves session-bound columns not in the snapshot (ended_at, bodyweight_snapshot_kg)', async () => {
    // First apply baseline snapshot, then iPhone-side mutate
    // un-mirrored columns, then re-apply snapshot — those columns
    // must survive.
    await replaceLiveMirror(db, snapshot());

    await db.runAsync(
      `UPDATE session SET ended_at = ?, bodyweight_snapshot_kg = ? WHERE id = ?`,
      1_700_000_500_000,
      75.5,
      'sess-1',
    );

    await replaceLiveMirror(db, snapshot({ title: 'Push Day renamed' }));

    const row = await db.getFirstAsync<{
      title: string;
      ended_at: number | null;
      bodyweight_snapshot_kg: number | null;
    }>(
      `SELECT title, ended_at, bodyweight_snapshot_kg FROM session WHERE id = ?`,
      'sess-1',
    );
    expect(row).toEqual({
      title: 'Push Day renamed',
      ended_at: 1_700_000_500_000,
      bodyweight_snapshot_kg: 75.5,
    });
  });

  it('regression — cycle a NON-LAST set into a dropset preserves the follower (no ordinal permute)', async () => {
    // grill-with-docs 2026-06-01 Q1=B. The Watch producer USED to re-stamp the
    // sorted ordinal pool by DISPLAY POSITION (`sortedOrdinals[i]`), which
    // collided a mid-list added follower's ordinal with an existing base row
    // under (session_exercise_id, ordinal) value-match → the follower was
    // written onto the wrong row then lost. The fix emits each set's OWN stable
    // ordinal. This test feeds the POST-FIX wire (stable ordinals, head-before-
    // follower ARRAY order so setIdMap resolves the parent) for the scenario
    // "cycle the MIDDLE working set into a dropset + add a follower".

    // Seed: 3 plain working sets at ordinals 0,1,2.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              { setId: 'sA', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true, parent_set_id: null },
              { setId: 'sB', ordinal: 1, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true, parent_set_id: null },
              { setId: 'sC', ordinal: 2, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true, parent_set_id: null },
            ],
          },
        ],
      }),
    );

    // sB → dropset head, add follower sF (own ordinal = max+1 = 3, displayed
    // mid-list). Post-fix wire: each set keeps its OWN ordinal (sF@3, sC@2);
    // ARRAY order is display order so the head (sB) precedes its follower (sF).
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              { setId: 'sA', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true, parent_set_id: null },
              { setId: 'sB', ordinal: 1, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: null },
              { setId: 'sF', ordinal: 3, weight: 60, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: 'sB' },
              { setId: 'sC', ordinal: 2, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true, parent_set_id: null },
            ],
          },
        ],
      }),
    );

    const rows = await db.getAllAsync<{
      id: string;
      ordering: number;
      set_kind: string;
      parent_set_id: string | null;
    }>(
      `SELECT id, ordering, set_kind, parent_set_id FROM "set"
         WHERE session_exercise_id = 'se-1' ORDER BY ordering ASC`,
    );
    // All four sets present — the follower was NOT lost (the pre-fix permute bug).
    expect(rows).toEqual([
      { id: 'sA', ordering: 0, set_kind: 'working', parent_set_id: null },
      { id: 'sB', ordering: 1, set_kind: 'dropset', parent_set_id: null }, // head
      { id: 'sC', ordering: 2, set_kind: 'working', parent_set_id: null },
      { id: 'sF', ordering: 3, set_kind: 'dropset', parent_set_id: 'sB' }, // follower of sB
    ]);
  });
});

// =====================================================================
// Phase D — tombstone precise-purge (Q5 live-delete, slice 13d sync-refactor)
// =====================================================================

describe('reconcileSessionTree — tombstone precise purge (deletedIds)', () => {
  let db: BetterSqliteDatabase;

  // Two-exercise / multi-set seed so we can assert PRECISE deletion.
  function twoExerciseSnapshot(
    overrides: Partial<SessionSnapshot> = {},
  ): SessionSnapshot {
    return {
      sessionId: 'sess-1',
      title: 'Push Day',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: '00000000-0000-4000-8000-000000000001',
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            { setId: 'set-1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
            { setId: 'set-2', ordinal: 1, weight: 80, reps: 6, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
        {
          sessionExerciseId: 'se-2',
          exerciseId: '00000000-0000-4000-8000-000000000002',
          exerciseName: 'Squat',
          ordering: 1,
          plannedSets: 1,
          sets: [
            { setId: 'set-3', ordinal: 0, weight: 100, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: false },
          ],
        },
      ],
      ...overrides,
    };
  }

  const idsOf = async (table: 'set' | 'session_exercise') => {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "${table}" WHERE session_id = ? ORDER BY id`,
      'sess-1',
    );
    return rows.map((r) => r.id);
  };

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // Seed the full two-exercise tree first (legacy live tick, no deletes).
    await replaceLiveMirror(db, twoExerciseSnapshot());
  });

  afterEach(() => db.close());

  it('removes a tombstoned set but keeps siblings (live tick, purgeTail false)', async () => {
    // set-2 is tombstoned AND still listed in the snapshot exercise — the
    // tombstone wins (precise delete runs after upsert).
    const res = await reconcileSessionTree(
      db,
      twoExerciseSnapshot({ deletedIds: { exerciseIds: [], setIds: ['set-2'] } }),
      { purgeTail: false },
    );
    expect(res.tombstonedSets).toBe(1);
    expect(res.tombstonedExercises).toBe(0);
    expect(await idsOf('set')).toEqual(['set-1', 'set-3']);
    expect(await idsOf('session_exercise')).toEqual(['se-1', 'se-2']);
  });

  it('removes a tombstoned exercise AND its sets, keeps the other exercise', async () => {
    const res = await reconcileSessionTree(
      db,
      twoExerciseSnapshot({ deletedIds: { exerciseIds: ['se-2'], setIds: [] } }),
      { purgeTail: false },
    );
    expect(res.tombstonedExercises).toBe(1);
    expect(res.tombstonedSets).toBe(1); // set-3 (child of se-2)
    expect(await idsOf('session_exercise')).toEqual(['se-1']);
    expect(await idsOf('set')).toEqual(['set-1', 'set-2']);
  });

  it('contrast — a snapshot-ABSENT-but-not-tombstoned set survives (only tombstones delete on a live tick)', async () => {
    // se-1 now lists ONLY set-1 (set-2 absent), no tombstone → set-2 STAYS
    // (the existing purgeTail-false invariant). This is the row the
    // tombstone test above deletes — proving deletion is driven by the
    // tombstone, not by snapshot absence.
    const onlySet1 = twoExerciseSnapshot();
    const trimmed: SessionSnapshot = {
      ...onlySet1,
      exercises: onlySet1.exercises.map((ex) =>
        ex.sessionExerciseId === 'se-1'
          ? { ...ex, sets: ex.sets.filter((s) => s.setId === 'set-1') }
          : ex,
      ),
    };
    const res = await reconcileSessionTree(db, trimmed, { purgeTail: false });
    expect(res.tombstonedSets).toBe(0);
    expect(await idsOf('set')).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('tombstone for an id with no local row is a harmless no-op', async () => {
    const res = await reconcileSessionTree(
      db,
      twoExerciseSnapshot({
        deletedIds: { exerciseIds: ['se-ghost'], setIds: ['set-ghost'] },
      }),
      { purgeTail: false },
    );
    expect(res.tombstonedSets).toBe(0);
    expect(res.tombstonedExercises).toBe(0);
    expect(await idsOf('set')).toEqual(['set-1', 'set-2', 'set-3']);
    expect(await idsOf('session_exercise')).toEqual(['se-1', 'se-2']);
  });

  it('no deletedIds → tombstoned counts are 0 (backward compatible)', async () => {
    const res = await reconcileSessionTree(db, twoExerciseSnapshot(), {
      purgeTail: false,
    });
    expect(res.tombstonedSets).toBe(0);
    expect(res.tombstonedExercises).toBe(0);
    expect(await idsOf('set')).toEqual(['set-1', 'set-2', 'set-3']);
  });
});
