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

/**
 * Seed a LIVE (un-ended) session row.
 *
 * H1 (2026-06-01): `replaceLiveMirror` now requires a pre-existing live session
 * (the start path owns creation). These tests seed the iPhone tree via
 * `replaceLiveMirror` (mirroring the real flow), so the session row must exist
 * first. `INSERT OR IGNORE` so a test that also builds its own canonical tree
 * (`seedCanonicalTree`) doesn't UNIQUE-collide.
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

describe('reconcileEndSnapshot — E2 end-session membership purge', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // H1: live mirror requires a pre-existing live session. Seed it so the
    // replaceLiveMirror-based tree seeding below applies (start path owns it).
    await seedLiveSession(db, 'sess-1');
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
      `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
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

// =====================================================================
// E2 first/middle delete under DIVERGENT canonical ids.
//
// The block above seeds BOTH sides via `replaceLiveMirror`, so the iPhone
// rows and the Watch snapshot share ids — which masks the real template
// flow: `startSessionFromTemplate` mints iPhone UUIDs + re-indexes ordering
// 1..N, while the Watch snapshot mints its OWN ids (`SE-<idx>-<exId>` /
// `SET-<i>-<j>`) and carries the raw `template_exercise.ordering`. The two
// sides share ONLY `exercise_id`. These cases seed a canonical tree with
// iPhone-minted ids and reconcile against Watch-minted snapshots, covering
// the Bug X regression + first/middle/tail/duplicate deletes.
// =====================================================================

// Real seeded builtin exercise ids (FK: session_exercise/set.exercise_id
// REFERENCES exercise(id), enforced — foreign_keys=ON). Distinct + sorted.
const EX_A = '00000000-0000-4000-8000-000000000001'; // Bench Press
const EX_B = '00000000-0000-4000-8000-000000000002'; // Back Squat
const EX_C = '00000000-0000-4000-8000-000000000003'; // Deadlift

interface ExDef {
  exerciseId: string;
  /** Raw `template_exercise.ordering` the Watch carries (often 0-based). */
  rawOrdering: number;
  plannedSets: number;
  /** One entry per set, in template order; distinct weights make rows identifiable. */
  sets: { weight: number; reps: number }[];
}

/**
 * Seed a CANONICAL session tree the way `startSessionFromTemplate` would:
 * iPhone-minted ids (NEVER equal to a Watch `SE-`/`SET-` id) and the 1..N
 * re-indexed ordering (`snapshotForSession` exercise `i+1`, set `j+1`).
 * Returns the generated ids so a test can assert which canonical rows
 * survive a purge.
 */
