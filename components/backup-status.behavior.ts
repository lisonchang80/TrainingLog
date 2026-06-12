/**
 * backup-status.behavior — pure decision/format logic for the Settings
 * backup section + the C5 home-screen escalation banner (slice 15 C3/C5;
 * rn-component-behavior-split pattern so it's jest-covered under node env).
 *
 * Dynamic i18n lives here in function form (per src/i18n/dynamic.ts
 * convention — kept out of dynamic.ts to keep this slice's parallel-agent
 * file surface self-contained, same as restore-gate.behavior.ts).
 */

import type { BackupErrorKind } from '../src/domain/backup/backupErrors';
import { formatLocalYmdFromMs } from '../src/domain/date/localYmd';
import { getLocale } from '../src/i18n/strings';

const isEn = (): boolean => getLocale() === 'en';

// ---------------------------------------------------------------------------
// Upload-state readout (prep-report R2: written-to-container ≠ safely in
// cloud — surface the NSMetadataQuery upload state honestly).
// ---------------------------------------------------------------------------

export type BackupUploadState = 'uploaded' | 'uploading' | 'unknown';

/**
 * Collapse the newest cloud item's NSMetadataQuery attributes into the
 * readout state. `isUploaded === false` WITHOUT an active upload still
 * reads as 'uploading' — the file is queued for iCloud, which is exactly
 * the “don't trust it's safe yet” signal R2 wants surfaced. Null item
 * (listing unavailable / still indexing) → 'unknown' (no suffix shown
 * rather than a false claim either way).
 */
export function uploadStateFromItem(
  item: { isUploaded: boolean | null; isUploading: boolean | null } | null
): BackupUploadState {
  if (!item) return 'unknown';
  if (item.isUploaded === true) return 'uploaded';
  if (item.isUploading === true || item.isUploaded === false) return 'uploading';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** Local-timezone `YYYY-MM-DD HH:mm` (ADR-0011 §8 mock: 「上次備份：
 * 2026-05-07 14:32」— minute precision, the date-only form is too coarse
 * for a “did my backup just run?” check). */
export function formatBackupTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatLocalYmdFromMs(ms)} ${hh}:${mm}`;
}

/** Human file size: <1 KB → B, <1 MB → integer KB, else 1-decimal MB. */
export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Readout / warning lines
// ---------------------------------------------------------------------------

/** 「上次備份：2026-05-07 14:32 · 1.2 MB · 已上傳 ✓」/ never-yet form. */
export function tBackupLastLine(args: {
  lastSuccessAtMs: number | null;
  sizeBytes: number | null;
  uploadState: BackupUploadState;
}): string {
  const { lastSuccessAtMs, sizeBytes, uploadState } = args;
  const prefix = isEn() ? 'Last backup: ' : '上次備份：';
  if (lastSuccessAtMs == null) {
    return prefix + (isEn() ? 'never' : '尚未備份');
  }
  const parts = [formatBackupTimestamp(lastSuccessAtMs)];
  if (sizeBytes != null) parts.push(formatBackupSize(sizeBytes));
  if (uploadState === 'uploaded') parts.push(isEn() ? 'Uploaded ✓' : '已上傳 ✓');
  else if (uploadState === 'uploading') parts.push(isEn() ? 'Uploading…' : '上傳中…');
  return prefix + parts.join(' · ');
}

/** C5 — Settings red error line for the unhealed failure, by family. */
export function tBackupErrorLine(kind: BackupErrorKind | undefined): string {
  const prefix = isEn() ? 'Last backup failed: ' : '上次備份失敗：';
  switch (kind) {
    case 'icloud-unavailable':
      return prefix + (isEn() ? 'iCloud is unavailable.' : 'iCloud 無法使用。');
    case 'capacity':
      return prefix + (isEn() ? 'not enough iCloud storage.' : 'iCloud 儲存空間不足。');
    case 'network':
      return prefix + (isEn() ? 'network error.' : '網路錯誤。');
    case 'unknown':
    default:
      return prefix + (isEn() ? 'an unknown error occurred.' : '發生未知錯誤。');
  }
}

/** Q15-A permanent red warning (not signed in to iCloud / Drive off). */
export function tBackupICloudUnavailableLine(): string {
  return isEn()
    ? 'iCloud backup is off — sign in to iCloud and enable iCloud Drive in system settings.'
    : '未啟用 iCloud 備份 — 請在系統設定登入 iCloud 並開啟 iCloud Drive。';
}

/** C5 home-screen banner copy.「備份已連續 N 天未成功」(days may be null
 * when the anchor is missing — fall back to the generic form). */
export function tBackupEscalationLine(days: number | null): string {
  if (isEn()) {
    return days != null
      ? `Backups have been failing for ${days} day${days === 1 ? '' : 's'} — check iCloud in Settings.`
      : 'Backups are failing — check iCloud in Settings.';
  }
  return days != null
    ? `備份已連續 ${days} 天未成功，請至設定檢查 iCloud。`
    : '備份持續失敗，請至設定檢查 iCloud。';
}
