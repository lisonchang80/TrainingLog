import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '../../src/adapters/sqlite/settingsRepository';

/**
 * `deleteSetting` is a thin DELETE wrapper added for Card 12R — the commit /
 * discard / focus-restore paths use it to drop the edit-snapshot row cleanly
 * (vs `setSetting(key, null)` which would store the literal string "null"
 * and leave a phantom row).
 */
describe('deleteSetting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  test('removes an existing key (getSetting returns null afterwards)', async () => {
    await setSetting<number>(db, 'demo_key', 42);
    expect(await getSetting<number>(db, 'demo_key')).toBe(42);

    await deleteSetting(db, 'demo_key');

    expect(await getSetting<number>(db, 'demo_key')).toBeNull();
  });

  test('non-existent key → no-op (no throw)', async () => {
    await expect(deleteSetting(db, 'never_set')).resolves.not.toThrow();
    expect(await getSetting(db, 'never_set')).toBeNull();
  });

  test('does NOT touch other keys (key-scoped DELETE)', async () => {
    await setSetting<string>(db, 'keep', 'yes');
    await setSetting<string>(db, 'drop', 'go');

    await deleteSetting(db, 'drop');

    expect(await getSetting<string>(db, 'keep')).toBe('yes');
    expect(await getSetting<string>(db, 'drop')).toBeNull();
  });
});
