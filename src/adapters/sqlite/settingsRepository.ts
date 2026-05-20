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
