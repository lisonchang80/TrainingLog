import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createSession } from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { loadReplayRecords } from '../../src/adapters/sqlite/achievementRepository';
import { loadStatsSetRecords } from '../../src/adapters/sqlite/statsRepository';
import { loadHistoryListRows } from '../../src/adapters/sqlite/sessionRepository';
import type { Database } from '../../src/db/types';

/**
 * CROSS-FIX consistency suite (2026-06-25 integration hardening).
 *
 * Three independent fixes landed the SAME invariant — "a set counts toward an
 * aggregate iff its DB column `is_logged = 1`, plain (NOT dropset-chain-aware)" —
 * on three different surfaces:
 *
 *   1. Stats-tab volume    → `loadStatsSetRecords`   (commit 60cd5e5, F3)
 *   2. History-tab volume  → `loadHistoryListRows`   (already plain is_logged=1)
 *   3. Achievement PR detect → `loadReplayRecords`   (commit d176702)
 *
 * The individual commits could only test their own surface. This file builds ONE
 * session with a deliberate mix of set states and asserts all three surfaces
 * agree on WHICH sets count — the cross-fix interaction. If any future change
 * drifts one surface's filter (e.g. someone makes Stats chain-aware but leaves
 * History plain), these tests fail loudly.
 *
 * Set inventory in the canonical fixture (all on Bench Press, one session):
 *   W1  working  logged    80kg×8  → counts (Stats+History+PR)
 *   W2  working  logged    90kg×5  → counts (Stats+History+PR)
 *   U1  working  UNCHECKED 200kg×8 → counts NOWHERE (is_logged=0)
 *   WU  warmup   logged    40kg×12 → counts NOWHERE (warmup excluded everywhere)
 *   DH  dropset  logged   100kg×5  → Stats volume YES; PR/History-volume per rules
 *   DF  dropset  UNCHECKED 70kg×6  → follower, is_logged=0 → Stats/History volume NO
 *
 * The dropset head (DH) is set_kind='dropset': it contributes to Stats VOLUME
 * (volumeEngine includes dropset) and History VOLUME (set_kind != 'warmup' AND
 * is_logged=1), but NOT to PR replay (loadReplayRecords filters
 * set_kind='working'). The follower (DF) carries DB is_logged=0 per the
 * dropset-chain DB invariant #2 (only the head flips on ✓), so it counts
 * nowhere by volume — exactly the "plain, not chain-aware" rule all three fixes
 * chose.
 */

const benchPlate = (
  db: Database,
  benchId: string,
  args: {
    id: string;
    session_id: string;
    weight_kg: number;
    reps: number;
    ordering: number;
    created_at: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id?: string | null;
    logged: boolean;
  }
) =>
  insertSessionSet(db, {
    id: args.id,
    session_id: args.session_id,
    exercise_id: benchId,
    weight_kg: args.weight_kg,
    reps: args.reps,
    is_skipped: 0,
    ordering: args.ordering,
    created_at: args.created_at,
    set_kind: args.set_kind,
    parent_set_id: args.parent_set_id ?? null,
  }).then(() =>
    args.logged
      ? db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id)
      : Promise.resolve(undefined)
  );

const SESSION = 'sess-cross';
const START = 1_700_000_000_000;

async function seedCanonicalFixture(db: Database, benchId: string): Promise<void> {
  await createSession(db, { id: SESSION, started_at: START });
  // W1 working logged
  await benchPlate(db, benchId, {
    id: 'W1', session_id: SESSION, weight_kg: 80, reps: 8, ordering: 1,
    created_at: START + 1, set_kind: 'working', logged: true,
  });
  // W2 working logged
  await benchPlate(db, benchId, {
    id: 'W2', session_id: SESSION, weight_kg: 90, reps: 5, ordering: 2,
    created_at: START + 2, set_kind: 'working', logged: true,
  });
  // U1 working UNCHECKED — heavy planned default the user never ticked
  await benchPlate(db, benchId, {
    id: 'U1', session_id: SESSION, weight_kg: 200, reps: 8, ordering: 3,
    created_at: START + 3, set_kind: 'working', logged: false,
  });
  // WU warmup logged
  await benchPlate(db, benchId, {
    id: 'WU', session_id: SESSION, weight_kg: 40, reps: 12, ordering: 4,
    created_at: START + 4, set_kind: 'warmup', logged: true,
  });
  // DH dropset head logged
  await benchPlate(db, benchId, {
    id: 'DH', session_id: SESSION, weight_kg: 100, reps: 5, ordering: 5,
    created_at: START + 5, set_kind: 'dropset', logged: true,
  });
  // DF dropset follower — DB is_logged=0 (invariant #2)
  await benchPlate(db, benchId, {
    id: 'DF', session_id: SESSION, weight_kg: 70, reps: 6, ordering: 6,
    created_at: START + 6, set_kind: 'dropset', parent_set_id: 'DH', logged: false,
  });
}

