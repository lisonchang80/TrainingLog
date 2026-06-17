/**
 * Slice 15 — `closeAndResetForRestore()` MISSING-`inner` structural-cast path
 * (recent-main bug-hunt report 02, 2026-06-17, finding #3).
 *
 * `closeAndResetForRestore` reaches the live connection via a structural cast
 * (expoDatabase.ts:283-287):
 *
 *     const inner = (db as unknown as { inner?: SQLiteDatabase }).inner;
 *     if (!inner) { cached = null; return; }   // ← silent SUCCESS
 *
 * Report 02 finding #3: if `inner` is ever absent/renamed, this returns
 * SUCCESSFULLY without closing the connection. `executeRestore` then treats
 * its 'close-live' step as done and proceeds to hard-delete the live DB file
 * while a stale handle (+ `-wal`) may still be open — the R1 corruption class
 * the engine works hard to avoid. The DESIRED behavior is to treat a missing
 * `inner` as a HARD failure (throw) so the engine aborts BEFORE any deletion.
 *
 * The sibling `closeAndResetForRestore.test.ts` already pins the R-05
 * keep-vs-clear matrix on the present-`inner` path. This file:
 *   1. PINS that the production wrapper ALWAYS exposes `inner` — i.e. the
 *      buggy branch is unreachable today (latent only), so finding #3 is not
 *      a live data-loss risk.
 *   2. Documents the desired throw-on-missing-`inner` behavior as an
 *      it.skip(RECENT-MAIN-BUG) fix candidate.
 *
 * expo-sqlite + migrate are mocked at the module boundary (both touch native
 * code unimportable under testEnvironment: node), mirroring the sibling test.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  defaultDatabaseDirectory: '/sandbox/Documents/SQLite',
}));
jest.mock('../../src/db/migrate', () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
  migrationsMaxVersion: jest.fn().mockReturnValue(26),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openDatabaseAsync } = require('expo-sqlite') as { openDatabaseAsync: jest.Mock };

interface MockInner {
  execAsync: jest.Mock;
  runAsync: jest.Mock;
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
  closeAsync: jest.Mock;
}

function makeInner(): MockInner {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue({ 1: 1 }),
    withTransactionAsync: jest.fn(),
    closeAsync: jest.fn().mockResolvedValue(undefined),
  };
}

/** Load a FRESH copy of expoDatabase (module-level `cached` starts null). */
function loadFresh(): typeof import('../../src/adapters/sqlite/expoDatabase') {
  let mod!: typeof import('../../src/adapters/sqlite/expoDatabase');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../src/adapters/sqlite/expoDatabase');
  });
  return mod;
}

describe('closeAndResetForRestore — structural `inner` cast (finding #3)', () => {
  beforeEach(() => {
    openDatabaseAsync.mockReset();
  });

  it('production wrapper ALWAYS exposes `inner` → the buggy branch is unreachable today', async () => {
    // openDatabase() wraps the native handle in `new ExpoDatabase(inner)`,
    // which sets `private readonly inner` in its constructor. So the resolved
    // Database the cache holds always has a truthy `inner`, and the
    // missing-inner silent-success branch can never fire in production. This
    // pins the assumption that keeps finding #3 latent (not a live risk).
    const { openDatabase } = loadFresh();
    const innerHandle = makeInner();
    openDatabaseAsync.mockResolvedValueOnce(innerHandle);
    const db = await openDatabase();
    const reached = (db as unknown as { inner?: unknown }).inner;
    expect(reached).toBe(innerHandle);
    expect(reached).toBeTruthy();
  });

  it('when `inner` is present, a clean close actually closes it (the close DOES happen)', async () => {
    // Contrast with the latent path below: with `inner` present, the function
    // genuinely closes the connection. This makes the "silent success WITHOUT
    // closing" of the missing-inner branch precise by comparison.
    const { openDatabase, closeAndResetForRestore } = loadFresh();
    const innerHandle = makeInner();
    openDatabaseAsync.mockResolvedValueOnce(innerHandle);
    await openDatabase();
    await closeAndResetForRestore();
    expect(innerHandle.closeAsync).toHaveBeenCalledTimes(1);
  });

  // RECENT-MAIN-BUG (report 02, finding #3) — NOW FIXED: a MISSING `inner` is
  // a HARD failure — closeAndResetForRestore THROWS so executeRestore aborts
  // at 'close-live' BEFORE deleting the live DB file, rather than reporting
  // close-live done while a possibly still-open handle (+ `-wal`) lingers.
  //
  // The seam is the same-file pure helper `extractInnerForRestore(db)`:
  // closeAndResetForRestore extracts `inner` through it, and it throws on a
  // missing field. The helper is the only JS way to inject an inner-less
  // Database (openDatabase() always constructs an ExpoDatabase WITH `inner`),
  // so we exercise the contract directly against it.
  it('SHOULD throw on a missing `inner` (not silently succeed) (RECENT-MAIN-BUG #3)', () => {
    const { extractInnerForRestore } = loadFresh();
    // An inner-less wrapper (the latent future-refactor case) must reject.
    expect(() => extractInnerForRestore({} as never)).toThrow(/no `inner`/);
    // Spelled-out: structurally a Database with no `inner` property at all.
    const innerless = {
      execAsync: jest.fn(),
      runAsync: jest.fn(),
      getAllAsync: jest.fn(),
      getFirstAsync: jest.fn(),
      withTransactionAsync: jest.fn(),
    };
    expect(() => extractInnerForRestore(innerless as never)).toThrow();
  });

  it('extractInnerForRestore returns the live handle when `inner` IS present', () => {
    // The complement of the throw path: a present `inner` is returned as-is so
    // closeAndResetForRestore can close it. Pinned via the production wrapper.
    const { openDatabase, extractInnerForRestore } = loadFresh();
    const innerHandle = makeInner();
    openDatabaseAsync.mockResolvedValueOnce(innerHandle);
    return openDatabase().then((db) => {
      expect(extractInnerForRestore(db)).toBe(innerHandle);
    });
  });
});
