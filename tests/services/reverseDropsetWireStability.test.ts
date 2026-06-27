/**
 * Reverse-sync dropset wire-stability — regression coverage for the TS side
 * of the iPhone→Watch reverse-apply contract.
 *
 * ⚠️ UPDATED 2026-06-28 for Option A1 (no-shift). The ORIGINAL tests (committed
 * `62ce68e`) locked the OLD `insertDropsetFollower` behaviour:
 *     UPDATE "set" SET ordering = ordering + 1 WHERE ordering >= newOrd
 * They asserted the post-insert wire ordinals SHIFTED (workA 2→3, tail 3→4) as
 * the "id-first matching is NECESSARY" proof. A1 REMOVED that shift: the
 * follower now appends at session-wide MAX(ordering)+1 and every pre-existing
 * set keeps its ordinal. This is an INTENDED behaviour change (the spike's
 * whole point), so these tests now assert the A1 contract:
 *   B. a non-last `insertDropsetFollower` does NOT shift any later ordinal
 *      (head/workA/tail keep 1/2/3); the follower gets a unique high ordinal
 *      (MAX+1 = 4) that is ABSENT from the Watch's immutable base, so the
 *      reverse-apply ordinal fallback routes it cleanly to an addedSet instead
 *      of colliding onto a neighbour base set (the "非末組遞減亂跳" bug). Every
 *      pre-existing setId still stays byte-identical (id-first match stays
 *      sufficient for cast). display_rank still folds the follower after its
 *      head on the wire.
 *   C. the cast-session snapshot (`buildStartFromIphone`) preserves each set's
 *      id end-to-end, and now carries the NON-shifted ordinals.
 *
 * Net: A1 makes BOTH the id-axis (cast: ids stable) AND the ordinal-axis
 * (template-start: no collision) safe — see report 05-a1-noshift-spike.md.
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
// B. Wire-payload stability for a dropset chain (A1 no-shift) — a non-last
//    follower insert does NOT shift any later ordinal (so no ordinal collision
//    on the immutable Watch base), the follower gets a unique high ordinal
//    absent from the base (clean addedSet on ordinal fallback), and every
//    pre-existing setId stays stable (id-first match still works for cast).
//    Exercised through BOTH wire builders: fetchSessionSnapshot (cast /
//    start-from-iphone) and the live-mirror producer (live projection).
// ---------------------------------------------------------------------
describe('B. dropset-follower insert → wire payload no-shift + stable setId (A1)', () => {
  it('fetchSessionSnapshot: a NON-LAST follower insert leaves later ordinals UNCHANGED; the follower gets a unique MAX+1 ordinal', async () => {
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

    // (1) A1 NO-SHIFT: every pre-existing wire ordinal is UNCHANGED. So an
    //     ordinal-keyed Watch reverse-apply re-binds head/workA/tail onto their
    //     OWN base rows (no collision) — the "非末組遞減亂跳" corruption is gone
    //     at the source. The follower appends at the session MAX+1 = 4, a value
    //     ABSENT from the immutable Watch base → ordinal fallback routes it to a
    //     clean addedSet.
    expect(after.get('head')!.ordinal).toBe(1);
    expect(after.get('workA')!.ordinal).toBe(2);
    expect(after.get('tail')!.ordinal).toBe(3);
    expect(after.get('follow')!.ordinal).toBe(4);

    // (2) id stability preserved: the insert mints a fresh id ('follow') and
    //     never re-keys existing rows — so cast (id-first) matching still works.
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

  it('live-mirror producer: same no-shift + stable-setId contract on the OMIT-NULL wire shape', async () => {
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
    // A1 no-shift carried through the producer's wire projection: base ordinals
    // unchanged, follower at MAX+1 = 4.
    expect(wire.get('head')!.ordinal).toBe(1);
    expect(wire.get('workA')!.ordinal).toBe(2);
    expect(wire.get('tail')!.ordinal).toBe(3);
    expect(wire.get('follow')!.ordinal).toBe(4);
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

  it('cast wire ordinals reflect the A1 no-shift DB state (base ordinals stable, follower appended)', async () => {
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
    // A1: the cast wire carries the UN-shifted ordinals (tail stays 3, workA
    // stays 2); the new follower appends at MAX+1 = 4. For cast the Watch base
    // carries the real ids so it matches id-first anyway, but A1 ALSO removes
    // the ordinal churn — both axes are now safe.
    expect(wireSets.get('head')).toBe(1);
    expect(wireSets.get('workA')).toBe(2);
    expect(wireSets.get('tail')).toBe(3);
    expect(wireSets.get('follow')).toBe(4);
  });
});

// Touch LiveMirrorPayload so the import is load-bearing for the type checker
// (the producer test uses it; here it documents the producer wire shape).
export type _WireShape = LiveMirrorPayload;
