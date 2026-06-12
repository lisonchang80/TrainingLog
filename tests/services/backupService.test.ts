/**
 * Slice 15 C3/C5 — backupService orchestration tests.
 *
 * Gate decisions themselves are locked in tests/domain/backupPolicy.test.ts;
 * THIS suite locks the service's sequencing contract against a REAL
 * in-memory app_settings table (BetterSqliteDatabase + migrate — the
 * default settingsRepository functions run for real, so metadata
 * read→gate→write is exercised end-to-end):
 *
 *   - success flow: snapshot → upload → recordBackupSuccess (heals streak)
 *   - gate skips: manual mode / debounce / cold-start freshness
 *   - manual trigger bypass
 *   - failure flows: classification persisted (kind), upload never called
 *     after snapshot failure, never throws even when the metadata write fails
 *   - single-flight latch: overlapping run → 'already-running'
 *   - getBackupHealth: escalation verdict + days + iCloud availability
 */

jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/sandbox/Documents/SQLite',
  openDatabaseAsync: jest.fn(),
  backupDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { BackupUploadError } from '../../src/adapters/backup/icloudBackupAdapter';
import { BackupSnapshotError } from '../../src/adapters/sqlite/expoDatabase';
import {
  getBackupMetadata,
  recordBackupFailure,
  recordBackupSuccess,
  setBackupMode,
} from '../../src/adapters/sqlite/settingsRepository';
import {
  __resetBackupInFlightForTests,
  getBackupHealth,
  runBackup,
  type BackupServiceDeps,
} from '../../src/services/backupService';

const NOW = 1_765_590_605_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let db: BetterSqliteDatabase;

beforeEach(async () => {
  __resetBackupInFlightForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
});

afterEach(() => {
  db.close();
  jest.restoreAllMocks();
});

function makeDeps(over: Partial<BackupServiceDeps> = {}): BackupServiceDeps {
  return {
    createBackupSnapshot: jest
      .fn()
      .mockResolvedValue({ path: '/sandbox/SQLite/backup-snapshot-1.sqlite', name: 'backup-snapshot-1.sqlite' }),
    uploadBackupSnapshot: jest.fn().mockResolvedValue({
      fileName: 'TrainingLog-backup-2026-06-13T013005Z.sqlite',
      sizeBytes: 4096,
      deletedNames: [],
      failedDeletes: [],
    }),
    now: () => NOW,
    ...over,
  };
}

describe('runBackup — success flow', () => {
  it('snapshot → upload → recordBackupSuccess against the real app_settings table', async () => {
    const deps = makeDeps();
    const outcome = await runBackup(db, 'session-finalize', deps);

    expect(outcome).toEqual({
      status: 'success',
      fileName: 'TrainingLog-backup-2026-06-13T013005Z.sqlite',
      sizeBytes: 4096,
    });
    expect(deps.createBackupSnapshot).toHaveBeenCalledWith(NOW);
    expect(deps.uploadBackupSnapshot).toHaveBeenCalledWith({
      snapshotPath: '/sandbox/SQLite/backup-snapshot-1.sqlite',
      nowMs: NOW,
    });

    const meta = await getBackupMetadata(db);
    expect(meta.lastSuccessAtMs).toBe(NOW);
    expect(meta.lastAttemptAtMs).toBe(NOW);
    expect(meta.lastSizeBytes).toBe(4096);
    expect(meta.lastError).toBeNull();
    expect(meta.firstErrorAtMs).toBeNull();
  });

  it('a success HEALS a prior failure streak (error keys cleared)', async () => {
    await recordBackupFailure(db, { atMs: NOW - DAY, message: 'boom', kind: 'network' });
    const outcome = await runBackup(db, 'manual', makeDeps());
    expect(outcome.status).toBe('success');

    const meta = await getBackupMetadata(db);
    expect(meta.lastError).toBeNull();
    expect(meta.firstErrorAtMs).toBeNull();
  });
});

