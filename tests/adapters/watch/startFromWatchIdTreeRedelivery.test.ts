/**
 * Phase C-id (set-level id-adoption) — REDELIVERY / Bug-X regression lock
 * for the `onStartFromWatch` orchestrator (the real DB write path, not the
 * `startSessionFromTemplate` unit surface).
 *
 * WHY THIS FILE EXISTS (gap the existing suite left open):
 *   - `startSessionFromTemplateCidAdoption.test.ts` proves the adoption /
 *     fallback / parent-remap at the `startSessionFromTemplate` layer, but
 *     always for a SINGLE call.
 *   - `handshake.test.ts` proves `onStartFromWatch` dedup for the FREESTYLE
 *     path (templateId:null → one `session` row on redelivery), and proves
 *     the TEMPLATE path materialises `session_exercise` rows — but only for a
 *     SINGLE delivery, and WITHOUT an idTree.
 *   - `startFromWatchIdTreeWire.test.ts` proves the idTree survives the
 *     transport, but delivers each envelope ONCE per lane.
 *
 * NONE of them prove the load-bearing invariant the whole C-id design exists
 * to protect: "Bug X" = a template-based Watch-led start whose envelope is
 * REDELIVERED (TUI is an OS-durable at-least-once queue; applicationContext
 * can race the same id) must NOT produce DUPLICATE `session_exercise` / `set`
 * rows. The first delivery runs `startSessionFromTemplate` (adopting the
 * Watch ids); the second must take the `existing && existing.id === suppliedId`
 * fast path in `onStartFromWatch` (flip is_watch_tracked, reply 'created', NO
 * second INSERT). If a future refactor ever moved the active-session guard or
 * changed first-write-wins keying, this would silently reintroduce duplicate
 * tree rows with the SAME adopted ids — the exact corruption C-id set out to
 * kill. This test fails the instant that regresses.
 *
 * Real SQLite in-memory via better-sqlite3; no WC bridge mocking — the
 * orchestrator is pure DB. Mirrors the seeding style of the C-id unit test
 * and the `handshake.test.ts` onStartFromWatch block.
 */

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import { listExercises } from '../../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
} from '../../../src/adapters/sqlite/templateRepository';
import { getSession } from '../../../src/adapters/sqlite/sessionRepository';
import { makeEnvelope, onStartFromWatch } from '../../../src/adapters/watch';
import type { StartFromWatchReconcile } from '../../../src/adapters/watch/handshake';
import type { StartFromWatchPayload } from '../../../src/adapters/watch/payloadSchema';

const WATCH_SID = 'W-cid-redeliver-0001';

const WATCH_ID_TREE = {
  seIds: ['watch-se-A'],
  setIds: [['watch-set-0', 'watch-set-1', 'watch-set-2']],
};

