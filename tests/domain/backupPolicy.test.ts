import {
  BACKUP_DEBOUNCE_MS,
  BACKUP_KEEP_COUNT,
  COLD_START_STALE_MS,
  makeBackupFileName,
  parseBackupFileName,
  planBackupRotation,
  shouldEscalateBackupFailure,
  shouldRunBackup,
} from '../../src/domain/backup/backupPolicy';

/**
 * Slice 15 C2 — backupPolicy pure-logic coverage (ADR-0011 + 2026-06-12
 * grill amendment: Q4-B timestamped names / Q5-B write-then-promote /
 * Q6-B trigger set / Q14-B in-app escalation thresholds).
 */

const T0 = Date.UTC(2026, 5, 13, 1, 30, 5); // 2026-06-13T01:30:05Z

describe('makeBackupFileName / parseBackupFileName', () => {
  it('produces the Q4-B shape with a filesystem-safe ISO ts (no colons, no ms)', () => {
    expect(makeBackupFileName(T0)).toBe('TrainingLog-backup-2026-06-13T013005Z.sqlite');
  });

  it('round-trips through parse (second precision)', () => {
    const withMs = T0 + 123; // ms stripped by the name format
    expect(parseBackupFileName(makeBackupFileName(withMs))).toBe(T0);
  });

  it('rejects foreign / live-db / malformed names', () => {
    expect(parseBackupFileName('traininglog.db')).toBeNull();
    expect(parseBackupFileName('TrainingLog-backup-latest.sqlite')).toBeNull();
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T013005Z.sqlite.tmp')).toBeNull();
    expect(parseBackupFileName('backup.sqlite')).toBeNull(); // pre-grill fixed name = foreign now
    // impossible calendar combo must not silently roll over via Date.UTC
    expect(parseBackupFileName('TrainingLog-backup-2026-13-13T013005Z.sqlite')).toBeNull();
  });

  it('accepts the .icloud placeholder wrapping of a cloud-only item', () => {
    expect(
      parseBackupFileName('.TrainingLog-backup-2026-06-13T013005Z.sqlite.icloud')
    ).toBe(T0);
  });

  it('orders lexicographically == chronologically (rotation tie-break property)', () => {
    const earlier = makeBackupFileName(T0 - 1000);
    const later = makeBackupFileName(T0);
    expect(earlier < later).toBe(true);
  });
});

describe('shouldRunBackup', () => {
  const base = {
    mode: 'auto' as const,
    nowMs: T0,
    lastAttemptAtMs: null,
    lastSuccessAtMs: null,
  };

  it('manual trigger always runs — bypasses manual mode AND debounce', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'manual',
        mode: 'manual',
        lastAttemptAtMs: T0 - 1000, // well inside debounce
      })
    ).toEqual({ run: true });
  });

  it('automatic triggers are off in manual mode', () => {
    for (const trigger of ['session-finalize', 'background', 'cold-start'] as const) {
      expect(shouldRunBackup({ ...base, trigger, mode: 'manual' })).toEqual({
        run: false,
        reason: 'mode-manual',
      });
    }
  });

  it('debounces an automatic trigger within 5 minutes of the last ATTEMPT', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'background',
        lastAttemptAtMs: T0 - BACKUP_DEBOUNCE_MS + 1,
      })
    ).toEqual({ run: false, reason: 'debounced' });
  });

  it('runs once the debounce window has fully elapsed', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'session-finalize',
        lastAttemptAtMs: T0 - BACKUP_DEBOUNCE_MS,
      })
    ).toEqual({ run: true });
  });

  it('first-ever automatic trigger runs (no attempt history)', () => {
    expect(shouldRunBackup({ ...base, trigger: 'session-finalize' })).toEqual({ run: true });
  });

  it('cold-start sweep: skips when last success is fresh (≤ 24h)', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'cold-start',
        lastSuccessAtMs: T0 - COLD_START_STALE_MS,
      })
    ).toEqual({ run: false, reason: 'cold-start-fresh' });
  });

  it('cold-start sweep: runs when stale (> 24h) or never succeeded', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'cold-start',
        lastSuccessAtMs: T0 - COLD_START_STALE_MS - 1,
      })
    ).toEqual({ run: true });
    expect(shouldRunBackup({ ...base, trigger: 'cold-start' })).toEqual({ run: true });
  });

  it('cold-start sweep still respects the debounce', () => {
    expect(
      shouldRunBackup({
        ...base,
        trigger: 'cold-start',
        lastAttemptAtMs: T0 - 1000,
        lastSuccessAtMs: null,
      })
    ).toEqual({ run: false, reason: 'debounced' });
  });
});

