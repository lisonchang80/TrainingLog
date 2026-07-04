/**
 * Reverse-sync dropset wire-stability — regression coverage for the TS
 * PRECONDITION the 2026-06-28 Swift id-first reverse-apply fix relies on
 * (branch `slice/13d-reverse-dropset-idmatch`, commit 30dc919).
 *
 * BACKGROUND. The Watch's reverse-apply (iPhone→Watch live projection /
 * cast-session) used to match incoming sets by `ordinal`. The iPhone
 * `insertDropsetFollower` does, in ONE transaction:
 *     UPDATE "set" SET ordering = ordering + 1 WHERE ordering >= newOrd
 * and the wire `ordinal = ordering`. So inserting a dropset follower in the
 * MIDDLE of a session shifts the `ordinal` of every later set — and an
 * ordinal-keyed Watch match then re-aligns the wrong rows, corrupting the
 * card (the device bug: "非末組遞減亂跳 / 1,2,2 / 1,3,3,4"). The Swift fix
 * changed the match to setId-first (ordinal only as a fallback), which is
 * safe BECAUSE the iPhone keeps each set's id STABLE across the shift.
 *
 * The Swift half can't be jest-tested, but the TS side that PRODUCES the wire
 * payload + the DB mutation that creates the shift ARE. These tests lock:
 *   B. the wire ordinal DOES carry the post-insert shift (∴ id-first matching
 *      is provably NECESSARY — an ordinal match would mis-align), while the
 *      setId of every pre-existing set stays IDENTICAL across the shift (∴
 *      id-first matching is provably SUFFICIENT to re-align correctly);
 *   C. the cast-session snapshot (`buildStartFromIphone`) preserves each set's
 *      id end-to-end — the precondition the Swift fix documents as its coverage
 *      ("只蓋 cast/投影 session").
 *
 * If a future TS refactor silently dropped the shift, or re-keyed set ids on
 * insert, these would fail — flagging that the Swift id-first contract no
 * longer matches what the iPhone emits BEFORE a wasted device session.
 *
 * Real in-memory SQLite (better-sqlite3) — same fixture idiom as
 * handshake.test.ts / iphoneLiveMirrorProducer.test.ts / watchSessionCast.test.ts.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertDropsetFollower,
  insertSessionSet,
} from '../../src/adapters/sqlite/setRepository';
import {
  fetchSessionSnapshot,
  buildStartFromIphone,
  type SessionSnapshot,
  type SessionSnapshotSet,
} from '../../src/adapters/watch';
import {
  buildLiveMirrorPayload,
  __resetLiveMirrorProducerForTests,
} from '../../src/services/iphoneLiveMirrorProducer';
import type { Database } from '../../src/db/types';
import type { LiveMirrorPayload } from '../../src/adapters/watch';

// Bench Press — seeded by v001_initial; migrate(db) already creates the row.
const BENCH = '00000000-0000-4000-8000-000000000001';
// A second exercise so the two cards are distinct solo cards (appendSessionExercise
// rejects two solo cards sharing the same exercise_id). Inserted by the fixture.
const SQUAT = '00000000-0000-4000-8000-0000000000aa';

async function makeDb(): Promise<Database> {
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  await db.runAsync(
    `INSERT OR IGNORE INTO exercise (id, name, load_type, is_builtin)
     VALUES (?, 'Back Squat', 'loaded', 0)`,
    SQUAT,
  );
  return db;
}

/**
 * Seed a card whose chain is NOT at the end of the session, so a follower
 * insert into it shifts a LATER (different-exercise) set's ordinal. Layout:
 *
 *   se-A card (BENCH):  head(ordering 1, working) , workA(ordering 2, working)
 *   se-B card (SQUAT):  tail(ordering 3, working)            ← a later set
 *
 * Inserting a dropset follower under `head` lands at ordering 2, shifting
 * workA→3 and tail→4. `head` / `workA` / `tail` keep their ids verbatim.
 *
 * The two cards use DISTINCT exercises (appendSessionExercise rejects two solo
 * cards sharing one exercise_id) so fetchSessionSnapshot buckets them into two
 * separate exercise cards — and the shifted set (`tail`) is on the OTHER card,
 * proving the ordinal shift is session-global, not card-scoped.
 */