describe('onStartFromWatch — C-id idTree redelivery (Bug-X guard: no duplicate tree rows)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /** 1 exercise × 3 working sets — same shape as the C-id unit test. */
  async function seedTemplate(templateId: string): Promise<void> {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    let n = 0;
    await createTemplate(db, { id: templateId, name: 'Push', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: templateId,
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid: () => `tpl-uuid-${++n}`,
      now: () => 100,
    });
    for (let i = 0; i < 3; i++) {
      await db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
         VALUES (?, ?, ?, 'working', ?, ?)`,
        `tpl-set-${i}`,
        teId,
        i,
        8,
        80,
      );
    }
  }

  function buildEnv(payload: StartFromWatchPayload) {
    return makeEnvelope('start-from-watch', payload);
  }

  function payload(templateId: string): StartFromWatchPayload {
    return {
      templateId,
      programCycleId: null,
      intensityId: null,
      sessionId: WATCH_SID,
      // Fresh copies per call — the wire would re-decode a distinct object.
      idTree: {
        seIds: [...WATCH_ID_TREE.seIds],
        setIds: WATCH_ID_TREE.setIds.map((s) => [...s]),
      },
    };
  }

  async function seIds(sessionId: string): Promise<string[]> {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    return rows.map((r) => r.id);
  }

  async function setIds(sessionId: string): Promise<string[]> {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    return rows.map((r) => r.id);
  }

  it('first delivery adopts the Watch ids for the full tree (baseline)', async () => {
    await seedTemplate('tpl-redeliver');
    const reconciles: StartFromWatchReconcile[] = [];

    await onStartFromWatch(
      db,
      buildEnv(payload('tpl-redeliver')),
      (r) => reconciles.push(r),
      () => 'IPHONE-MINTED-SHOULD-NOT-APPEAR',
    );

    expect(reconciles).toEqual([{ status: 'created', sessionId: WATCH_SID }]);
    expect(await seIds(WATCH_SID)).toEqual(WATCH_ID_TREE.seIds);
    expect(await setIds(WATCH_SID)).toEqual(WATCH_ID_TREE.setIds[0]);
  });

  it('redelivery of the SAME template+idTree envelope produces NO duplicate session_exercise / set rows', async () => {
    await seedTemplate('tpl-redeliver');
    const reconciles: StartFromWatchReconcile[] = [];
    const uuid = () => 'IPHONE-MINTED-SHOULD-NOT-APPEAR';

    // 1st delivery — startSessionFromTemplate runs, adopts the Watch ids.
    await onStartFromWatch(db, buildEnv(payload('tpl-redeliver')), (r) => reconciles.push(r), uuid);
    // 2nd delivery — TUI at-least-once replay. Must take the existing-session
    // fast path (flip flag + reply), NOT a second startSessionFromTemplate.
    await onStartFromWatch(db, buildEnv(payload('tpl-redeliver')), (r) => reconciles.push(r), uuid);

    // Both deliveries reply 'created' (idempotent ack the Watch expects).
    expect(reconciles).toEqual([
      { status: 'created', sessionId: WATCH_SID },
      { status: 'created', sessionId: WATCH_SID },
    ]);

    // Exactly ONE session row.
    const sessRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session WHERE id = ?`,
      WATCH_SID,
    );
    expect(sessRows).toHaveLength(1);

    // Bug X: exactly ONE session_exercise (not two) — the adopted id, once.
    expect(await seIds(WATCH_SID)).toEqual(WATCH_ID_TREE.seIds);
    // And exactly the three adopted set ids — no minted / duplicated rows.
    expect(await setIds(WATCH_SID)).toEqual(WATCH_ID_TREE.setIds[0]);

    // No iPhone-minted id leaked in on either delivery.
    const allSe = await seIds(WATCH_SID);
    const allSet = await setIds(WATCH_SID);
    for (const id of [...allSe, ...allSet]) {
      expect(id).not.toContain('MINTED');
    }

    // Watch tracking flag stayed true across the idempotent 2nd flip.
    expect((await getSession(db, WATCH_SID))?.is_watch_tracked).toBe(true);
  });

  it('third+ redelivery is still a pure no-op — the tree never grows', async () => {
    await seedTemplate('tpl-redeliver');
    const reconciles: StartFromWatchReconcile[] = [];
    const uuid = () => 'IPHONE-MINTED-SHOULD-NOT-APPEAR';

    for (let i = 0; i < 4; i++) {
      await onStartFromWatch(db, buildEnv(payload('tpl-redeliver')), (r) => reconciles.push(r), uuid);
    }

    expect(reconciles).toHaveLength(4);
    expect(reconciles.every((r) => r.status === 'created')).toBe(true);
    // Tree is exactly what the first delivery built — 1 se, 3 sets.
    expect(await seIds(WATCH_SID)).toEqual(WATCH_ID_TREE.seIds);
    expect(await setIds(WATCH_SID)).toEqual(WATCH_ID_TREE.setIds[0]);
  });
});
