import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getBucketRanges,
  setBucketRanges,
} from '../../src/adapters/sqlite/settingsRepository';
import type { BucketBoundary } from '../../src/domain/pr/types';

/**
 * Slice 17 / ADR-0027 — `app_settings.bucket_ranges` round-trip + validation.
 * getBucketRanges returns null on unset OR malformed/invalid; setBucketRanges
 * throws on non-contiguous input (the editor only ever produces valid lists).
 */
const VALID: BucketBoundary[] = [
  { key: 'max_strength', min: 1, max: 5 },
  { key: 'strength', min: 6, max: 8 },
  { key: 'hypertrophy', min: 9, max: 12 },
  { key: 'muscle_endurance', min: 13, max: 20 },
  { key: 'endurance', min: 21, max: null },
];

describe('Slice 17 — bucket_ranges setting', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for a fresh DB (no row)', async () => {
    expect(await getBucketRanges(db)).toBeNull();
  });

  it('round-trips a valid boundary list', async () => {
    await setBucketRanges(db, VALID);
    expect(await getBucketRanges(db)).toEqual(VALID);
  });

  it('returns null when the stored value is non-contiguous (invalid)', async () => {
    const bad = VALID.map((b) => ({ ...b }));
    bad[1].min = 7; // gap at rep 6 (prev max 5)
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('bucket_ranges', ?)`,
      JSON.stringify(bad),
    );
    expect(await getBucketRanges(db)).toBeNull();
  });

  it('returns null for unparseable garbage', async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('bucket_ranges', 'not-json')`,
    );
    expect(await getBucketRanges(db)).toBeNull();
  });

  it('throws when persisting an invalid list', async () => {
    const bad = VALID.map((b) => ({ ...b }));
    bad[4] = { ...bad[4], max: 30 }; // last bucket must be open-ended
    await expect(setBucketRanges(db, bad)).rejects.toThrow(/invalid bucket boundaries/i);
  });
});