async function seedNonLastChain(db: Database, sessionId: string): Promise<void> {
  await createSession(db, {
    id: sessionId,
    started_at: 1_700_000_000_000,
    title: 'Drop Day',
  });
  await appendSessionExercise(db, {
    id: 'se-A',
    session_id: sessionId,
    exercise_id: BENCH,
  });
  await appendSessionExercise(db, {
    id: 'se-B',
    session_id: sessionId,
    exercise_id: SQUAT,
  });
  await insertSessionSet(db, {
    id: 'head',
    session_id: sessionId,
    exercise_id: BENCH,
    weight_kg: 100,
    reps: 8,
    is_skipped: 0,
    ordering: 1,
    created_at: 1_700_000_000_001,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: 'se-A',
  });
  await insertSessionSet(db, {
    id: 'workA',
    session_id: sessionId,
    exercise_id: BENCH,
    weight_kg: 100,
    reps: 6,
    is_skipped: 0,
    ordering: 2,
    created_at: 1_700_000_000_002,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: 'se-A',
  });
  await insertSessionSet(db, {
    id: 'tail',
    session_id: sessionId,
    exercise_id: SQUAT,
    weight_kg: 60,
    reps: 12,
    is_skipped: 0,
    ordering: 3,
    created_at: 1_700_000_000_003,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: 'se-B',
  });
}

/** All sets across all exercises in a snapshot, flattened, keyed by setId. */
function setsById(snap: SessionSnapshot): Map<string, SessionSnapshotSet> {
  const m = new Map<string, SessionSnapshotSet>();
  for (const ex of snap.exercises) for (const s of ex.sets) m.set(s.setId, s);
  return m;
}

afterEach(() => {
  __resetLiveMirrorProducerForTests();
});

