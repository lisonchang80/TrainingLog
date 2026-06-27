/**
 * A1 no-shift — FORWARD reconcile + reverse-wire safety proof (SPIKE).
 *
 * Option A1 (2026-06-28 spike) replaced the iPhone `insertDropsetFollower` /
 * `insertSessionSetAfter` / `addSessionDropsetRow` / `addSessionDropsetCluster`
 * ordinal SHIFT (`UPDATE "set" SET ordering = ordering + 1 WHERE ordering >= N`)
 * with a non-colliding session-wide `MAX(ordering)+1` append. The genuine risk
 * the spike must DISPROVE is that this breaks the forward Watch→iPhone reconcile,
 * which matches base sets by `(session_exercise_id, ordinal)` VALUE
 * (`replaceLiveMirror` pass 1: `SELECT id FROM "set" WHERE session_exercise_id=?
 * AND ordering=?`).
 *
 * These tests are the spike's primary evidence:
 *   1. FORWARD invariant: after a non-last A1 insert, feeding the resulting
 *      iPhone DB state back through `replaceLiveMirror` (the forward path)
 *      matches every existing set by `(se_id, ordering)` — no row is
 *      duplicated, re-keyed, or orphaned. (A self-round-trip is the cleanest
 *      proof the `(se_id, ordering)` identity still hits the same rows.)
 *   2. DISPLAY_RANK lands the follower right after its head in render order
 *      even though its `ordering` is now a high MAX+1 value.
 *   3. REVERSE wire: the non-last follower's wire ordinal is UNIQUE (absent
 *      from the pre-insert base ordinals) → no collision onto a neighbour base
 *      set, while every pre-existing base ordinal is byte-identical.
 *
 * Real in-memory SQLite (better-sqlite3).
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
  insertSessionSetAfter,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';
import { fetchSessionSnapshot } from '../../src/adapters/watch';
import { replaceLiveMirror } from '../../src/services/replaceLiveMirror';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';
import type { Database } from '../../src/db/types';

const BENCH = '00000000-0000-4000-8000-000000000001';
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
 * Two-card session where card A's chain is NOT last:
 *   se-A (BENCH): head(ord 1, working) , workA(ord 2, working)
 *   se-B (SQUAT): tail(ord 3, working)
 */
async function seedNonLast(db: Database, sessionId: string): Promise<void> {
  await createSession(db, {
    id: sessionId,
    started_at: 1_700_000_000_000,
    title: 'Drop Day',
  });
  await appendSessionExercise(db, { id: 'se-A', session_id: sessionId, exercise_id: BENCH });
  await appendSessionExercise(db, { id: 'se-B', session_id: sessionId, exercise_id: SQUAT });
  const base = [
    { id: 'head', ex: BENCH, ord: 1, se: 'se-A' },
    { id: 'workA', ex: BENCH, ord: 2, se: 'se-A' },
    { id: 'tail', ex: SQUAT, ord: 3, se: 'se-B' },
  ];
  for (const b of base) {
    await insertSessionSet(db, {
      id: b.id,
      session_id: sessionId,
      exercise_id: b.ex,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: b.ord,
      created_at: 1_700_000_000_000 + b.ord,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: b.se,
    });
  }
}

