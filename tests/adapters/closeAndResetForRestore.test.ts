/**
 * Slice 15 audit R-05 — `closeAndResetForRestore()` keep-vs-clear semantics.
 *
 * expo-sqlite's native `closeDatabase` sets isClosed=true + removes the
 * connection from its cache BEFORE the only throw (exsqlite3_close non-OK);
 * statement finalization there does NOT throw. So a thrown closeAsync means
 * the handle is already dead — keeping the cached singleton would hand the
 * NEXT openDatabase() a dead wrapper → migrate/init fails → permanent
 * "Database initialization failed" until the user force-quits.
 *
 * The fix probes liveness after a throw: a successful trivial read keeps the
 * cache (genuinely alive); a failing read clears it so the next call does a
 * fresh open. This test pins all three branches.
 *
 * Each test re-requires the module via jest.isolateModules so the module-level
 * `cached` singleton is fresh — there is no other way to reset it from JS.
 * expo-sqlite + migrate are mocked at the module boundary (both touch native
 * code unimportable under testEnvironment: node).
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
    // The liveness probe (`SELECT 1`) goes through the wrapper → inner.
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

describe('closeAndResetForRestore — R-05 keep-vs-clear', () => {
  beforeEach(() => {
    openDatabaseAsync.mockReset();
  });

  it('no-op when never opened (fresh-install gate path)', async () => {
    const { closeAndResetForRestore } = loadFresh();
    await expect(closeAndResetForRestore()).resolves.toBeUndefined();
    expect(openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('clean close clears the cache → next openDatabase re-opens', async () => {
    const { openDatabase, closeAndResetForRestore } = loadFresh();
    const inner1 = makeInner();
    openDatabaseAsync.mockResolvedValueOnce(inner1);
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);

    await closeAndResetForRestore();
    expect(inner1.closeAsync).toHaveBeenCalledTimes(1);

    // Cache cleared → a second open hits the native open again.
    openDatabaseAsync.mockResolvedValueOnce(makeInner());
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it('close throws + dead handle (probe fails) → cache CLEARED, error propagates', async () => {
    const { openDatabase, closeAndResetForRestore } = loadFresh();
    const inner = makeInner();
    inner.closeAsync.mockRejectedValue(new Error('exsqlite3_close: SQLITE_BUSY'));
    // After the (failed) close the native handle is already closed → any read
    // throws, so the probe confirms it is dead.
    inner.getFirstAsync.mockRejectedValue(new Error('database is closed'));
    openDatabaseAsync.mockResolvedValueOnce(inner);
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);

    await expect(closeAndResetForRestore()).rejects.toThrow(/SQLITE_BUSY/);

    // Cache cleared despite the throw → next open does a FRESH open (no
    // stranded "Database initialization failed").
    openDatabaseAsync.mockResolvedValueOnce(makeInner());
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it('close throws but connection still alive (probe succeeds) → cache KEPT, error propagates', async () => {
    const { openDatabase, closeAndResetForRestore } = loadFresh();
    const inner = makeInner();
    inner.closeAsync.mockRejectedValue(new Error('transient close error'));
    // The probe succeeds → connection genuinely usable → keep the cache.
    inner.getFirstAsync.mockResolvedValue({ 1: 1 });
    openDatabaseAsync.mockResolvedValueOnce(inner);
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);

    await expect(closeAndResetForRestore()).rejects.toThrow(/transient close error/);

    // Cache KEPT → next open returns the cached singleton WITHOUT re-opening.
    await openDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
  });
});
