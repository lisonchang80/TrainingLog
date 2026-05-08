import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  deleteBodyMetric,
  getBodyMetric,
  insertBodyMetric,
  listBodyMetrics,
} from '../../src/adapters/sqlite/bodyMetricRepository';
import {
  getSetting,
  getUnitPreference,
  setSetting,
  setUnitPreference,
} from '../../src/adapters/sqlite/settingsRepository';
import {
  createSession,
  getSession,
  setSessionBwSnapshot,
} from '../../src/adapters/sqlite/sessionRepository';
import { canWriteBwSnapshot } from '../../src/domain/body/bodyMetricManager';

/**
 * DB integration tests for slice 7: body_metric table, settings KV store,
 * session bw_snapshot column.
 */
describe('Slice 7 — body_metric + settings + bw_snapshot', () => {
  let db: BetterSqliteDatabase;
  let counter: number;

  const fakeUuid = (): string => {
    counter += 1;
    return `id-${counter}`;
  };

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => {
    db.close();
  });

  describe('migration v007', () => {
    it('creates body_metric with correct columns', async () => {
      const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
        `PRAGMA table_info(body_metric)`
      );
      const colMap = new Map(cols.map((c) => [c.name, c]));
      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('recorded_at')).toBe(true);
      expect(colMap.has('bodyweight_kg')).toBe(true);
      expect(colMap.has('pbf')).toBe(true);
      expect(colMap.has('smm_kg')).toBe(true);
      // recorded_at is NOT NULL; the three metric columns are nullable.
      expect(colMap.get('recorded_at')?.notnull).toBe(1);
      expect(colMap.get('bodyweight_kg')?.notnull).toBe(0);
    });

    it('idempotent (running migrate twice is safe)', async () => {
      await migrate(db);
      await migrate(db);
      const cols = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(body_metric)`
      );
      expect(cols.length).toBe(5);
    });
  });

  describe('body_metric round-trip', () => {
    it('inserts and lists body metrics in recorded_at ASC order', async () => {
      await insertBodyMetric(
        db,
        { recorded_at: 200, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 100, bodyweight_kg: 71, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 300, bodyweight_kg: 69, pbf: 18, smm_kg: 30 },
        fakeUuid
      );
      const all = await listBodyMetrics(db);
      expect(all.length).toBe(3);
      expect(all.map((m) => m.recorded_at)).toEqual([100, 200, 300]);
    });

    it('allows multiple readings on the same day', async () => {
      const dayMs = Date.UTC(2026, 0, 5);
      await insertBodyMetric(
        db,
        { recorded_at: dayMs + 8 * 3600_000, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: dayMs + 20 * 3600_000, bodyweight_kg: 71.2, pbf: null, smm_kg: null },
        fakeUuid
      );
      const all = await listBodyMetrics(db);
      expect(all.length).toBe(2);
      // Same calendar day, different timestamps — both persisted.
      const sameDay = all.every(
        (m) => m.recorded_at >= dayMs && m.recorded_at < dayMs + 86400_000
      );
      expect(sameDay).toBe(true);
    });

    it('persists each metric column independently (any subset)', async () => {
      await insertBodyMetric(
        db,
        { recorded_at: 100, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 200, bodyweight_kg: null, pbf: 18.5, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 300, bodyweight_kg: null, pbf: null, smm_kg: 32.4 },
        fakeUuid
      );
      const all = await listBodyMetrics(db);
      expect(all[0]).toMatchObject({ bodyweight_kg: 70, pbf: null, smm_kg: null });
      expect(all[1]).toMatchObject({ bodyweight_kg: null, pbf: 18.5, smm_kg: null });
      expect(all[2]).toMatchObject({ bodyweight_kg: null, pbf: null, smm_kg: 32.4 });
    });

    it('rejects fully-empty drafts before reaching DB', async () => {
      await expect(
        insertBodyMetric(
          db,
          { recorded_at: 1, bodyweight_kg: null, pbf: null, smm_kg: null },
          fakeUuid
        )
      ).rejects.toThrow(/EMPTY/);
    });

    it('get + delete works', async () => {
      const m = await insertBodyMetric(
        db,
        { recorded_at: 100, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      const fetched = await getBodyMetric(db, m.id);
      expect(fetched?.bodyweight_kg).toBe(70);
      await deleteBodyMetric(db, m.id);
      expect(await getBodyMetric(db, m.id)).toBeNull();
    });
  });

  describe('settings — unit preference', () => {
    it('defaults to kg when unset', async () => {
      expect(await getUnitPreference(db)).toBe('kg');
    });

    it('persists kg/lb toggle', async () => {
      await setUnitPreference(db, 'lb');
      expect(await getUnitPreference(db)).toBe('lb');
      await setUnitPreference(db, 'kg');
      expect(await getUnitPreference(db)).toBe('kg');
    });

    it('generic getSetting/setSetting JSON-encodes arbitrary values', async () => {
      await setSetting(db, 'demo', { count: 3, on: true });
      const v = await getSetting<{ count: number; on: boolean }>(db, 'demo');
      expect(v).toEqual({ count: 3, on: true });
    });

    it('returns null for unset key', async () => {
      expect(await getSetting<unknown>(db, 'never')).toBeNull();
    });
  });

  describe('session.bodyweight_snapshot_kg — pre-session lock semantics', () => {
    const sessionId = 'sess-1';

    it('createSession persists bw_snapshot when supplied', async () => {
      await createSession(db, {
        id: sessionId,
        started_at: 1000,
        bodyweight_snapshot_kg: 72.5,
      });
      const s = await getSession(db, sessionId);
      expect(s?.bodyweight_snapshot_kg).toBe(72.5);
    });

    it('createSession defaults to null when not supplied', async () => {
      await createSession(db, { id: sessionId, started_at: 1000 });
      const s = await getSession(db, sessionId);
      expect(s?.bodyweight_snapshot_kg).toBeNull();
    });

    it('once snapshot is locked, domain rule rejects further writes', async () => {
      await createSession(db, {
        id: sessionId,
        started_at: 1000,
        bodyweight_snapshot_kg: 70,
      });
      const s = await getSession(db, sessionId);
      // AC: "bw_snapshot 在 pre-session 階段鎖定不再變動"
      const allowed = canWriteBwSnapshot({
        sessionStatus: 'in_progress',
        existingSnapshot: s?.bodyweight_snapshot_kg ?? null,
      });
      expect(allowed).toBe(false);
    });

    it('inline body_metric during session does NOT touch session.bw_snapshot', async () => {
      await createSession(db, {
        id: sessionId,
        started_at: 1000,
        bodyweight_snapshot_kg: 70,
      });
      // User logs a fresh measurement mid-session — independent table.
      await insertBodyMetric(
        db,
        { recorded_at: 1500, bodyweight_kg: 71, pbf: null, smm_kg: null },
        fakeUuid
      );
      const s = await getSession(db, sessionId);
      expect(s?.bodyweight_snapshot_kg).toBe(70); // unchanged
      const all = await listBodyMetrics(db);
      expect(all.length).toBe(1);
    });

    it('setSessionBwSnapshot allows backfill when snapshot was null', async () => {
      // Recovery path: user skipped pre-session prompt, decides to set later.
      await createSession(db, { id: sessionId, started_at: 1000 });
      await setSessionBwSnapshot(db, {
        id: sessionId,
        bodyweight_snapshot_kg: 72.5,
      });
      const s = await getSession(db, sessionId);
      expect(s?.bodyweight_snapshot_kg).toBe(72.5);
    });
  });
});
