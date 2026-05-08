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
