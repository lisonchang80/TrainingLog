/**
 * icloudBackupAdapter — ships a verified DB snapshot into the iCloud Drive
 * ubiquity container and rotates old backups (slice 15 C2; ADR-0011 +
 * 2026-06-12 grill amendment Q4-B/Q5-B).
 *
 * Composition: `modules/icloud-backup` (native thin bridge — container URL +
 * NSMetadataQuery listing) + expo-file-system (the actual file moving; its
 * new File/Directory API defers permission checks on paths outside the
 * sandbox to the OS, so a `file://` ubiquity URL is writable from JS).
 *
 * ## Write-then-promote (grill Q5-B — hard spec)
 *   1. copy the snapshot to `Documents/<timestamped name>` (a NEW name —
 *      nothing existing is touched)
 *   2. verify the copy landed (exists + size matches the snapshot)
 *   3. only THEN delete the oldest backups beyond the keep-2 window
 * Any failure in 1–2 aborts before any deletion → at least one complete
 * old backup always survives. Deletion failures in 3 are NON-fatal — a
 * surplus file is harmless and the next run re-plans the rotation.
 *
 * ## Dependency injection
 * Mirrors `src/services/healthkitSessionSync.ts`: every collaborator is
 * individually injectable with production defaults; expo-file-system is
 * lazy-required inside the default `fs` factory so importing this module
 * never touches native code (jest node env safe).
 */

import {
  getUbiquityContainerUrl,
  listBackupItems,
  type ICloudBackupItem,
} from '../../../modules/icloud-backup';
import {
  makeBackupFileName,
  parseBackupFileName,
  planBackupRotation,
} from '../../domain/backup/backupPolicy';

/** R1 sidecar suffixes — cleared defensively at every copy/delete site. */
const SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'] as const;

/** Snapshot temp files (`createBackupSnapshot`) live next to the live DB. */
const SNAPSHOT_PREFIX = 'backup-snapshot-';

/**
 * Minimal synchronous fs facade over expo-file-system's new File/Directory
 * API (all these operations are sync in v19). Injectable for tests.
 */
export interface BackupFs {
  /** True when a file exists at the URI. */
  fileExists(uri: string): boolean;
  /** File size in bytes, or null when unknown / missing. */
  fileSize(uri: string): number | null;
  /** Copy a file (throws on failure). */
  copyFile(srcUri: string, destUri: string): void;
  /** Delete a file (throws on failure; caller decides fatality). */
  deleteFile(uri: string): void;
  /** Create a directory (idempotent, intermediates allowed). */
  ensureDir(uri: string): void;
  /** Names of entries directly inside a directory ([] when missing). */
  listFileNames(dirUri: string): string[];
}

/** Production fs — lazy expo-file-system require (jest-safe import). */
export function createExpoBackupFs(): BackupFs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Directory } = require('expo-file-system') as typeof import('expo-file-system');
  return {
    fileExists: (uri) => new File(uri).exists,
    fileSize: (uri) => {
      try {
        const f = new File(uri);
        return f.exists ? (f.size ?? null) : null;
      } catch {
        return null;
      }
    },
    copyFile: (srcUri, destUri) => {
      new File(srcUri).copy(new File(destUri));
    },
    deleteFile: (uri) => {
      new File(uri).delete();
    },
    ensureDir: (uri) => {
      new Directory(uri).create({ intermediates: true, idempotent: true });
    },
    listFileNames: (dirUri) => {
      try {
        const dir = new Directory(dirUri);
        if (!dir.exists) return [];
        return dir.list().map((entry) => entry.name);
      } catch {
        return [];
      }
    },
  };
}

export type BackupUploadErrorKind =
  /** No signed-in iCloud account / iCloud Drive off / module missing. */
  | 'icloud-unavailable'
  /** Copy into the container failed (capacity, I/O, permissions…). */
  | 'copy-failed'
  /** The copy "succeeded" but the landed file is missing/size-mismatched. */
  | 'verify-failed';

export class BackupUploadError extends Error {
  constructor(
    readonly kind: BackupUploadErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'BackupUploadError';
  }
}

