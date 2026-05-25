/**
 * Slice 13a Phase A dev toggle round-trip tests.
 *
 * Both toggles default OFF (vs auto_popup_rest_timer which is default ON
 * via v016 seed). No migration seed for these keys — `getSetting` returns
 * null on missing row, the getter coerces null → false.
 *
 * REMOVE this test file in Phase B first commit alongside the settings
 * repository functions + Settings UI section (per ADR-0019 § Phase A
 * Amendment risks section).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getDevSimulateHKGranted,
  getDevSimulateWatchTracked,
  setDevSimulateHKGranted,
  setDevSimulateWatchTracked,
} from '../../src/adapters/sqlite/settingsRepository';

describe('Slice 13a — dev_simulate_watch_tracked setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to false on fresh DB (no migration seed)', async () => {
    const v = await getDevSimulateWatchTracked(db);
    expect(v).toBe(false);
  });

  it('round-trips true ↔ false through the setter', async () => {
    await setDevSimulateWatchTracked(db, true);
    expect(await getDevSimulateWatchTracked(db)).toBe(true);
    await setDevSimulateWatchTracked(db, false);
    expect(await getDevSimulateWatchTracked(db)).toBe(false);
  });
});

describe('Slice 13a — dev_simulate_hk_granted setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to false on fresh DB (no migration seed)', async () => {
    const v = await getDevSimulateHKGranted(db);
    expect(v).toBe(false);
  });

  it('round-trips true ↔ false through the setter', async () => {
    await setDevSimulateHKGranted(db, true);
    expect(await getDevSimulateHKGranted(db)).toBe(true);
    await setDevSimulateHKGranted(db, false);
    expect(await getDevSimulateHKGranted(db)).toBe(false);
  });
});

describe('Slice 13a dev toggles — keys are independent', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => db.close());

  it('toggling watch_tracked does not affect hk_granted (and vice versa)', async () => {
    await setDevSimulateWatchTracked(db, true);
    expect(await getDevSimulateWatchTracked(db)).toBe(true);
    expect(await getDevSimulateHKGranted(db)).toBe(false);

    await setDevSimulateHKGranted(db, true);
    expect(await getDevSimulateWatchTracked(db)).toBe(true);
    expect(await getDevSimulateHKGranted(db)).toBe(true);

    await setDevSimulateWatchTracked(db, false);
    expect(await getDevSimulateWatchTracked(db)).toBe(false);
    expect(await getDevSimulateHKGranted(db)).toBe(true);
  });
});
