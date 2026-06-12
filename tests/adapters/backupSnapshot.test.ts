/**
 * Slice 15 C2 — `createBackupSnapshot()` flow coverage (grill Q2-A:
 * backupDatabaseAsync → sandbox temp → quick_check gate).
 *
 * expo-sqlite is mocked at the module boundary (its real JS calls
 * `requireNativeModule('ExpoSQLite')` at import time, which would crash
 * under testEnvironment: node).
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  backupDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));

import {
  backupDatabaseAsync,
  deleteDatabaseAsync,
  openDatabaseAsync,
} from 'expo-sqlite';
import {
  BackupSnapshotError,
  createBackupSnapshot,
} from '../../src/adapters/sqlite/expoDatabase';

const openMock = openDatabaseAsync as jest.Mock;
const backupMock = backupDatabaseAsync as jest.Mock;
const deleteMock = deleteDatabaseAsync as jest.Mock;

interface MockDb {
  databasePath: string;
  getAllAsync: jest.Mock;
  closeAsync: jest.Mock;
}

function makeMockDb(name: string): MockDb {
  return {
    databasePath: `/sandbox/Documents/SQLite/${name}`,
    getAllAsync: jest.fn().mockResolvedValue([{ quick_check: 'ok' }]),
    closeAsync: jest.fn().mockResolvedValue(undefined),
  };
}

const NOW = 1765590605000;
const SNAPSHOT_NAME = `backup-snapshot-${NOW}.sqlite`;

let srcDb: MockDb;
let destDb: MockDb;

beforeEach(() => {
  jest.clearAllMocks();
  srcDb = makeMockDb('traininglog.db');
  destDb = makeMockDb(SNAPSHOT_NAME);
  openMock.mockImplementation(async (name: string) =>
    name === 'traininglog.db' ? srcDb : destDb
  );
  backupMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

describe('createBackupSnapshot — happy path', () => {
  it('opens a DEDICATED source connection, backs up, verifies, closes both', async () => {
    const result = await createBackupSnapshot(NOW);

    expect(result).toEqual({
      path: `/sandbox/Documents/SQLite/${SNAPSHOT_NAME}`,
      name: SNAPSHOT_NAME,
    });
    expect(openMock).toHaveBeenCalledWith('traininglog.db');
    expect(openMock).toHaveBeenCalledWith(SNAPSHOT_NAME);
    expect(backupMock).toHaveBeenCalledWith({
      sourceDatabase: srcDb,
      destDatabase: destDb,
    });
    expect(destDb.getAllAsync).toHaveBeenCalledWith('PRAGMA quick_check');
    expect(srcDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(destDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('runs quick_check BEFORE closing the dest connection', async () => {
    const order: string[] = [];
    destDb.getAllAsync.mockImplementation(async () => {
      order.push('quick_check');
      return [{ quick_check: 'ok' }];
    });
    destDb.closeAsync.mockImplementation(async () => {
      order.push('close');
    });
    await createBackupSnapshot(NOW);
    expect(order).toEqual(['quick_check', 'close']);
  });
});

describe('createBackupSnapshot — failure classification + cleanup', () => {
  it('backupDatabaseAsync rejection → snapshot-failed, temp deleted, both closed', async () => {
    backupMock.mockRejectedValue(new Error('SQLITE_BUSY'));

    await expect(createBackupSnapshot(NOW)).rejects.toMatchObject({
      name: 'BackupSnapshotError',
      kind: 'snapshot-failed',
    });
    expect(deleteMock).toHaveBeenCalledWith(SNAPSHOT_NAME);
    expect(srcDb.closeAsync).toHaveBeenCalled();
    expect(destDb.closeAsync).toHaveBeenCalled();
  });

  it('source open rejection → snapshot-failed (no dest to clean is tolerated)', async () => {
    openMock.mockRejectedValue(new Error('cannot open'));

    await expect(createBackupSnapshot(NOW)).rejects.toMatchObject({
      kind: 'snapshot-failed',
    });
    // delete is still attempted (idempotent best-effort) and must not throw
    expect(deleteMock).toHaveBeenCalledWith(SNAPSHOT_NAME);
  });

  it('quick_check reporting corruption → integrity-check-failed with verdict, temp deleted', async () => {
    destDb.getAllAsync.mockResolvedValue([
      { quick_check: 'row 12 missing from index sqlite_autoindex_session_1' },
      { quick_check: 'wrong # of entries in index idx_set_session' },
    ]);

    const err = await createBackupSnapshot(NOW).then(
      () => null,
      (e: unknown) => e as BackupSnapshotError
    );
    expect(err).toBeInstanceOf(BackupSnapshotError);
    expect(err!.kind).toBe('integrity-check-failed');
    expect(err!.message).toContain('row 12 missing');
    expect(deleteMock).toHaveBeenCalledWith(SNAPSHOT_NAME);
  });

  it('quick_check throwing → integrity-check-failed', async () => {
    destDb.getAllAsync.mockRejectedValue(new Error('disk I/O error'));

    await expect(createBackupSnapshot(NOW)).rejects.toMatchObject({
      kind: 'integrity-check-failed',
    });
    expect(deleteMock).toHaveBeenCalledWith(SNAPSHOT_NAME);
  });

  it('cleanup failures never mask the original error', async () => {
    backupMock.mockRejectedValue(new Error('SQLITE_BUSY'));
    destDb.closeAsync.mockRejectedValue(new Error('close failed'));
    srcDb.closeAsync.mockRejectedValue(new Error('close failed'));
    deleteMock.mockRejectedValue(new Error('delete failed'));

    await expect(createBackupSnapshot(NOW)).rejects.toMatchObject({
      kind: 'snapshot-failed',
    });
  });
});
