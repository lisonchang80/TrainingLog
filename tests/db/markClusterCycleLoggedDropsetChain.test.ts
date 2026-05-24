import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  markClusterCycleLogged,
  markClusterCycleUnlogged,
} from '../../src/adapters/sqlite/setRepository';

/**
 * markClusterCycleLogged / Unlogged × dropset chain on one cluster side
 * (deferred top-5 from 5/24 Agent D's test-gap audit, round 2).
 *
 * Context — ADR-0019 chain semantics (see skill `dropset-chain-semantics`):
 *   - is_logged for a dropset chain is owned by the HEAD; followers stay at
 *     is_logged=0 always (UI tap-✓ toggles head only, computeClusterVolume
 *     defers follower's effective is_logged to head's).
 *   - markClusterCycleLogged is the cluster-cycle ✓ atomic flip (Q16) —
 *     it flips the PAIR (a_set, b_set) for one cycle. The comment in
 *     setRepository.ts:266-269 explicitly notes "No cascade to the underlying
 *     parent_set_id dropset-follower chain".
 *
 * What's covered elsewhere:
 *   - `clusterAtomicLog.test.ts` covers the atomic flip for non-dropset
 *     pairs (5 cases).
 *   - `clusterDropset.test.ts` covers deleteSet cascade × cluster side
 *     isolation.
 *   - But the interaction of `markClusterCycleLogged` × a dropset chain
 *     living on ONE cluster side is not explicitly tested. This file fills
 *     that gap.
 *
 * Gap rationale (D's notes §3 medium-priority row 5):
 *   "When the cluster A side hosts a dropset chain (head + followers) and
 *    the user toggles a working cycle on the OTHER side, the chain's
 *    is_logged propagation should not bleed."
 */
