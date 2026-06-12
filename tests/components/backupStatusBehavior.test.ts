import {
  formatBackupSize,
  formatBackupTimestamp,
  tBackupErrorLine,
  tBackupEscalationLine,
  tBackupICloudUnavailableLine,
  tBackupLastLine,
  uploadStateFromItem,
} from '../../components/backup-status.behavior';
import { setLocale } from '../../src/i18n/strings';

/**
 * Slice 15 C3/C5 — Settings backup readout + escalation banner copy
 * (behavior-split pattern; settings.tsx / backup-failure-banner.tsx are
 * thin shells over these).
 */

afterEach(() => setLocale('zh'));

describe('uploadStateFromItem (R2 readout)', () => {
  it('fully uploaded → uploaded', () => {
    expect(uploadStateFromItem({ isUploaded: true, isUploading: false })).toBe('uploaded');
  });

  it('in-flight OR written-but-not-uploaded → uploading', () => {
    expect(uploadStateFromItem({ isUploaded: false, isUploading: true })).toBe('uploading');
    expect(uploadStateFromItem({ isUploaded: false, isUploading: null })).toBe('uploading');
  });

  it('no item / no metadata → unknown (claim nothing)', () => {
    expect(uploadStateFromItem(null)).toBe('unknown');
    expect(uploadStateFromItem({ isUploaded: null, isUploading: null })).toBe('unknown');
  });
});

describe('formatters', () => {
  it('formatBackupTimestamp renders local YYYY-MM-DD HH:mm with zero-pads', () => {
    // local-time constructor → expectation is timezone-independent
    const ms = new Date(2026, 4, 7, 14, 32).getTime(); // 2026-05-07 14:32 local
    expect(formatBackupTimestamp(ms)).toBe('2026-05-07 14:32');
    const ms2 = new Date(2026, 0, 3, 9, 5).getTime();
    expect(formatBackupTimestamp(ms2)).toBe('2026-01-03 09:05');
  });

  it('formatBackupSize picks B / KB / MB tiers', () => {
    expect(formatBackupSize(512)).toBe('512 B');
    expect(formatBackupSize(356 * 1024)).toBe('356 KB');
    expect(formatBackupSize(Math.round(1.2 * 1024 * 1024))).toBe('1.2 MB');
  });
});

describe('tBackupLastLine', () => {
  const ms = new Date(2026, 4, 7, 14, 32).getTime();

  it('zh: full line with size + uploaded ✓', () => {
    expect(
      tBackupLastLine({ lastSuccessAtMs: ms, sizeBytes: 4096, uploadState: 'uploaded' })
    ).toBe('上次備份：2026-05-07 14:32 · 4 KB · 已上傳 ✓');
  });

  it('zh: uploading suffix + size-less + never-yet forms', () => {
    expect(
      tBackupLastLine({ lastSuccessAtMs: ms, sizeBytes: null, uploadState: 'uploading' })
    ).toBe('上次備份：2026-05-07 14:32 · 上傳中…');
    expect(
      tBackupLastLine({ lastSuccessAtMs: ms, sizeBytes: 4096, uploadState: 'unknown' })
    ).toBe('上次備份：2026-05-07 14:32 · 4 KB');
    expect(
      tBackupLastLine({ lastSuccessAtMs: null, sizeBytes: null, uploadState: 'unknown' })
    ).toBe('上次備份：尚未備份');
  });

  it('en: localized forms', () => {
    setLocale('en');
    expect(
      tBackupLastLine({ lastSuccessAtMs: ms, sizeBytes: 4096, uploadState: 'uploaded' })
    ).toBe('Last backup: 2026-05-07 14:32 · 4 KB · Uploaded ✓');
    expect(
      tBackupLastLine({ lastSuccessAtMs: null, sizeBytes: null, uploadState: 'unknown' })
    ).toBe('Last backup: never');
  });
});

describe('tBackupErrorLine (C5 families)', () => {
  it('zh copy per family, undefined kind falls back to unknown (pre-C5 rows)', () => {
    expect(tBackupErrorLine('icloud-unavailable')).toBe('上次備份失敗：iCloud 無法使用。');
    expect(tBackupErrorLine('capacity')).toBe('上次備份失敗：iCloud 儲存空間不足。');
    expect(tBackupErrorLine('network')).toBe('上次備份失敗：網路錯誤。');
    expect(tBackupErrorLine('unknown')).toBe('上次備份失敗：發生未知錯誤。');
    expect(tBackupErrorLine(undefined)).toBe('上次備份失敗：發生未知錯誤。');
  });

  it('en copy', () => {
    setLocale('en');
    expect(tBackupErrorLine('capacity')).toBe('Last backup failed: not enough iCloud storage.');
  });
});

describe('escalation banner + iCloud warning copy', () => {
  it('zh banner with day count, singular/plural-safe en, null fallback', () => {
    expect(tBackupEscalationLine(3)).toBe('備份已連續 3 天未成功，請至設定檢查 iCloud。');
    expect(tBackupEscalationLine(null)).toBe('備份持續失敗，請至設定檢查 iCloud。');
    setLocale('en');
    expect(tBackupEscalationLine(1)).toBe(
      'Backups have been failing for 1 day — check iCloud in Settings.'
    );
    expect(tBackupEscalationLine(3)).toBe(
      'Backups have been failing for 3 days — check iCloud in Settings.'
    );
  });

  it('Q15-A permanent warning copy in both locales', () => {
    expect(tBackupICloudUnavailableLine()).toBe(
      '未啟用 iCloud 備份 — 請在系統設定登入 iCloud 並開啟 iCloud Drive。'
    );
    setLocale('en');
    expect(tBackupICloudUnavailableLine()).toBe(
      'iCloud backup is off — sign in to iCloud and enable iCloud Drive in system settings.'
    );
  });
});
