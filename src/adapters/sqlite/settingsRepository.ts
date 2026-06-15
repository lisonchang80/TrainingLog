import type { Database } from '../../db/types';
import type { BackupErrorKind } from '../../domain/backup/backupErrors';
import type { UnitPreference } from '../../domain/body/types';

/**
 * Generic key/value store backed by `app_settings(key, value)`.
 *
 * Values are JSON-encoded so callers can persist arbitrary primitives /
 * objects without schema changes. Slice 7 uses it for `unit_preference`;
 * slice 15 (Backup) will reuse it for backup mode and last-export timestamp.
 */

const UNIT_KEY = 'unit_preference';
const AUTO_POPUP_REST_TIMER_KEY = 'auto_popup_rest_timer';

/**
 * Slice 16 (App Mode) — ADR-0026. App-wide presentation mode:
 *   'plan'    — the full app (programs, intensities, planned-training). Default.
 *   'minimal' — 「極簡模式」: the entire 計劃 (program) concept is hidden;
 *               starting a template always resolves to 通用 (program=NULL,
 *               sub_tag=NULL → existing variant resolver, alert silenced).
 *
 * Stored as a plain string enum in `app_settings` (no migration — getAppMode
 * defaults to 'plan' when the key is absent, so fresh installs keep today's
 * behaviour). Surfaced reactively to the whole tree via AppModeProvider /
 * useAppMode (SQLite-backed; mirrors ThemeProvider but inside DatabaseProvider).
 */
const APP_MODE_KEY = 'app_mode';

/**
 * Slice 13b — local-only flag tracking whether the HealthKit permission
 * dialog has been shown to the user at least once. iOS's HK API is
 * one-shot: once the system dialog has been displayed for an app the
 * same `initHealthKit()` call no longer triggers it (the user has to go
 * to Settings.app → Privacy → Health → TrainingLog to change their
 * answer). We persist this flag so the Settings 「Apple Health 整合」
 * section can switch between the "Connect" CTA and the "已連結 / Open
 * System Settings" view across launches.
 *
 * Distinct from `DEV_SIMULATE_HK_GRANTED_KEY` (Phase A dev toggle that
 * gets deleted in B3 along with its repo getters/setters).
 */
const HK_AUTHORIZATION_REQUESTED_KEY = 'hk_authorization_requested';

