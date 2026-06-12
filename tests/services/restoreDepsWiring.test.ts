/**
 * Slice 15 morning integration — restoreDepsWiring (2026-06-13).
 *
 * Covers the contract-bridging layer between agent A's icloud-backup JS
 * wrapper (nullable cloud metadata, request-only startDownload) and agent
 * B's restore engine contract (concrete BackupItem, materialize-and-return-
 * path startDownload). Production wiring itself (expo APIs) is exercised by
 * device smoke; here we pin the pure mapping + the poll loop's semantics.
 */

import {
  containerDocumentUri,
  materializeBackup,
  toRestoreBackupItems,
} from '../../src/services/restoreDepsWiring';
import type { ICloudBackupItem } from '../../modules/icloud-backup';

function item(overrides: Partial<ICloudBackupItem> = {}): ICloudBackupItem {
  return {
    name: 'TrainingLog-backup-2026-06-13T0100Z.sqlite',
    url: null,
    sizeBytes: 4096,
    modifiedAtMs: 1_780_000_000_000,
    isUploaded: true,
    isUploading: null,
    percentUploaded: null,
    downloadingStatus: 'current',
    ...overrides,
  };
}

describe('toRestoreBackupItems', () => {
  it('maps concrete metadata through 1:1', () => {
    const [mapped] = toRestoreBackupItems([item()]);
    expect(mapped).toEqual({
      name: 'TrainingLog-backup-2026-06-13T0100Z.sqlite',
      sizeBytes: 4096,
      modifiedAt: 1_780_000_000_000,
      isUploaded: true,
      isDownloaded: true,
    });
  });

  it('degrades nullable metadata to conservative defaults', () => {
    const [mapped] = toRestoreBackupItems([
      item({ sizeBytes: null, modifiedAtMs: null, isUploaded: null, downloadingStatus: null }),
    ]);
    expect(mapped.sizeBytes).toBe(0);
    expect(mapped.modifiedAt).toBe(0);
    expect(mapped.isUploaded).toBe(false);
    expect(mapped.isDownloaded).toBe(false);
  });

  it('treats only current/downloaded as a local copy', () => {
    const statuses = ['current', 'downloaded', 'not-downloaded', 'weird-future-value', null];
    const mapped = toRestoreBackupItems(statuses.map((s) => item({ downloadingStatus: s })));
    expect(mapped.map((m) => m.isDownloaded)).toEqual([true, true, false, false, false]);
  });
});

describe('containerDocumentUri', () => {
  it('joins root and name under Documents/, tolerating a trailing slash', () => {
    expect(containerDocumentUri('file:///container', 'a.sqlite')).toBe(
      'file:///container/Documents/a.sqlite'
    );
    expect(containerDocumentUri('file:///container/', 'a.sqlite')).toBe(
      'file:///container/Documents/a.sqlite'
    );
  });
});

describe('materializeBackup', () => {
  const NAME = 'TrainingLog-backup-2026-06-13T0100Z.sqlite';

  function ops(overrides: Partial<Parameters<typeof materializeBackup>[1]> = {}) {
    let clock = 0;
    return {
      startDownload: jest.fn(async () => true),
      listBackupItems: jest.fn(async () => [item({ name: NAME })]),
      getUbiquityContainerUrl: jest.fn(async () => 'file:///container'),
      sleep: jest.fn(async () => {
        clock += 500;
      }),
      now: () => clock,
      ...overrides,
    };
  }

  it('requests the download with the Documents/-relative path', async () => {
    const o = ops();
    await materializeBackup(NAME, o);
    expect(o.startDownload).toHaveBeenCalledWith(`Documents/${NAME}`);
  });

  it('prefers the item url, falling back to the container-derived uri', async () => {
    const withUrl = ops({
      listBackupItems: jest.fn(async () => [
        item({ name: NAME, url: `file:///container/Documents/${NAME}` }),
      ]),
    });
    await expect(materializeBackup(NAME, withUrl)).resolves.toBe(
      `file:///container/Documents/${NAME}`
    );

    const noUrl = ops();
    await expect(materializeBackup(NAME, noUrl)).resolves.toBe(
      `file:///container/Documents/${NAME}`
    );
  });

  it('polls until the item reports a local copy', async () => {
    let calls = 0;
    const o = ops({
      listBackupItems: jest.fn(async () => {
        calls += 1;
        return [item({ name: NAME, downloadingStatus: calls < 3 ? 'not-downloaded' : 'current' })];
      }),
    });
    await materializeBackup(NAME, o);
    expect(calls).toBe(3);
    expect(o.sleep).toHaveBeenCalledTimes(2);
  });

  it('rejects when the request itself is refused (iCloud off)', async () => {
    const o = ops({ startDownload: jest.fn(async () => false) });
    await expect(materializeBackup(NAME, o)).rejects.toThrow(/startDownload rejected/);
  });

  it('rejects once the internal cap elapses without a local copy', async () => {
    const o = ops({
      listBackupItems: jest.fn(async () => [
        item({ name: NAME, downloadingStatus: 'not-downloaded' }),
      ]),
    });
    await expect(materializeBackup(NAME, o, 1500)).rejects.toThrow(/did not materialize/);
    expect(o.sleep).toHaveBeenCalledTimes(3);
  });
});