describe('runBackup — gate skips (policy wired to real metadata)', () => {
  it('automatic trigger in manual mode skips without touching the snapshot', async () => {
    await setBackupMode(db, 'manual');
    const deps = makeDeps();
    const outcome = await runBackup(db, 'background', deps);
    expect(outcome).toEqual({ status: 'skipped', reason: 'mode-manual' });
    expect(deps.createBackupSnapshot).not.toHaveBeenCalled();
  });

  it('manual trigger bypasses manual mode', async () => {
    await setBackupMode(db, 'manual');
    const outcome = await runBackup(db, 'manual', makeDeps());
    expect(outcome.status).toBe('success');
  });

  it('debounces an automatic retrigger within 5 minutes of the recorded attempt', async () => {
    await recordBackupSuccess(db, { atMs: NOW - 2 * MIN, sizeBytes: 1024 });
    const deps = makeDeps();
    const outcome = await runBackup(db, 'background', deps);
    expect(outcome).toEqual({ status: 'skipped', reason: 'debounced' });
    expect(deps.createBackupSnapshot).not.toHaveBeenCalled();
  });

  it('cold-start sweep skips when the last success is fresh, runs when stale (Q6-B)', async () => {
    await recordBackupSuccess(db, { atMs: NOW - 2 * HOUR, sizeBytes: 1024 });
    expect(await runBackup(db, 'cold-start', makeDeps())).toEqual({
      status: 'skipped',
      reason: 'cold-start-fresh',
    });

    await recordBackupSuccess(db, { atMs: NOW - 25 * HOUR, sizeBytes: 1024 });
    expect((await runBackup(db, 'cold-start', makeDeps())).status).toBe('success');
  });
});

describe('runBackup — failure flows', () => {
  it('snapshot failure: classified + persisted, upload never called', async () => {
    const deps = makeDeps({
      createBackupSnapshot: jest
        .fn()
        .mockRejectedValue(new BackupSnapshotError('snapshot-failed', 'sqlite3_backup failed: BUSY')),
    });
    const outcome = await runBackup(db, 'session-finalize', deps);
    expect(outcome).toEqual({
      status: 'failed',
      kind: 'unknown',
      message: 'sqlite3_backup failed: BUSY',
    });
    expect(deps.uploadBackupSnapshot).not.toHaveBeenCalled();

    const meta = await getBackupMetadata(db);
    expect(meta.lastError).toEqual({
      message: 'sqlite3_backup failed: BUSY',
      atMs: NOW,
      kind: 'unknown',
    });
    expect(meta.firstErrorAtMs).toBe(NOW);
    expect(meta.lastAttemptAtMs).toBe(NOW); // failed attempt still anchors the debounce
    expect(meta.lastSuccessAtMs).toBeNull();
  });

  it("upload icloud-unavailable lands as the 'icloud-unavailable' family", async () => {
    const deps = makeDeps({
      uploadBackupSnapshot: jest
        .fn()
        .mockRejectedValue(new BackupUploadError('icloud-unavailable', 'no container')),
    });
    const outcome = await runBackup(db, 'manual', deps);
    expect(outcome).toEqual({
      status: 'failed',
      kind: 'icloud-unavailable',
      message: 'no container',
    });
    expect((await getBackupMetadata(db)).lastError?.kind).toBe('icloud-unavailable');
  });

  it('repeated failures keep the FIRST error anchor (escalation streak semantics)', async () => {
    const failing = (msg: string) =>
      makeDeps({
        uploadBackupSnapshot: jest.fn().mockRejectedValue(new Error(msg)),
        now: () => NOW,
      });
    await runBackup(db, 'manual', failing('first'));
    await runBackup(db, 'manual', { ...failing('second'), now: () => NOW + DAY });

    const meta = await getBackupMetadata(db);
    expect(meta.firstErrorAtMs).toBe(NOW);
    expect(meta.lastError?.message).toBe('second');
  });

  it('NEVER throws — even when the failure metadata write itself fails', async () => {
    const deps = makeDeps({
      uploadBackupSnapshot: jest.fn().mockRejectedValue(new Error('copy exploded')),
      recordBackupFailure: jest.fn().mockRejectedValue(new Error('disk gone')),
    });
    await expect(runBackup(db, 'manual', deps)).resolves.toEqual({
      status: 'failed',
      kind: 'unknown',
      message: 'copy exploded',
    });
  });

  it('metadata read failure resolves as failed (no gate, no snapshot)', async () => {
    const deps = makeDeps({
      getBackupMetadata: jest.fn().mockRejectedValue(new Error('db closed')),
    });
    const outcome = await runBackup(db, 'background', deps);
    expect(outcome).toEqual({ status: 'failed', kind: 'unknown', message: 'db closed' });
    expect(deps.createBackupSnapshot).not.toHaveBeenCalled();
  });
});

