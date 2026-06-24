/**
 * Slice 15 audit Y-5 — shared `toFileUri` util (consolidated the two
 * divergent copies from icloudBackupAdapter.ts and restoreDepsWiring.ts onto
 * the encodeURI version).
 */

import { fromFileUri, toFileUri } from '../../src/domain/backup/fileUri';

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

describe('fromFileUri', () => {
  it('strips the file:// scheme to a plain POSIX path (expo-sqlite directory contract)', () => {
    expect(fromFileUri('file:///sandbox/Documents/SQLite/traininglog.db')).toBe(
      '/sandbox/Documents/SQLite/traininglog.db'
    );
  });

  it('is idempotent for an already-plain path', () => {
    const path = '/sandbox/Documents/SQLite/traininglog.db';
    expect(fromFileUri(path)).toBe(path);
  });

  it('percent-decodes a space in the iCloud container path', () => {
    expect(
      fromFileUri('file:///private/var/Mobile%20Documents/iCloud~com~x/Documents/b.sqlite')
    ).toBe('/private/var/Mobile Documents/iCloud~com~x/Documents/b.sqlite');
  });

  it('round-trips with toFileUri (path -> uri -> path) for a space-bearing path', () => {
    const path = '/private/var/Mobile Documents/iCloud~com~x/Documents/b.sqlite';
    expect(fromFileUri(toFileUri(path))).toBe(path);
  });

  it('returns the stripped path unchanged when percent-encoding is malformed', () => {
    // A lone % is not a valid escape — decodeURI would throw; we keep the path.
    expect(fromFileUri('file:///sandbox/100%done/b.sqlite')).toBe('/sandbox/100%done/b.sqlite');
  });
});
