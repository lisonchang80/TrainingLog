import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate, migrationsMaxVersion } from '../../src/db/migrate';
import type { BackupItem } from '../../src/domain/backup/restoreRules';
import {
  discoverBackupCandidates,
  executeRestore,
  getRestoreDeps,
  inspectCandidate,
  isRestoreInFlight,
  pickRestorableCandidate,
  recoverInterruptedRestore,
  setRestoreDeps,
  withTimeout,
  __setRestoreInFlightForTests,
  type CandidateDbHandle,
  type RestoreServiceDeps,
} from '../../src/services/restoreService';
import { gateSkipReason } from '../../components/restore-gate.behavior';

/**
 * Slice 15 C4 — restore engine orchestration tests.
 *
 * Decision logic (version gate / sidecar list / ordering) is covered in
 * tests/domain/restoreRules.test.ts; THIS suite locks the service's
 * sequencing contract:
 *
 *   - discovery: unavailable / timeout (Q18-A) / none / found-sorted
 *   - inspection: happy preview, not-sqlite, version-too-new against a REAL
 *     SQLite file (BetterSqliteDatabase candidate handle — verifies the
 *     actual PRAGMA row shapes, not just mocks), handle always closed
 *   - pick: newest corrupt → falls back to older valid copy (ADR-0011 §7)
 *   - executeRestore: exact destructive-step ORDER (self-backup → close →
 *     delete main+sidecars → copy-in → reopen), fresh-install skip of the
 *     self-backup, keep-1 sweep, close-failure aborts BEFORE deletion, and
 *     best-effort rollback on swap failure
 */

const item = (over: Partial<BackupItem> = {}): BackupItem => ({
  name: 'TrainingLog-backup-2026-06-12T0830.sqlite',
  sizeBytes: 4096,
  modifiedAt: 1_765_000_000_000,
  isUploaded: true,
  isDownloaded: true,
  ...over,
});

/** Candidate handle backed by a REAL in-memory SQLite DB migrated to head —
 * exercises the service's literal PRAGMA/SELECT strings. */
async function realCandidateHandle(opts?: {
  userVersion?: number;
  sessions?: { started_at: number }[];
}): Promise<{ handle: CandidateDbHandle; closed: () => boolean }> {
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  for (const s of opts?.sessions ?? []) {
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      `sess-${s.started_at}`,
      s.started_at
    );
  }
  if (opts?.userVersion !== undefined) {
    await db.execAsync(`PRAGMA user_version = ${opts.userVersion}`);
  }
  let closed = false;
  const handle: CandidateDbHandle = {
    getFirstAsync: <T>(sql: string) => db.getFirstAsync<T>(sql),
    closeAsync: async () => {
      closed = true;
      db.close();
    },
  };
  return { handle, closed: () => closed };
}

function makeDeps(over: Partial<RestoreServiceDeps> = {}): RestoreServiceDeps {
  return {
    icloud: {
      isICloudAvailable: jest.fn().mockResolvedValue(true),
      getUbiquityContainerUrl: jest.fn().mockResolvedValue('/icloud/container'),
      listBackupItems: jest.fn().mockResolvedValue([]),
      startDownload: jest.fn(async (name: string) => `/icloud/container/Documents/${name}`),
    },
    fileOps: {
      exists: jest.fn().mockResolvedValue(true),
      copy: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      listDir: jest.fn().mockResolvedValue([]),
    },
    dbOps: {
      openCandidate: jest.fn(),
      closeAndResetLive: jest.fn().mockResolvedValue(undefined),
      reopenLive: jest.fn().mockResolvedValue(undefined),
    },
    paths: {
      liveDbPath: '/sandbox/Documents/SQLite/traininglog.db',
      preRestoreDir: '/sandbox/Library/Caches',
    },
    now: () => 1_765_600_000_123,
    ...over,
  };
}

const never = new Promise<never>(() => undefined);

