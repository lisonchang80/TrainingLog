import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getAppMode,
  setAppMode,
} from '../../src/adapters/sqlite/settingsRepository';

/**
 * DB integration tests for ADR-0026 (slice 16) — `app_settings.app_mode`
 * round-trip (計劃模式 'plan' / 極簡模式 'minimal').
 *
 * Contracts:
 *   1. Fresh DB (no migration seed for this key) → reads 'plan' (full app).
 *   2. setAppMode('minimal') → next read returns 'minimal'.
 *   3. Round-trips back to 'plan'.
 *   4. An unknown / corrupt stored value falls back to 'plan' (never traps the
 *      user in a half-rendered minimal app over a bad row).
 */
describe('Slice 16 — app_mode setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("defaults to 'plan' on a fresh DB (no migration / key absent)", async () => {
    const v = await getAppMode(db);
    expect(v).toBe('plan');
  });

  it("round-trips 'minimal' → 'minimal'", async () => {
    await setAppMode(db, 'minimal');
    expect(await getAppMode(db)).toBe('minimal');
  });

  it("round-trips back 'minimal' → 'plan'", async () => {
    await setAppMode(db, 'minimal');
    await setAppMode(db, 'plan');
    expect(await getAppMode(db)).toBe('plan');
  });

  it("falls back to 'plan' for an unknown stored value", async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('app_mode', '"garbage"')`,
    );
    expect(await getAppMode(db)).toBe('plan');
  });
});