describe('A1 no-shift — forward reconcile keys on (se_id, ordering) survives a non-last insert', () => {
  it('replaceLiveMirror self-round-trip after a non-last dropset insert matches every set by (se_id, ordering) — no dup / re-key / orphan', async () => {
    const db = await makeDb();
    await seedNonLast(db, 'sess-1');

    // A1 non-last insert: a dropset follower under `head` (workA + tail live
    // after it). With A1 this appends at MAX+1 = 4; head/workA/tail keep 1/2/3.
    await insertDropsetFollower(db, {
      session_id: 'sess-1',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const beforeRows = await listSetsBySession(db, 'sess-1');
    const beforeIds = new Set(beforeRows.map((r) => r.id));
    expect(beforeIds).toEqual(new Set(['head', 'workA', 'tail', 'follow']));

    // Build the snapshot the iPhone would emit, then feed it straight back
    // through the FORWARD reconcile. This exercises the `(se_id, ordering)`
    // pass-1 match against the very ordinals A1 produced. If A1 had shifted /
    // re-stamped ordinals non-deterministically, the round-trip would mismatch
    // (re-insert as new rows / orphan the follower / clobber neighbours).
    const snapshot = (await fetchSessionSnapshot(db, 'sess-1'))!;
    const res = await replaceLiveMirror(db, snapshot);

    const afterRows = await listSetsBySession(db, 'sess-1');
    // (a) No duplication / re-keying: exactly the same 4 ids survive.
    expect(new Set(afterRows.map((r) => r.id))).toEqual(beforeIds);
    expect(afterRows).toHaveLength(4);
    // (b) Each base set keeps its ORIGINAL ordinal — the forward match hit the
    //     existing row by (se_id, ordering) rather than inserting a clone.
    const ordById = new Map(afterRows.map((r) => [r.id, r.ordering] as const));
    expect(ordById.get('head')).toBe(1);
    expect(ordById.get('workA')).toBe(2);
    expect(ordById.get('tail')).toBe(3);
    expect(ordById.get('follow')).toBe(4);
    // (c) The follower chain survives: parent_set_id still points at head, NOT
    //     orphaned to null (the broken-chain symptom).
    const follow = afterRows.find((r) => r.id === 'follow')!;
    expect(follow.parent_set_id).toBe('head');
    expect(follow.set_kind).toBe('dropset');
    // (d) The reconcile reported the same 4 sets — no tail purge, no tombstone.
    expect(res.setCount).toBe(4);
    expect(res.purgedSets).toBe(0);
  });

  it('insertSessionSetAfter non-last: forward self-round-trip leaves the OTHER card untouched (no cross-card ordinal churn)', async () => {
    const db = await makeDb();
    await seedNonLast(db, 'sess-2');

    // Non-last "+1 below source" on workA (card A). A1: appends at MAX+1 = 4.
    const ins = await insertSessionSetAfter(db, {
      session_id: 'sess-2',
      source_set_id: 'workA',
      uuid: (() => {
        let n = 0;
        return () => `new-${++n}`;
      })(),
    });
    expect(ins.ordering).toBe(4);

    const snapshot = (await fetchSessionSnapshot(db, 'sess-2'))!;
    await replaceLiveMirror(db, snapshot);

    const rows = await listSetsBySession(db, 'sess-2');
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    // The OTHER card's set (`tail`, se-B) kept ordinal 3 across both the insert
    // AND the forward round-trip — the cross-card invariant A1 must preserve.
    expect(ordById.get('tail')).toBe(3);
    // se-B card still has exactly its one set.
    expect(rows.filter((r) => r.session_exercise_id === 'se-B').map((r) => r.id)).toEqual([
      'tail',
    ]);
    // No row count drift.
    expect(rows).toHaveLength(4);
  });
});

describe('A1 no-shift — display_rank carries render position despite high ordering', () => {
  it('the non-last follower (ordering = MAX+1) still renders immediately after its head', async () => {
    const db = await makeDb();
    await seedNonLast(db, 'sess-3');

    await insertDropsetFollower(db, {
      session_id: 'sess-3',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const rows = await listSetsBySession(db, 'sess-3');
    // Card A render order via display_rank: head → follow → workA, even though
    // `follow`'s raw ordering (4) is the highest in the card.
    const cardA = rows.filter((r) => r.session_exercise_id === 'se-A');
    expect(sortSetsByDisplayRank(cardA).map((r) => r.id)).toEqual(['head', 'follow', 'workA']);
    // And `follow`'s ordering really is the high MAX+1 value (proves the sort
    // is on display_rank, not ordering).
    expect(cardA.find((r) => r.id === 'follow')!.ordering).toBe(4);
    expect(cardA.find((r) => r.id === 'follow')!.display_rank).toBe(1);
  });
});

describe('A1 no-shift — reverse wire ordinals no longer collide', () => {
  it('the follower wire ordinal is UNIQUE (absent from the pre-insert base ordinals) and no base ordinal moved', async () => {
    const db = await makeDb();
    await seedNonLast(db, 'sess-4');

    // Capture the immutable base ordinal set (what a Watch base would freeze).
    const baseSnap = (await fetchSessionSnapshot(db, 'sess-4'))!;
    const baseOrdinals = new Set<number>();
    for (const ex of baseSnap.exercises) for (const s of ex.sets) baseOrdinals.add(s.ordinal);
    expect(baseOrdinals).toEqual(new Set([1, 2, 3]));

    await insertDropsetFollower(db, {
      session_id: 'sess-4',
      parent_set_id: 'head',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      new_set_id: 'follow',
      now: () => 1_700_000_000_010,
    });

    const afterSnap = (await fetchSessionSnapshot(db, 'sess-4'))!;
    const ordById = new Map<string, number>();
    for (const ex of afterSnap.exercises) for (const s of ex.sets) ordById.set(s.setId, s.ordinal);

    // Every base set's wire ordinal is UNCHANGED → reverse-apply ordinal
    // fallback re-binds each onto its OWN base row (no collision).
    expect(ordById.get('head')).toBe(1);
    expect(ordById.get('workA')).toBe(2);
    expect(ordById.get('tail')).toBe(3);
    // The follower's ordinal is NOT in the frozen base set → on the immutable
    // Watch base it matches NOTHING by ordinal → routes to a clean addedSet
    // (instead of colliding onto `tail`'s old slot, the pre-A1 corruption).
    const followOrd = ordById.get('follow')!;
    expect(baseOrdinals.has(followOrd)).toBe(false);
    expect(followOrd).toBe(4);
  });
});