describe('is_logged invariant — cross-surface consistency (Stats × History × PR)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    benchId = (await listExercises(db)).find((e) => e.name === 'Bench Press')!.id;
    await seedCanonicalFixture(db, benchId);
  });

  afterEach(() => {
    db.close();
  });

  it('Stats volume == History volume (the explicit F3 goal) on the mixed fixture', async () => {
    const statsRecords = await loadStatsSetRecords(db, {
      start_ms: 0,
      end_ms: START + 1_000_000,
    });
    const statsVolume = statsRecords.reduce((sum, r) => sum + (r.volume ?? 0), 0);

    const historyRows = await loadHistoryListRows(db);
    const historyRow = historyRows.find((r) => r.session.id === SESSION)!;

    // W1(80×8=640) + W2(90×5=450) + DH(100×5=500) = 1590.
    // U1 (unchecked) and DF (follower is_logged=0) and WU (warmup) excluded.
    expect(statsVolume).toBe(1590);
    expect(historyRow.volume).toBe(1590);
    expect(statsVolume).toBe(historyRow.volume);
  });

  it('Stats counts exactly {W1, W2, DH} — unchecked working, warmup, and follower all excluded', async () => {
    const records = await loadStatsSetRecords(db, {
      start_ms: 0,
      end_ms: START + 1_000_000,
    });
    expect(records.map((r) => r.set_id).sort()).toEqual(['DH', 'W1', 'W2']);
  });

  it('PR replay counts exactly {W1, W2} — dropset head excluded (working-only) AND unchecked working excluded', async () => {
    const records = await loadReplayRecords(db);
    const fromSession = records.filter((r) => r.session_id === SESSION);
    // PR replay is working-only, so DH (dropset head) drops out — leaving the two
    // logged working sets. U1 is working but is_logged=0 → also out.
    expect(fromSession.map((r) => r.set_id).sort()).toEqual(['W1', 'W2']);
    // Critically: the false 200kg "PR" never reaches replay.
    expect(fromSession.some((r) => r.set_id === 'U1')).toBe(false);
  });

  it('all three surfaces agree on the LOGGED-WORKING core {W1, W2}, and none counts the unchecked U1 or the follower DF', async () => {
    const stats = (await loadStatsSetRecords(db, { start_ms: 0, end_ms: START + 1_000_000 }))
      .map((r) => r.set_id);
    const pr = (await loadReplayRecords(db))
      .filter((r) => r.session_id === SESSION)
      .map((r) => r.set_id);
    const historyVol = (await loadHistoryListRows(db)).find((r) => r.session.id === SESSION)!.volume;

    // Shared core: every working logged set appears on Stats AND PR.
    for (const id of ['W1', 'W2']) {
      expect(stats).toContain(id);
      expect(pr).toContain(id);
    }
    // The unchecked working set and the unchecked follower count on NONE of them.
    for (const id of ['U1', 'DF']) {
      expect(stats).not.toContain(id);
      expect(pr).not.toContain(id);
    }
    // History volume is the SUM proxy for the same membership — it equals Stats
    // (proven numerically above) so it agrees by construction.
    expect(historyVol).toBe(1590);
  });

  it('exercise_count (History 動作數) only counts exercises with a logged set — fixture has one logged exercise', async () => {
    const historyRow = (await loadHistoryListRows(db)).find((r) => r.session.id === SESSION)!;
    // Bench Press has W1/W2/DH logged → exactly 1 performed exercise.
    expect(historyRow.exerciseCount).toBe(1);
  });
});