export async function getSetting<T>(
  db: Database,
  key: string
): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    key
  );
  if (!row || row.value == null) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting<T>(
  db: Database,
  key: string,
  value: T
): Promise<void> {
  const encoded = JSON.stringify(value);
  // INSERT OR REPLACE writes the new value while preserving primary key
  // semantics — first call on a key inserts, subsequent calls overwrite.
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`,
    key,
    encoded
  );
}

/**
 * Remove an `app_settings` row outright.
 *
 * Used by Card 12R `editSnapshotPersistence` — commit / discard /
 * focus-restore / discardSession-cascade paths all need to drop the
 * `session_edit_snapshot_${id}` key cleanly (vs writing `"null"`,
 * which would leave a phantom row + confuse later getSetting callers).
 *
 * No-op when the key doesn't exist (DELETE is idempotent).
 */
export async function deleteSetting(
  db: Database,
  key: string
): Promise<void> {
  await db.runAsync(`DELETE FROM app_settings WHERE key = ?`, key);
}

/** Returns the user's unit preference, defaulting to 'kg' when unset. */
export async function getUnitPreference(db: Database): Promise<UnitPreference> {
  const v = await getSetting<UnitPreference>(db, UNIT_KEY);
  return v === 'lb' ? 'lb' : 'kg';
}

export async function setUnitPreference(
  db: Database,
  unit: UnitPreference
): Promise<void> {
  await setSetting<UnitPreference>(db, UNIT_KEY, unit);
}

/**
 * Read the `auto_popup_rest_timer` app setting (ADR-0019 Q2.3 a, slice 10d).
 *
 * v016 migration seeds the key with raw string `"1"` (not JSON-encoded),
 * so we tolerate both shapes here:
 *   - JSON-encoded `1` / `true` → ON
 *   - Raw `"1"` (v016 seed shape) → ON
 *   - JSON `0` / `false` / missing → OFF
 *
 * Default ON when the key is missing — matches the v016 seed intent and
 * keeps fresh installs aligned with the ADR-0019 § Q2.3 (a) "預設 ON" rule.
 */
export async function getAutoPopupRestTimer(db: Database): Promise<boolean> {
  const v = await getSetting<number | boolean>(db, AUTO_POPUP_REST_TIMER_KEY);
  // null/undefined → ON (default for fresh installs).
  if (v == null) return true;
  return v === 1 || v === true;
}

export async function setAutoPopupRestTimer(
  db: Database,
  enabled: boolean
): Promise<void> {
  // Store as numeric 1/0 so the v016 raw-seed (`"1"`) and any JSON.parse
  // round-trip stay consistent. JSON.stringify(1) = "1" — same wire form
  // as the seed, so a Settings toggle never produces a divergent shape.
  await setSetting<number>(db, AUTO_POPUP_REST_TIMER_KEY, enabled ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Slice 16 — App Mode (計劃模式 / 極簡模式), ADR-0026.
// ---------------------------------------------------------------------------

/** App-wide presentation mode. See APP_MODE_KEY docblock. */
export type AppMode = 'plan' | 'minimal';

/**
 * Read the app mode, defaulting to 'plan' (full app) when unset — fresh
 * installs and every pre-slice-16 DB keep today's behaviour with no migration.
 */
export async function getAppMode(db: Database): Promise<AppMode> {
  const v = await getSetting<AppMode>(db, APP_MODE_KEY);
  return v === 'minimal' ? 'minimal' : 'plan';
}

export async function setAppMode(db: Database, mode: AppMode): Promise<void> {
  await setSetting<AppMode>(db, APP_MODE_KEY, mode);
}

/**
 * Slice 13b — has the HealthKit OS permission dialog been shown at least once?
 *
 * `false` (default) → Settings shows the "Connect Apple Health" CTA, tapping
 * it triggers `requestHKAuthorization` which shows the OS dialog.
 * `true` → Settings shows the "已連結 Apple Health / Open System Settings"
 * view. iOS won't re-show the dialog from `initHealthKit()` so the user has
 * to go to Settings.app → 隱私 → 健康 to change their answer.
 *
 * Note: this flag tracks whether we ASKED, not whether we were GRANTED.
 * iOS deliberately hides per-scope grant status (privacy / fingerprinting).
 */
export async function getHKAuthorizationRequested(db: Database): Promise<boolean> {
  const v = await getSetting<number | boolean>(db, HK_AUTHORIZATION_REQUESTED_KEY);
  return v === 1 || v === true;
}

export async function setHKAuthorizationRequested(
  db: Database,
  requested: boolean
): Promise<void> {
  await setSetting<number>(db, HK_AUTHORIZATION_REQUESTED_KEY, requested ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Slice 15 (Backup) — backup metadata keys (ADR-0011 + 2026-06-12 grill Q16-A:
// `app_settings` keys, NO new migration / no backup_log table).
//
// Key inventory:
//   backup_mode             'auto' | 'manual'  (Q14.8 toggle; default 'auto')
//   backup_last_success_at  epoch ms of last successful upload
//   backup_last_attempt_at  epoch ms of last attempt (success OR failure) —
//                           the 5min debounce anchor (backupPolicy)
//   backup_last_size        bytes of the last uploaded snapshot
//   backup_last_error       { message, atMs } of the unhealed failure;
//                           cleared on success
//   backup_first_error_at   epoch ms of the FIRST failure since the last
//                           success — anchors the 3/7-day escalation streak
//                           for never-succeeded installs; cleared on success
// ---------------------------------------------------------------------------

const BACKUP_MODE_KEY = 'backup_mode';
const BACKUP_LAST_SUCCESS_AT_KEY = 'backup_last_success_at';
const BACKUP_LAST_ATTEMPT_AT_KEY = 'backup_last_attempt_at';
const BACKUP_LAST_SIZE_KEY = 'backup_last_size';
const BACKUP_LAST_ERROR_KEY = 'backup_last_error';
const BACKUP_FIRST_ERROR_AT_KEY = 'backup_first_error_at';

export type BackupModeSetting = 'auto' | 'manual';

export interface BackupLastError {
  /** Human-oriented failure description (English source; UI maps to i18n later — C5). */
  message: string;
  /** When the failure happened, epoch ms. */
  atMs: number;
  /**
   * C5 classified family (`classifyBackupError`) — drives the Settings 紅
   * error line's i18n copy. Optional for backward compatibility with rows
   * written before C5 (JSON without the field parses fine → 'unknown' copy).
   */
  kind?: BackupErrorKind;
}

/** Aggregated backup metadata snapshot for policy decisions + Settings readout. */
export interface BackupMetadata {
  mode: BackupModeSetting;
  lastSuccessAtMs: number | null;
  lastAttemptAtMs: number | null;
  lastSizeBytes: number | null;
  lastError: BackupLastError | null;
  firstErrorAtMs: number | null;
}

/** ADR-0011 Q14.8: 自動備份 toggle 預設 ON ('auto'). */
export async function getBackupMode(db: Database): Promise<BackupModeSetting> {
  const v = await getSetting<BackupModeSetting>(db, BACKUP_MODE_KEY);
  return v === 'manual' ? 'manual' : 'auto';
}

export async function setBackupMode(
  db: Database,
  mode: BackupModeSetting
): Promise<void> {
  await setSetting<BackupModeSetting>(db, BACKUP_MODE_KEY, mode);
}

/** One read for everything the trigger gate / Settings readout needs. */
export async function getBackupMetadata(db: Database): Promise<BackupMetadata> {
  const [mode, lastSuccessAtMs, lastAttemptAtMs, lastSizeBytes, lastError, firstErrorAtMs] =
    await Promise.all([
      getBackupMode(db),
      getSetting<number>(db, BACKUP_LAST_SUCCESS_AT_KEY),
      getSetting<number>(db, BACKUP_LAST_ATTEMPT_AT_KEY),
      getSetting<number>(db, BACKUP_LAST_SIZE_KEY),
      getSetting<BackupLastError>(db, BACKUP_LAST_ERROR_KEY),
      getSetting<number>(db, BACKUP_FIRST_ERROR_AT_KEY),
    ]);
  return {
    mode,
    lastSuccessAtMs: lastSuccessAtMs ?? null,
    lastAttemptAtMs: lastAttemptAtMs ?? null,
    lastSizeBytes: lastSizeBytes ?? null,
    lastError: lastError ?? null,
    firstErrorAtMs: firstErrorAtMs ?? null,
  };
}

/**
 * Record a successful backup upload: stamps success + attempt + size and
 * HEALS the failure streak (clears last_error + first_error_at) so the
 * escalation gate (`shouldEscalateBackupFailure`) goes quiet.
 */
export async function recordBackupSuccess(
  db: Database,
  args: { atMs: number; sizeBytes: number | null }
): Promise<void> {
  await setSetting<number>(db, BACKUP_LAST_SUCCESS_AT_KEY, args.atMs);
  await setSetting<number>(db, BACKUP_LAST_ATTEMPT_AT_KEY, args.atMs);
  if (args.sizeBytes != null) {
    await setSetting<number>(db, BACKUP_LAST_SIZE_KEY, args.sizeBytes);
  }
  await deleteSetting(db, BACKUP_LAST_ERROR_KEY);
  await deleteSetting(db, BACKUP_FIRST_ERROR_AT_KEY);
}

/**
 * Record a failed backup attempt: stamps attempt + last_error, and anchors
 * `backup_first_error_at` only when starting a NEW streak (key absent) —
 * repeated failures keep the original anchor so the 3/7-day escalation
 * window measures the streak, not the latest retry.
 */
export async function recordBackupFailure(
  db: Database,
  args: { atMs: number; message: string; kind?: BackupErrorKind }
): Promise<void> {
  await setSetting<number>(db, BACKUP_LAST_ATTEMPT_AT_KEY, args.atMs);
  await setSetting<BackupLastError>(db, BACKUP_LAST_ERROR_KEY, {
    message: args.message,
    atMs: args.atMs,
    ...(args.kind ? { kind: args.kind } : {}),
  });
  const existingAnchor = await getSetting<number>(db, BACKUP_FIRST_ERROR_AT_KEY);
  if (existingAnchor == null) {
    await setSetting<number>(db, BACKUP_FIRST_ERROR_AT_KEY, args.atMs);
  }
}
