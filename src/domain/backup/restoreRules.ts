/**
 * Restore rules — slice 15 C4 pure logic (ADR-0011 + 2026-06-12 amendment).
 *
 * Every decision the restore engine makes that does NOT require IO lives
 * here so jest can cover the full branch matrix under `testEnvironment:
 * node` with zero mocks:
 *
 *   - Candidate filtering + ordering (newest first — grill Q4 timestamped
 *     filenames, 2-copy rotate semantics owned by the backup side / C2).
 *   - Version gating (grill Q10-A): candidate `user_version` > app
 *     migrations max → REJECT («此備份來自較新版本的 TrainingLog»);
 *     `<= max` → accept (reopen runs `migrate()` which upgrades old
 *     schemas for free); `0` / non-SQLite / failed quick_check → reject.
 *     The app max is passed IN (dynamic — `migrationsMaxVersion()` from
 *     `src/db/migrate.ts`), never hardcoded.
 *   - Sidecar path list (risk R1): swapping the DB file MUST hard-delete
 *     `-journal` / `-wal` / `-shm` siblings. expo-sqlite's delete API does
 *     not clear sidecars (expo issue #43441) and a stale `-wal` replayed
 *     over the restored main file corrupts it.
 *   - Pre-restore self-backup naming + stale-copy selection (grill Q11-A:
 *     sandbox `pre-restore-<ts>.sqlite`, keep exactly 1, never uploaded).
 *
 * NO imports from adapters / services / react — keep this file pure.
 */

/** Mirror of the `modules/icloud-backup` `listBackupItems()` item contract
 * (agent A's native module — type duplicated here on purpose; this worktree
 * must not import the module itself). */
export interface BackupItem {
  /** File name inside the ubiquity container's Documents/ folder. */
  name: string;
  sizeBytes: number;
  /** Last-modified epoch ms. */
  modifiedAt: number;
  isUploaded: boolean;
  isDownloaded: boolean;
}

/** Why a candidate was rejected by {@link evaluateCandidate}. */
export type CandidateRejectReason =
  /** File failed to open as SQLite (bad magic header / not a DB at all). */
  | 'not-sqlite'
  /** `PRAGMA quick_check` returned anything other than 'ok'. */
  | 'quick-check-failed'
  /** `user_version` 0 / missing — fresh or foreign DB, not a TrainingLog backup. */
  | 'empty-or-invalid'
  /** `user_version` ahead of this app build's migrations — needs app update. */
  | 'version-too-new';

export type CandidateVerdict =
  | { ok: true; userVersion: number }
  | { ok: false; reason: CandidateRejectReason };

/**
 * Version + integrity gate (grill Q10-A). Inputs are raw observations the
 * service collected from the candidate file; this function owns the verdict.
 *
 * - `opened === false` → the file could not even be opened as SQLite.
 * - `quickCheckResult` is the first row of `PRAGMA quick_check` (lowercased
 *   comparison; SQLite returns exactly 'ok' when healthy). `null` = the
 *   pragma itself errored → treat as corrupt.
 * - `userVersion` `null` / `<= 0` → not a TrainingLog DB (our migrations
 *   start at 1; a fresh non-app SQLite file reports 0).
 * - `userVersion > appMaxVersion` → backup written by a NEWER app → reject
 *   (downgrade is unsafe; runner only migrates forward).
 */
export function evaluateCandidate(input: {
  opened: boolean;
  quickCheckResult: string | null;
  userVersion: number | null;
  appMaxVersion: number;
}): CandidateVerdict {
  if (!input.opened) return { ok: false, reason: 'not-sqlite' };
  if ((input.quickCheckResult ?? '').toLowerCase() !== 'ok') {
    return { ok: false, reason: 'quick-check-failed' };
  }
  const v = input.userVersion;
  if (v == null || v <= 0 || !Number.isInteger(v)) {
    return { ok: false, reason: 'empty-or-invalid' };
  }
  if (v > input.appMaxVersion) return { ok: false, reason: 'version-too-new' };
  return { ok: true, userVersion: v };
}

/**
 * Sidecar files that MUST be deleted alongside the main DB file during the
 * restore swap (risk R1). Order matters only for determinism in tests.
 *
 * Covers all three journaling artifacts regardless of the journal mode the
 * app happens to run (currently DELETE; a future WAL switch must not be
 * able to corrupt restore).
 */
export function sidecarPaths(dbPath: string): string[] {
  return [`${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`];
}

/** A name is a restore candidate when it's a bare `.sqlite` file (grill
 * Q20-A: backups are raw .sqlite). Hidden files and `.icloud` placeholders
 * are excluded — the native module resolves placeholders via NSMetadataQuery
 * and `startDownload`, but defensive filtering here keeps junk out even if
 * the listing leaks one through. */
export function isBackupCandidateName(name: string): boolean {
  if (name.startsWith('.')) return false;
  return name.toLowerCase().endsWith('.sqlite');
}

/**
 * Filter + order discovery results: newest first (grill «候選排序（最新優先）»).
 * Tie-break on name descending so timestamped filenames stay deterministic
 * when two items share a modifiedAt.
 */
export function sortCandidatesNewestFirst(items: BackupItem[]): BackupItem[] {
  return items
    .filter((i) => isBackupCandidateName(i.name))
    .slice()
    .sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
}

/** Prefix + suffix for the pre-restore self-backup (grill Q11-A). */
const PRE_RESTORE_PREFIX = 'pre-restore-';
const PRE_RESTORE_SUFFIX = '.sqlite';

/** `pre-restore-<ts>.sqlite` — sandbox-local safety copy taken right before
 * the swap. `<ts>` is epoch ms: sortable, collision-free, not user-facing. */
export function preRestoreFileName(nowMs: number): string {
  return `${PRE_RESTORE_PREFIX}${nowMs}${PRE_RESTORE_SUFFIX}`;
}

/**
 * Keep exactly ONE pre-restore copy (the one about to be written): given the
 * existing file names in the pre-restore directory, return the ones to
 * delete. Non-matching names (other sandbox tenants) are never touched.
 */
export function selectStalePreRestoreFiles(existingNames: string[]): string[] {
  return existingNames.filter(
    (n) => n.startsWith(PRE_RESTORE_PREFIX) && n.endsWith(PRE_RESTORE_SUFFIX)
  );
}