export interface BackupUploadResult {
  /** Timestamped cloud file name (Q4-B shape). */
  fileName: string;
  /** Bytes uploaded (null when the fs could not report a size). */
  sizeBytes: number | null;
  /** Old backups removed by rotation (oldest first). */
  deletedNames: string[];
  /**
   * Rotation deletions that did NOT happen (non-fatal; re-planned next run).
   * Includes both genuine delete throws AND cloud-only (not-downloaded)
   * backups JS cannot evict — see audit R-02 in `uploadBackupSnapshot`.
   */
  failedDeletes: string[];
}

export interface UploadBackupSnapshotDeps {
  /** Defaults to the native module wrapper. */
  getUbiquityContainerUrl?: () => Promise<string | null>;
  /** Defaults to the native module wrapper (NSMetadataQuery listing). */
  listBackupItems?: () => Promise<ICloudBackupItem[]>;
  /** Defaults to {@link createExpoBackupFs}. */
  fs?: BackupFs;
}

/** file:// URI for a local filesystem path (idempotent for URIs). */
function toFileUri(pathOrUri: string): string {
  if (pathOrUri.startsWith('file://')) return pathOrUri;
  // encodeURI keeps '/' but escapes spaces etc. (simulator paths can
  // contain spaces; the container URL from native is already encoded).
  return `file://${encodeURI(pathOrUri)}`;
}

function joinUri(baseUri: string, ...segments: string[]): string {
  const base = baseUri.endsWith('/') ? baseUri.slice(0, -1) : baseUri;
  return [base, ...segments].join('/');
}

function deleteSidecarsBestEffort(fs: BackupFs, fileUri: string): void {
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecar = `${fileUri}${suffix}`;
    try {
      if (fs.fileExists(sidecar)) fs.deleteFile(sidecar);
    } catch {
      // best-effort hygiene — never escalate
    }
  }
}

/**
 * Upload a verified snapshot (from `createBackupSnapshot`) to
 * `<container>/Documents/` under a fresh Q4-B timestamped name, then rotate
 * down to the newest 2 backups. Owns deleting the snapshot temp file (and
 * sweeping stale `backup-snapshot-*` leftovers from crashed earlier runs).
 *
 * Throws {@link BackupUploadError}; the caller (C3 service) records
 * success/failure via `recordBackupSuccess` / `recordBackupFailure`.
 */