async function seedCanonicalTree(
  db: BetterSqliteDatabase,
  sessionId: string,
  defs: ExDef[],
): Promise<{ seId: string; exerciseId: string; setIds: string[] }[]> {
  await db.runAsync(
    `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, ?)`,
    sessionId,
    1_700_000_000_000,
    'Push Day',
  );
  const out: { seId: string; exerciseId: string; setIds: string[] }[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const seId = `canon-se-${i}`; // stands in for a startSessionFromTemplate UUID
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      seId,
      sessionId,
      d.exerciseId,
      i + 1, // canonical re-index 1..N (vs the Watch's raw ordering)
      d.plannedSets,
      'tmpl-1', // same template for every row, like snapshotForSession
    );
    const setIds: string[] = [];
    for (let j = 0; j < d.sets.length; j++) {
      const s = d.sets[j];
      const setId = `canon-set-${i}-${j}`;
      await db.runAsync(
        `INSERT INTO "set"
           (id, session_id, exercise_id, session_exercise_id,
            weight_kg, reps, notes, set_kind, is_logged, ordering, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        setId,
        sessionId,
        d.exerciseId,
        seId,
        s.weight,
        s.reps,
        null,
        'working',
        1,
        j + 1, // canonical set ordering 1..N
        1_700_000_000_000,
      );
      setIds.push(setId);
    }
    out.push({ seId, exerciseId: d.exerciseId, setIds });
  }
  return out;
}

/**
 * Build a Watch-shaped `SessionSnapshot` from the same defs: `SE-<idx>-<exId>`
 * / `SET-<idx>-<setIdx>` ids (never equal to the canonical ones), 1-based set
 * `ordinal` (matches the Swift builder), and the raw `rawOrdering` on each
 * exercise. `idx` is the array position — re-compacted after a delete, exactly
 * like the Watch's `.enumerated()` over its post-delete exercise list.
 */
function watchSnapshot(sessionId: string, defs: ExDef[]): SessionSnapshot {
  return {
    sessionId,
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: defs.map((d, idx) => ({
      sessionExerciseId: `SE-${idx}-${d.exerciseId}`,
      exerciseId: d.exerciseId,
      exerciseName: 'Bench Press',
      ordering: d.rawOrdering,
      plannedSets: d.plannedSets,
      sets: d.sets.map((s, setIdx) => ({
        setId: `SET-${idx}-${setIdx}`,
        ordinal: setIdx + 1,
        weight: s.weight,
        reps: s.reps,
        rpe: null,
        rest_sec: null,
        notes: null,
        set_kind: 'working' as const,
        is_logged: true,
      })),
    })),
  };
}

const A: ExDef = { exerciseId: EX_A, rawOrdering: 0, plannedSets: 1, sets: [{ weight: 50, reps: 5 }] };
const B: ExDef = { exerciseId: EX_B, rawOrdering: 1, plannedSets: 1, sets: [{ weight: 70, reps: 7 }] };
const C: ExDef = { exerciseId: EX_C, rawOrdering: 2, plannedSets: 1, sets: [{ weight: 90, reps: 9 }] };

describe('reconcileEndSnapshot — E2 first/middle delete under divergent canonical ids', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // H1: live mirror requires a pre-existing live session. Seed it so the
    // replaceLiveMirror-based tree seeding below applies (start path owns it).
    await seedLiveSession(db, 'sess-1');
  });

  afterEach(() => {
    db.close();
  });

  async function exerciseRows(sessionId = 'sess-1') {
    return db.getAllAsync<{ id: string; exercise_id: string }>(
      `SELECT id, exercise_id FROM session_exercise
        WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
  }

  /** Weight of the (single) surviving set under a given exercise_id. */
  async function setWeightFor(exerciseId: string, sessionId = 'sess-1') {
    const row = await db.getFirstAsync<{ weight_kg: number }>(
      `SELECT s.weight_kg AS weight_kg
         FROM "set" s
         JOIN session_exercise se ON s.session_exercise_id = se.id
        WHERE se.session_id = ? AND se.exercise_id = ?`,
      sessionId,
      exerciseId,
    );
    return row?.weight_kg ?? null;
  }

  it('live-mirror tick with divergent Watch ids UPDATEs in place — no duplicate rows (Bug X)', async () => {
    const canon = await seedCanonicalTree(db, 'sess-1', [A, B, C]);
    expect(await countRows(db)).toEqual({ exercises: 3, sets: 3 });

    // A mid-session tick carrying the same 3 exercises but Watch-minted ids
    // must reconcile onto the canonical rows by exercise_id, NOT INSERT a
    // parallel tree (the Bug X duplicate-exercise regression).
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A, B, C]));

    expect(await countRows(db)).toEqual({ exercises: 3, sets: 3 });
    const rows = await exerciseRows();
    expect(rows.map((r) => r.id)).toEqual(canon.map((c) => c.seId)); // canonical UUIDs kept
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_B, EX_C]);
  });

  it('drops the FIRST exercise → purges that row, survivors keep their own id + set data', async () => {
    const canon = await seedCanonicalTree(db, 'sess-1', [A, B, C]);
    // Mid-session live ticks happened (non-purging) — tree still 3 rows.
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A, B, C]));

    // Watch deleted A → final snapshot [B, C] (idx re-compacts, ordering raw).
    const result = await reconcileEndSnapshot(db, 'sess-1', watchSnapshot('sess-1', [B, C]));

    expect(result).toMatchObject({ purged: true, purgedExercises: 1, purgedSets: 1 });
    // The position-matching bug would shift B onto A's row + C onto B's row
    // and purge C; assert the RIGHT row (A) is gone and B/C keep their own
    // identity + set data (no shuffle).
    const rows = await exerciseRows();
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_B, EX_C]);
    expect(rows.map((r) => r.id)).toEqual([canon[1].seId, canon[2].seId]);
    expect(await setWeightFor(EX_B)).toBe(70);
    expect(await setWeightFor(EX_C)).toBe(90);
  });

  it('drops a MIDDLE exercise → purges that row, survivors keep their own id + set data', async () => {
    const canon = await seedCanonicalTree(db, 'sess-1', [A, B, C]);
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A, B, C]));

    const result = await reconcileEndSnapshot(db, 'sess-1', watchSnapshot('sess-1', [A, C]));

    expect(result).toMatchObject({ purged: true, purgedExercises: 1, purgedSets: 1 });
    const rows = await exerciseRows();
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_C]);
    expect(rows.map((r) => r.id)).toEqual([canon[0].seId, canon[2].seId]);
    expect(await setWeightFor(EX_A)).toBe(50);
    expect(await setWeightFor(EX_C)).toBe(90);
  });

  it('drops the TAIL exercise → still correct (previously-working case preserved)', async () => {
    const canon = await seedCanonicalTree(db, 'sess-1', [A, B, C]);
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A, B, C]));

    const result = await reconcileEndSnapshot(db, 'sess-1', watchSnapshot('sess-1', [A, B]));

    expect(result).toMatchObject({ purged: true, purgedExercises: 1, purgedSets: 1 });
    const rows = await exerciseRows();
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_B]);
    expect(rows.map((r) => r.id)).toEqual([canon[0].seId, canon[1].seId]);
    expect(await setWeightFor(EX_A)).toBe(50);
    expect(await setWeightFor(EX_B)).toBe(70);
  });

  it('same exercise twice → deleting the first occurrence keeps one row carrying the survivor data', async () => {
    // Two session_exercise rows share exercise_id EX_A (e.g. programmed twice);
    // distinct set weights make the two occurrences identifiable.
    const A0: ExDef = { exerciseId: EX_A, rawOrdering: 0, plannedSets: 1, sets: [{ weight: 50, reps: 5 }] };
    const A1: ExDef = { exerciseId: EX_A, rawOrdering: 1, plannedSets: 1, sets: [{ weight: 60, reps: 6 }] };
    const Bx: ExDef = { exerciseId: EX_B, rawOrdering: 2, plannedSets: 1, sets: [{ weight: 70, reps: 7 }] };
    await seedCanonicalTree(db, 'sess-1', [A0, A1, Bx]);
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A0, A1, Bx]));
    expect(await countRows(db)).toEqual({ exercises: 3, sets: 3 });

    // Watch deletes the FIRST Bench Press → final [A1, B].
    const result = await reconcileEndSnapshot(db, 'sess-1', watchSnapshot('sess-1', [A1, Bx]));

    expect(result).toMatchObject({ purged: true, purgedExercises: 1, purgedSets: 1 });
    expect(await countRows(db)).toEqual({ exercises: 2, sets: 2 });
    // Exactly one EX_A row remains carrying the SURVIVING occurrence's data
    // (weight 60). The occurrence-index maps the lone snapshot EX_A onto the
    // first canonical EX_A row, so the kept row-id is A0's while the data is
    // A1's — invisible to the UI because both rows share exercise_id +
    // template_id. The invariant that matters: one EX_A gone, survivor data
    // kept, and B untouched (the bug would shift B's data onto an EX_A row).
    const rows = await exerciseRows();
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_B]);
    expect(await setWeightFor(EX_A)).toBe(60);
    expect(await setWeightFor(EX_B)).toBe(70);
  });

  it('same exercise twice → deleting the last occurrence purges that exact row', async () => {
    const A0: ExDef = { exerciseId: EX_A, rawOrdering: 0, plannedSets: 1, sets: [{ weight: 50, reps: 5 }] };
    const A1: ExDef = { exerciseId: EX_A, rawOrdering: 1, plannedSets: 1, sets: [{ weight: 60, reps: 6 }] };
    const Bx: ExDef = { exerciseId: EX_B, rawOrdering: 2, plannedSets: 1, sets: [{ weight: 70, reps: 7 }] };
    const canon = await seedCanonicalTree(db, 'sess-1', [A0, A1, Bx]);
    await replaceLiveMirror(db, watchSnapshot('sess-1', [A0, A1, Bx]));

    // Watch deletes the SECOND Bench Press → final [A0, B]. Here the kept id
    // IS clean: occurrence 0 maps to canonical A0, A1's row (canon[1]) purged.
    const result = await reconcileEndSnapshot(db, 'sess-1', watchSnapshot('sess-1', [A0, Bx]));

    expect(result).toMatchObject({ purged: true, purgedExercises: 1, purgedSets: 1 });
    const rows = await exerciseRows();
    expect(rows.map((r) => r.id)).toEqual([canon[0].seId, canon[2].seId]); // A1 (canon[1]) purged
    expect(rows.map((r) => r.exercise_id)).toEqual([EX_A, EX_B]);
    expect(await setWeightFor(EX_A)).toBe(50); // A0's own data preserved
  });
});
