/**
 * Slice 13d WC ship-blocker E2 (grill 2026-05-30, Q1/Q3) —
 * reconcileEndSnapshot unit tests.
 *
 * The end-session membership reconcile: given the Watch's final
 * authoritative snapshot, PURGE the iPhone rows the Watch deleted
 * mid-session (which the non-purging live mirror left behind = E2), with
 * the Q3 guards that prevent a malformed / empty snapshot from wiping
 * real data.
 *
 * Covers:
 *   - purge a tail set the Watch deleted (live mirror keeps it; end purges)
 *   - purge a whole exercise the Watch deleted (sets CASCADE)
 *   - guard: unparseable snapshot → bad-payload, NO purge, DB untouched
 *   - guard: sessionId mismatch → session-mismatch, NO purge
 *   - guard: empty snapshot vs non-empty DB → suspicious-empty, NO purge
 *   - legit empty session (snapshot empty + DB empty) → purged, no-op
 *   - idempotency: re-running the same final snapshot purges nothing more
 *
 * Real DB via better-sqlite3 in-memory; the live tree is seeded by
 * replaceLiveMirror (mirrors the real flow) then reconciled.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import { reconcileEndSnapshot } from '../../src/services/endSnapshotReconcile';
import type {
  SessionSnapshot,
  SessionSnapshotExercise,
  SessionSnapshotSet,
} from '../../src/adapters/watch/handshake';

const BUILTIN_BENCH_PRESS_ID = '00000000-0000-4000-8000-000000000001';

function set(
  overrides: Partial<SessionSnapshotSet> & Pick<SessionSnapshotSet, 'setId' | 'ordinal'>,
): SessionSnapshotSet {
  return {
    weight: 80,
    reps: 8,
    rpe: null,
    rest_sec: 90,
    notes: null,
    set_kind: 'working',
    is_logged: true,
    ...overrides,
  };
}

function exercise(
  overrides: Partial<SessionSnapshotExercise> &
    Pick<SessionSnapshotExercise, 'sessionExerciseId' | 'ordering'>,
): SessionSnapshotExercise {
  return {
    exerciseId: BUILTIN_BENCH_PRESS_ID,
    exerciseName: 'Bench Press',
    plannedSets: 3,
    sets: [set({ setId: `${overrides.sessionExerciseId}-s0`, ordinal: 0 })],
    ...overrides,
  };
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [exercise({ sessionExerciseId: 'se-1', ordering: 0 })],
    ...overrides,
  };
}

async function countRows(db: BetterSqliteDatabase) {
  const ex = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session_exercise WHERE session_id = 'sess-1'`,
  );
  const sets = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "set" WHERE session_id = 'sess-1'`,
  );
  return { exercises: ex?.n ?? 0, sets: sets?.n ?? 0 };
}

describe('reconcileEndSnapshot — E2 end-session membership purge', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('purges a tail set the Watch deleted (live mirror kept it)', async () => {
    // Seed the live tree with 2 sets.
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          exercise({
            sessionExerciseId: 'se-1',
            ordering: 0,
            sets: [
              set({ setId: 'set-1', ordinal: 0 }),
              set({ setId: 'set-2', ordinal: 1 }),
            ],
          }),
        ],
      }),
    );
    expect((await countRows(db)).sets).toBe(2);

    // Final snapshot dropped set-2 → end reconcile must DELETE it.
    const result = await reconcileEndSnapshot(
      db,
      'sess-1',
      snapshot({
        exercises: [
          exercise({
            sessionExerciseId: 'se-1',
            ordering: 0,
            sets: [set({ setId: 'set-1', ordinal: 0 })],
          }),
        ],
      }),
    );

    expect(result).toMatchObject({ purged: true, purgedSets: 1, purgedExercises: 0 });
    const remaining = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-1' ORDER BY id`,
    );
    expect(remaining.map((r) => r.id)).toEqual(['set-1']);
  });

  it('purges a whole exercise the Watch deleted (sets CASCADE)', async () => {
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          exercise({ sessionExerciseId: 'se-1', ordering: 0 }),
          exercise({ sessionExerciseId: 'se-2', ordering: 1 }),
        ],
      }),
    );
    expect(await countRows(db)).toEqual({ exercises: 2, sets: 2 });

    const result = await reconcileEndSnapshot(
      db,
      'sess-1',
      snapshot({
        exercises: [exercise({ sessionExerciseId: 'se-1', ordering: 0 })],
      }),
    );

    expect(result).toMatchObject({ purged: true, purgedExercises: 1 });
    expect(await countRows(db)).toEqual({ exercises: 1, sets: 1 });
    const remaining = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = 'sess-1'`,
    );
    expect(remaining.map((r) => r.id)).toEqual(['se-1']);
  });

  it('guard: unparseable snapshot → bad-payload, DB untouched', async () => {
    await replaceLiveMirror(db, snapshot());
    const before = await countRows(db);

    const result = await reconcileEndSnapshot(db, 'sess-1', { garbage: true });

    expect(result).toEqual({ purged: false, reason: 'bad-payload' });
    expect(await countRows(db)).toEqual(before);
  });

  it('guard: sessionId mismatch → session-mismatch, DB untouched', async () => {
    await replaceLiveMirror(db, snapshot());
    const before = await countRows(db);

    // snapshot.sessionId is 'sess-1' but we are ending 'sess-OTHER'.
    const result = await reconcileEndSnapshot(db, 'sess-OTHER', snapshot());

    expect(result).toEqual({ purged: false, reason: 'session-mismatch' });
    expect(await countRows(db)).toEqual(before);
  });

  it('guard: empty snapshot vs non-empty DB → suspicious-empty, NOT wiped', async () => {
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          exercise({
            sessionExerciseId: 'se-1',
            ordering: 0,
            sets: [
              set({ setId: 'set-1', ordinal: 0 }),
              set({ setId: 'set-2', ordinal: 1 }),
            ],
          }),
        ],
      }),
    );
    expect(await countRows(db)).toEqual({ exercises: 1, sets: 2 });

    // A glitchy empty snapshot must NOT delete the real tree.
    const result = await reconcileEndSnapshot(
      db,
      'sess-1',
      snapshot({ exercises: [] }),
    );

    expect(result).toEqual({ purged: false, reason: 'suspicious-empty' });
    expect(await countRows(db)).toEqual({ exercises: 1, sets: 2 });
  });

  it('legit empty session (snapshot empty + DB empty) → purged no-op', async () => {
    // Session row exists but no exercises (e.g. ended immediately).
    await db.runAsync(
      `INSERT INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'Empty',
    );

    const result = await reconcileEndSnapshot(
      db,
      'sess-1',
      snapshot({ exercises: [] }),
    );

    expect(result).toMatchObject({ purged: true, purgedExercises: 0, purgedSets: 0 });
    expect(await countRows(db)).toEqual({ exercises: 0, sets: 0 });
  });

  it('idempotency: re-running the same final snapshot purges nothing more', async () => {
    await replaceLiveMirror(
      db,
      snapshot({
        exercises: [
          exercise({
            sessionExerciseId: 'se-1',
            ordering: 0,
            sets: [
              set({ setId: 'set-1', ordinal: 0 }),
              set({ setId: 'set-2', ordinal: 1 }),
            ],
          }),
        ],
      }),
    );

    const finalSnap = snapshot({
      exercises: [
        exercise({
          sessionExerciseId: 'se-1',
          ordering: 0,
          sets: [set({ setId: 'set-1', ordinal: 0 })],
        }),
      ],
    });

    const first = await reconcileEndSnapshot(db, 'sess-1', finalSnap);
    expect(first).toMatchObject({ purged: true, purgedSets: 1 });

    const second = await reconcileEndSnapshot(db, 'sess-1', finalSnap);
    expect(second).toMatchObject({ purged: true, purgedSets: 0, purgedExercises: 0 });
    expect(await countRows(db)).toEqual({ exercises: 1, sets: 1 });
  });
});
