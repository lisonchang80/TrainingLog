/**
 * backupErrors — pure classification of backup-pipeline failures
 * (slice 15 C5; ADR-0011 §7 + 2026-06-12 grill amendment Q14-B).
 *
 * The ADR's escalation copy distinguishes four user-meaningful failure
 * families: 未登入 iCloud / 容量 / 網路 / 未知. The pipeline itself throws
 * typed errors (`BackupSnapshotError` from expoDatabase,
 * `BackupUploadError` from icloudBackupAdapter) whose `kind` describes the
 * STEP that failed, not the user-facing cause — e.g. a `copy-failed` can be
 * either a full iCloud quota or a transient I/O hiccup, distinguishable
 * only from the underlying NSError text. This module maps both layers onto
 * the 4 ADR families.
 *
 * Layering: pure domain — no adapter imports (the adapter error classes are
 * detected STRUCTURALLY via their `kind` discriminant so this module never
 * depends on `src/adapters/**`). No I/O, no Date.now(); fully jest-covered
 * under node env.
 */

/** ADR-0011 Q14.7 / C5 — the four user-facing failure families. */
export type BackupErrorKind =
  /** 未登入 iCloud / iCloud Drive off（Q15-A 永久紅警示路徑）. */
  | 'icloud-unavailable'
  /** iCloud / 磁碟容量不足. */
  | 'capacity'
  /** 網路錯誤（離線、逾時、連線中斷）. */
  | 'network'
  /** 其他（本地 snapshot 失敗、I/O、未識別錯誤）. */
  | 'unknown';

export interface ClassifiedBackupError {
  kind: BackupErrorKind;
  /** Diagnostic message (English source) persisted to backup metadata. */
  message: string;
}

/**
 * Capacity-failure fingerprints. Cocoa surfaces quota/disk exhaustion as
 * `NSFileWriteOutOfSpaceError` (NSCocoaErrorDomain 640) with descriptions
 * like “You can’t save the file … because the volume … is out of space”;
 * POSIX-level failures say “No space left on device” (ENOSPC).
 */
const CAPACITY_PATTERN =
  /out of space|no space|not enough space|insufficient storage|insufficient space|disk full|storage full|quota|NSFileWriteOutOfSpace/i;

/**
 * Network-failure fingerprints. Ubiquity writes mostly fail LOCALLY only
 * when the container is gone (covered by 'icloud-unavailable'), but
 * NSURLErrorDomain texts can still surface through the file coordinator —
 * “The Internet connection appears to be offline”, “The request timed
 * out”, “A server with the specified hostname could not be found”…
 */
const NETWORK_PATTERN =
  /network|internet|offline|time(d)? out|timeout|connection (lost|failed|appears)|cannot connect|could not connect|host(name)? could not|unreachable|NSURLError/i;

/** `kind` discriminant values carried by `BackupUploadError` (adapter layer). */
const UPLOAD_UNAVAILABLE_KIND = 'icloud-unavailable';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Map any failure thrown by the backup pipeline (snapshot / upload / metadata
 * write) onto the four ADR families.
 *
 * Precedence:
 *   1. A `BackupUploadError` whose `kind` is `'icloud-unavailable'` is the
 *      authoritative not-signed-in signal (the adapter checked the container
 *      URL directly) → 'icloud-unavailable'.
 *   2. Message fingerprints: capacity, then network. Capacity wins ties —
 *      a “network volume out of space” is actionable as capacity.
 *   3. Everything else → 'unknown' (includes `BackupSnapshotError`, whose
 *      kinds are local sqlite3_backup / quick_check failures with no
 *      user-side remedy beyond retrying).
 */
export function classifyBackupError(e: unknown): ClassifiedBackupError {
  const message = errorMessage(e);

  const kindProp = (e as { kind?: unknown } | null | undefined)?.kind;
  if (kindProp === UPLOAD_UNAVAILABLE_KIND) {
    return { kind: 'icloud-unavailable', message };
  }

  if (CAPACITY_PATTERN.test(message)) return { kind: 'capacity', message };
  if (NETWORK_PATTERN.test(message)) return { kind: 'network', message };

  return { kind: 'unknown', message };
}
