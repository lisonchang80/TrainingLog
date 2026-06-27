/**
 * Cast wire path — `fetchSessionSnapshot` → `buildStartFromIphone` composition
 * (2026-06-28 coverage hardening for the 投影 Watch ship `fd9a6b9`).
 *
 * `pushCastToWatch` (src/services/watchSessionCast.ts) builds the cast envelope
 * via EXACTLY this pair:
 *
 *     const snapshot = await fetchSessionSnapshot(db, sessionId);
 *     const payload  = buildStartFromIphone(snapshot);
 *
 * The existing handshake.test.ts covers each half in isolation (a DB snapshot
 * with display_rank; a hand-built snapshot through buildStartFromIphone), but
 * NOTHING pins the COMPOSITION — the actual bytes the Watch decodes after a
 * cast. This file locks that wire contract from real DB rows, which is where a
 * silent field drop would regress (the cast wire shape diverging from the
 * live-mirror producer wire shape).
 *
 * ⚠️ CHARACTERIZATION: `snapshotToWire` (the projection inside
 * buildStartFromIphone) does NOT carry `display_rank`, even though
 * fetchSessionSnapshot populates it on every set. So a cast of a REORDERED
 * session loses the long-press reorder on the wire — see the `display_rank`
 * test below, which pins the CURRENT behaviour and flags the divergence from
 * the live-mirror producer (handshake.ts:1222 DOES carry it). Documented as a
 * suspected src bug in the coverage report; NOT fixed here.
 *
 * Real DB via better-sqlite3 in-memory; same seeding harness as handshake.test.
 */

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
} from '../../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../../src/adapters/sqlite/setRepository';
import {
  buildStartFromIphone,
  fetchSessionSnapshot,
} from '../../../src/adapters/watch/handshake';

// Bench Press — seeded by v001_initial; stable FK target for session rows.
const BENCH = '00000000-0000-4000-8000-000000000001';

