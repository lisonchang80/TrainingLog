/**
 * ADR-0024 § 4 — `createSession` + `startSessionFromTemplate` auto-pull
 * the latest body_metric into `bodyweight_snapshot_kg` when the caller
 * doesn't supply one explicitly.
 *
 * Important shape note caught while implementing: `listBodyMetrics`
 * returns rows in `recorded_at ASC` order (it's tuned for the body-trend
 * chart consumer), so "latest" is `.at(-1)`, not `.at(0)` as the ADR
 * pseudocode reads. This test file pins that contract.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { insertBodyMetric } from '../../src/adapters/sqlite/bodyMetricRepository';
import {
  createSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';

describe('Session bw snapshot auto-pull (ADR-0024 § 4)', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const fakeUuid = () => `id-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => db.close());

  describe('createSession', () => {
    it('pulls the LATEST body_metric when none is supplied', async () => {
      // Insert in non-monotonic recorded_at order to make sure the helper
      // picks by recorded_at, not by insertion order.
      await insertBodyMetric(
        db,
        { recorded_at: 500, bodyweight_kg: 70, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 2000, bodyweight_kg: 73, pbf: null, smm_kg: null },
        fakeUuid
      );
      await insertBodyMetric(
        db,
        { recorded_at: 1000, bodyweight_kg: 71, pbf: null, smm_kg: null },
        fakeUuid
      );

      await createSession(db, { id: 'sess-A', started_at: 5000 });

      const s = await getSession(db, 'sess-A');
      // recorded_at=2000 is the latest → bodyweight_kg=73 must win.
      expect(s?.bodyweight_snapshot_kg).toBe(73);
    });

    it('resolves to null when body_metric table is empty', async () => {
      await createSession(db, { id: 'sess-B', started_at: 1000 });
      const s = await getSession(db, 'sess-B');
      expect(s?.bodyweight_snapshot_kg).toBeNull();
    });

    it('honours explicit bodyweight_snapshot_kg over auto-pull', async () => {
      await insertBodyMetric(
        db,
        { recorded_at: 100, bodyweight_kg: 80, pbf: null, smm_kg: null },
        fakeUuid
      );
      // Explicit null wins — caller overrode the auto-pull.
      await createSession(db, {
        id: 'sess-C',
        started_at: 200,
        bodyweight_snapshot_kg: null,
      });
      const s = await getSession(db, 'sess-C');
      expect(s?.bodyweight_snapshot_kg).toBeNull();
    });

    it('honours explicit numeric snapshot over auto-pull', async () => {
      await insertBodyMetric(
        db,
        { recorded_at: 100, bodyweight_kg: 80, pbf: null, smm_kg: null },
        fakeUuid
      );
      await createSession(db, {
        id: 'sess-D',
        started_at: 200,
        bodyweight_snapshot_kg: 65,
      });
      const s = await getSession(db, 'sess-D');
      expect(s?.bodyweight_snapshot_kg).toBe(65);
    });

    it('latest body_metric works regardless of insertion age (no time horizon)', async () => {
      // ADR-0024 § 4: "無時效性限制；永遠拿最後一筆 (哪怕 6 個月前)".
      const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 180;
      await insertBodyMetric(
        db,
        {
          recorded_at: sixMonthsAgo,
          bodyweight_kg: 68,
          pbf: null,
          smm_kg: null,
        },
        fakeUuid
      );
      await createSession(db, { id: 'sess-E', started_at: Date.now() });
      const s = await getSession(db, 'sess-E');
      expect(s?.bodyweight_snapshot_kg).toBe(68);
    });
  });

  describe('startSessionFromTemplate', () => {
    it('pulls the latest body_metric into the new session header', async () => {
      await createTemplate(db, { id: 'tpl-1', name: 'Push' });
      await insertBodyMetric(
        db,
        { recorded_at: 1000, bodyweight_kg: 75, pbf: null, smm_kg: null },
        fakeUuid
      );
      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-1',
        uuid: fakeUuid,
        now: () => 2000,
      });
      const s = await getSession(db, session_id);
      expect(s?.bodyweight_snapshot_kg).toBe(75);
    });

    it('leaves snapshot null when no body_metric is on record', async () => {
      await createTemplate(db, { id: 'tpl-2', name: 'Pull' });
      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-2',
        uuid: fakeUuid,
        now: () => 2000,
      });
      const s = await getSession(db, session_id);
      expect(s?.bodyweight_snapshot_kg).toBeNull();
    });
  });
});
