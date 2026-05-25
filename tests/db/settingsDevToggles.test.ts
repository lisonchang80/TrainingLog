/**
 * Slice 13a Phase A → 13b Phase B opener — `dev_simulate_watch_tracked` round-trip.
 *
 * Originally tested both `watch_tracked` + `hk_granted` toggles; slice 13b
 * deleted the HK-granted dev toggle in favor of the real
 * `getAuthorizationState` reading from `hk_authorization_requested` (see
 * `tests/adapters/healthkit/permission.test.ts`).
 *
 * Watch tracked toggle survives to slice 13d as a 5-tile-watch UI regression
 * guard (without it, the variant is unreachable on dev builds until a real
 * `session.healthkit_workout_uuid` exists).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getDevSimulateWatchTracked,
  setDevSimulateWatchTracked,
} from '../../src/adapters/sqlite/settingsRepository';

describe('Slice 13a → 13b — dev_simulate_watch_tracked setting', () => {
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