describe('cast wire path — fetchSessionSnapshot → buildStartFromIphone', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Seed one exercise + N sets so the snapshot is a non-empty tree. */
  async function seedExerciseWithSet(sessionId: string): Promise<void> {
    await createSession(db, {
      id: sessionId,
      started_at: 1_700_000_000_000,
      title: 'Push Day',
    });
    await appendSessionExercise(db, {
      id: 'se-1',
      session_id: sessionId,
      exercise_id: BENCH,
    });
    await insertSessionSet(db, {
      id: 'set-1',
      session_id: sessionId,
      exercise_id: BENCH,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_001,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-1',
    });
  }

  it('the exact wire payload a cast sends — sessionId + localised tree the Watch decodes', async () => {
    await seedExerciseWithSet('sess-cast');
    const snapshot = await fetchSessionSnapshot(db, 'sess-cast');
    expect(snapshot).not.toBeNull();
    const payload = buildStartFromIphone(snapshot!);

    // Top-level envelope payload shape.
    expect(payload.sessionId).toBe('sess-cast');
    expect(payload.snapshot.sessionId).toBe('sess-cast');
    expect(payload.snapshot.title).toBe('Push Day');
    expect(payload.snapshot.startedAt).toBe(1_700_000_000_000);

    const exercises = payload.snapshot.exercises as Array<{
      sessionExerciseId: string;
      exerciseId: string;
      exerciseName: string;
      parentId: string | null;
      reusableSupersetId: string | null;
      sets: Array<Record<string, unknown>>;
    }>;
    expect(exercises).toHaveLength(1);
    const ex = exercises[0];
    expect(ex.sessionExerciseId).toBe('se-1');
    expect(ex.exerciseId).toBe(BENCH);
    // Localised at the DB boundary (zh default) — must survive the projection.
    expect(ex.exerciseName).toBe('槓鈴臥推');
    // Solo exercise → cluster linkage projects explicit null (sendMessage
    // reply is plist-tolerant of null, unlike applicationContext).
    expect(ex.parentId).toBeNull();
    expect(ex.reusableSupersetId).toBeNull();

    // Set row — every column the Swift SessionSnapshot decodes, with the wire
    // renames (weight_kg→weight, ordering→ordinal, is_logged 0/1→boolean) and
    // the explicit parent_set_id the projection adds.
    expect(ex.sets).toHaveLength(1);
    expect(ex.sets[0]).toEqual({
      setId: 'set-1',
      ordinal: 1,
      weight: 100,
      reps: 5,
      rpe: null,
      rest_sec: null,
      notes: null,
      set_kind: 'working',
      is_logged: false, // freshly inserted, never ✓-tapped
      parent_set_id: null,
    });
  });

  it('legacy snapshot omits bidirectional fields → cast wire stays clean (no rev/originator/deletedIds)', async () => {
    // fetchSessionSnapshot never stamps rev/originator/deletedIds (those are a
    // live-mirror producer concern), so a cast envelope must NOT carry them —
    // a stray `originator:'iphone'` would make the Watch echo-suppress its own
    // open. Lock the absence.
    await seedExerciseWithSet('sess-clean');
    const snapshot = await fetchSessionSnapshot(db, 'sess-clean');
    const payload = buildStartFromIphone(snapshot!);
    expect(payload.snapshot).not.toHaveProperty('rev');
    expect(payload.snapshot).not.toHaveProperty('originator');
    expect(payload.snapshot).not.toHaveProperty('deletedIds');
  });

  it('cast wire payload JSON round-trips identical (no Map/Set/Date leakage from the DB read)', async () => {
    await seedExerciseWithSet('sess-rt');
    const snapshot = await fetchSessionSnapshot(db, 'sess-rt');
    const payload = buildStartFromIphone(snapshot!);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('a dropset follower\'s parent_set_id rides the cast wire (chain head→follower)', async () => {
    // The chain linkage is what lets the Watch fold a dropset cluster after a
    // cast. parent_set_id is the one set field snapshotToWire DOES carry, so
    // pin it end-to-end from real rows (the head + a follower pointing at it).
    await createSession(db, { id: 'sess-drop', started_at: 1_700_000_000_000 });
    await appendSessionExercise(db, {
      id: 'se-d',
      session_id: 'sess-drop',
      exercise_id: BENCH,
    });
    await insertSessionSet(db, {
      id: 'set-head',
      session_id: 'sess-drop',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_001,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-d',
    });
    await insertSessionSet(db, {
      id: 'set-drop',
      session_id: 'sess-drop',
      exercise_id: BENCH,
      weight_kg: 60,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: 1_700_000_000_002,
      set_kind: 'dropset',
      parent_set_id: 'set-head',
      session_exercise_id: 'se-d',
    });

    const snapshot = await fetchSessionSnapshot(db, 'sess-drop');
    const payload = buildStartFromIphone(snapshot!);
    const sets = (payload.snapshot.exercises as Array<{ sets: Array<{ setId: string; parent_set_id: string | null; set_kind: string }> }>)[0].sets;
    const byId = new Map(sets.map((s) => [s.setId, s] as const));
    expect(byId.get('set-head')?.parent_set_id).toBeNull();
    expect(byId.get('set-drop')?.parent_set_id).toBe('set-head');
    expect(byId.get('set-drop')?.set_kind).toBe('dropset');
  });

  // -------------------------------------------------------------------------
  // CHARACTERIZATION — suspected src bug (documented, NOT fixed here).
  // -------------------------------------------------------------------------
  it('CHARACTERIZATION: snapshotToWire DROPS display_rank — a cast of a reordered session loses the reorder on the wire', async () => {
    // fetchSessionSnapshot populates display_rank on every set (handshake.ts:
    // 1222, covered by handshake.test.ts:1022 "surfaces display_rank …(③)").
    // BUT buildStartFromIphone → snapshotToWire (handshake.ts:738-749) does NOT
    // project it. So even though the in-memory snapshot carries the long-press
    // reorder, the CAST wire payload the Watch decodes does not → the Watch
    // renders by ordinal, ignoring the user's reorder until a later live-mirror
    // push re-supplies it. The live-mirror PRODUCER wire (handshake.ts:1222)
    // does carry display_rank, so the two iPhone→Watch wire shapes DIVERGE.
    //
    // This test pins the CURRENT (drop) behaviour so an intentional fix would
    // flip it deliberately, and an accidental regression on the producer side
    // is contrasted. See coverage report 09 — flagged as a suspected bug.
    await createSession(db, { id: 'sess-reorder', started_at: 1_700_000_000_000 });
    await appendSessionExercise(db, {
      id: 'se-ro',
      session_id: 'sess-reorder',
      exercise_id: BENCH,
    });
    await insertSessionSet(db, {
      id: 'set-a',
      session_id: 'sess-reorder',
      exercise_id: BENCH,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_001,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-ro',
    });
    await insertSessionSet(db, {
      id: 'set-b',
      session_id: 'sess-reorder',
      exercise_id: BENCH,
      weight_kg: 105,
      reps: 4,
      is_skipped: 0,
      ordering: 2,
      created_at: 1_700_000_000_002,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-ro',
    });
    // Long-press reorder: rewrite display_rank ONLY (ordering is the reconcile
    // identity key) — set-b now ranks before set-a.
    await db.runAsync(`UPDATE "set" SET display_rank = ? WHERE id = ?`, 0, 'set-b');
    await db.runAsync(`UPDATE "set" SET display_rank = ? WHERE id = ?`, 1, 'set-a');

    const snapshot = await fetchSessionSnapshot(db, 'sess-reorder');
    // The in-memory snapshot DID capture the reorder…
    const snapById = new Map(snapshot!.exercises[0].sets.map((s) => [s.setId, s] as const));
    expect(snapById.get('set-b')?.display_rank).toBe(0);
    expect(snapById.get('set-a')?.display_rank).toBe(1);

    // …but the cast wire payload DROPS it (no `display_rank` key on any set).
    const payload = buildStartFromIphone(snapshot!);
    const wireSets = (payload.snapshot.exercises as Array<{ sets: Array<Record<string, unknown>> }>)[0].sets;
    for (const s of wireSets) {
      expect(s).not.toHaveProperty('display_rank');
    }
  });
});