describe('runBackup — single-flight latch', () => {
  it('an overlapping call returns already-running and does not double-snapshot', async () => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const deps = makeDeps({
      uploadBackupSnapshot: jest.fn().mockImplementation(async () => {
        await uploadGate;
        return { fileName: 'f.sqlite', sizeBytes: 1, deletedNames: [], failedDeletes: [] };
      }),
    });

    const first = runBackup(db, 'session-finalize', deps);
    const second = await runBackup(db, 'background', deps);
    expect(second).toEqual({ status: 'already-running' });
    // let the first run's metadata-read microtasks advance to the snapshot
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.createBackupSnapshot).toHaveBeenCalledTimes(1);

    releaseUpload();
    expect((await first).status).toBe('success');

    // latch released → next run proceeds normally
    const third = await runBackup(db, 'manual', makeDeps());
    expect(third.status).toBe('success');
  });
});

describe('getBackupHealth', () => {
  it('escalates an unhealed 3-day streak in auto mode, with floored day count', async () => {
    await recordBackupSuccess(db, { atMs: NOW - 3 * DAY - HOUR, sizeBytes: 1 });
    await recordBackupFailure(db, { atMs: NOW - 2 * DAY, message: 'x', kind: 'network' });

    const health = await getBackupHealth(db, {
      isICloudAvailable: () => true,
      now: () => NOW,
    });
    expect(health.escalated).toBe(true);
    expect(health.escalatedDays).toBe(3);
    expect(health.iCloudAvailable).toBe(true);
    expect(health.metadata.lastError?.kind).toBe('network');
  });

  it('manual mode holds the banner until 7 days', async () => {
    await setBackupMode(db, 'manual');
    await recordBackupSuccess(db, { atMs: NOW - 4 * DAY, sizeBytes: 1 });
    await recordBackupFailure(db, { atMs: NOW - 3 * DAY, message: 'x' });

    const at4 = await getBackupHealth(db, { isICloudAvailable: () => true, now: () => NOW });
    expect(at4.escalated).toBe(false);
    expect(at4.escalatedDays).toBeNull();

    const at8 = await getBackupHealth(db, {
      isICloudAvailable: () => true,
      now: () => NOW + 4 * DAY,
    });
    expect(at8.escalated).toBe(true);
    expect(at8.escalatedDays).toBe(8);
  });

  it('a healed streak never escalates; iCloud availability degrades to false on throw', async () => {
    await recordBackupFailure(db, { atMs: NOW - 5 * DAY, message: 'x' });
    await recordBackupSuccess(db, { atMs: NOW - 4 * DAY, sizeBytes: 1 });

    const health = await getBackupHealth(db, {
      isICloudAvailable: () => {
        throw new Error('module missing');
      },
      now: () => NOW,
    });
    expect(health.escalated).toBe(false);
    expect(health.iCloudAvailable).toBe(false);
  });
});