describe('markClusterCycleLogged × dropset chain on one side', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench (seed)
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat (seed)
  const sessionId = 'sess-chain-cluster';
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertWorking(
    id: string,
    exercise_id: string,
    ordering: number,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  async function insertDropsetHead(
    id: string,
    exercise_id: string,
    ordering: number,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 80,
      reps: 5,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id: null,
    });
  }

  async function insertDropsetFollower(
    id: string,
    exercise_id: string,
    ordering: number,
    parent_set_id: string,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 60,
      reps: 5,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: 'dropset',
      parent_set_id,
    });
  }

  async function readIsLogged(set_id: string): Promise<number> {
    const all = await listSetsBySession(db, sessionId);
    const row = all.find((s) => s.id === set_id);
    if (!row) throw new Error(`set ${set_id} not found`);
    return row.is_logged;
  }

  it('logging a cycle that pairs a working A with a working B does NOT touch unrelated dropset followers on A side', async () => {
    // A side: cycle 1 working + then a dropset chain (head + 2 followers)
    // representing a separate "D1" stack appended later. Cycle 1 working
    // (a1) is the head of the cycle being toggled, not the dropset head.
    await insertWorking('a1', exA, 1);
    await insertDropsetHead('a-head', exA, 2);
    await insertDropsetFollower('a-foll-1', exA, 3, 'a-head');
    await insertDropsetFollower('a-foll-2', exA, 4, 'a-head');
    // B side: pair to a1.
    await insertWorking('b1', exB, 5);

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });

    expect(await readIsLogged('a1')).toBe(1); // flipped
    expect(await readIsLogged('b1')).toBe(1); // flipped
    // Dropset chain on A side completely untouched — owner of that chain's
    // is_logged is the head (a-head), and its own cluster-cycle ✓ is a
    // separate concern.
    expect(await readIsLogged('a-head')).toBe(0);
    expect(await readIsLogged('a-foll-1')).toBe(0);
    expect(await readIsLogged('a-foll-2')).toBe(0);
  });

  it('logging the dropset HEAD cycle (head paired with B working) flips only the head, NOT the followers', async () => {
    // Cluster pair: A-side dropset head + B-side working. UI passes the
    // HEAD id (not a follower) per chain-semantics — markClusterCycleLogged
    // is intentionally id-strict and does NOT chase parent_set_id.
    await insertDropsetHead('a-head', exA, 1);
    await insertDropsetFollower('a-foll-1', exA, 2, 'a-head');
    await insertDropsetFollower('a-foll-2', exA, 3, 'a-head');
    await insertWorking('b1', exB, 4);

    await markClusterCycleLogged(db, { a_set_id: 'a-head', b_set_id: 'b1' });

    expect(await readIsLogged('a-head')).toBe(1); // head flipped
    expect(await readIsLogged('b1')).toBe(1);
    // Followers stay 0 — the comment at setRepository.ts:266-269 documents
    // "No cascade to the underlying parent_set_id dropset-follower chain".
    expect(await readIsLogged('a-foll-1')).toBe(0);
    expect(await readIsLogged('a-foll-2')).toBe(0);
  });

  it('unchecking the head cycle inverse — head flips back to 0, followers (always 0) remain 0', async () => {
    await insertDropsetHead('a-head', exA, 1);
    await insertDropsetFollower('a-foll-1', exA, 2, 'a-head');
    await insertWorking('b1', exB, 3);

    // First log.
    await markClusterCycleLogged(db, { a_set_id: 'a-head', b_set_id: 'b1' });
    expect(await readIsLogged('a-head')).toBe(1);
    expect(await readIsLogged('b1')).toBe(1);
    expect(await readIsLogged('a-foll-1')).toBe(0);

    // Then uncheck.
    await markClusterCycleUnlogged(db, { a_set_id: 'a-head', b_set_id: 'b1' });
    expect(await readIsLogged('a-head')).toBe(0);
    expect(await readIsLogged('b1')).toBe(0);
    // Follower never changed — it stayed at 0 throughout (chain semantics:
    // follower DB is_logged is structurally always 0).
    expect(await readIsLogged('a-foll-1')).toBe(0);
  });

  it('dropset chains on BOTH cluster sides — flipping the working pair does not bleed into either chain', async () => {
    // A side: working (a1) + a dropset chain (a-head + foll).
    await insertWorking('a1', exA, 1);
    await insertDropsetHead('a-head', exA, 2);
    await insertDropsetFollower('a-foll', exA, 3, 'a-head');
    // B side: working (b1) + a dropset chain (b-head + foll).
    await insertWorking('b1', exB, 4);
    await insertDropsetHead('b-head', exB, 5);
    await insertDropsetFollower('b-foll', exB, 6, 'b-head');

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });

    expect(await readIsLogged('a1')).toBe(1);
    expect(await readIsLogged('b1')).toBe(1);
    // Neither chain (A or B) is touched.
    expect(await readIsLogged('a-head')).toBe(0);
    expect(await readIsLogged('a-foll')).toBe(0);
    expect(await readIsLogged('b-head')).toBe(0);
    expect(await readIsLogged('b-foll')).toBe(0);
  });

  it('passing a FOLLOWER id (caller bug — UI should pass head) — flips the follower row only, not the head; chain semantics violated but contract is strict', async () => {
    // This locks in the function's strict-id contract: it updates whichever
    // id you pass, no follower-to-head redirection. Documents the caller's
    // responsibility per the comment "passing in the head is a programming
    // error" (line 1024 — for removeSessionDropsetRow, mirrored convention).
    await insertDropsetHead('a-head', exA, 1);
    await insertDropsetFollower('a-foll', exA, 2, 'a-head');
    await insertWorking('b1', exB, 3);

    // Caller bug — passes follower id instead of head.
    await markClusterCycleLogged(db, { a_set_id: 'a-foll', b_set_id: 'b1' });

    expect(await readIsLogged('a-foll')).toBe(1); // follower got flipped
    expect(await readIsLogged('a-head')).toBe(0); // head NOT touched
    expect(await readIsLogged('b1')).toBe(1);
    // Even though chain semantics say follower DB is_logged should always
    // be 0, this lock-in test surfaces "your UI passed the wrong id" as a
    // visible DB-level smell rather than silently redirecting.
  });
});
