/**
 * backupService — the C3 orchestrator for the iCloud whole-DB backup
 * (slice 15; ADR-0011 + 2026-06-12 grill amendment).
 *
 * One entry point, `runBackup`, fans out to the C2 building blocks:
 *
 *   trigger ──► shouldRunBackup (backupPolicy, pure gate:
 *               manual bypass / mode toggle / 5min debounce / cold-start 24h)
 *           ──► createBackupSnapshot   (expoDatabase — sqlite3_backup →
 *                                       sandbox temp + quick_check)
 *           ──► uploadBackupSnapshot   (icloudBackupAdapter — write-then-
 *                                       promote into the ubiquity container)
 *           ──► recordBackupSuccess / recordBackupFailure
 *                                      (settingsRepository app_settings keys;
 *                                       failures classified per C5)
 *
 * ## Contract
 *   - NEVER throws. Every call site is fire-and-forget (session finalize
 *     chain, AppState listener, cold-start sweep) except the Settings button,
 *     which branches on the returned outcome. Failures are classified
 *     (`classifyBackupError`), persisted to metadata, and logged.
 *   - Single-flight: one backup at a time process-wide. Overlapping calls
 *     return `{ status: 'already-running' }` — e.g. session finalize
 *     immediately followed by app-background, or a manual tap while an
 *     automatic run is mid-upload. (The 5min debounce only suppresses
 *     SEQUENTIAL retriggers; it can't see an in-flight run because the
 *     attempt stamp is written at completion.)
 *   - Q7-B ordering is the CALLER's job: the finalize trigger chains after
 *     `pushEndToWatch` settles (see app/(tabs)/index.tsx) — nothing here
 *     waits on watch reconcile.
 *
 * ## Dependency injection
 * Mirrors `healthkitSessionSync.ts`: each collaborator individually
 * injectable with production defaults, so tests cover the orchestration
 * matrix without native modules.
 */

import type { Database } from '../db/types';
import {
  createBackupSnapshot,
  type BackupSnapshotResult,
} from '../adapters/sqlite/expoDatabase';
import {
  uploadBackupSnapshot,
  type BackupUploadResult,
} from '../adapters/backup/icloudBackupAdapter';
import { isICloudAvailable } from '../../modules/icloud-backup';
import {
  classifyBackupError,
  type BackupErrorKind,
} from '../domain/backup/backupErrors';
import {
  shouldEscalateBackupFailure,
  shouldRunBackup,
  type BackupTrigger,
  type SkipReason,
} from '../domain/backup/backupPolicy';
import {
  getBackupMetadata,
  recordBackupFailure,
  recordBackupSuccess,
  type BackupMetadata,
} from '../adapters/sqlite/settingsRepository';

export type RunBackupOutcome =
  | { status: 'success'; fileName: string; sizeBytes: number | null }
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'already-running' }
  | { status: 'failed'; kind: BackupErrorKind; message: string };

export interface BackupServiceDeps {
  /** Defaults to {@link createBackupSnapshot}. */
  createBackupSnapshot?: (nowMs?: number) => Promise<BackupSnapshotResult>;
  /** Defaults to {@link uploadBackupSnapshot}. */
  uploadBackupSnapshot?: (args: {
    snapshotPath: string;
    nowMs?: number;
  }) => Promise<BackupUploadResult>;
  /** Defaults to {@link getBackupMetadata}. */
  getBackupMetadata?: (db: Database) => Promise<BackupMetadata>;
  /** Defaults to {@link recordBackupSuccess}. */
  recordBackupSuccess?: (
    db: Database,
    args: { atMs: number; sizeBytes: number | null }
  ) => Promise<void>;
  /** Defaults to {@link recordBackupFailure}. */
  recordBackupFailure?: (
    db: Database,
    args: { atMs: number; message: string; kind?: BackupErrorKind }
  ) => Promise<void>;
  /** Defaults to Date.now. */
  now?: () => number;
}

/** Process-wide single-flight latch (see module docblock). */
let backupInFlight = false;

/** Test hook — clears the single-flight latch between cases. */
export function __resetBackupInFlightForTests(): void {
  backupInFlight = false;
}

/**
 * Gate + run one backup attempt. See module docblock for the contract.
 *
 * `trigger` semantics (backupPolicy):
 *   - 'manual'           Settings 立即備份 — bypasses mode + debounce
 *   - 'session-finalize' after finalize reconcile completes (Q7-B)
 *   - 'background'       AppState → background
 *   - 'cold-start'       boot sweep — additionally requires last success
 *                        missing or > 24h old (Q6-B)
 */
