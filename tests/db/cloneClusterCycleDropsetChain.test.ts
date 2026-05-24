import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  cloneClusterCycle,
  insertSessionSet,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * `cloneClusterCycle` × dropset chain semantics
 * (deferred low-priority from 5/24 Agent D's audit §3 row "cloneClusterCycle"
 * — promoted to MED here because chain-clone semantics are an invariant a
 * future caller could accidentally break).
 *
 * Two invariants the existing tests (`clusterCycleOps.test.ts`) leave
 * implicit:
 *
 *   (I1) Source is a dropset HEAD → followers are NOT cloned (chain not
 *        deep-copied). The new row gets `set_kind` from source (so it's
 *        labeled "dropset") but is a standalone row (no follower attached,
 *        no chain semantics until the user re-creates the chain manually).
 *        Cluster cycle row right-swipe 加 should produce a new cycle "to-
 *        do" — copying the entire chain would create silent extra logged
 *        sets the user never performed.
 *
 *   (I2) Source is a dropset FOLLOWER → the clone's `parent_set_id` is
 *        forced to NULL (per the INSERT statement at setRepository.ts:410:
 *        `parent_set_id` literal). Cloning a follower into "+ 加 cycle"
 *        produces a new working/dropset-head-shaped row, never another
 *        orphan follower pointing at a stale parent.
 *
 *   (I3) is_logged on the source is irrelevant — the clone is always
 *        is_logged=0 ("to-do, not done"). Already locked by an existing
 *        test, but combined with chain semantics adds insurance.
 *
 * Wave 5/18 #18 added cascade-delete on heads; this is the symmetric
 * write-side invariant. Mirrors the skill `dropset-chain-semantics`
 * guidance.
 */
