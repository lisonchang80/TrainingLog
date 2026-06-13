/**
 * Slice 15 C2 — icloudBackupAdapter coverage: write-then-promote ordering
 * (grill Q5-B hard spec), foreign-file safety, R1 sidecar hygiene, snapshot
 * temp cleanup, and the Settings latest-backup readout.
 *
 * All deps injected (BackupFs facade + native wrapper fns) — no
 * expo-file-system / native module touched.
 */

import type { ICloudBackupItem } from '../../modules/icloud-backup';
import {
  BackupUploadError,
  getLatestCloudBackup,
  uploadBackupSnapshot,
  type BackupFs,
} from '../../src/adapters/backup/icloudBackupAdapter';
import { makeBackupFileName } from '../../src/domain/backup/backupPolicy';

const CONTAINER = 'file:///icloud/Container/';
const DOCS = 'file:///icloud/Container/Documents';
const SNAPSHOT_PATH = '/sandbox/Documents/SQLite/backup-snapshot-100.sqlite';
const SNAPSHOT_URI = `file://${SNAPSHOT_PATH}`;

const T0 = Date.UTC(2026, 5, 13, 1, 30, 5);
const NEW_NAME = makeBackupFileName(T0);

function makeItem(name: string, extra: Partial<ICloudBackupItem> = {}): ICloudBackupItem {
  return {
    name,
    url: `${DOCS}/${name}`,
    sizeBytes: 1000,
    modifiedAtMs: null,
    isUploaded: true,
    isUploading: null,
    percentUploaded: null,
    downloadingStatus: 'current',
    ...extra,
  };
}

/** In-memory BackupFs that records the call sequence. */
function makeMockFs(initialFiles: Record<string, number>) {
  const files = new Map<string, number>(Object.entries(initialFiles));
  const calls: string[] = [];
  const fs: BackupFs = {
    fileExists: (uri) => files.has(uri),
    fileSize: (uri) => files.get(uri) ?? null,
    copyFile: (src, dest) => {
      calls.push(`copy:${src}->${dest}`);
      if (!files.has(src)) throw new Error(`copy source missing: ${src}`);
      files.set(dest, files.get(src)!);
    },
    deleteFile: (uri) => {
      calls.push(`delete:${uri}`);
      if (!files.has(uri)) throw new Error(`delete target missing: ${uri}`);
      files.delete(uri);
    },
    ensureDir: (uri) => {
      calls.push(`ensureDir:${uri}`);
    },
    listFileNames: (dirUri) => {
      const prefix = `${dirUri}/`;
      return [...files.keys()]
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => uri.slice(prefix.length));
    },
  };
  return { fs, files, calls };
}

function baseDeps(overrides: {
  fs: BackupFs;
  items?: ICloudBackupItem[];
  containerUrl?: string | null;
}) {
  return {
    fs: overrides.fs,
    getUbiquityContainerUrl: jest
      .fn()
      .mockResolvedValue(overrides.containerUrl === undefined ? CONTAINER : overrides.containerUrl),
    listBackupItems: jest.fn().mockResolvedValue(overrides.items ?? []),
  };
}

