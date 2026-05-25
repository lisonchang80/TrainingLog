import type { Database } from '../../db/types';
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
 * Slice 13a Phase A — `dev_simulate_watch_tracked` toggle.
 *
 * Kept past slice 13b as a 5-tile-watch UI regression guard while slice 13d
 * (Watch app scaffold + WatchConnectivity bridge) is still in flight — without
 * this dev affordance the 5-tile-watch variant is unreachable on dev builds
 * (no session has `healthkit_workout_uuid` set yet). Removed in slice 13d's
 * first commit once real Watch sessions can flip the variant naturally.
 *
 * Counterpart `dev_simulate_hk_granted` was removed in slice 13b — the real
 * `getAuthorizationState` reading from `hk_authorization_requested` replaces
 * it (see `src/adapters/healthkit/permission.ts`).
 */
const DEV_SIMULATE_WATCH_TRACKED_KEY = 'dev_simulate_watch_tracked';

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

/**
 * Slice 13a Phase A — read 模擬 Watch tracked dev toggle.
 *
 * When ON, the Today screen renders SessionStatsPanel `variant='5tile-watch'`
 * even without an actual Apple Watch / HealthKit data source (HR / kcal
 * tiles show '—'). When OFF (default), Today keeps the legacy 3-tile
 * layout.
 *
 * Phase B (HealthKit + Watch unlock) REMOVES this toggle — the variant
 * decision will instead read `session.is_watch_tracked` from the schema.
 */
export async function getDevSimulateWatchTracked(db: Database): Promise<boolean> {
  const v = await getSetting<number | boolean>(db, DEV_SIMULATE_WATCH_TRACKED_KEY);
  return v === 1 || v === true;
}

export async function setDevSimulateWatchTracked(
  db: Database,
  enabled: boolean
): Promise<void> {
  await setSetting<number>(db, DEV_SIMULATE_WATCH_TRACKED_KEY, enabled ? 1 : 0);
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