describe('cloneClusterCycle × dropset chain semantics', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat
  const sessionId = 'sess-clone-chain';
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

  async function insertSet(opts: {
    id: string;
    exercise_id: string;
    ordering: number;
    weight_kg?: number;
    reps?: number;
    set_kind: 'working' | 'warmup' | 'dropset';
    parent_set_id?: string | null;
    is_logged?: number;
  }) {
    await insertSessionSet(db, {
      id: opts.id,
      session_id: sessionId,
      exercise_id: opts.exercise_id,
      weight_kg: opts.weight_kg ?? 80,
      reps: opts.reps ?? 5,
      is_skipped: 0,
      ordering: opts.ordering,
      created_at: now,
      set_kind: opts.set_kind,
      parent_set_id: opts.parent_set_id ?? null,
    });
    // is_logged defaults to 0 in insertSessionSet; patch when caller wants 1.
    if (opts.is_logged === 1) {
      await db.runAsync(
        `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
        opts.id,
      );
    }
  }

  it('I1: cloning a dropset HEAD does NOT deep-copy followers — only the head row gets a new clone', async () => {
    // A side: dropset chain (head + 2 followers).  B side: working pair.
    await insertSet({
      id: 'a-head',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 80,
      reps: 5,
      set_kind: 'dropset',
    });
    await insertSet({
      id: 'a-foll-1',
      exercise_id: exA,
      ordering: 2,
      weight_kg: 60,
      reps: 5,
      set_kind: 'dropset',
      parent_set_id: 'a-head',
    });
    await insertSet({
      id: 'a-foll-2',
      exercise_id: exA,
      ordering: 3,
      weight_kg: 40,
      reps: 5,
      set_kind: 'dropset',
      parent_set_id: 'a-head',
    });
    await insertSet({
      id: 'b1',
      exercise_id: exB,
      ordering: 1,
      weight_kg: 60,
      reps: 8,
      set_kind: 'working',
    });

    await cloneClusterCycle(db, {
      a_source: { id: 'a-head', exercise_id: exA },
      b_source: { id: 'b1', exercise_id: exB },
      session_id: sessionId,
      new_a_set_id: 'a-clone',
      new_b_set_id: 'b-clone',
    });

    const rows = await listSetsBySession(db, sessionId);
    // Only 2 new rows (a-clone + b-clone) — followers NOT replicated.
    expect(rows.map((r) => r.id).sort()).toEqual(
      ['a-clone', 'a-foll-1', 'a-foll-2', 'a-head', 'b-clone', 'b1'].sort(),
    );
    // The new A-side row IS labeled "dropset" (set_kind copied from source).
    const aClone = rows.find((r) => r.id === 'a-clone')!;
    expect(aClone.set_kind).toBe('dropset');
    // ... but has NO parent_set_id and NO follower rows pointing at it.
    expect(aClone.parent_set_id).toBeNull();
    const followersOfClone = rows.filter(
      (r) => r.parent_set_id === 'a-clone',
    );
    expect(followersOfClone).toHaveLength(0);
    // And it's is_logged=0 (clone is "to-do").
    expect(aClone.is_logged).toBe(0);
  });

  it('I2: cloning a FOLLOWER produces a row with parent_set_id=NULL — never another orphan follower', async () => {
    // A side: dropset chain. Caller mistakenly passes a follower id as
    // source (a UI bug we want to surface defensively, but the function
    // strictly handles whatever id is passed).
    await insertSet({
      id: 'a-head',
      exercise_id: exA,
      ordering: 1,
      set_kind: 'dropset',
    });
    await insertSet({
      id: 'a-foll',
      exercise_id: exA,
      ordering: 2,
      weight_kg: 60,
      reps: 6,
      set_kind: 'dropset',
      parent_set_id: 'a-head',
    });
    await insertSet({
      id: 'b1',
      exercise_id: exB,
      ordering: 1,
      set_kind: 'working',
    });

    await cloneClusterCycle(db, {
      a_source: { id: 'a-foll', exercise_id: exA },
      b_source: { id: 'b1', exercise_id: exB },
      session_id: sessionId,
      new_a_set_id: 'a-foll-clone',
      new_b_set_id: 'b-clone',
    });

    const rows = await listSetsBySession(db, sessionId);
    const aFollClone = rows.find((r) => r.id === 'a-foll-clone')!;
    // parent_set_id explicitly forced NULL — the INSERT literal at line 410
    // of setRepository.ts pins this regardless of source's parent.
    expect(aFollClone.parent_set_id).toBeNull();
    // set_kind preserved (still 'dropset') but it's now structurally a
    // standalone row — chain-aware queries will treat it as a NEW head.
    expect(aFollClone.set_kind).toBe('dropset');
    expect(aFollClone.weight_kg).toBe(60); // copied
    expect(aFollClone.reps).toBe(6);
    expect(aFollClone.is_logged).toBe(0);
  });

  it('I3: cloning a LOGGED dropset head — clone is_logged=0 (clone is "to-do, not done"), chain unaffected', async () => {
    // Head is logged (chain effectively complete). Clone the cycle —
    // newcomer should NOT inherit the logged state.
    await insertSet({
      id: 'a-head',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 100,
      reps: 3,
      set_kind: 'dropset',
      is_logged: 1,
    });
    await insertSet({
      id: 'a-foll',
      exercise_id: exA,
      ordering: 2,
      set_kind: 'dropset',
      parent_set_id: 'a-head',
    });
    await insertSet({
      id: 'b1',
      exercise_id: exB,
      ordering: 1,
      weight_kg: 80,
      reps: 5,
      set_kind: 'working',
      is_logged: 1,
    });

    await cloneClusterCycle(db, {
      a_source: { id: 'a-head', exercise_id: exA },
      b_source: { id: 'b1', exercise_id: exB },
      session_id: sessionId,
      new_a_set_id: 'a-clone',
      new_b_set_id: 'b-clone',
    });

    const rows = await listSetsBySession(db, sessionId);
    expect(rows.find((r) => r.id === 'a-clone')?.is_logged).toBe(0);
    expect(rows.find((r) => r.id === 'b-clone')?.is_logged).toBe(0);
    // Source rows untouched.
    expect(rows.find((r) => r.id === 'a-head')?.is_logged).toBe(1);
    expect(rows.find((r) => r.id === 'b1')?.is_logged).toBe(1);
    // Source's followers untouched.
    const foll = rows.find((r) => r.id === 'a-foll')!;
    expect(foll.parent_set_id).toBe('a-head'); // still pointing at original head
  });

  it('asymmetric chain × working pair — only A side has a chain head; B side is plain working — clone works on both sides as normal', async () => {
    // Realistic scenario: A side cycle 1 is a dropset, B side cycle 1 is
    // working. User right-swipes "+ 加 cycle" → clone produces parallel
    // cycle 2 on both sides.
    await insertSet({
      id: 'a-head',
      exercise_id: exA,
      ordering: 1,
      weight_kg: 100,
      reps: 3,
      set_kind: 'dropset',
    });
    await insertSet({
      id: 'a-foll',
      exercise_id: exA,
      ordering: 2,
      set_kind: 'dropset',
      parent_set_id: 'a-head',
    });
    await insertSet({
      id: 'b1',
      exercise_id: exB,
      ordering: 1,
      weight_kg: 80,
      reps: 5,
      set_kind: 'working',
    });

    await cloneClusterCycle(db, {
      a_source: { id: 'a-head', exercise_id: exA },
      b_source: { id: 'b1', exercise_id: exB },
      session_id: sessionId,
      new_a_set_id: 'a2',
      new_b_set_id: 'b2',
    });

    const rows = await listSetsBySession(db, sessionId);
    const a2 = rows.find((r) => r.id === 'a2')!;
    const b2 = rows.find((r) => r.id === 'b2')!;
    expect(a2.set_kind).toBe('dropset'); // source was dropset head → label preserved
    expect(a2.parent_set_id).toBeNull(); // no follower auto-attached
    expect(a2.weight_kg).toBe(100);
    expect(a2.reps).toBe(3);
    expect(b2.set_kind).toBe('working');
    expect(b2.parent_set_id).toBeNull();
    expect(b2.weight_kg).toBe(80);
    expect(b2.reps).toBe(5);
    // Ordering: a2 gets MAX(ordering for exA) + 1 = 3 (a-head + a-foll
    // occupy 1+2); b2 gets MAX(ordering for exB) + 1 = 2.
    // Note the cloneClusterCycle MAX query scopes by exercise_id when no
    // session_exercise_id provided.
    expect(a2.ordering).toBe(3);
    expect(b2.ordering).toBe(2);
  });
});
