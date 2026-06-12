// expoDatabase imports expo-sqlite at module scope (ESM, crashes under
// testEnvironment: node) — mock the boundary like backupSnapshot.test.ts.
jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/sandbox/Documents/SQLite',
}));

import { classifyBackupError } from '../../src/domain/backup/backupErrors';
import { BackupUploadError } from '../../src/adapters/backup/icloudBackupAdapter';
import { BackupSnapshotError } from '../../src/adapters/sqlite/expoDatabase';

/**
 * Slice 15 C5 — backup failure classification (ADR-0011 Q14.7 families:
 * 未登入 / 容量 / 網路 / 未知).
 *
 * The classifier is pure domain and detects adapter error classes
 * STRUCTURALLY (via the `kind` discriminant) — these tests deliberately
 * feed it the REAL adapter classes to lock the structural contract: if an
 * adapter ever renames its `kind` values, this suite breaks loudly.
 */

describe('classifyBackupError', () => {
  it("maps BackupUploadError 'icloud-unavailable' to the not-signed-in family", () => {
    const e = new BackupUploadError(
      'icloud-unavailable',
      'iCloud ubiquity container unavailable (not signed in / iCloud Drive off)'
    );
    expect(classifyBackupError(e)).toEqual({
      kind: 'icloud-unavailable',
      message: e.message,
    });
  });

  it('recognizes capacity exhaustion from Cocoa / POSIX message shapes', () => {
    const cocoaText =
      'copy into container failed: Error Domain=NSCocoaErrorDomain Code=640 ' +
      '"You can’t save the file “TrainingLog-backup-….sqlite” because the volume is out of space." ' +
      '(NSFileWriteOutOfSpaceError)';
    expect(classifyBackupError(new BackupUploadError('copy-failed', cocoaText)).kind).toBe(
      'capacity'
    );
    expect(classifyBackupError(new Error('No space left on device')).kind).toBe('capacity');
    expect(classifyBackupError(new Error('iCloud storage quota exceeded')).kind).toBe('capacity');
  });

  it('recognizes network failures from NSURLError-style message shapes', () => {
    expect(
      classifyBackupError(new Error('The Internet connection appears to be offline.')).kind
    ).toBe('network');
    expect(classifyBackupError(new Error('The request timed out.')).kind).toBe('network');
    expect(
      classifyBackupError(
        new BackupUploadError('copy-failed', 'NSURLErrorDomain Code=-1009 connection lost')
      ).kind
    ).toBe('network');
  });

  it('capacity outranks network when both fingerprints appear', () => {
    expect(
      classifyBackupError(new Error('network volume is out of space — cannot write')).kind
    ).toBe('capacity');
  });

  it('maps BackupSnapshotError (local snapshot / quick_check) to unknown', () => {
    expect(
      classifyBackupError(new BackupSnapshotError('snapshot-failed', 'sqlite3_backup failed: BUSY'))
        .kind
    ).toBe('unknown');
    expect(
      classifyBackupError(
        new BackupSnapshotError('integrity-check-failed', 'quick_check reported: rowid missing')
      ).kind
    ).toBe('unknown');
  });

  it('handles non-Error throwables without crashing (String() fallback)', () => {
    expect(classifyBackupError('plain string failure')).toEqual({
      kind: 'unknown',
      message: 'plain string failure',
    });
    expect(classifyBackupError(undefined).kind).toBe('unknown');
    expect(classifyBackupError(null).kind).toBe('unknown');
  });

  it("a verify-failed upload without a recognizable cause stays 'unknown'", () => {
    const e = new BackupUploadError(
      'verify-failed',
      'landed copy failed verification (exists=true, size=0, expected=4096)'
    );
    expect(classifyBackupError(e).kind).toBe('unknown');
  });
});