/**
 * GAP 2 — F3 / achievement dropset-chain EDGES.
 *
 * The fixes deliberately chose "plain is_logged=1, NOT chain-aware". That means
 * the DB column is the sole authority even when it disagrees with chain
 * semantics. These two edges pin that choice directly:
 *
 *   - A logged HEAD with UNCHECKED followers: head volume counts; followers
 *     don't (their column is 0) — Stats and History both follow the column, not
 *     the chain.
 *   - An UNCHECKED head with LOGGED followers (an unusual / corrupt-ish state
 *     the column model still answers deterministically): head drops, only the
 *     column-logged followers count for volume. PR replay sees neither (both are
 *     set_kind='dropset', working-only filter).
 */
describe('dropset-chain edges — plain is_logged=1 (not chain-aware) on every surface', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  const SESS = 'sess-drop-edge';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    benchId = (await listExercises(db)).find((e) => e.name === 'Bench Press')!.id;
    await createSession(db, { id: SESS, started_at: START });
  });

  afterEach(() => {
    db.close();
  });

  it('logged HEAD + unchecked followers: only the head counts toward volume; PR replay sees nothing (working-only)', async () => {
    await benchPlate(db, benchId, {
      id: 'H', session_id: SESS, weight_kg: 100, reps: 5, ordering: 1,
      created_at: START + 1, set_kind: 'dropset', logged: true,
    });
    await benchPlate(db, benchId, {
      id: 'F1', session_id: SESS, weight_kg: 80, reps: 6, ordering: 2,
      created_at: START + 2, set_kind: 'dropset', parent_set_id: 'H', logged: false,
    });
    await benchPlate(db, benchId, {
      id: 'F2', session_id: SESS, weight_kg: 60, reps: 8, ordering: 3,
      created_at: START + 3, set_kind: 'dropset', parent_set_id: 'H', logged: false,
    });

    const stats = await loadStatsSetRecords(db, { start_ms: 0, end_ms: START + 1_000_000 });
    expect(stats.map((r) => r.set_id)).toEqual(['H']); // followers' column is 0
    const statsVolume = stats.reduce((s, r) => s + (r.volume ?? 0), 0);
    expect(statsVolume).toBe(500); // 100×5

    const historyVol = (await loadHistoryListRows(db)).find((r) => r.session.id === SESS)!.volume;
    expect(historyVol).toBe(500);
    expect(historyVol).toBe(statsVolume);

    // PR replay is working-only → an all-dropset chain contributes zero PRs.
    const pr = (await loadReplayRecords(db)).filter((r) => r.session_id === SESS);
    expect(pr).toHaveLength(0);
  });

  it('UNCHECKED head + LOGGED followers: column rules — only the column-logged followers count for volume', async () => {
    // An unusual state where the head was un-ticked but followers carry is_logged=1.
    // The fixes chose the column as the single source of truth, so volume follows
    // the column verbatim (no head→follower or follower→head resolution).
    await benchPlate(db, benchId, {
      id: 'H2', session_id: SESS, weight_kg: 100, reps: 5, ordering: 1,
      created_at: START + 1, set_kind: 'dropset', logged: false,
    });
    await benchPlate(db, benchId, {
      id: 'G1', session_id: SESS, weight_kg: 80, reps: 6, ordering: 2,
      created_at: START + 2, set_kind: 'dropset', parent_set_id: 'H2', logged: true,
    });

    const stats = await loadStatsSetRecords(db, { start_ms: 0, end_ms: START + 1_000_000 });
    // Head is column-0 → excluded; the column-1 follower is included.
    expect(stats.map((r) => r.set_id)).toEqual(['G1']);
    const statsVolume = stats.reduce((s, r) => s + (r.volume ?? 0), 0);
    expect(statsVolume).toBe(480); // 80×6

    const historyVol = (await loadHistoryListRows(db)).find((r) => r.session.id === SESS)!.volume;
    expect(historyVol).toBe(480);
    expect(historyVol).toBe(statsVolume);

    // Neither row is set_kind='working', so PR replay still sees nothing.
    const pr = (await loadReplayRecords(db)).filter((r) => r.session_id === SESS);
    expect(pr).toHaveLength(0);
  });
});