describe('withTimeout', () => {
  it('resolves the value when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toEqual({
      timedOut: false,
      value: 42,
    });
  });

  it('reports timeout when the deadline wins', async () => {
    await expect(withTimeout(never, 15)).resolves.toEqual({ timedOut: true });
  });

  it('propagates rejections', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('discoverBackupCandidates', () => {
  it('reports unavailable when not signed into iCloud', async () => {
    const deps = makeDeps();
    (deps.icloud.isICloudAvailable as jest.Mock).mockResolvedValue(false);
    await expect(discoverBackupCandidates(deps)).resolves.toEqual({ status: 'unavailable' });
    expect(deps.icloud.listBackupItems).not.toHaveBeenCalled();
  });

  it('reports timeout when listing hangs past the window (Q18-A: never spin forever)', async () => {
    const deps = makeDeps();
    (deps.icloud.listBackupItems as jest.Mock).mockReturnValue(never);
    await expect(discoverBackupCandidates(deps, { timeoutMs: 15 })).resolves.toEqual({
      status: 'timeout',
    });
  });

  it('reports none when the folder has no usable .sqlite items', async () => {
    const deps = makeDeps();
    (deps.icloud.listBackupItems as jest.Mock).mockResolvedValue([
      item({ name: 'notes.txt' }),
      item({ name: '.hidden.sqlite.icloud' }),
    ]);
    await expect(discoverBackupCandidates(deps)).resolves.toEqual({ status: 'none' });
  });

  it('returns candidates sorted newest first', async () => {
    const deps = makeDeps();
    const older = item({ name: 'a.sqlite', modifiedAt: 100 });
    const newer = item({ name: 'b.sqlite', modifiedAt: 200 });
    (deps.icloud.listBackupItems as jest.Mock).mockResolvedValue([older, newer]);
    const result = await discoverBackupCandidates(deps);
    expect(result).toEqual({ status: 'found', items: [newer, older] });
  });

  it('maps listing errors to the error status', async () => {
    const deps = makeDeps();
    (deps.icloud.listBackupItems as jest.Mock).mockRejectedValue(new Error('container gone'));
    await expect(discoverBackupCandidates(deps)).resolves.toEqual({
      status: 'error',
      message: 'container gone',
    });
  });
});

describe('inspectCandidate', () => {
  it('produces a preview from a real head-version SQLite candidate and closes the handle', async () => {
    const { handle, closed } = await realCandidateHandle({
      sessions: [{ started_at: 1_700_000_000_000 }, { started_at: 1_710_000_000_000 }],
    });
    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockResolvedValue(handle);

    const result = await inspectCandidate(deps, item());
    expect(result).toEqual({
      ok: true,
      preview: {
        item: item(),
        localPath: `/icloud/container/Documents/${item().name}`,
        userVersion: migrationsMaxVersion(),
        sessionCount: 2,
        lastSessionAt: 1_710_000_000_000,
      },
    });
    expect(closed()).toBe(true);
  });

  it('accepts an older-schema backup (user_version < max) — reopen will migrate it up', async () => {
    const { handle } = await realCandidateHandle({ userVersion: 7 });
    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockResolvedValue(handle);
    const result = await inspectCandidate(deps, item());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.userVersion).toBe(7);
  });

  it('REJECTS a backup from a newer app build (user_version > max), closing the handle', async () => {
    const { handle, closed } = await realCandidateHandle({
      userVersion: migrationsMaxVersion() + 1,
    });
    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockResolvedValue(handle);
    await expect(inspectCandidate(deps, item())).resolves.toEqual({
      ok: false,
      reason: 'version-too-new',
    });
    expect(closed()).toBe(true);
  });

  it('maps an open failure to not-sqlite', async () => {
    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockRejectedValue(new Error('file is not a database'));
    await expect(inspectCandidate(deps, item())).resolves.toEqual({
      ok: false,
      reason: 'not-sqlite',
    });
  });

  it('maps a thrown quick_check (SQLITE_NOTADB on first statement) to not-sqlite', async () => {
    const deps = makeDeps();
    const handle: CandidateDbHandle = {
      getFirstAsync: jest.fn().mockRejectedValue(new Error('file is not a database')),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    (deps.dbOps.openCandidate as jest.Mock).mockResolvedValue(handle);
    await expect(inspectCandidate(deps, item())).resolves.toEqual({
      ok: false,
      reason: 'not-sqlite',
    });
    expect(handle.closeAsync).toHaveBeenCalled();
  });

  it('maps quick_check corruption rows to quick-check-failed', async () => {
    const deps = makeDeps();
    const handle: CandidateDbHandle = {
      getFirstAsync: jest.fn(async (sql: string) => {
        if (sql === 'PRAGMA quick_check') return { quick_check: '*** in database main ***' };
        return null;
      }) as CandidateDbHandle['getFirstAsync'],
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    (deps.dbOps.openCandidate as jest.Mock).mockResolvedValue(handle);
    await expect(inspectCandidate(deps, item())).resolves.toEqual({
      ok: false,
      reason: 'quick-check-failed',
    });
  });

  it('maps a hung / failed download to download-failed', async () => {
    const deps = makeDeps();
    (deps.icloud.startDownload as jest.Mock).mockReturnValue(never);
    await expect(
      inspectCandidate(deps, item(), { downloadTimeoutMs: 15 })
    ).resolves.toEqual({ ok: false, reason: 'download-failed', message: 'timeout' });

    (deps.icloud.startDownload as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(inspectCandidate(deps, item())).resolves.toEqual({
      ok: false,
      reason: 'download-failed',
      message: 'offline',
    });
  });
});

describe('pickRestorableCandidate — fallback to older copies', () => {
  it('falls back to the previous copy when the newest is corrupt, recording the rejection', async () => {
    const newest = item({ name: 'new.sqlite', modifiedAt: 200 });
    const older = item({ name: 'old.sqlite', modifiedAt: 100 });
    const { handle: goodHandle } = await realCandidateHandle({
      sessions: [{ started_at: 1_700_000_000_000 }],
    });

    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('new.sqlite')) throw new Error('not a database');
      return goodHandle;
    });

    const result = await pickRestorableCandidate(deps, [newest, older]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.item.name).toBe('old.sqlite');
      expect(result.rejected).toEqual([{ name: 'new.sqlite', reason: 'not-sqlite' }]);
    }
  });

  it('reports every rejection when no copy is usable', async () => {
    const deps = makeDeps();
    (deps.dbOps.openCandidate as jest.Mock).mockRejectedValue(new Error('nope'));
    const result = await pickRestorableCandidate(deps, [
      item({ name: 'a.sqlite' }),
      item({ name: 'b.sqlite' }),
    ]);
    expect(result).toEqual({
      ok: false,
      rejected: [
        { name: 'a.sqlite', reason: 'not-sqlite' },
        { name: 'b.sqlite', reason: 'not-sqlite' },
      ],
    });
  });
});

