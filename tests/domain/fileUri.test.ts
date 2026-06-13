/**
 * Slice 15 audit Y-5 — shared `toFileUri` util (consolidated the two
 * divergent copies from icloudBackupAdapter.ts and restoreDepsWiring.ts onto
 * the encodeURI version).
 */

import { toFileUri } from '../../src/domain/backup/fileUri';

describe('toFileUri', () => {
  it('prefixes a bare POSIX path with file://', () => {
    expect(toFileUri('/sandbox/Documents/SQLite/traininglog.db')).toBe(
      'file:///sandbox/Documents/SQLite/traininglog.db'
    );
  });

  it('is idempotent for an already-formed file:// URI', () => {
    const uri = 'file:///icloud/Container/Documents/backup.sqlite';
    expect(toFileUri(uri)).toBe(uri);
  });

  it('percent-encodes spaces while keeping the path structure (iCloud container)', () => {
    // The ubiquity container path always contains a space (Mobile Documents).
    expect(toFileUri('/private/var/Mobile Documents/iCloud~com~x/Documents/b.sqlite')).toBe(
      'file:///private/var/Mobile%20Documents/iCloud~com~x/Documents/b.sqlite'
    );
  });
});
