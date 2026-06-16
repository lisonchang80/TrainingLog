import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getAchievementsEnabled,
  setAchievementsEnabled,
} from '../../src/adapters/sqlite/settingsRepository';

/**
 * Slice 17 (ADR-0009 amend) — `app_settings.achievements_enabled` round-trip.
 * Default ON (system on for fresh installs); stored as numeric 1/0.
 */
describe('Slice 17 — achievements_enabled setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to ON for a fresh DB (no row)', async () => {
    expect(await getAchievementsEnabled(db)).toBe(true);
  });

  it('round-trips false → false', async () => {
    await setAchievementsEnabled(db, false);
    expect(await getAchievementsEnabled(db)).toBe(false);
  });

  it('round-trips back true → true', async () => {
    await setAchievementsEnabled(db, false);
    await setAchievementsEnabled(db, true);
    expect(await getAchievementsEnabled(db)).toBe(true);
  });

  it('reads ON when the value is unparseable garbage', async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('achievements_enabled', 'not-json')`,
    );
    expect(await getAchievementsEnabled(db)).toBe(true);
  });
});
