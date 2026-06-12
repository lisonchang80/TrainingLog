/**
 * Restore engine — slice 15 C4 service layer (ADR-0011 + 2026-06-12
 * amendment; micro-PRD in
 * `~/code/TrainingLog-overnight-reports/2026-06-12/12-slice15-backup-prep.md`).
 *
 * Orchestrates the full restore pipeline. Decision logic lives in
 * `src/domain/backup/restoreRules.ts` (pure, jest-covered); THIS module owns
 * sequencing + failure mapping and is 100 % dependency-injected — it imports
 * NO native module, NO expo API:
 *
 *   discoverBackupCandidates  — iCloud availability + listing, bounded by a
 *                               hard timeout (grill Q18-A: never spin forever;
 *                               ~5-10 s window, default 8 s)
 *   inspectCandidate          — download → open → quick_check → version gate
 *                               (Q10-A) → preview (session count + last date)
 *   pickRestorableCandidate   — newest-first walk with fallback to older
 *                               copies when the newest is corrupt/too-new
 *                               (ADR-0011 §7 «backup.sqlite 壞 → fallback»)
 *   executeRestore            — pre-restore self-backup (Q11-A) → close live
 *                               singleton → hard-delete main + sidecars (R1)
 *                               → copy candidate in → reopen (migrate runs)
 *                               (Q12-A in-place swap), with best-effort
 *                               rollback to the self-backup on swap failure
 *
 * ## Morning-integration wiring (deps registry)
 *
 * The production implementations live in a parallel worktree (agent A's
 * `modules/icloud-backup`) plus expo APIs this worktree deliberately does
 * not import. Integration wires them ONCE at boot via {@link setRestoreDeps}:
 *
 *   setRestoreDeps({
 *     icloud:  modules/icloud-backup JS wrapper        (isICloudAvailable /
 *              getUbiquityContainerUrl / listBackupItems / startDownload),
 *     fileOps: expo-file-system shims (exists/copy/remove/listDir — `remove`
 *              MUST be missing-ok, `listDir` MUST return [] for missing dir),
 *     dbOps:   { openCandidate: openCandidateDatabase,
 *                closeAndResetLive: closeAndResetForRestore,
 *                reopenLive: openDatabase }            (expoDatabase.ts),
 *     paths:   { liveDbPath: liveDatabasePath(),
 *                preRestoreDir: <sandbox cache/Documents dir> },
 *   });
 *
 * Until that call happens, `getRestoreDeps()` returns null and both restore
 * entry points (RestoreGate + Settings) degrade to inert pass-through.
 */

import {
  evaluateCandidate,
  preRestoreFileName,
  selectStalePreRestoreFiles,
  sidecarPaths,
  sortCandidatesNewestFirst,
  type BackupItem,
  type CandidateRejectReason,
} from '../domain/backup/restoreRules';
import { migrationsMaxVersion } from '../db/migrate';

// ---------------------------------------------------------------------------
// Deps contracts
// ---------------------------------------------------------------------------

/**
 * Contract mirror of agent A's `modules/icloud-backup` native module. This
 * worktree must NOT import the module itself — types are duplicated by
 * design; the morning integration passes the real module in.
 */
export interface ICloudBackupModuleLike {
  isICloudAvailable(): Promise<boolean>;
  getUbiquityContainerUrl(): Promise<string | null>;
  listBackupItems(): Promise<BackupItem[]>;
  /** Ensures the named item is materialized locally; resolves to a readable
   * local path (may be the ubiquity container file itself — the engine
   * therefore only ever COPIES from it, never moves). */
  startDownload(name: string): Promise<string>;
}

export interface RestoreFileOps {
  exists(path: string): Promise<boolean>;
  copy(src: string, dst: string): Promise<void>;
  /** MUST resolve silently when the path does not exist (idempotent delete).
   * The R1 sidecar sweep removes paths that usually aren't there. */
  remove(path: string): Promise<void>;
  /** File NAMES (not paths) inside `dir`; MUST return [] for a missing dir. */
  listDir(dir: string): Promise<string[]>;
}

