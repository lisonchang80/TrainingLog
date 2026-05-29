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