describe('executeRestore — destructive step order', () => {
  /** Wires every fileOps/dbOps call into one chronological log. */
  function loggedDeps(over: Partial<RestoreServiceDeps> = {}) {
    const log: string[] = [];
    const deps = makeDeps({
      fileOps: {
        exists: jest.fn(async (p: string) => {
          log.push(`exists:${p}`);
          return true;
        }),
        copy: jest.fn(async (src: string, dst: string) => {
          log.push(`copy:${src}->${dst}`);
        }),
        remove: jest.fn(async (p: string) => {
          log.push(`remove:${p}`);
        }),
        listDir: jest.fn(async () => {
          log.push('listDir');
          return ['pre-restore-100.sqlite', 'unrelated.txt'];
        }),
      },
      dbOps: {
        openCandidate: jest.fn(),
        closeAndResetLive: jest.fn(async () => {
          log.push('closeLive');
        }),
        reopenLive: jest.fn(async () => {
          log.push('reopen');
        }),
      },
      ...over,
    });
    return { deps, log };
  }

  const LIVE = '/sandbox/Documents/SQLite/traininglog.db';
  const CANDIDATE = '/icloud/container/Documents/new.sqlite';

  it('runs self-backup → close → delete main+sidecars → copy-in → reopen, in that exact order', async () => {
    const { deps, log } = loggedDeps();
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });

    expect(outcome).toEqual({
      ok: true,
      preRestorePath: '/sandbox/Library/Caches/pre-restore-1765600000123.sqlite',
    });
    expect(log).toEqual([
      `exists:${LIVE}`,
      'listDir',
      'remove:/sandbox/Library/Caches/pre-restore-100.sqlite', // keep-1 sweep
      `copy:${LIVE}->/sandbox/Library/Caches/pre-restore-1765600000123.sqlite`,
      'closeLive',
      // 🟠-1 crash-recovery marker written BEFORE the destructive window.
      `copy:/sandbox/Library/Caches/pre-restore-1765600000123.sqlite->/sandbox/Library/Caches/restore-in-progress.sqlite`,
      `remove:${LIVE}`,
      `remove:${LIVE}-journal`, // R1 hard sidecar sweep
      `remove:${LIVE}-wal`,
      `remove:${LIVE}-shm`,
      `copy:${CANDIDATE}->${LIVE}`,
      'reopen',
      // Marker cleared once the swap is confirmed.
      'remove:/sandbox/Library/Caches/restore-in-progress.sqlite',
    ]);
  });

  it('skips the self-backup on the fresh-install path (no live DB) and still swaps', async () => {
    const { deps, log } = loggedDeps();
    (deps.fileOps.exists as jest.Mock).mockImplementation(async (p: string) => {
      log.push(`exists:${p}`);
      return false;
    });
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });
    expect(outcome).toEqual({ ok: true, preRestorePath: null });
    expect(log).toEqual([
      `exists:${LIVE}`,
      'closeLive',
      `remove:${LIVE}`,
      `remove:${LIVE}-journal`,
      `remove:${LIVE}-wal`,
      `remove:${LIVE}-shm`,
      `copy:${CANDIDATE}->${LIVE}`,
      'reopen',
    ]);
  });

  it('aborts at close-live BEFORE any deletion when the connection cannot be closed', async () => {
    const { deps, log } = loggedDeps();
    (deps.dbOps.closeAndResetLive as jest.Mock).mockRejectedValue(new Error('busy'));
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });
    expect(outcome).toEqual({
      ok: false,
      step: 'close-live',
      message: 'busy',
      rolledBack: false,
    });
    // No remove/copy-in after the failed close — old data untouched.
    expect(log.filter((l) => l.startsWith(`remove:${LIVE}`))).toEqual([]);
    expect(log.filter((l) => l.includes(`->${LIVE}`))).toEqual([]);
  });

  it('rolls back to the pre-restore copy when copy-in fails', async () => {
    const { deps, log } = loggedDeps();
    (deps.fileOps.copy as jest.Mock).mockImplementation(async (src: string, dst: string) => {
      if (src === CANDIDATE) throw new Error('disk full');
      log.push(`copy:${src}->${dst}`);
    });
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });
    expect(outcome).toEqual({
      ok: false,
      step: 'copy-in',
      message: 'disk full',
      rolledBack: true,
    });
    // Rollback = pre-restore copy back into place + reopen on old data.
    expect(log).toContain(
      `copy:/sandbox/Library/Caches/pre-restore-1765600000123.sqlite->${LIVE}`
    );
    expect(log[log.length - 1]).toBe('reopen');
  });

  it('reports rolledBack: false when rollback is impossible (fresh install, no self-backup)', async () => {
    const { deps } = loggedDeps();
    (deps.fileOps.exists as jest.Mock).mockResolvedValue(false);
    (deps.fileOps.copy as jest.Mock).mockRejectedValue(new Error('disk full'));
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });
    expect(outcome).toEqual({
      ok: false,
      step: 'copy-in',
      message: 'disk full',
      rolledBack: false,
    });
  });

  it('rolls back when reopen (migrate) fails so the old data stays live', async () => {
    const { deps } = loggedDeps();
    (deps.dbOps.reopenLive as jest.Mock)
      .mockRejectedValueOnce(new Error('migration exploded'))
      .mockResolvedValue(undefined);
    const outcome = await executeRestore(deps, { localPath: CANDIDATE });
    expect(outcome).toEqual({
      ok: false,
      step: 'reopen',
      message: 'migration exploded',
      rolledBack: true,
    });
  });
});