/** Matches `CandidateDb` from expoDatabase.ts structurally (no import — keep
 * this module native-free for jest). */
export interface CandidateDbHandle {
  getFirstAsync<T>(sql: string): Promise<T | null>;
  closeAsync(): Promise<void>;
}

export interface RestoreDbOps {
  /** Production: `openCandidateDatabase` (expoDatabase.ts append). */
  openCandidate(absolutePath: string): Promise<CandidateDbHandle>;
  /** Production: `closeAndResetForRestore` (expoDatabase.ts append). */
  closeAndResetLive(): Promise<void>;
  /** Production: `openDatabase` — re-opens the swapped file and runs
   * `migrate()`, which upgrades older-schema backups for free (Q10-A). */
  reopenLive(): Promise<unknown>;
}

export interface RestorePaths {
  /** Production: `liveDatabasePath()` (expoDatabase.ts append). */
  liveDbPath: string;
  /** Sandbox directory for the Q11-A pre-restore self-backup (NOT uploaded). */
  preRestoreDir: string;
}

export interface RestoreServiceDeps {
  icloud: ICloudBackupModuleLike;
  fileOps: RestoreFileOps;
  dbOps: RestoreDbOps;
  paths: RestorePaths;
  /** Defaults to `migrationsMaxVersion()` — dynamic, never hardcoded. */
  appMaxVersion?: number;
  /** Defaults to `Date.now`. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Deps registry (single morning-integration wiring point)
// ---------------------------------------------------------------------------

let registeredDeps: RestoreServiceDeps | null = null;

/** Wire the production deps once at boot (see module docblock). Passing
 * `null` un-wires (test teardown). */
export function setRestoreDeps(deps: RestoreServiceDeps | null): void {
  registeredDeps = deps;
}

/** `null` until {@link setRestoreDeps} has been called — RestoreGate and the
 * Settings restore entry treat null as "feature not wired" and stay inert. */
export function getRestoreDeps(): RestoreServiceDeps | null {
  return registeredDeps;
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/** Q18-A discovery window. Within the grill-approved ~5-10 s band. */
export const DISCOVERY_TIMEOUT_MS = 8000;
/** startDownload bound — generous; large backups over slow links still get
 * a hard ceiling (#311's lesson: every cross-boundary wait needs a watchdog). */
export const DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Race a promise against a deadline. Resolves `{ timedOut: true }` when the
 * deadline wins; rejections of `p` propagate to the caller. The timer is
 * always cleared so jest never hangs on an open handle.
 */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export type DiscoveryResult =
  /** Not signed into iCloud / iCloud Drive off — Settings shows the
   * permanent red state per ADR-0011 §4. */
  | { status: 'unavailable' }
  /** Q18-A: discovery window elapsed — proceed fresh, offer 重新檢查. */
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'none' }
  /** Sorted newest-first, junk filtered. */
  | { status: 'found'; items: BackupItem[] };

export async function discoverBackupCandidates(
  deps: RestoreServiceDeps,
  opts?: { timeoutMs?: number }
): Promise<DiscoveryResult> {
  const timeoutMs = opts?.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  try {
    const availability = await withTimeout(deps.icloud.isICloudAvailable(), timeoutMs);
    if (availability.timedOut) return { status: 'timeout' };
    if (!availability.value) return { status: 'unavailable' };

    const listing = await withTimeout(deps.icloud.listBackupItems(), timeoutMs);
    if (listing.timedOut) return { status: 'timeout' };

    const items = sortCandidatesNewestFirst(listing.value);
    return items.length === 0 ? { status: 'none' } : { status: 'found', items };
  } catch (e) {
    return { status: 'error', message: errMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Inspection (download + integrity/version gate + preview)
// ---------------------------------------------------------------------------

export interface RestorePreview {
  item: BackupItem;
  /** Local readable path startDownload resolved to. */
  localPath: string;
  userVersion: number;
  /** Confirmation-dialog content (ADR-0011 §4: «備份內含 N 個 Session，
   * 最後一筆 YYYY-MM-DD»). */
  sessionCount: number;
  lastSessionAt: number | null;
}

export type InspectRejectReason = CandidateRejectReason | 'download-failed';

export type InspectResult =
  | { ok: true; preview: RestorePreview }
  | { ok: false; reason: InspectRejectReason; message?: string };

export async function inspectCandidate(
  deps: RestoreServiceDeps,
  item: BackupItem,
  opts?: { downloadTimeoutMs?: number }
): Promise<InspectResult> {
  // 1. Materialize locally (cloud placeholder → real bytes).
  let localPath: string;
  try {
    const dl = await withTimeout(
      deps.icloud.startDownload(item.name),
      opts?.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS
    );
    if (dl.timedOut) return { ok: false, reason: 'download-failed', message: 'timeout' };
    localPath = dl.value;
  } catch (e) {
    return { ok: false, reason: 'download-failed', message: errMessage(e) };
  }

  // 2. Open + run the read-only checks. The handle is ALWAYS closed.
  let handle: CandidateDbHandle | null = null;
  try {
    try {
      handle = await deps.dbOps.openCandidate(localPath);
    } catch {
      return { ok: false, reason: 'not-sqlite' };
    }

    // SQLITE_NOTADB often surfaces on the FIRST statement rather than at
    // open — a thrown quick_check therefore also maps to 'not-sqlite'.
    let quickCheckResult: string | null;
    try {
      const row = await handle.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
      quickCheckResult = row?.quick_check ?? null;
    } catch {
      return { ok: false, reason: 'not-sqlite' };
    }

    const versionRow = await handle
      .getFirstAsync<{ user_version: number }>('PRAGMA user_version')
      .catch(() => null);

    const verdict = evaluateCandidate({
      opened: true,
      quickCheckResult,
      userVersion: versionRow?.user_version ?? null,
      appMaxVersion: deps.appMaxVersion ?? migrationsMaxVersion(),
    });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    // Preview. `session` exists from v001 on, so user_version >= 1 implies
    // the table — a throw here means the file lied about being ours.
    let sessionCount = 0;
    let lastSessionAt: number | null = null;
    try {
      const p = await handle.getFirstAsync<{ n: number; last: number | null }>(
        'SELECT COUNT(*) AS n, MAX(started_at) AS last FROM session'
      );
      sessionCount = p?.n ?? 0;
      lastSessionAt = p?.last ?? null;
    } catch {
      return { ok: false, reason: 'empty-or-invalid' };
    }

    return {
      ok: true,
      preview: { item, localPath, userVersion: verdict.userVersion, sessionCount, lastSessionAt },
    };
  } finally {
    if (handle) await handle.closeAsync().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Pick (newest-first with fallback to older copies)
// ---------------------------------------------------------------------------

export interface RejectedCandidate {
  name: string;
  reason: InspectRejectReason;
}

export type PickResult =
  | { ok: true; preview: RestorePreview; rejected: RejectedCandidate[] }
  | { ok: false; rejected: RejectedCandidate[] };

/**
 * Walk the (already newest-first) candidates; first one passing inspection
 * wins. A corrupt newest copy falls back to the previous one (ADR-0011 §7);
 * when nothing passes, the caller gets every rejection so the UI can tell a
 * version-too-new story apart from a corruption story.
 */
export async function pickRestorableCandidate(
  deps: RestoreServiceDeps,
  items: BackupItem[],
  opts?: { downloadTimeoutMs?: number }
): Promise<PickResult> {
  const rejected: RejectedCandidate[] = [];
  for (const item of items) {
    const result = await inspectCandidate(deps, item, opts);
    if (result.ok) return { ok: true, preview: result.preview, rejected };
    rejected.push({ name: item.name, reason: result.reason });
  }
  return { ok: false, rejected };
}

// ---------------------------------------------------------------------------
// Execute (the swap)
// ---------------------------------------------------------------------------

export type RestoreStep = 'self-backup' | 'close-live' | 'clear-old' | 'copy-in' | 'reopen';

export type RestoreOutcome =
  | { ok: true; preRestorePath: string | null }
  | { ok: false; step: RestoreStep; message: string; rolledBack: boolean };

/**
 * Perform the in-place swap (Q12-A). Step order is load-bearing:
 *
 *   1. self-backup — copy the live DB to `pre-restore-<ts>.sqlite` (Q11-A,
 *      keep exactly 1) BEFORE anything destructive. Skipped when no live DB
 *      exists (fresh-install gate path).
 *   2. close-live — `closeAndResetForRestore()`. A throw aborts the whole
 *      restore HERE, before any deletion (see expoDatabase.ts docs).
 *   3. clear-old — delete main file + hard-delete all three sidecars (R1).
 *   4. copy-in — COPY the inspected candidate over (never move: the source
 *      may be the ubiquity container's only copy of that backup).
 *   5. reopen — `openDatabase()` → `migrate()` upgrades older schemas.
 *
 * Failures in steps 3-5 attempt a best-effort rollback to the step-1 copy
 * (`rolledBack` reports whether the old data is live again). The caller
 * (DatabaseProvider's suspend-runner) re-opens the DB afterwards either way.
 */
export async function executeRestore(
  deps: RestoreServiceDeps,
  preview: Pick<RestorePreview, 'localPath'>
): Promise<RestoreOutcome> {
  const now = deps.now ?? Date.now;
  const live = deps.paths.liveDbPath;
  let preRestorePath: string | null = null;

  const rollback = async (): Promise<boolean> => {
    if (!preRestorePath) return false;
    try {
      await deps.fileOps.remove(live);
      for (const sidecar of sidecarPaths(live)) await deps.fileOps.remove(sidecar);
      await deps.fileOps.copy(preRestorePath, live);
      await deps.dbOps.reopenLive();
      return true;
    } catch {
      return false;
    }
  };

  // 1. Pre-restore self-backup (keep 1 — sweep older copies first).
  try {
    if (await deps.fileOps.exists(live)) {
      const existing = await deps.fileOps.listDir(deps.paths.preRestoreDir);
      for (const stale of selectStalePreRestoreFiles(existing)) {
        await deps.fileOps.remove(`${deps.paths.preRestoreDir}/${stale}`);
      }
      preRestorePath = `${deps.paths.preRestoreDir}/${preRestoreFileName(now())}`;
      await deps.fileOps.copy(live, preRestorePath);
    }
  } catch (e) {
    return { ok: false, step: 'self-backup', message: errMessage(e), rolledBack: false };
  }

  // 2. Close + reset the live singleton.
  try {
    await deps.dbOps.closeAndResetLive();
  } catch (e) {
    // Nothing destroyed yet — the old connection (and data) remain live.
    return { ok: false, step: 'close-live', message: errMessage(e), rolledBack: false };
  }

  // 3. Hard-delete old main + sidecars (R1: stale -wal replay corrupts).
  try {
    await deps.fileOps.remove(live);
    for (const sidecar of sidecarPaths(live)) await deps.fileOps.remove(sidecar);
  } catch (e) {
    return { ok: false, step: 'clear-old', message: errMessage(e), rolledBack: await rollback() };
  }

  // 4. Copy the candidate into place.
  try {
    await deps.fileOps.copy(preview.localPath, live);
  } catch (e) {
    return { ok: false, step: 'copy-in', message: errMessage(e), rolledBack: await rollback() };
  }

  // 5. Reopen → migrate() brings older-schema backups to head.
  try {
    await deps.dbOps.reopenLive();
  } catch (e) {
    return { ok: false, step: 'reopen', message: errMessage(e), rolledBack: await rollback() };
  }

  return { ok: true, preRestorePath };
}
