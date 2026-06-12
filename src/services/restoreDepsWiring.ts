/**
 * Restore deps wiring — slice 15 morning integration (2026-06-13).
 *
 * The restore engine (`restoreService.ts`, agent B) is 100 % dependency-
 * injected and was written in a worktree that deliberately did NOT import
 * the native bridge (`modules/icloud-backup`, agent A) nor expo APIs. This
 * module is the single production wiring point the two halves agreed on:
 * it adapts agent A's JS wrapper to agent B's `ICloudBackupModuleLike`
 * contract and registers everything via `setRestoreDeps` once at boot
 * (`app/_layout.tsx`). Until that call, RestoreGate + the Settings restore
 * entry stay inert by design.
 *
 * Contract gaps bridged here (wrapper ≠ contract, both shipped overnight):
 *   - `isICloudAvailable` is sync in the wrapper, async in the contract.
 *   - wrapper items carry nullable cloud metadata (`modifiedAtMs`,
 *     `downloadingStatus`, …); the contract wants concrete `BackupItem`s.
 *   - wrapper `startDownload` only REQUESTS the download (resolves boolean);
 *     the contract wants "materialized locally, give me a readable path" —
 *     so we poll `listBackupItems` until the item reports a local copy.
 *     `restoreService` already races the call against DOWNLOAD_TIMEOUT_MS;
 *     the internal cap below just stops the orphaned poll loop afterwards.
 */

import {
  getUbiquityContainerUrl,
  isICloudAvailable,
  listBackupItems,
  startDownload,
  type ICloudBackupItem,
} from '../../modules/icloud-backup';
import type { BackupItem } from '../domain/backup/restoreRules';
import {
  setRestoreDeps,
  DOWNLOAD_TIMEOUT_MS,
  type ICloudBackupModuleLike,
  type RestoreFileOps,
} from './restoreService';

// ---------------------------------------------------------------------------
// Pure mapping (exported for jest)
// ---------------------------------------------------------------------------

/** Local copy present and readable (NSMetadataQuery download state). */
function hasLocalCopy(status: ICloudBackupItem['downloadingStatus']): boolean {
  return status === 'current' || status === 'downloaded';
}

/**
 * Wrapper items → engine `BackupItem`s. Nameless rows are already filtered
 * by the wrapper; nullable metadata degrades to conservative defaults
 * (0 size / epoch-0 mtime sort last via newest-first ordering, unknown
 * upload state counts as not-yet-uploaded).
 */
export function toRestoreBackupItems(items: ICloudBackupItem[]): BackupItem[] {
  return items.map((i) => ({
    name: i.name,
    sizeBytes: i.sizeBytes ?? 0,
    modifiedAt: i.modifiedAtMs ?? 0,
    isUploaded: i.isUploaded ?? false,
    isDownloaded: hasLocalCopy(i.downloadingStatus),
  }));
}

/** `file://` URI of `name` inside the ubiquity Documents/ scope. */
export function containerDocumentUri(containerRootUrl: string, name: string): string {
  const root = containerRootUrl.endsWith('/')
    ? containerRootUrl.slice(0, -1)
    : containerRootUrl;
  return `${root}/Documents/${name}`;
}

// ---------------------------------------------------------------------------
// Download materialization (request + poll)
// ---------------------------------------------------------------------------

