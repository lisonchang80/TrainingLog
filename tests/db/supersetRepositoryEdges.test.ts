/**
 * supersetRepository edge coverage (src/adapters/sqlite/supersetRepository.ts).
 *
 * The main supersetRepository.test.ts covers the happy paths; these pin
 * two defensive branches it does not reach:
 *
 *   - `findExistingReusableSupersetByPair(A, A)` → short-circuits to null
 *     BEFORE the SQL (a pair against itself can't form a valid RS; the
 *     validate-draft layer rejects it, so the lookup must not match).
 *   - `listReusableSupersetsWithExercises` for a superset row that has NO
 *     `superset_exercise` links → exercises: [] (the `byId.get(id) ?? []`
 *     fallback). Bare rows shouldn't exist via the prod insert path but a
 *     CASCADE-orphaned / partially-migrated row must hydrate to an empty
 *     list rather than crash.
 *
 * Additive, non-overlapping with the main supersetRepository.test.ts.
 *
 * Overnight 2026-05-31 — agent 06 (non-WC coverage r2).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  findExistingReusableSupersetByPair,
  insertReusableSuperset,
  listReusableSupersetsWithExercises,
} from '../../src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetDraft } from '../../src/domain/superset/supersetManager';

const BENCH = '00000000-0000-4000-8000-000000000001';
const ROW = '00000000-0000-4000-8000-000000000005';

describe('supersetRepository edges', () => {
  let db: BetterSqliteDatabase;
  let uuidCounter = 0;
  const uuid = () => `ss-${++uuidCounter}`;
  const now = () => 1000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  // --- self-pair short-circuit -----------------------------------------

  it('findExistingReusableSupersetByPair(A, A) returns null without querying', async () => {
    // Even with a real RS in the DB, querying a self-pair must not match it.
    await insertReusableSuperset(
      db,
      {
        name: 'Bench + Row',
        color_hex: '#34c759',
        exercise_ids: [BENCH, ROW],
      } as ReusableSupersetDraft,
      uuid,
      now
    );

    expect(await findExistingReusableSupersetByPair(db, BENCH, BENCH)).toBeNull();
    expect(await findExistingReusableSupersetByPair(db, ROW, ROW)).toBeNull();
  });

  it('self-pair short-circuit also returns null on an empty DB', async () => {
    expect(await findExistingReusableSupersetByPair(db, BENCH, BENCH)).toBeNull();
  });

  // --- list-all with a link-less superset row --------------------------

  it('listReusableSupersetsWithExercises hydrates a link-less row to exercises: []', async () => {
    // Insert a bare superset row with NO superset_exercise links (simulating
    // a partially-migrated / CASCADE-orphaned row). The `byId.get(id) ?? []`
    // fallback must produce an empty exercise list, not undefined / crash.
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      'bare-rs',
      'Orphan',
      '#ff0000',
      1000,
      1000
    );

    const hydrated = await listReusableSupersetsWithExercises(db);
    const bare = hydrated.find((h) => h.superset.id === 'bare-rs');
    expect(bare).toBeDefined();
    expect(bare!.exercises).toEqual([]);
  });

  it('list-all returns a link-less row alongside a well-formed RS', async () => {
    await insertReusableSuperset(
      db,
      {
        name: 'Bench + Row',
        color_hex: '#34c759',
        exercise_ids: [BENCH, ROW],
      } as ReusableSupersetDraft,
      uuid,
      now
    );
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      'bare-rs',
      'Orphan',
      null,
      900,
      900
    );

    const hydrated = await listReusableSupersetsWithExercises(db);
    expect(hydrated).toHaveLength(2);
    const bare = hydrated.find((h) => h.superset.id === 'bare-rs');
    const full = hydrated.find((h) => h.superset.id !== 'bare-rs');
    expect(bare!.exercises).toEqual([]);
    expect(full!.exercises.map((e) => e.id)).toEqual([BENCH, ROW]);
  });
});
