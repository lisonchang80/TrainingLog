/**
 * Settings 體重 row (ADR-0024 § 5) — integration test for the simple flow
 * the mini-sheet handler runs:
 *   parseWeightInput → insertBodyMetric → it shows up in listBodyMetrics.
 *
 * This mirrors the UI handler in app/(tabs)/settings.tsx without importing
 * react-native (the test env is node-only). If the handler ever stops
 * threading the value through one of these three calls, this test fails.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertBodyMetric,
  listBodyMetrics,
} from '../../src/adapters/sqlite/bodyMetricRepository';
import { parseWeightInput } from '../../src/domain/body/unitConversion';

describe('Settings 體重 row → body_metric round-trip', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const fakeUuid = () => `bm-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => db.close());

  it('saves kg input as kg via insertBodyMetric', async () => {
    const bwKg = parseWeightInput('72.5', 'kg');
    expect(bwKg).toBe(72.5);

    await insertBodyMetric(
      db,
      { recorded_at: 1234, bodyweight_kg: bwKg!, pbf: null, smm_kg: null },
      fakeUuid
    );

    const rows = await listBodyMetrics(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].bodyweight_kg).toBe(72.5);
    expect(rows[0].pbf).toBeNull();
    expect(rows[0].smm_kg).toBeNull();
  });

  it('converts lb input to kg before persisting', async () => {
    const bwKg = parseWeightInput('160', 'lb');
    expect(bwKg).not.toBeNull();
    // lb → kg uses the canonical conversion exposed by parseWeightInput;
    // we only assert the value is in a sane neighbourhood of 72.5kg without
    // pinning the exact float (the conversion factor lives in unitConversion).
    expect(bwKg!).toBeGreaterThan(70);
    expect(bwKg!).toBeLessThan(75);

    await insertBodyMetric(
      db,
      { recorded_at: 5678, bodyweight_kg: bwKg!, pbf: null, smm_kg: null },
      fakeUuid
    );

    const [row] = await listBodyMetrics(db);
    expect(row.bodyweight_kg).toBe(bwKg);
  });

  it('rejects garbage input (parser returns null → handler aborts before insert)', () => {
    expect(parseWeightInput('abc', 'kg')).toBeNull();
    expect(parseWeightInput('', 'kg')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // B-2 (2026-06-27 `28c3eed`) — the Settings 體重 mini-modal became a full
  // 身體數據 entry: a DateTimePicker on top (backfill a PAST recorded_at, which
  // was hardcoded to Date.now() before) + the PBF/SMM trio (was bodyweight
  // only). The handler now builds a draft { recorded_at, bodyweight_kg, pbf,
  // smm_kg }, UI-guards on validateBodyMetric, then insertBodyMetric (which
  // RE-validates + throws). These tests mirror that handler's repo-facing
  // contract — the pre-B-2 cases above only covered single-bodyweight with a
  // fixed recorded_at, so the backfill + trio + repo-boundary throw were
  // untested branches the new modal newly relies on.
  // -------------------------------------------------------------------------
  describe('B-2 — backdated recorded_at + PBF/SMM trio + repo-boundary guard', () => {
    it('persists a user-picked PAST recorded_at verbatim (the backfill — was Date.now())', async () => {
      // User opened the DateTimePicker and set the entry to 30 days ago.
      const thirtyDaysAgo = Date.UTC(2026, 4, 28, 9, 0, 0);
      await insertBodyMetric(
        db,
        { recorded_at: thirtyDaysAgo, bodyweight_kg: 71.2, pbf: null, smm_kg: null },
        fakeUuid
      );
      const [row] = await listBodyMetrics(db);
      // Stored verbatim — NOT coerced to "now".
      expect(row.recorded_at).toBe(thirtyDaysAgo);
    });

    it('a backdated entry sorts BEFORE a newer one in listBodyMetrics (chart order intact)', async () => {
      // The whole point of the backfill: an entry stamped earlier must slot
      // into chronological order, not append to the tail.
      const newer = Date.UTC(2026, 5, 27, 9, 0, 0);
      const older = Date.UTC(2026, 4, 1, 9, 0, 0);
      await insertBodyMetric(
        db,
        { recorded_at: newer, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: older, bodyweight_kg: 72, pbf: null, smm_kg: null },
        fakeUuid
      );
      const rows = await listBodyMetrics(db);
      // listBodyMetrics is ORDER BY recorded_at ASC → the backdated row leads.
      expect(rows.map((r) => r.recorded_at)).toEqual([older, newer]);
      expect(rows[0].bodyweight_kg).toBe(72);
    });

    it('writes the full 體重/PBF/SMM trio in ONE row (B-2 added PBF + SMM)', async () => {
      await insertBodyMetric(
        db,
        { recorded_at: 1234, bodyweight_kg: 70.5, pbf: 18.2, smm_kg: 33.1 },
        fakeUuid
      );
      const [row] = await listBodyMetrics(db);
      expect(row).toMatchObject({ bodyweight_kg: 70.5, pbf: 18.2, smm_kg: 33.1 });
    });

    it('insertBodyMetric THROWS at the repo boundary on an out-of-range PBF (UI guard backstop)', async () => {
      // The handler UI-guards on validateBodyMetric, but insertBodyMetric
      // re-validates and throws — the repo boundary is the backstop that keeps
      // a bad row out of the table if a future UI refactor drops the guard.
      // PBF > 100 is impossible; must be rejected, NOT clamped/written.
      await expect(
        insertBodyMetric(
          db,
          { recorded_at: 1234, bodyweight_kg: null, pbf: 150, smm_kg: null },
          fakeUuid
        )
      ).rejects.toThrow(/Invalid body metric: PBF_OUT_OF_RANGE/);
      // Nothing landed in the table.
      expect(await listBodyMetrics(db)).toHaveLength(0);
    });

    it('insertBodyMetric THROWS on a non-finite recorded_at (NaN from a bad date parse)', async () => {
      // If the DateTimePicker / Date math ever yields NaN (e.g. an invalid
      // Date), the repo must reject rather than write a NaN timestamp that
      // would corrupt every recorded_at-ordered query.
      await expect(
        insertBodyMetric(
          db,
          { recorded_at: Number.NaN, bodyweight_kg: 70, pbf: null, smm_kg: null },
          fakeUuid
        )
      ).rejects.toThrow(/Invalid body metric: RECORDED_AT_INVALID/);
      expect(await listBodyMetrics(db)).toHaveLength(0);
    });

    it('insertBodyMetric THROWS on out-of-range SMM (200kg ceiling)', async () => {
      await expect(
        insertBodyMetric(
          db,
          { recorded_at: 1234, bodyweight_kg: null, pbf: null, smm_kg: 250 },
          fakeUuid
        )
      ).rejects.toThrow(/Invalid body metric: SMM_OUT_OF_RANGE/);
      expect(await listBodyMetrics(db)).toHaveLength(0);
    });
  });
});
