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
 * Slice 13a Phase A dev toggles — REMOVE in Phase B first commit (per
 * ADR-0019 § Slice 13 Phase A Amendment risks section). These keys back
 * Settings > 開發者 switches that let us preview the Watch-tracked 5-tile
 * variant + HK-granted mock state without an actual Apple Watch / HealthKit
 * binding (those require Expo Dev Build).
 *
 * Both default OFF — fresh installs see the legacy 3-tile / no-HK state.
 */
const DEV_SIMULATE_WATCH_TRACKED_KEY = 'dev_simulate_watch_tracked';
const DEV_SIMULATE_HK_GRANTED_KEY = 'dev_simulate_hk_granted';

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
 * Slice 13a Phase A — read 模擬 HealthKit 授權 dev toggle.
 *
 * Phase A has no observable UI effect (preserves the slot for Phase B
 * permission gating). Documented + persisted so the Settings switch state
 * survives reloads; Phase B will branch HK-dependent UI on this flag (then
 * remove it once real HKHealthStore.authorizationStatus replaces the mock).
 */
export async function getDevSimulateHKGranted(db: Database): Promise<boolean> {
  const v = await getSetting<number | boolean>(db, DEV_SIMULATE_HK_GRANTED_KEY);
  return v === 1 || v === true;
}

export async function setDevSimulateHKGranted(
  db: Database,
  enabled: boolean
): Promise<void> {
  await setSetting<number>(db, DEV_SIMULATE_HK_GRANTED_KEY, enabled ? 1 : 0);
}
