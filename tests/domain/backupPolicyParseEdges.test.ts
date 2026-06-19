import {
  makeBackupFileName,
  parseBackupFileName,
  planBackupRotation,
} from '../../src/domain/backup/backupPolicy';

/**
 * Slice 15 C2 — backupPolicy parse/rotation EDGE coverage (recent-main
 * bug-hunt report 02, 2026-06-17, finding #4 「other recent-main gaps in
 * backup pure logic with thin coverage」).
 *
 * The shipped `backupPolicy.test.ts` pins the happy path + the month-13
 * rollover. The single most safety-critical property of `parseBackupFileName`
 * is its round-trip calendar guard: it is the MEMBERSHIP TEST for rotation
 * (`planBackupRotation` only ever deletes a file whose name parses), so a
 * mistakenly-accepted malformed name could let rotation delete a foreign
 * file, and a mistakenly-rejected real backup could orphan a backup forever.
 * This file exhausts the rollover matrix and the keepCount clamp branches.
 */

const T0 = Date.UTC(2026, 5, 13, 1, 30, 5); // 2026-06-13T01:30:05Z

describe('parseBackupFileName — calendar rollover rejection (round-trip guard)', () => {
  // Each of these is a structurally well-formed name (\d{2} fields) that
  // Date.UTC would SILENTLY roll over into a different valid date. The
  // round-trip check (re-format the parsed ms, compare to the input) is the
  // only thing standing between these and a false-accept.
  const rollovers = [
    ['month 00', 'TrainingLog-backup-2026-00-13T013005Z.sqlite'],
    ['month 13', 'TrainingLog-backup-2026-13-13T013005Z.sqlite'],
    ['day 00', 'TrainingLog-backup-2026-06-00T013005Z.sqlite'],
    ['day 32', 'TrainingLog-backup-2026-06-32T013005Z.sqlite'],
    ['hour 25', 'TrainingLog-backup-2026-06-13T253005Z.sqlite'],
    ['minute 60', 'TrainingLog-backup-2026-06-13T016005Z.sqlite'],
    ['second 60', 'TrainingLog-backup-2026-06-13T013060Z.sqlite'],
    ['Feb 29 in a NON-leap year', 'TrainingLog-backup-2026-02-29T000000Z.sqlite'],
  ] as const;

  it.each(rollovers)('rejects an impossible %s', (_label, name) => {
    expect(parseBackupFileName(name)).toBeNull();
  });

  it('ACCEPTS Feb 29 in a real leap year (2024) — guard must not over-reject', () => {
    expect(parseBackupFileName('TrainingLog-backup-2024-02-29T000000Z.sqlite')).toBe(
      Date.UTC(2024, 1, 29, 0, 0, 0)
    );
  });

  it('accepts the canonical boundary times (midnight + 23:59:59)', () => {
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T000000Z.sqlite')).toBe(
      Date.UTC(2026, 5, 13, 0, 0, 0)
    );
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T235959Z.sqlite')).toBe(
      Date.UTC(2026, 5, 13, 23, 59, 59)
    );
  });
});

describe('parseBackupFileName — structural rejection (not a backup name)', () => {
  it('rejects wrong prefix / wrong extension / extra segments', () => {
    expect(parseBackupFileName('Backup-2026-06-13T013005Z.sqlite')).toBeNull();
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T013005Z.db')).toBeNull();
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T013005Z.sqlite.bak')).toBeNull();
    expect(parseBackupFileName('pre-restore-1765600000123.sqlite')).toBeNull();
  });

  it('rejects missing-Z / non-padded / non-numeric timestamp fields', () => {
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T013005.sqlite')).toBeNull(); // no Z
    expect(parseBackupFileName('TrainingLog-backup-2026-6-13T013005Z.sqlite')).toBeNull(); // month not 2-wide
    expect(parseBackupFileName('TrainingLog-backup-2026-06-13T01:30:05Z.sqlite')).toBeNull(); // colons (display form)
  });

  it('rejects the empty string and a bare extension', () => {
    expect(parseBackupFileName('')).toBeNull();
    expect(parseBackupFileName('.sqlite')).toBeNull();
  });

  it('parses the .icloud placeholder around a VALID name but rejects one around a rollover', () => {
    expect(
      parseBackupFileName('.TrainingLog-backup-2024-02-29T000000Z.sqlite.icloud')
    ).toBe(Date.UTC(2024, 1, 29, 0, 0, 0));
    // The placeholder unwrap must still run the calendar guard on the logical name.
    expect(
      parseBackupFileName('.TrainingLog-backup-2026-02-29T000000Z.sqlite.icloud')
    ).toBeNull();
  });

  it('round-trips makeBackupFileName for an arbitrary instant (inverse property)', () => {
    for (const ms of [0, T0, Date.UTC(1999, 11, 31, 23, 59, 59), Date.UTC(2100, 0, 1, 0, 0, 0)]) {
      expect(parseBackupFileName(makeBackupFileName(ms))).toBe(ms);
    }
  });
});

describe('planBackupRotation — keepCount clamp branches', () => {
  const n = makeBackupFileName;

  it('keepCount 0 deletes EVERY backup, oldest first', () => {
    const plan = planBackupRotation([{ name: n(T0) }, { name: n(T0 - 1000) }], 0);
    expect(plan.keep).toEqual([]);
    // oldest-first so a partial-failure deletion preserves the newest.
    expect(plan.toDelete).toEqual([n(T0 - 1000), n(T0)]);
  });

  it('negative keepCount is clamped to 0 (never produces a negative-length slice)', () => {
    const plan = planBackupRotation([{ name: n(T0) }], -5);
    expect(plan.keep).toEqual([]);
    expect(plan.toDelete).toEqual([n(T0)]);
  });

  it('keepCount larger than the listing keeps everything, deletes nothing', () => {
    const plan = planBackupRotation([{ name: n(T0) }, { name: n(T0 - 1000) }], 10);
    expect(plan.toDelete).toEqual([]);
    expect(plan.keep).toEqual([n(T0), n(T0 - 1000)]);
  });

  it('deletes oldest-first across MANY backups (custom keepCount=1)', () => {
    const items = [n(T0), n(T0 - 1000), n(T0 - 2000), n(T0 - 3000)].map((name) => ({ name }));
    const plan = planBackupRotation(items, 1);
    expect(plan.keep).toEqual([n(T0)]);
    expect(plan.toDelete).toEqual([n(T0 - 3000), n(T0 - 2000), n(T0 - 1000)]);
  });

  it('empty listing yields empty keep + empty toDelete', () => {
    expect(planBackupRotation([])).toEqual({ keep: [], toDelete: [] });
  });
});
