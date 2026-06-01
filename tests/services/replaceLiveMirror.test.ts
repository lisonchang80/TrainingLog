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

/**
 * Seed a LIVE (un-ended) session row.
 *
 * H1 (2026-06-01): the live mirror no longer CREATES the session row — it
 * requires the row to already exist + be un-ended (`requireExistingLiveSession`,
 * via `replaceLiveMirror`). In production the start path
 * (`onStartFromWatch` → `startSessionFromTemplate` / `createSession`) always
 * commits the session row before any live tick. These tests mirror that by
 * pre-seeding the row in `beforeEach`. `INSERT OR IGNORE` so a test that also
 * builds a canonical tree (its own session INSERT) doesn't UNIQUE-collide.
 */
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

describe('replaceLiveMirror — NEW-Q50 snapshot-replace', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // H1: live mirror requires a pre-existing live session (start path owns
    // creation). Seed it so the reconcile body under test actually runs.
    await seedLiveSession(db, 'sess-1');
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
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
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

  // ── Cross-session Watch-authored id collision (2026-06-01 device-DB repro) ──
  // The Watch mints freestyle (dropset-follower / +1) set ids as "ADD-<n>" from
  // an in-memory counter that resets to 0 on Watch app relaunch — so two
  // DIFFERENT sessions can both mint "ADD-1". The on-device `set.id` is the
  // PRIMARY KEY, so a later session's INSERT … ON CONFLICT(id) DO UPDATE used to
  // CLOBBER a prior session's row in place (moving its parent_set_id +
  // session_exercise_id to the new session) while leaving session_id stale →
  // the old session's follower became a cross-session orphan and the new
  // session couldn't find its own. Fix: detect the cross-session id collision
  // in the INSERT branch and divert to a session-namespaced on-device id.
  it('cross-session ADD-1 collision — a later session does NOT clobber an earlier session’s follower', async () => {
    // Helper: a snapshot with a freestyle dropset HEAD + ONE follower whose
    // wire id is the colliding "ADD-1". Heads carry unique wire ids per session
    // (they don’t collide in the wild — only ADD-<n> followers do).
    const sessSnap = (sessionId: string, headWireId: string): SessionSnapshot =>
      snapshot({
        sessionId,
        exercises: [
          {
            sessionExerciseId: `se-${sessionId}`,
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              {
                setId: headWireId,
                ordinal: 0,
                weight: 80,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: true,
                parent_set_id: null,
              },
              {
                setId: 'ADD-1', // ← collides across sessions
                ordinal: 1,
                weight: 40,
                reps: 8,
                rpe: null,
                rest_sec: null,
                notes: null,
                set_kind: 'dropset',
                is_logged: false,
                parent_set_id: headWireId,
              },
            ],
          },
        ],
      });

    // Session A — live tick writes head + ADD-1 follower, then A ends.
    await seedLiveSession(db, 'sess-A');
    await replaceLiveMirror(db, sessSnap('sess-A', 'headA'));
    await db.runAsync(
      `UPDATE session SET ended_at = ? WHERE id = ?`,
      1_700_000_100_000,
      'sess-A',
    );

    // Session B — Watch relaunched, counter reset, mints "ADD-1" AGAIN.
    await seedLiveSession(db, 'sess-B');
    await replaceLiveMirror(db, sessSnap('sess-B', 'headB'));

    // Session A's follower MUST still belong to A, parented to A's head.
    const aFollower = await db.getFirstAsync<{
      session_id: string;
      parent_set_id: string | null;
      session_exercise_id: string;
    }>(
      `SELECT s.session_id, s.parent_set_id, s.session_exercise_id
         FROM "set" s
        WHERE s.session_id = 'sess-A' AND s.set_kind = 'dropset'
          AND s.parent_set_id IS NOT NULL`,
    );
    expect(aFollower).not.toBeNull();
    expect(aFollower?.session_id).toBe('sess-A');
    // Its parent + se must point at A's rows, NOT B's (no cross-session bleed).
    const aHead = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-A' AND parent_set_id IS NULL`,
    );
    expect(aFollower?.parent_set_id).toBe(aHead?.id);
    expect(aFollower?.session_exercise_id).toBe('se-sess-A');

    // Session B must have its OWN follower under its own head.
    const bFollower = await db.getFirstAsync<{
      session_id: string;
      parent_set_id: string | null;
    }>(
      `SELECT session_id, parent_set_id
         FROM "set"
        WHERE session_id = 'sess-B' AND parent_set_id IS NOT NULL`,
    );
    expect(bFollower).not.toBeNull();
    expect(bFollower?.session_id).toBe('sess-B');
    const bHead = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = 'sess-B' AND parent_set_id IS NULL`,
    );
    expect(bFollower?.parent_set_id).toBe(bHead?.id);

    // And exactly ONE follower per session (no row got moved or duplicated).
    const counts = await db.getAllAsync<{ session_id: string; n: number }>(
      `SELECT session_id, COUNT(*) AS n FROM "set"
        WHERE parent_set_id IS NOT NULL GROUP BY session_id ORDER BY session_id`,
    );
    expect(counts).toEqual([
      { session_id: 'sess-A', n: 1 },
      { session_id: 'sess-B', n: 1 },
    ]);
  });

  it('within-session idempotency — re-applying a freestyle ADD-1 over ticks does NOT duplicate or divert', async () => {
    // Same session, repeated ticks: the (se, ordinal) match keeps it a single
    // row with the RAW wire id (no needless session-namespacing within a
    // session — the diversion only triggers on a FOREIGN-session collision).
    await seedLiveSession(db, 'sess-1');
    const snap = snapshot({
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 2,
          sets: [
            { setId: 'h1', ordinal: 0, weight: 80, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: null },
            { setId: 'ADD-1', ordinal: 1, weight: 40, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: false, parent_set_id: 'h1' },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, snap);
    await replaceLiveMirror(db, snap);
    await replaceLiveMirror(db, snap);

    const rows = await db.getAllAsync<{ id: string; parent_set_id: string | null }>(
      `SELECT id, parent_set_id FROM "set" WHERE session_id = 'sess-1' ORDER BY ordering ASC`,
    );
    expect(rows).toEqual([
      { id: 'h1', parent_set_id: null },
      { id: 'ADD-1', parent_set_id: 'h1' }, // raw id preserved (no foreign collision)
    ]);
  });

  it('dropset chain (re-sync) — an existing follower with NULL parent is retro-fixed via UPDATE', async () => {
    // Simulate a session whose follower was first synced by an OLDER reconcile
    // (no parent_set_id column written) → head 'c1' + follower 'f-old' (NULL).
    await db.runAsync(
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
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
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
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

  it('preserves session-bound columns not in the snapshot (bodyweight_snapshot_kg) on a LIVE tick', async () => {
    // First apply baseline snapshot, then iPhone-side mutate an un-mirrored
    // column on the still-LIVE session, then re-apply — it must survive (the
    // live UPDATE touches only started_at + title).
    //
    // NOTE (H1): `ended_at` is deliberately NOT exercised here — a live tick on
    // an ENDED session is DROPPED by the liveness gate (it does not apply at
    // all), so "preserve ended_at across a live tick" is moot. That drop is
    // covered by the H1 gate tests below.
    await replaceLiveMirror(db, snapshot());

    await db.runAsync(
      `UPDATE session SET bodyweight_snapshot_kg = ? WHERE id = ?`,
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
      ended_at: null, // session stayed live the whole time
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

  it('multi-tick — cycle a MIDDLE set to dropset + add a follower, then reconcile 3× in a row: follower survives + base set stays matched', async () => {
    // Gap #1 (the canonical bug the fix addresses, stressed across ticks).
    // The Watch dual-fires + re-emits the SAME snapshot repeatedly (15s
    // appContext + instant sendMessage). Each redelivery re-runs reconcile.
    // A single-tick green is not enough: the second+ tick reconciles onto the
    // rows the FIRST tick created, so any id/parent drift would compound. We
    // assert idempotent stability — the follower is never lost and the head
    // stays the SAME on-device row across ticks.

    // Seed: 3 plain working sets sA/sB/sC at ordinals 0/1/2.
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

    // The cycled snapshot — sB→dropset head, follower sF@ordinal 3 (post-fix
    // stable ordinals, head-before-follower array order). This is the exact
    // wire shape the Watch re-emits every tick once the user has made the edit.
    const cycled = snapshot({
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
    });

    // Reconcile the cycled snapshot THREE times in a row (tick redelivery).
    await replaceLiveMirror(db, cycled);
    await replaceLiveMirror(db, cycled);
    await replaceLiveMirror(db, cycled);

    const rows = await db.getAllAsync<{
      id: string;
      ordering: number;
      set_kind: string;
      parent_set_id: string | null;
      weight_kg: number | null;
    }>(
      `SELECT id, ordering, set_kind, parent_set_id, weight_kg FROM "set"
         WHERE session_exercise_id = 'se-1' ORDER BY ordering ASC`,
    );
    // Exactly four rows — no follower duplication / loss across the 3 ticks.
    expect(rows).toHaveLength(4);
    expect(rows).toEqual([
      { id: 'sA', ordering: 0, set_kind: 'working', parent_set_id: null, weight_kg: 80 },
      { id: 'sB', ordering: 1, set_kind: 'dropset', parent_set_id: null, weight_kg: 80 }, // base/head stays matched
      { id: 'sC', ordering: 2, set_kind: 'working', parent_set_id: null, weight_kg: 80 },
      { id: 'sF', ordering: 3, set_kind: 'dropset', parent_set_id: 'sB', weight_kg: 60 }, // follower survives
    ]);
  });

  it('multi-tick — edit the follower weight on a later tick: the SAME follower row updates in place (no duplicate)', async () => {
    // Gap #1, mutation variant. Tick 1 establishes the chain; tick 2 carries a
    // mutated follower weight (the user nudged the dropset weight). The follower
    // must UPDATE in place — not insert a parallel row — and the chain link must
    // hold. This catches a (session_exercise_id, ordinal) mismatch that would
    // strand the mutation on a new row.
    const base = (followerWeight: number): SessionSnapshot =>
      snapshot({
        exercises: [
          {
            sessionExerciseId: 'se-1',
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 2,
            sets: [
              { setId: 'h', ordinal: 0, weight: 100, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: null },
              { setId: 'f', ordinal: 1, weight: followerWeight, reps: 8, rpe: null, rest_sec: null, notes: null, set_kind: 'dropset', is_logged: true, parent_set_id: 'h' },
            ],
          },
        ],
      });

    await replaceLiveMirror(db, base(60));
    await replaceLiveMirror(db, base(55)); // follower weight nudged 60 → 55
    await replaceLiveMirror(db, base(50)); // and again 55 → 50

    const rows = await db.getAllAsync<{
      id: string;
      parent_set_id: string | null;
      weight_kg: number | null;
    }>(
      `SELECT id, parent_set_id, weight_kg FROM "set"
         WHERE session_exercise_id = 'se-1' ORDER BY ordering ASC`,
    );
    expect(rows).toEqual([
      { id: 'h', parent_set_id: null, weight_kg: 100 },
      { id: 'f', parent_set_id: 'h', weight_kg: 50 }, // mutated in place, link intact
    ]);
  });

  it('reconcile by exercise_id + occurrence — the SAME exercise appearing twice maps to the right occurrence across ticks', async () => {
    // Gap #4. A superset / repeated movement: Bench Press appears TWICE in the
    // session. Seed a canonical (template-built) tree with two se rows for the
    // SAME exercise_id (occurrences A then B, distinct planned_sets + set
    // weights). The Watch live mirror carries its OWN se ids for both. The
    // reconcile must map snapshot-occurrence-1 → canonical-occurrence-1 and
    // snapshot-occurrence-2 → canonical-occurrence-2 (FIFO in ordering ASC) —
    // NOT collapse both onto one canonical row, and stay stable across ticks.
    await db.runAsync(
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
      'sess-1',
      1_700_000_000_000,
      'A',
    );
    // Occurrence 1 — canonical id 'ios-occ-1', ordering 1, planned 3.
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ios-occ-1', 'sess-1', BUILTIN_BENCH_PRESS_ID, 1, 3, 'tpl-X',
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
         weight_kg, reps, set_kind, is_logged, ordering, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ios-occ-1-set', 'sess-1', BUILTIN_BENCH_PRESS_ID, 'ios-occ-1',
      20, 8, 'working', 0, 1, 1_700_000_000_000,
    );
    // Occurrence 2 — canonical id 'ios-occ-2', ordering 2, planned 2.
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ios-occ-2', 'sess-1', BUILTIN_BENCH_PRESS_ID, 2, 2, 'tpl-X',
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id,
         weight_kg, reps, set_kind, is_logged, ordering, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ios-occ-2-set', 'sess-1', BUILTIN_BENCH_PRESS_ID, 'ios-occ-2',
      30, 8, 'working', 0, 1, 1_700_000_000_000,
    );

    // Watch mirror — two occurrences of the SAME exercise_id, Watch ids,
    // logged distinct weights (occ1=101, occ2=202). Reconcile twice.
    const watchSnap = snapshot({
      exercises: [
        {
          sessionExerciseId: 'w-occ-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [
            { setId: 'w-occ-1-set', ordinal: 1, weight: 101, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
        {
          sessionExerciseId: 'w-occ-2',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 1,
          plannedSets: 2,
          sets: [
            { setId: 'w-occ-2-set', ordinal: 1, weight: 202, reps: 5, rpe: null, rest_sec: null, notes: null, set_kind: 'working', is_logged: true },
          ],
        },
      ],
    });
    await replaceLiveMirror(db, watchSnap);
    await replaceLiveMirror(db, watchSnap); // second tick — must not double-map

    // Exactly TWO session_exercise rows — both canonical, in order, with their
    // template linkage preserved (no parallel tree, no collapse onto one row).
    const seRows = await db.getAllAsync<{
      id: string;
      ordering: number;
      planned_sets: number;
      template_id: string | null;
    }>(
      `SELECT id, ordering, planned_sets, template_id FROM session_exercise
         WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-1',
    );
    expect(seRows).toEqual([
      { id: 'ios-occ-1', ordering: 1, planned_sets: 3, template_id: 'tpl-X' },
      { id: 'ios-occ-2', ordering: 2, planned_sets: 2, template_id: 'tpl-X' },
    ]);

    // Each canonical set row carries its OWN occurrence's logged weight — proof
    // the occurrences didn't cross-contaminate.
    const occ1Set = await db.getFirstAsync<{ weight_kg: number }>(
      `SELECT weight_kg FROM "set" WHERE session_exercise_id = 'ios-occ-1'`,
    );
    const occ2Set = await db.getFirstAsync<{ weight_kg: number }>(
      `SELECT weight_kg FROM "set" WHERE session_exercise_id = 'ios-occ-2'`,
    );
    expect(occ1Set?.weight_kg).toBe(101);
    expect(occ2Set?.weight_kg).toBe(202);

    // And exactly two sets total — no duplication across the two ticks.
    const setCount = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "set" WHERE session_id = ?`,
      'sess-1',
    );
    expect(setCount?.n).toBe(2);
  });
});

// =====================================================================
// H1 (2026-06-01) — live-mirror session-liveness gate
// =====================================================================
//
// `replaceLiveMirror` passes `requireExistingLiveSession: true`, so a live
// tick that lands after the session was DISCARDED (放棄 → row hard-deleted)
// or FINALIZED (完成 → `ended_at` set) — the three WC channels have no
// cross-channel ordering — must be DROPPED, not applied. Without this a late
// tick would re-`INSERT INTO session ... ON CONFLICT` (zombie `ended_at=NULL`
// resurrection) or re-insert a row end-session's `purgeTail` just removed
// (E2 regression). The gate is checked INSIDE the reconcile transaction so a
// concurrent discard can't slip into a check↔write gap.

describe('replaceLiveMirror — H1 liveness gate', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // NOTE: deliberately NO seed here — each test controls session presence.
  });

  afterEach(() => db.close());

  it('discarded session (row ABSENT) → tick dropped, no resurrection', async () => {
    // No session row at all (simulates: discard hard-deleted it, then a late
    // live tick arrives on the unordered sendMessage/appContext channel).
    const result = await replaceLiveMirror(db, snapshot());
    expect(result.skipped).toBe('session-gone');

    // Nothing was written — no zombie session, no orphan exercise/set rows.
    const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session');
    const e = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session_exercise');
    const st = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM "set"');
    expect([s?.n, e?.n, st?.n]).toEqual([0, 0, 0]);
  });

  it('finalized session (ended_at set) → tick dropped, no post-purge re-insert (E2 guard)', async () => {
    await seedLiveSession(db, 'sess-1');
    // End-session ran: ended_at set + the tree was purged (we leave it empty
    // here). A late live tick carrying the (now-deleted) exercise+set must NOT
    // re-introduce them.
    await db.runAsync(
      `UPDATE session SET ended_at = ? WHERE id = ?`,
      1_700_000_100_000,
      'sess-1',
    );

    const result = await replaceLiveMirror(db, snapshot());
    expect(result.skipped).toBe('session-gone');

    // The snapshot's exercise/set were NOT re-inserted (E2 stays fixed).
    const e = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session_exercise');
    const st = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM "set"');
    expect([e?.n, st?.n]).toEqual([0, 0]);
    // Session row still present + still ended (NOT revived to ended_at=NULL).
    const row = await db.getFirstAsync<{ ended_at: number | null }>(
      'SELECT ended_at FROM session WHERE id = ?',
      'sess-1',
    );
    expect(row?.ended_at).toBe(1_700_000_100_000);
  });

  it('live (un-ended) session → applies + UPDATEs, never INSERTs a 2nd session row', async () => {
    await seedLiveSession(db, 'sess-1', 999); // placeholder started_at

    const result = await replaceLiveMirror(db, snapshot());
    expect(result.skipped).toBeNull();
    expect(result.exerciseCount).toBe(1);

    // Exactly ONE session row (UPDATE in place, not a 2nd INSERT), and the
    // mirror-bound columns were overwritten from the snapshot.
    const rows = await db.getAllAsync<{ id: string; started_at: number; title: string }>(
      'SELECT id, started_at, title FROM session',
    );
    expect(rows).toEqual([
      { id: 'sess-1', started_at: 1_700_000_000_000, title: 'Push Day' },
    ]);
    const e = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session_exercise');
    expect(e?.n).toBe(1);
  });

  it('apply → discard (row deleted) → late tick dropped, session stays gone (zombie regression)', async () => {
    await seedLiveSession(db, 'sess-1');
    const applied = await replaceLiveMirror(db, snapshot());
    expect(applied.skipped).toBeNull();

    // Discard: hard-delete the whole tree (mirrors discardSession cascade).
    await db.runAsync('DELETE FROM "set" WHERE session_id = ?', 'sess-1');
    await db.runAsync('DELETE FROM session_exercise WHERE session_id = ?', 'sess-1');
    await db.runAsync('DELETE FROM session WHERE id = ?', 'sess-1');

    // A late tick (the one still in flight at 放棄) must NOT resurrect it.
    const late = await replaceLiveMirror(db, snapshot());
    expect(late.skipped).toBe('session-gone');
    const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session');
    expect(s?.n).toBe(0);
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
    // H1: live mirror requires a pre-existing live session — seed it BEFORE
    // the live-tick seed below, or the gate would drop the whole setup.
    await seedLiveSession(db, 'sess-1');
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