describe('planBackupRotation', () => {
  const n = (ms: number) => makeBackupFileName(ms);

  it('keeps the newest 2 and deletes the rest, oldest first', () => {
    const items = [n(T0 - 3000), n(T0), n(T0 - 1000), n(T0 - 2000)].map((name) => ({ name }));
    const plan = planBackupRotation(items);
    expect(plan.keep).toEqual([n(T0), n(T0 - 1000)]);
    expect(plan.toDelete).toEqual([n(T0 - 3000), n(T0 - 2000)]);
  });

  it('never deletes foreign files (membership = parseable name)', () => {
    const items = [
      { name: 'traininglog.db' },
      { name: 'IMG_0001.HEIC' },
      { name: n(T0 - 2000) },
      { name: n(T0 - 1000) },
      { name: n(T0) },
    ];
    const plan = planBackupRotation(items);
    expect(plan.toDelete).toEqual([n(T0 - 2000)]);
    expect(plan.keep).toEqual([n(T0), n(T0 - 1000)]);
  });

  it('no deletions when at or under the keep count', () => {
    expect(planBackupRotation([{ name: n(T0) }]).toDelete).toEqual([]);
    expect(
      planBackupRotation([{ name: n(T0) }, { name: n(T0 - 1000) }]).toDelete
    ).toEqual([]);
    expect(BACKUP_KEEP_COUNT).toBe(2);
  });

  it('dedupes by name (caller may pass the just-written file on top of the listing)', () => {
    const items = [{ name: n(T0) }, { name: n(T0) }, { name: n(T0 - 1000) }];
    const plan = planBackupRotation(items);
    expect(plan.keep).toEqual([n(T0), n(T0 - 1000)]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe('shouldEscalateBackupFailure', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const base = {
    mode: 'auto' as const,
    nowMs: T0,
    lastSuccessAtMs: null as number | null,
    lastErrorAtMs: null as number | null,
    firstErrorAtMs: null as number | null,
  };

  it('no failure recorded → never escalates', () => {
    expect(shouldEscalateBackupFailure(base)).toBe(false);
    expect(
      shouldEscalateBackupFailure({ ...base, lastSuccessAtMs: T0 - 30 * DAY })
    ).toBe(false); // stale-but-clean is not an error state
  });

  it('a success newer than the last failure heals the streak', () => {
    expect(
      shouldEscalateBackupFailure({
        ...base,
        lastErrorAtMs: T0 - 10 * DAY,
        firstErrorAtMs: T0 - 10 * DAY,
        lastSuccessAtMs: T0 - 5 * DAY,
      })
    ).toBe(false);
  });

  it('auto mode escalates at 3 days since last success, not before', () => {
    const failing = {
      ...base,
      lastErrorAtMs: T0 - 1000,
      firstErrorAtMs: T0 - 4 * DAY,
    };
    expect(
      shouldEscalateBackupFailure({ ...failing, lastSuccessAtMs: T0 - 3 * DAY + 1 })
    ).toBe(false);
    expect(
      shouldEscalateBackupFailure({ ...failing, lastSuccessAtMs: T0 - 3 * DAY })
    ).toBe(true);
  });

  it('manual mode threshold is 7 days', () => {
    const failing = {
      ...base,
      mode: 'manual' as const,
      lastErrorAtMs: T0 - 1000,
      firstErrorAtMs: T0 - 8 * DAY,
    };
    expect(
      shouldEscalateBackupFailure({ ...failing, lastSuccessAtMs: T0 - 7 * DAY + 1 })
    ).toBe(false);
    expect(
      shouldEscalateBackupFailure({ ...failing, lastSuccessAtMs: T0 - 7 * DAY })
    ).toBe(true);
  });

  it('never-succeeded installs anchor the streak at the FIRST failure', () => {
    expect(
      shouldEscalateBackupFailure({
        ...base,
        lastErrorAtMs: T0 - 1000,
        firstErrorAtMs: T0 - 3 * DAY,
      })
    ).toBe(true);
    expect(
      shouldEscalateBackupFailure({
        ...base,
        lastErrorAtMs: T0 - 1000,
        firstErrorAtMs: T0 - 2 * DAY,
      })
    ).toBe(false);
  });

  it('fails safe (no banner) on inconsistent inputs — error without any anchor', () => {
    expect(
      shouldEscalateBackupFailure({ ...base, lastErrorAtMs: T0 - 10 * DAY })
    ).toBe(false);
  });
});
