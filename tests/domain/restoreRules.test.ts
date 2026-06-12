import {
  evaluateCandidate,
  isBackupCandidateName,
  preRestoreFileName,
  selectStalePreRestoreFiles,
  sidecarPaths,
  sortCandidatesNewestFirst,
  type BackupItem,
} from '../../src/domain/backup/restoreRules';

/**
 * Slice 15 C4 — restore rules pure-logic coverage.
 *
 * Branch matrix for the version gate (grill Q10-A), the R1 sidecar list,
 * candidate ordering, and the Q11-A pre-restore self-backup naming. These
 * rules guard the single most destructive operation in the app (whole-DB
 * swap) — every branch is locked here so the service tests can focus on
 * orchestration order instead of decision logic.
 */

const item = (over: Partial<BackupItem> = {}): BackupItem => ({
  name: 'TrainingLog-backup-2026-06-12T0830.sqlite',
  sizeBytes: 1024,
  modifiedAt: 1_765_000_000_000,
  isUploaded: true,
  isDownloaded: true,
  ...over,
});

describe('evaluateCandidate — version + integrity gate (Q10-A)', () => {
  const base = {
    opened: true,
    quickCheckResult: 'ok',
    userVersion: 26,
    appMaxVersion: 26,
  };

  it('accepts user_version == app max', () => {
    expect(evaluateCandidate(base)).toEqual({ ok: true, userVersion: 26 });
  });

  it('accepts user_version below app max (old backup → migrate() upgrades on reopen)', () => {
    expect(evaluateCandidate({ ...base, userVersion: 7 })).toEqual({
      ok: true,
      userVersion: 7,
    });
  });

  it('REJECTS user_version above app max (backup from a newer app build)', () => {
    expect(evaluateCandidate({ ...base, userVersion: 27 })).toEqual({
      ok: false,
      reason: 'version-too-new',
    });
  });

  it('rejects user_version 0 (fresh/foreign SQLite file, not a TrainingLog backup)', () => {
    expect(evaluateCandidate({ ...base, userVersion: 0 })).toEqual({
      ok: false,
      reason: 'empty-or-invalid',
    });
  });

  it('rejects null / negative / non-integer user_version readings', () => {
    expect(evaluateCandidate({ ...base, userVersion: null })).toEqual({
      ok: false,
      reason: 'empty-or-invalid',
    });
    expect(evaluateCandidate({ ...base, userVersion: -3 })).toEqual({
      ok: false,
      reason: 'empty-or-invalid',
    });
    expect(evaluateCandidate({ ...base, userVersion: 12.5 })).toEqual({
      ok: false,
      reason: 'empty-or-invalid',
    });
  });

  it('rejects a file that failed to open as SQLite — before any other check', () => {
    expect(
      evaluateCandidate({ ...base, opened: false, quickCheckResult: null, userVersion: null })
    ).toEqual({ ok: false, reason: 'not-sqlite' });
  });

  it('rejects quick_check failures (corrupt DB), even with a plausible version', () => {
    expect(evaluateCandidate({ ...base, quickCheckResult: '*** in database main ***' })).toEqual({
      ok: false,
      reason: 'quick-check-failed',
    });
    expect(evaluateCandidate({ ...base, quickCheckResult: null })).toEqual({
      ok: false,
      reason: 'quick-check-failed',
    });
  });

  it("accepts quick_check 'OK' case-insensitively (SQLite emits lowercase, stay lenient)", () => {
    expect(evaluateCandidate({ ...base, quickCheckResult: 'OK' })).toEqual({
      ok: true,
      userVersion: 26,
    });
  });
});

describe('sidecarPaths — R1 hard-delete list', () => {
  it('returns -journal, -wal and -shm siblings of the main file', () => {
    expect(sidecarPaths('/data/SQLite/traininglog.db')).toEqual([
      '/data/SQLite/traininglog.db-journal',
      '/data/SQLite/traininglog.db-wal',
      '/data/SQLite/traininglog.db-shm',
    ]);
  });
});

describe('candidate filtering + ordering (newest first)', () => {
  it('keeps .sqlite files, drops placeholders / hidden / unrelated names', () => {
    expect(isBackupCandidateName('TrainingLog-backup-2026.sqlite')).toBe(true);
    expect(isBackupCandidateName('UPPER.SQLITE')).toBe(true);
    expect(isBackupCandidateName('.TrainingLog-backup-2026.sqlite.icloud')).toBe(false);
    expect(isBackupCandidateName('notes.txt')).toBe(false);
    expect(isBackupCandidateName('backup.sqlite.tmp')).toBe(false);
  });

  it('sorts newest modifiedAt first and never mutates the input', () => {
    const older = item({ name: 'a.sqlite', modifiedAt: 100 });
    const newest = item({ name: 'b.sqlite', modifiedAt: 300 });
    const middle = item({ name: 'c.sqlite', modifiedAt: 200 });
    const input = [older, newest, middle];
    const sorted = sortCandidatesNewestFirst(input);
    expect(sorted.map((i) => i.name)).toEqual(['b.sqlite', 'c.sqlite', 'a.sqlite']);
    expect(input.map((i) => i.name)).toEqual(['a.sqlite', 'b.sqlite', 'c.sqlite']);
  });

  it('tie-breaks equal timestamps by name descending (timestamped names → newest)', () => {
    const a = item({ name: 'TrainingLog-backup-2026-06-11.sqlite', modifiedAt: 500 });
    const b = item({ name: 'TrainingLog-backup-2026-06-12.sqlite', modifiedAt: 500 });
    expect(sortCandidatesNewestFirst([a, b]).map((i) => i.name)).toEqual([
      'TrainingLog-backup-2026-06-12.sqlite',
      'TrainingLog-backup-2026-06-11.sqlite',
    ]);
  });

  it('filters non-candidates out before sorting', () => {
    const good = item({ name: 'good.sqlite', modifiedAt: 1 });
    const bad = item({ name: 'junk.json', modifiedAt: 999 });
    expect(sortCandidatesNewestFirst([bad, good])).toEqual([good]);
  });
});

describe('pre-restore self-backup (Q11-A)', () => {
  it('names the copy pre-restore-<epoch-ms>.sqlite', () => {
    expect(preRestoreFileName(1_765_600_000_123)).toBe('pre-restore-1765600000123.sqlite');
  });

  it('selects exactly the previous pre-restore copies for deletion (keep-1 semantics)', () => {
    expect(
      selectStalePreRestoreFiles([
        'pre-restore-100.sqlite',
        'pre-restore-200.sqlite',
        'traininglog.db',
        'something-else.sqlite',
        'pre-restore-300.txt',
      ])
    ).toEqual(['pre-restore-100.sqlite', 'pre-restore-200.sqlite']);
  });

  it('returns empty when the directory has no pre-restore copies', () => {
    expect(selectStalePreRestoreFiles(['traininglog.db', 'misc.sqlite'])).toEqual([]);
  });
});
