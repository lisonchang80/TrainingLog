/**
 * settingsRepository edge coverage (src/adapters/sqlite/settingsRepository.ts).
 *
 * The generic key/value store + the slice-13b HealthKit-authorization flag
 * had untested branches that the existing focused tests
 * (settingsDeleteSetting / autoPopupRestTimerSetting / settingsBodyweightRow)
 * never reached:
 *
 *   - `getSetting` JSON.parse THROW path → returns null (malformed row value)
 *   - `getHKAuthorizationRequested` truthy / falsy / missing decode branches
 *   - `setHKAuthorizationRequested` numeric 1/0 wire shape + round-trip
 *
 * Additive, non-overlapping with the existing settings test files.
 *
 * Overnight 2026-05-31 — agent 06 (non-WC coverage r2).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getSetting,
  setSetting,
  getHKAuthorizationRequested,
  setHKAuthorizationRequested,
} from '../../src/adapters/sqlite/settingsRepository';

describe('settingsRepository edges', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- getSetting JSON.parse catch path --------------------------------

  it('getSetting returns null when the stored value is not valid JSON', async () => {
    // Write a raw, un-JSON-encoded blob straight into the row, bypassing
    // setSetting (which would JSON.stringify). `{not json` cannot be parsed.
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`,
      'corrupt_key',
      '{not json'
    );

    expect(await getSetting<number>(db, 'corrupt_key')).toBeNull();
  });

  it('getSetting returns null for a row whose value column is SQL NULL', async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, NULL)`,
      'null_value_key'
    );

    expect(await getSetting(db, 'null_value_key')).toBeNull();
  });

  it('getSetting round-trips a JSON-encoded object written by setSetting', async () => {
    await setSetting(db, 'obj_key', { a: 1, b: ['x', 'y'] });
    expect(await getSetting(db, 'obj_key')).toEqual({ a: 1, b: ['x', 'y'] });
  });

  // --- getHKAuthorizationRequested decode branches ---------------------

  it('getHKAuthorizationRequested defaults to false when the key is missing', async () => {
    expect(await getHKAuthorizationRequested(db)).toBe(false);
  });

  it('getHKAuthorizationRequested is true when stored as numeric 1', async () => {
    await setSetting<number>(db, 'hk_authorization_requested', 1);
    expect(await getHKAuthorizationRequested(db)).toBe(true);
  });

  it('getHKAuthorizationRequested is true when stored as boolean true', async () => {
    await setSetting<boolean>(db, 'hk_authorization_requested', true);
    expect(await getHKAuthorizationRequested(db)).toBe(true);
  });

  it('getHKAuthorizationRequested is false when stored as numeric 0', async () => {
    await setSetting<number>(db, 'hk_authorization_requested', 0);
    expect(await getHKAuthorizationRequested(db)).toBe(false);
  });

  it('getHKAuthorizationRequested is false when stored as boolean false', async () => {
    await setSetting<boolean>(db, 'hk_authorization_requested', false);
    expect(await getHKAuthorizationRequested(db)).toBe(false);
  });

  // --- setHKAuthorizationRequested wire shape + round-trip -------------

  it('setHKAuthorizationRequested(true) persists numeric 1 (not boolean)', async () => {
    await setHKAuthorizationRequested(db, true);
    // raw wire form is "1" (JSON.stringify(1)), matching the v016-style convention
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      'hk_authorization_requested'
    );
    expect(row?.value).toBe('1');
    expect(await getHKAuthorizationRequested(db)).toBe(true);
  });

  it('setHKAuthorizationRequested(false) persists numeric 0 and reads back false', async () => {
    await setHKAuthorizationRequested(db, false);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`,
      'hk_authorization_requested'
    );
    expect(row?.value).toBe('0');
    expect(await getHKAuthorizationRequested(db)).toBe(false);
  });

  it('setHKAuthorizationRequested toggles cleanly (true → false → true)', async () => {
    await setHKAuthorizationRequested(db, true);
    expect(await getHKAuthorizationRequested(db)).toBe(true);
    await setHKAuthorizationRequested(db, false);
    expect(await getHKAuthorizationRequested(db)).toBe(false);
    await setHKAuthorizationRequested(db, true);
    expect(await getHKAuthorizationRequested(db)).toBe(true);
  });
});