export async function uploadBackupSnapshot(
  args: { snapshotPath: string; nowMs?: number },
  deps: UploadBackupSnapshotDeps = {}
): Promise<BackupUploadResult> {
  const getContainerUrl = deps.getUbiquityContainerUrl ?? getUbiquityContainerUrl;
  const listItems = deps.listBackupItems ?? listBackupItems;
  const fs = deps.fs ?? createExpoBackupFs();
  const nowMs = args.nowMs ?? Date.now();

  const snapshotUri = toFileUri(args.snapshotPath);

  // -- resolve destination ---------------------------------------------------
  const containerUrl = await getContainerUrl();
  if (!containerUrl) {
    throw new BackupUploadError(
      'icloud-unavailable',
      'iCloud ubiquity container unavailable (not signed in / iCloud Drive off)'
    );
  }
  // Backups MUST live under Documents/ — that subtree is what
  // NSUbiquitousContainerIsDocumentScopePublic exposes in iCloud Drive.
  const documentsUri = joinUri(containerUrl, 'Documents');
  const fileName = makeBackupFileName(nowMs);
  const destUri = joinUri(documentsUri, fileName);

  // -- step 1: write the NEW file (nothing existing is touched) --------------
  // R1: never let a stale sidecar travel with (or shadow) a database file.
  deleteSidecarsBestEffort(fs, snapshotUri);
  deleteSidecarsBestEffort(fs, destUri);
  try {
    fs.ensureDir(documentsUri);
    fs.copyFile(snapshotUri, destUri);
  } catch (e) {
    throw new BackupUploadError('copy-failed', `copy into container failed: ${String(e)}`);
  }

  // -- step 2: verify the landed copy ----------------------------------------
  const snapshotSize = fs.fileSize(snapshotUri);
  const landedSize = fs.fileSize(destUri);
  const landed =
    fs.fileExists(destUri) &&
    landedSize != null &&
    landedSize > 0 &&
    (snapshotSize == null || landedSize === snapshotSize);
  if (!landed) {
    try {
      fs.deleteFile(destUri); // remove the partial; old backups are intact
    } catch {
      // best-effort — a partial under a unique name can't shadow anything
    }
    throw new BackupUploadError(
      'verify-failed',
      `landed copy failed verification (exists=${fs.fileExists(destUri)}, size=${String(
        landedSize
      )}, expected=${String(snapshotSize)})`
    );
  }

  // -- step 3: promote — delete the oldest beyond keep-2 (non-fatal) ---------
  // The metadata query may not index the fresh write yet, so the new name is
  // appended manually (planBackupRotation dedupes).
  let listedNames: { name: string }[] = [];
  try {
    listedNames = (await listItems()).map((item) => ({ name: item.name }));
  } catch {
    // listing failure → skip rotation this run; surplus is harmless
  }
  const plan = planBackupRotation([...listedNames, { name: fileName }]);

  const deletedNames: string[] = [];
  const failedDeletes: string[] = [];
  for (const name of plan.toDelete) {
    const targetUri = joinUri(documentsUri, name);
    try {
      if (fs.fileExists(targetUri)) {
        // Local copy present → real delete (touches the cloud item).
        fs.deleteFile(targetUri);
        deleteSidecarsBestEffort(fs, targetUri);
        deletedNames.push(name);
      } else {
        // Audit R-02: the logical name doesn't exist locally — this is a
        // cloud-only (not-downloaded) backup, materialized only as a
        // `.<name>.icloud` placeholder. `fileExists` (FileManager
        // fileExists(atPath:)) reports false for the logical path, so a
        // bare `if (exists) delete` would SKIP the delete yet still report
        // success → keep-2 never converges and old cloud backups accumulate
        // forever across devices. Try deleting the placeholder instead; if
        // even that is absent, we genuinely cannot evict the cloud item from
        // JS (needs native removeUbiquitousItem) → report it honestly in
        // failedDeletes, NOT deletedNames, so the next run re-plans it.
        const placeholderUri = joinUri(documentsUri, `.${name}.icloud`);
        if (fs.fileExists(placeholderUri)) {
          fs.deleteFile(placeholderUri);
          deletedNames.push(name);
        } else {
          failedDeletes.push(name);
        }
      }
    } catch {
      failedDeletes.push(name); // non-fatal (Q5-B); re-planned next run
    }
  }

  // -- cleanup: snapshot temp + stale leftovers from crashed runs ------------
  cleanupSnapshotTempBestEffort(fs, snapshotUri);

  return { fileName, sizeBytes: landedSize, deletedNames, failedDeletes };
}

/**
 * Delete the snapshot temp file + sidecars, then sweep any OTHER stale
 * `backup-snapshot-*` files in the same directory (leftovers of runs that
 * crashed between snapshot and upload — R5 window). All best-effort.
 */
function cleanupSnapshotTempBestEffort(fs: BackupFs, snapshotUri: string): void {
  try {
    if (fs.fileExists(snapshotUri)) fs.deleteFile(snapshotUri);
  } catch {
    // best-effort
  }
  deleteSidecarsBestEffort(fs, snapshotUri);

  const lastSlash = snapshotUri.lastIndexOf('/');
  if (lastSlash <= 'file://'.length) return;
  const dirUri = snapshotUri.slice(0, lastSlash);
  for (const name of fs.listFileNames(dirUri)) {
    if (!name.startsWith(SNAPSHOT_PREFIX)) continue;
    try {
      fs.deleteFile(joinUri(dirUri, name));
    } catch {
      // best-effort
    }
  }
}

/**
 * Settings readout helper (C3 consumes): the newest cloud backup with its
 * upload state, or null when none / iCloud unavailable. Foreign files are
 * ignored (same membership rule as rotation: the Q4-B name must parse).
 */
export async function getLatestCloudBackup(
  deps: Pick<UploadBackupSnapshotDeps, 'listBackupItems'> = {}
): Promise<ICloudBackupItem | null> {
  const listItems = deps.listBackupItems ?? listBackupItems;
  try {
    const items = await listItems();
    let latest: { item: ICloudBackupItem; ts: number } | null = null;
    for (const item of items) {
      const ts = parseBackupFileName(item.name);
      if (ts == null) continue;
      if (!latest || ts > latest.ts) latest = { item, ts };
    }
    return latest?.item ?? null;
  } catch {
    return null;
  }
}
