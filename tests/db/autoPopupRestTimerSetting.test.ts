import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getAutoPopupRestTimer,
  setAutoPopupRestTimer,
} from '../../src/adapters/sqlite/settingsRepository';

/**
 * DB integration tests for ADR-0019 § slice 10d S1 — Settings toggle
 * `app_settings.auto_popup_rest_timer` round-trip.
 *
 * Three behavioural contracts:
 *   1. Fresh DB after v016 seed → reads as ON (default).
 *   2. setAutoPopupRestTimer(false) → next read returns false.
 *   3. Missing row (manual DELETE) → reads as ON (default-on safety net,
 *      not OFF — Today should still pop the modal by default).
 *
 * Plus tolerance for the v016 raw-string seed shape: the migration seeds
 * the key as `'1'` via `INSERT OR IGNORE`, no JSON encoding. The getter
 * must accept both `'1'` (seed) and `1` (round-trip after setter).
 */
describe('Slice 10d S1 — auto_popup_rest_timer setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to ON after fresh migrate (v016 seed)', async () => {
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(true);
  });

  it('round-trips false → false', async () => {
    await setAutoPopupRestTimer(db, false);
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(false);
  });

  it('round-trips true → true', async () => {
    await setAutoPopupRestTimer(db, false);
    await setAutoPopupRestTimer(db, true);
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(true);
  });

  it('reads ON when key row is missing (default-on safety net)', async () => {
    await db.runAsync(
      `DELETE FROM app_settings WHERE key = 'auto_popup_rest_timer'`,
    );
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(true);
  });

  it('reads ON for the v016 raw-string seed shape ("1", not JSON 1)', async () => {
    // The v016 migration uses `INSERT OR IGNORE ... VALUES ('1')` — no JSON
    // encoding. Force that exact shape to verify the getter tolerates it.
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_popup_rest_timer', '1')`,
    );
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(true);
  });

  it('reads OFF for the literal value "0"', async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_popup_rest_timer', '0')`,
    );
    const v = await getAutoPopupRestTimer(db);
    expect(v).toBe(false);
  });
});
