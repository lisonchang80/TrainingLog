/**
 * icloud-backup — JS wrapper for the local Expo module `IcloudBackup`
 * (slice 15, ADR-0011 + 2026-06-12 grill amendment, Q1-A).
 *
 * Thin bridge to the iCloud Drive ubiquity container; actual file copying
 * is done by callers via expo-file-system (see
 * `src/adapters/backup/icloudBackupAdapter.ts`).
 *
 * ## Degradation contract
 * Every function survives the native module being absent (jest node env,
 * pod not yet installed, non-iOS platform): catch → `false` / `null` / `[]`.
 * Callers MUST gate on `isICloudAvailable()` for an honest
 * "iCloud unavailable" signal — a degraded `[]` from `listBackupItems()` is
 * indistinguishable from a genuinely empty container by design (the
 * availability check is the disambiguator, mirroring ADR-0011's "未登
 * iCloud → 警告但放行" UX).
 *
 * ## Native module load
 * Lazily required so importing this file never throws under
 * `testEnvironment: node` (same pattern as
 * `src/adapters/healthkit/permission.ts`'s lazy Kingstinct require).
 */

/** Cloud state of one item in the ubiquity container Documents/ scope. */
export interface ICloudBackupItem {
  /** File name, e.g. `TrainingLog-backup-2026-06-13T013000Z.sqlite`. */
  name: string;
  /** Absolute `file://` URL inside the ubiquity container. */
  url: string | null;
  /** File size in bytes; null while only cloud metadata is known. */
  sizeBytes: number | null;
  /** Last content change, epoch ms; null when the system has no value. */
  modifiedAtMs: number | null;
  /**
   * True once the item is fully uploaded to iCloud servers. THE signal for
   * the Settings「已上傳✓ / 上傳中…」readout (prep-report R2: written-to-
   * container does NOT mean safely-in-cloud). Null when unknown.
   */
  isUploaded: boolean | null;
  /** True while an upload is in flight. Null when unknown. */
  isUploading: boolean | null;
  /** Upload progress 0–100 while `isUploading`. Null when unknown. */
  percentUploaded: number | null;
  /**
   * Local availability: 'current' = local copy is latest, 'downloaded' =
   * local copy exists but a newer cloud version exists, 'not-downloaded' =
   * cloud-only placeholder (needs `startDownload` before it can be read).
   * Null when unknown.
   */
  downloadingStatus: 'current' | 'downloaded' | 'not-downloaded' | string | null;
}

/** Raw shape from Swift — optional attributes are omitted, never NSNull. */
type RawBackupItem = Partial<{
  name: string;
  url: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isUploaded: boolean;
  isUploading: boolean;
  percentUploaded: number;
  downloadingStatus: string;
}>;

interface IcloudBackupNativeModule {
  isICloudAvailable(): boolean;
  getUbiquityContainerUrl(): Promise<string | null>;
  listBackupItems(): Promise<RawBackupItem[]>;
  startDownload(relativePath: string): Promise<void>;
}

function getNativeModule(): IcloudBackupNativeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    return requireOptionalNativeModule('IcloudBackup') ?? null;
  } catch {
    // expo-modules-core itself is unimportable (jest node env).
    return null;
  }
}

/**
 * True when an iCloud account is signed in and iCloud Drive is enabled for
 * this app (`ubiquityIdentityToken != nil`). Synchronous and cheap.
 * False when iCloud is off OR the native module is unavailable.
 */
export function isICloudAvailable(): boolean {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return mod.isICloudAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Resolves the ubiquity container ROOT as a `file://` URL string (backups
 * live under its `Documents/` child — that subdirectory is what iCloud
 * Drive / the Files app exposes). Null when iCloud is unavailable or the
 * module is missing. First call after install/sign-in may take a moment
 * (container provisioning happens off the main thread natively).
 */
export async function getUbiquityContainerUrl(): Promise<string | null> {
  const mod = getNativeModule();
  if (!mod) return null;
  try {
    return (await mod.getUbiquityContainerUrl()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Lists items in the ubiquitous Documents scope with cloud state attached
 * (NSMetadataQuery — sees cloud-only placeholders a plain directory listing
 * would misreport as `.<name>.icloud` files). Capped by a native 10s
 * watchdog that resolves with a partial snapshot rather than hanging.
 *
 * Degrades to `[]` when the module is missing or the query fails — gate on
 * `isICloudAvailable()` to distinguish "no backups" from "no iCloud".
 */
export async function listBackupItems(): Promise<ICloudBackupItem[]> {
  const mod = getNativeModule();
  if (!mod) return [];
  try {
    const raw = await mod.listBackupItems();
    return raw
      .filter((r): r is RawBackupItem & { name: string } => typeof r.name === 'string')
      .map((r) => ({
        name: r.name,
        url: r.url ?? null,
        sizeBytes: r.sizeBytes ?? null,
        modifiedAtMs: r.modifiedAtMs ?? null,
        isUploaded: r.isUploaded ?? null,
        isUploading: r.isUploading ?? null,
        percentUploaded: r.percentUploaded ?? null,
        downloadingStatus: r.downloadingStatus ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Triggers download of a cloud-only item. `relativePath` is relative to the
 * container ROOT — e.g. `Documents/TrainingLog-backup-….sqlite` — using the
 * LOGICAL name (never the `.icloud` placeholder name). Returns true when
 * the request was accepted; completion is observed by polling
 * `listBackupItems()` for `downloadingStatus === 'current' | 'downloaded'`.
 * False when iCloud / the module is unavailable or the request fails.
 */
export async function startDownload(relativePath: string): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    await mod.startDownload(relativePath);
    return true;
  } catch {
    return false;
  }
}