describe('uploadBackupSnapshot — write-then-promote', () => {
  it('happy path: copies under a fresh timestamped name, rotates oldest, cleans temp', async () => {
    const oldA = makeBackupFileName(T0 - 2000); // oldest → rotated out
    const oldB = makeBackupFileName(T0 - 1000); // second-newest → kept
    const { fs, files, calls } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${DOCS}/${oldA}`]: 900,
      [`${DOCS}/${oldB}`]: 950,
    });
    const deps = baseDeps({ fs, items: [makeItem(oldA), makeItem(oldB)] });

    const result = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    );

    expect(result.fileName).toBe(NEW_NAME);
    expect(result.sizeBytes).toBe(1000);
    expect(result.deletedNames).toEqual([oldA]);
    expect(result.failedDeletes).toEqual([]);
    expect(files.has(`${DOCS}/${NEW_NAME}`)).toBe(true);
    expect(files.has(`${DOCS}/${oldB}`)).toBe(true);
    expect(files.has(`${DOCS}/${oldA}`)).toBe(false);
    expect(files.has(SNAPSHOT_URI)).toBe(false); // temp cleaned

    // HARD ordering: the new file must be fully written before ANY delete
    const copyIdx = calls.findIndex((c) => c.startsWith('copy:'));
    const firstDeleteIdx = calls.findIndex((c) => c.startsWith('delete:'));
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(copyIdx);
  });

  it('iCloud unavailable → classified error, zero fs activity', async () => {
    const { fs, calls } = makeMockFs({ [SNAPSHOT_URI]: 1000 });
    const deps = baseDeps({ fs, containerUrl: null });

    await expect(
      uploadBackupSnapshot({ snapshotPath: SNAPSHOT_PATH, nowMs: T0 }, deps)
    ).rejects.toMatchObject({ name: 'BackupUploadError', kind: 'icloud-unavailable' });
    expect(calls.filter((c) => !c.startsWith('ensureDir'))).toEqual([]);
  });

  it('copy failure → copy-failed and NO old backup is deleted (promote never ran)', async () => {
    const oldA = makeBackupFileName(T0 - 2000);
    const oldB = makeBackupFileName(T0 - 1000);
    const { fs, files } = makeMockFs({
      // snapshot missing → copy throws
      [`${DOCS}/${oldA}`]: 900,
      [`${DOCS}/${oldB}`]: 950,
    });
    const deps = baseDeps({ fs, items: [makeItem(oldA), makeItem(oldB)] });

    await expect(
      uploadBackupSnapshot({ snapshotPath: SNAPSHOT_PATH, nowMs: T0 }, deps)
    ).rejects.toMatchObject({ kind: 'copy-failed' });
    expect(files.has(`${DOCS}/${oldA}`)).toBe(true);
    expect(files.has(`${DOCS}/${oldB}`)).toBe(true);
  });

  it('size-mismatch verify failure → partial deleted, old backups intact', async () => {
    const oldA = makeBackupFileName(T0 - 1000);
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${DOCS}/${oldA}`]: 900,
    });
    // copy "succeeds" but lands a truncated file
    fs.copyFile = (src, dest) => {
      files.set(dest, 1); // wrong size
    };
    const deps = baseDeps({ fs, items: [makeItem(oldA)] });

    const err = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    ).then(
      () => null,
      (e: unknown) => e as BackupUploadError
    );
    expect(err).toBeInstanceOf(BackupUploadError);
    expect(err!.kind).toBe('verify-failed');
    expect(files.has(`${DOCS}/${NEW_NAME}`)).toBe(false); // partial removed
    expect(files.has(`${DOCS}/${oldA}`)).toBe(true);
  });

  it('rotation delete failure is NON-fatal: success result, name reported in failedDeletes', async () => {
    const oldA = makeBackupFileName(T0 - 2000);
    const oldB = makeBackupFileName(T0 - 1000);
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${DOCS}/${oldA}`]: 900,
      [`${DOCS}/${oldB}`]: 950,
    });
    const innerDelete = fs.deleteFile.bind(fs);
    fs.deleteFile = (uri) => {
      if (uri === `${DOCS}/${oldA}`) throw new Error('cloud delete refused');
      innerDelete(uri);
    };
    const deps = baseDeps({ fs, items: [makeItem(oldA), makeItem(oldB)] });

    const result = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    );
    expect(result.deletedNames).toEqual([]);
    expect(result.failedDeletes).toEqual([oldA]);
    expect(files.has(`${DOCS}/${NEW_NAME}`)).toBe(true);
  });

  it('cloud-only (not-downloaded) backup with no local placeholder is NOT reported deleted (R-02)', async () => {
    // oldA is listed by the metadata query but has no local copy at all
    // (downloadingStatus=not-downloaded → only a cloud item exists, no
    // `.icloud` placeholder materialized). fileExists is false for both the
    // logical name and the placeholder → JS cannot evict it.
    const oldA = makeBackupFileName(T0 - 2000); // oldest → planned for deletion
    const oldB = makeBackupFileName(T0 - 1000); // kept
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${DOCS}/${oldB}`]: 950,
      // NB: oldA's file is absent locally (cloud-only); no `.icloud` either
    });
    const deps = baseDeps({ fs, items: [makeItem(oldA), makeItem(oldB)] });

    const result = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    );

    // The placeholder skip must NOT masquerade as a successful delete.
    expect(result.deletedNames).toEqual([]);
    expect(result.failedDeletes).toEqual([oldA]);
    expect(files.has(`${DOCS}/${NEW_NAME}`)).toBe(true);
  });

  it('cloud-only backup with a local .icloud placeholder is evicted via the placeholder (R-02)', async () => {
    const oldA = makeBackupFileName(T0 - 2000);
    const oldB = makeBackupFileName(T0 - 1000);
    const placeholder = `${DOCS}/.${oldA}.icloud`;
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [placeholder]: 1, // cloud-only placeholder present locally
      [`${DOCS}/${oldB}`]: 950,
    });
    const deps = baseDeps({ fs, items: [makeItem(oldA), makeItem(oldB)] });

    const result = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    );

    expect(result.deletedNames).toEqual([oldA]);
    expect(result.failedDeletes).toEqual([]);
    expect(files.has(placeholder)).toBe(false); // placeholder evicted
  });

  it('foreign files in the user-visible folder are never deleted; listing failure skips rotation', async () => {
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${DOCS}/holiday-photos.zip`]: 5000,
      [`${DOCS}/backup.sqlite`]: 700, // pre-grill fixed name = foreign now
    });
    const deps = baseDeps({ fs });
    deps.listBackupItems = jest.fn().mockRejectedValue(new Error('metadata query timeout'));

    const result = await uploadBackupSnapshot(
      { snapshotPath: SNAPSHOT_PATH, nowMs: T0 },
      deps
    );
    expect(result.deletedNames).toEqual([]);
    expect(files.has(`${DOCS}/holiday-photos.zip`)).toBe(true);
    expect(files.has(`${DOCS}/backup.sqlite`)).toBe(true);
    expect(files.has(`${DOCS}/${NEW_NAME}`)).toBe(true);
  });

  it('R1 hygiene: snapshot sidecars and stale backup-snapshot-* leftovers are swept', async () => {
    const staleUri = 'file:///sandbox/Documents/SQLite/backup-snapshot-50.sqlite';
    const { fs, files } = makeMockFs({
      [SNAPSHOT_URI]: 1000,
      [`${SNAPSHOT_URI}-journal`]: 10,
      [staleUri]: 800, // crashed earlier run (R5 window)
      ['file:///sandbox/Documents/SQLite/traininglog.db']: 9999, // live db — untouchable
    });
    const deps = baseDeps({ fs });

    await uploadBackupSnapshot({ snapshotPath: SNAPSHOT_PATH, nowMs: T0 }, deps);

    expect(files.has(`${SNAPSHOT_URI}-journal`)).toBe(false);
    expect(files.has(staleUri)).toBe(false);
    expect(files.has('file:///sandbox/Documents/SQLite/traininglog.db')).toBe(true);
  });
});

describe('getLatestCloudBackup', () => {
  it('returns the newest parseable backup, ignoring foreign files', async () => {
    const newest = makeBackupFileName(T0);
    const items = [
      makeItem(makeBackupFileName(T0 - 1000)),
      makeItem(newest, { isUploaded: false, isUploading: true }),
      makeItem('random.txt'),
    ];
    const result = await getLatestCloudBackup({
      listBackupItems: jest.fn().mockResolvedValue(items),
    });
    expect(result?.name).toBe(newest);
    expect(result?.isUploading).toBe(true);
  });

  it('null when empty or the listing throws', async () => {
    expect(
      await getLatestCloudBackup({ listBackupItems: jest.fn().mockResolvedValue([]) })
    ).toBeNull();
    expect(
      await getLatestCloudBackup({
        listBackupItems: jest.fn().mockRejectedValue(new Error('boom')),
      })
    ).toBeNull();
  });
});