interface MaterializeOps {
  startDownload(relativePath: string): Promise<boolean>;
  listBackupItems(): Promise<ICloudBackupItem[]>;
  getUbiquityContainerUrl(): Promise<string | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Ensure `name` has a local copy, then resolve its readable path (the item's
 * own url when known, else constructed from the container root). Exported
 * with injectable ops for jest; production binds the wrapper functions.
 */
export async function materializeBackup(
  name: string,
  ops: MaterializeOps,
  capMs: number = DOWNLOAD_TIMEOUT_MS
): Promise<string> {
  const requested = await ops.startDownload(`Documents/${name}`);
  if (!requested) {
    throw new Error(`startDownload rejected for ${name} (iCloud unavailable?)`);
  }
  const deadline = ops.now() + capMs;
  for (;;) {
    const item = (await ops.listBackupItems()).find((i) => i.name === name);
    if (item && hasLocalCopy(item.downloadingStatus)) {
      if (item.url) return item.url;
      const root = await ops.getUbiquityContainerUrl();
      if (!root) throw new Error('ubiquity container url unavailable after download');
      return containerDocumentUri(root, name);
    }
    if (ops.now() >= deadline) {
      throw new Error(`download of ${name} did not materialize within ${capMs}ms`);
    }
    await ops.sleep(500);
  }
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** expo-file-system's File/Directory want `file://` URIs; expo-sqlite hands
 * out plain POSIX paths (`liveDatabasePath`, `databasePath`). Normalize. */
function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Lazy expo-file-system require — same jest-safe pattern as the backup
 * adapter's production fs (icloudBackupAdapter.ts). */
function buildFileOps(): RestoreFileOps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Directory } = require('expo-file-system') as typeof import('expo-file-system');
  return {
    exists: async (path) => new File(toFileUri(path)).exists,
    copy: async (src, dst) => {
      const dstUri = toFileUri(dst);
      // Audit R-01: on a true fresh install the live DB's parent directory
      // (Documents/SQLite/) does not exist yet — expo-sqlite only creates it
      // on first openDatabase(), which is exactly what RestoreGate blocks.
      // FileManager.copyItem does NOT create intermediates, so copy-in would
      // throw NSFileNoSuchFileError and the gate's restore could never
      // succeed. Ensure the destination's parent exists first.
      const slash = dstUri.lastIndexOf('/');
      if (slash > 'file://'.length) {
        new Directory(dstUri.slice(0, slash)).create({ intermediates: true, idempotent: true });
      }
      new File(toFileUri(src)).copy(new File(dstUri));
    },
    remove: async (path) => {
      const f = new File(toFileUri(path));
      if (f.exists) f.delete();
    },
    listDir: async (dir) => {
      const d = new Directory(toFileUri(dir));
      if (!d.exists) return [];
      return d.list().map((entry) => entry.name);
    },
  };
}

const productionICloud: ICloudBackupModuleLike = {
  isICloudAvailable: async () => isICloudAvailable(),
  getUbiquityContainerUrl: () => getUbiquityContainerUrl(),
  listBackupItems: async () => toRestoreBackupItems(await listBackupItems()),
  startDownload: (name) =>
    materializeBackup(name, {
      startDownload,
      listBackupItems,
      getUbiquityContainerUrl,
      sleep,
      now: Date.now,
    }),
};

/**
 * Register production restore deps. Called once from `app/_layout.tsx`
 * module scope; any throw (native module absent, jest node env) leaves the
 * registry null so both restore entry points degrade to inert — never block
 * boot over the backup feature.
 */
export function wireRestoreDeps(): void {
  try {
    // Lazy — expoDatabase imports expo-sqlite at module scope, which is
    // unresolvable under jest's node env (this file's pure exports above
    // must stay importable by tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoDb =
      require('../adapters/sqlite/expoDatabase') as typeof import('../adapters/sqlite/expoDatabase');
    const liveDbPath = expoDb.liveDatabasePath();
    setRestoreDeps({
      icloud: productionICloud,
      fileOps: buildFileOps(),
      dbOps: {
        openCandidate: expoDb.openCandidateDatabase,
        closeAndResetLive: expoDb.closeAndResetForRestore,
        reopenLive: expoDb.openDatabase,
      },
      paths: {
        liveDbPath,
        preRestoreDir: liveDbPath.slice(0, liveDbPath.lastIndexOf('/')),
      },
    });
  } catch (e) {
    console.warn('[restore] deps wiring failed — restore entry points stay inert:', e);
  }
}