export async function runBackup(
  db: Database,
  trigger: BackupTrigger,
  deps: BackupServiceDeps = {}
): Promise<RunBackupOutcome> {
  const snapshotFn = deps.createBackupSnapshot ?? createBackupSnapshot;
  const uploadFn = deps.uploadBackupSnapshot ?? uploadBackupSnapshot;
  const getMetadataFn = deps.getBackupMetadata ?? getBackupMetadata;
  const recordSuccessFn = deps.recordBackupSuccess ?? recordBackupSuccess;
  const recordFailureFn = deps.recordBackupFailure ?? recordBackupFailure;
  const now = deps.now ?? Date.now;

  if (backupInFlight) return { status: 'already-running' };
  backupInFlight = true;
  try {
    const nowMs = now();

    let metadata: BackupMetadata;
    try {
      metadata = await getMetadataFn(db);
    } catch (e) {
      // Metadata unreadable (DB mid-restore?) — skip this run rather than
      // backing up against an inconsistent gate. Next trigger retries.
      const { message } = classifyBackupError(e);
      console.warn('[backup] metadata read failed, skipping run:', message);
      return { status: 'failed', kind: 'unknown', message };
    }

    const gate = shouldRunBackup({
      trigger,
      mode: metadata.mode,
      nowMs,
      lastAttemptAtMs: metadata.lastAttemptAtMs,
      lastSuccessAtMs: metadata.lastSuccessAtMs,
    });
    if (!gate.run) return { status: 'skipped', reason: gate.reason };

    try {
      const snapshot = await snapshotFn(nowMs);
      const uploaded = await uploadFn({ snapshotPath: snapshot.path, nowMs });
      await recordSuccessFn(db, { atMs: now(), sizeBytes: uploaded.sizeBytes });
      return {
        status: 'success',
        fileName: uploaded.fileName,
        sizeBytes: uploaded.sizeBytes,
      };
    } catch (e) {
      const classified = classifyBackupError(e);
      try {
        await recordFailureFn(db, {
          atMs: now(),
          message: classified.message,
          kind: classified.kind,
        });
      } catch (persistErr) {
        console.warn('[backup] failure metadata write failed:', persistErr);
      }
      console.warn(`[backup] run failed (${classified.kind}):`, classified.message);
      return { status: 'failed', kind: classified.kind, message: classified.message };
    }
  } finally {
    backupInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// C5 — aggregated health readout (Settings 紅警示 + 主畫面 banner share it).
// ---------------------------------------------------------------------------

export interface BackupHealth {
  metadata: BackupMetadata;
  /**
   * Q14-B in-app escalation verdict: the unhealed failure streak is at
   * least 3 days (auto) / 7 days (manual) old → Settings red + home banner.
   */
  escalated: boolean;
  /**
   * Days since the streak anchor (last success, else first failure),
   * floored; null when not escalated. Feeds the banner's「已 N 天未成功」.
   */
  escalatedDays: number | null;
  /** Q15-A permanent red warning when false (未登 iCloud / Drive off). */
  iCloudAvailable: boolean;
}

export interface BackupHealthDeps {
  /** Defaults to {@link getBackupMetadata}. */
  getBackupMetadata?: (db: Database) => Promise<BackupMetadata>;
  /** Defaults to the native module wrapper (sync + cheap). */
  isICloudAvailable?: () => boolean;
  /** Defaults to Date.now. */
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getBackupHealth(
  db: Database,
  deps: BackupHealthDeps = {}
): Promise<BackupHealth> {
  const getMetadataFn = deps.getBackupMetadata ?? getBackupMetadata;
  const availableFn = deps.isICloudAvailable ?? isICloudAvailable;
  const now = deps.now ?? Date.now;

  const nowMs = now();
  const metadata = await getMetadataFn(db);

  const escalated = shouldEscalateBackupFailure({
    mode: metadata.mode,
    nowMs,
    lastSuccessAtMs: metadata.lastSuccessAtMs,
    lastErrorAtMs: metadata.lastError?.atMs ?? null,
    firstErrorAtMs: metadata.firstErrorAtMs,
  });
  const anchor = metadata.lastSuccessAtMs ?? metadata.firstErrorAtMs;
  const escalatedDays =
    escalated && anchor != null
      ? Math.max(0, Math.floor((nowMs - anchor) / DAY_MS))
      : null;

  let iCloudAvailable = false;
  try {
    iCloudAvailable = availableFn();
  } catch {
    iCloudAvailable = false;
  }

  return { metadata, escalated, escalatedDays, iCloudAvailable };
}