describe('deps registry (morning-integration wiring point)', () => {
  afterEach(() => setRestoreDeps(null));

  it('is null until wired, then returns the registered deps, and can be un-wired', () => {
    expect(getRestoreDeps()).toBeNull();
    const deps = makeDeps();
    setRestoreDeps(deps);
    expect(getRestoreDeps()).toBe(deps);
    setRestoreDeps(null);
    expect(getRestoreDeps()).toBeNull();
  });
});

describe('recoverInterruptedRestore — boot crash-recovery (🟠-1)', () => {
  const LIVE = '/sandbox/Documents/SQLite/traininglog.db';
  const MARKER = '/sandbox/Library/Caches/restore-in-progress.sqlite';

  function recoveryDeps(present: { marker: boolean; live: boolean }) {
    const log: string[] = [];
    const deps = makeDeps({
      fileOps: {
        exists: jest.fn(async (p: string) => {
          if (p === MARKER) return present.marker;
          if (p === LIVE) return present.live;
          return false;
        }),
        copy: jest.fn(async (src: string, dst: string) => {
          log.push(`copy:${src}->${dst}`);
        }),
        remove: jest.fn(async (p: string) => {
          log.push(`remove:${p}`);
        }),
        listDir: jest.fn(async () => []),
      },
    });
    return { deps, log };
  }

  it('no marker → no-op (normal boot)', async () => {
    const { deps, log } = recoveryDeps({ marker: false, live: true });
    expect(await recoverInterruptedRestore(deps)).toEqual({ recovered: false });
    expect(log).toEqual([]);
  });

  it('marker + live MISSING → restores from the marker (the kill-window case)', async () => {
    const { deps, log } = recoveryDeps({ marker: true, live: false });
    expect(await recoverInterruptedRestore(deps)).toEqual({ recovered: true });
    expect(log).toEqual([
      `remove:${LIVE}`,
      `remove:${LIVE}-journal`,
      `remove:${LIVE}-wal`,
      `remove:${LIVE}-shm`,
      `copy:${MARKER}->${LIVE}`,
      `remove:${MARKER}`,
    ]);
  });

  it('marker + live PRESENT → clears the stale marker, never overwrites live', async () => {
    const { deps, log } = recoveryDeps({ marker: true, live: true });
    expect(await recoverInterruptedRestore(deps)).toEqual({
      recovered: false,
      cleared: true,
    });
    expect(log).toEqual([`remove:${MARKER}`]);
    expect(log.some((l) => l.includes(`->${LIVE}`))).toBe(false);
  });

  it('recovery copy failure leaves the marker for the next boot to retry', async () => {
    const { deps } = recoveryDeps({ marker: true, live: false });
    (deps.fileOps.copy as jest.Mock).mockRejectedValue(new Error('disk full'));
    const out = await recoverInterruptedRestore(deps);
    expect(out.recovered).toBe(false);
    const removedMarker = (deps.fileOps.remove as jest.Mock).mock.calls.some(
      (c) => c[0] === MARKER
    );
    expect(removedMarker).toBe(false);
  });
});