// ---------------------------------------------------------------------
// B. Wire-payload stability for a dropset chain — the wire ordinal carries
//    the post-insert shift (id-first NECESSARY) AND setId is stable across
//    the shift (id-first SUFFICIENT). Exercised through BOTH wire builders:
//    fetchSessionSnapshot (cast / start-from-iphone) and the live-mirror
//    producer (live projection).
// ---------------------------------------------------------------------
describe('B. dropset-follower insert → wire payload ordinal shift + stable setId', () => {
  it('fetchSessionSnapshot: a NON-LAST follower insert shifts later ordinals while every pre-existing setId is unchanged', async () => {
    const db = await makeDb();
    await seedNonLastChain(db, 'sess-b1');

    // BEFORE the insert: capture the wire ordinal + id of each set.
    const before = setsById((await fetchSessionSnapshot(db, 'sess-b1'))!);
    expect(before.get('head')!.ordinal).toBe(1);
    expect(before.get('workA')!.ordinal).toBe(2);
    expect(before.get('tail')!.ordinal).toBe(3);

    // Insert a dropset follower UNDER `head` (a NON-LAST chain — `tail` lives
    // after it in the session-global ordering space).
    await insertDropsetFollower(db, {
      session_id: 'sess-b1',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const after = setsById((await fetchSessionSnapshot(db, 'sess-b1'))!);

    // (1) id-first NECESSARY: the wire ordinal DID shift for the later sets.
    //     An ordinal-keyed Watch match would now re-align `workA` (was 2) onto
    //     whatever new row sits at 2 (the follower) — corruption. The new
    //     follower lands at 2; workA→3; tail→4.
    expect(after.get('follow')!.ordinal).toBe(2);
    expect(after.get('workA')!.ordinal).toBe(3);
    expect(after.get('tail')!.ordinal).toBe(4);
    // `head` stays at ordinal 1 (the insert was AFTER it).
    expect(after.get('head')!.ordinal).toBe(1);

    // (2) id-first SUFFICIENT: every pre-existing set keeps its EXACT setId —
    //     the insert mints a fresh id ('follow') and never re-keys existing
    //     rows. So a setId-keyed Watch match re-aligns head/workA/tail
    //     correctly regardless of the ordinal churn.
    expect(after.has('head')).toBe(true);
    expect(after.has('workA')).toBe(true);
    expect(after.has('tail')).toBe(true);
    // The set of pre-existing ids is unchanged (only `follow` is added).
    const ids = [...after.keys()].sort();
    expect(ids).toEqual(['follow', 'head', 'tail', 'workA'].sort());

    // (3) chain wiring rides the wire: the follower is a dropset whose
    //     parent_set_id points at the (id-stable) head.
    expect(after.get('follow')!.set_kind).toBe('dropset');
    expect(after.get('follow')!.parent_set_id).toBe('head');
  });

  it('live-mirror producer: same shift + stable-setId contract on the OMIT-NULL wire shape', async () => {
    const db = await makeDb();
    await seedNonLastChain(db, 'sess-b2');

    await insertDropsetFollower(db, {
      session_id: 'sess-b2',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const payload = (await buildLiveMirrorPayload(db, 'sess-b2'))!;
    // Flatten all sets across exercises into an id-keyed map.
    const wire = new Map<string, Record<string, unknown>>();
    for (const ex of payload.exercises as Array<Record<string, unknown>>) {
      for (const s of ex.sets as Array<Record<string, unknown>>) {
        wire.set(s.setId as string, s);
      }
    }
    // Ordinal shift carried through the producer's wire projection.
    expect(wire.get('follow')!.ordinal).toBe(2);
    expect(wire.get('workA')!.ordinal).toBe(3);
    expect(wire.get('tail')!.ordinal).toBe(4);
    // setIds stable — the follower is the only new id.
    expect([...wire.keys()].sort()).toEqual(
      ['follow', 'head', 'tail', 'workA'].sort(),
    );
    // Follower's parent_set_id (omit-null shape: present only because non-null)
    // references the id-stable head.
    expect(wire.get('follow')!.parent_set_id).toBe('head');
    // The head row, being a non-follower, OMITS parent_set_id (plist-clean).
    expect('parent_set_id' in wire.get('head')!).toBe(false);
  });

  it('display_rank lands the follower right after the head on the wire (folds the chain in render order)', async () => {
    // The display_rank surfaced on the wire is what lets the Watch fold a
    // dropset chain in render order without depending on the (shifting)
    // ordinal. A follower inserted under the head must carry a display_rank
    // that sorts immediately after the head's, BEFORE the card's later set.
    const db = await makeDb();
    await seedNonLastChain(db, 'sess-b3');

    await insertDropsetFollower(db, {
      session_id: 'sess-b3',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const snap = (await fetchSessionSnapshot(db, 'sess-b3'))!;
    // se-A card holds head + follow + workA (display-ordered by renumber).
    const cardA = snap.exercises.find((e) => e.sessionExerciseId === 'se-A')!;
    const rankById = new Map(
      cardA.sets.map((s) => [s.setId, s.display_rank ?? null] as const),
    );
    // head(0) → follow(1) → workA(2) in render order.
    expect(rankById.get('head')).toBe(0);
    expect(rankById.get('follow')).toBe(1);
    expect(rankById.get('workA')).toBe(2);
  });
});

// ---------------------------------------------------------------------
// C. cast-session id preservation — `buildStartFromIphone` (the cast wire
//    builder) preserves each set's id end-to-end through a full snapshot →
//    wire round-trip, including a JSON serialise/parse hop (the WC bridge).
//    This is the "cast = ids aligned" precondition the Swift fix documents.
// ---------------------------------------------------------------------
describe('C. cast-session snapshot preserves every set id end-to-end', () => {
  it('buildStartFromIphone keeps each dropset-chain setId byte-identical (snapshot → wire → JSON round-trip)', async () => {
    const db = await makeDb();
    await seedNonLastChain(db, 'sess-c1');
    // Insert the middle follower so the cast snapshot includes a chain whose
    // ordinals have shifted — the scenario the Swift cast-apply must survive.
    await insertDropsetFollower(db, {
      session_id: 'sess-c1',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const snapshot = (await fetchSessionSnapshot(db, 'sess-c1'))!;
    const expectedIds = [...setsById(snapshot).keys()].sort();

    // Build the cast envelope payload, then simulate the WC bridge's JSON hop.
    const castPayload = buildStartFromIphone(snapshot);
    expect(castPayload.sessionId).toBe('sess-c1');
    const onWire = JSON.parse(JSON.stringify(castPayload)) as {
      sessionId: string;
      snapshot: {
        exercises: Array<{ sets: Array<{ setId: string; parent_set_id: unknown }> }>;
      };
    };

    // Collect every setId that survived the round-trip.
    const wireIds: string[] = [];
    let followerParent: unknown;
    for (const ex of onWire.snapshot.exercises) {
      for (const s of ex.sets) {
        wireIds.push(s.setId);
        if (s.setId === 'follow') followerParent = s.parent_set_id;
      }
    }
    // Exact id set preserved — cast = ids aligned (the Swift fix's coverage).
    expect(wireIds.sort()).toEqual(expectedIds);
    // And the chain linkage survives: the follower's parent is the stable head
    // id (not re-keyed, not dropped) — what the Swift id-first match keys on.
    expect(followerParent).toBe('head');
  });

  it('cast wire ordinals reflect the post-shift DB state (so id-first, not ordinal, is the only safe match)', async () => {
    const db = await makeDb();
    await seedNonLastChain(db, 'sess-c2');
    await insertDropsetFollower(db, {
      session_id: 'sess-c2',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const castPayload = buildStartFromIphone((await fetchSessionSnapshot(db, 'sess-c2'))!);
    const wireSets = new Map<string, number>();
    for (const ex of castPayload.snapshot.exercises as Array<{ sets: Array<{ setId: string; ordinal: number }> }>) {
      for (const s of ex.sets) wireSets.set(s.setId, s.ordinal);
    }
    // The cast wire carries the SHIFTED ordinals (tail moved 3→4). If the
    // Watch matched by ordinal it would mis-bind `tail`; it must match by the
    // stable setId. This asserts the shift is genuinely present on the cast
    // payload (not silently normalised away somewhere upstream).
    expect(wireSets.get('follow')).toBe(2);
    expect(wireSets.get('workA')).toBe(3);
    expect(wireSets.get('tail')).toBe(4);
  });
});

// Touch LiveMirrorPayload so the import is load-bearing for the type checker
// (the producer test uses it; here it documents the producer wire shape).
export type _WireShape = LiveMirrorPayload;
