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
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
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

  it('snapshot does NOT delete iPhone-side rows missing from snapshot (purge is end-session job)', async () => {
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

    // Second snapshot: only set-1 (set-2 vanished from Watch). Per
    // NEW-Q50 contract the replace MUST NOT delete set-2 — that's
    // end-session reconcile's job.
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
    expect(setIds.map((r) => r.id)).toEqual(['set-1', 'set-2']);
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
});