describe('🟠-1 ✕ RestoreGate — heal runs BEFORE the gate decides (device smoke 2026-06-19)', () => {
  // Regression guard for the 2026-06-19 device-smoke finding: RestoreGate mounts
  // ABOVE DatabaseProvider, so the gate's own dbExists probe shadowed the boot
  // self-heal — a kill-window interrupted restore (marker present, live deleted)
  // was mistaken for a FRESH INSTALL and the gate prompted "發現 iCloud 備份"
  // instead of silently recovering. The fix runs recoverInterruptedRestore at the
  // TOP of RestoreGate's mount probe (restore-gate.tsx), before dbExists. This
  // locks the COMPOSITION: heal → live restored → gateSkipReason returns a skip.
  // (RestoreGate is a RN component; the node-env jest harness can't render it, so
  // this guards the service+behavior chain the inline ordering relies on.)
  const LIVE = '/sandbox/Documents/SQLite/traininglog.db';
  const MARKER = '/sandbox/Library/Caches/restore-in-progress.sqlite';

  it('marker + live-missing → after heal the live DB exists and the gate SKIPS (no fresh-install prompt)', async () => {
    // Stateful in-memory fs starting in the kill-window state (marker, no live).
    const files = new Set<string>([MARKER]);
    const deps = makeDeps({
      fileOps: {
        exists: jest.fn(async (p: string) => files.has(p)),
        copy: jest.fn(async (_src: string, dst: string) => {
          files.add(dst);
        }),
        remove: jest.fn(async (p: string) => {
          files.delete(p);
        }),
        listDir: jest.fn(async () => []),
      },
    });

    // BEFORE the heal: gate sees no live DB → does NOT skip → would prompt.
    expect(await deps.fileOps.exists(LIVE)).toBe(false);
    expect(
      gateSkipReason({ depsWired: true, declinedSentinel: false, dbExists: false })
    ).toBeNull();

    // RestoreGate's mount probe runs the heal first (the fix).
    expect(await recoverInterruptedRestore(deps)).toEqual({ recovered: true });

    // AFTER the heal: live restored from the marker → gate's probe sees it → SKIP.
    const dbExists = await deps.fileOps.exists(LIVE);
    expect(dbExists).toBe(true);
    expect(
      gateSkipReason({ depsWired: true, declinedSentinel: false, dbExists })
    ).toBe('db-exists');
  });
});

describe('restore-in-flight latch (🟠-2)', () => {
  afterEach(() => __setRestoreInFlightForTests(false));

  it('is held across executeRestore and cleared on success', async () => {
    let flagDuringClose = false;
    const deps = makeDeps({
      dbOps: {
        openCandidate: jest.fn(),
        closeAndResetLive: jest.fn(async () => {
          flagDuringClose = isRestoreInFlight();
        }),
        reopenLive: jest.fn().mockResolvedValue(undefined),
      },
    });
    expect(isRestoreInFlight()).toBe(false);
    await executeRestore(deps, { localPath: '/icloud/x.sqlite' });
    expect(flagDuringClose).toBe(true);
    expect(isRestoreInFlight()).toBe(false);
  });

  it('is cleared even when the swap fails', async () => {
    const deps = makeDeps({
      dbOps: {
        openCandidate: jest.fn(),
        closeAndResetLive: jest.fn().mockRejectedValue(new Error('busy')),
        reopenLive: jest.fn(),
      },
    });
    await executeRestore(deps, { localPath: '/icloud/x.sqlite' });
    expect(isRestoreInFlight()).toBe(false);
  });
});
