/**
 * Wire-level lock for Phase C-id idTree over the expo-wcsession transport
 * (integration/54-cid-2026-07-05 — #54 transport swap × C-id id-adoption).
 *
 * The C-id unit tests (`startSessionFromTemplateCidAdoption.test.ts`) call
 * `startSessionFromTemplate` directly; the compat tests
 * (`wcCompatReconcile.test.ts`) stop at opaque payload passthrough. NEITHER
 * proves the two features compose: that a `start-from-watch` envelope whose
 * payload carries the NESTED `idTree` dict (`seIds: string[]` +
 * `setIds: string[][]`) survives the new transport's JS half — the compat
 * shim's single `deliver()` choke point, the user-info ARRAY batch contract,
 * and connectivity's kind/msgId intake — and lands in `onStartFromWatch`
 * intact enough for the iPhone DB to adopt the Watch-minted ids verbatim.
 *
 * Chain under test (real code, only the NATIVE module faked):
 *
 *   fake native journal/live  →  modules/expo-wcsession/compat (REAL)
 *     →  src/adapters/watch/connectivity `addUserInfoListener` (REAL)
 *     →  src/adapters/watch/handshake `onStartFromWatch` (REAL)
 *     →  in-memory SQLite — session_exercise / "set" rows carry Watch ids.
 *
 * Covered lanes: (1) live event lane, (2) the #54 Phase 2 deaf-lane pull
 * (`reconcileWatchInbound` → `getEventsSince` re-injection) — proving a
 * start-from-watch envelope recovered from the native journal still adopts
 * ids, not just one delivered live. The Swift half (WCSessionHub journals
 * `[String: Any]` verbatim, no key filtering) is source-verified; it cannot
 * run under jest.
 */

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import { listExercises } from '../../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
} from '../../../src/adapters/sqlite/templateRepository';
import type { StartFromWatchPayload, WCMessage } from '../../../src/adapters/watch/payloadSchema';
import type { StartFromWatchReconcile } from '../../../src/adapters/watch/handshake';

type FakeEvt = {
  seq: number;
  epoch: string;
  payload: Record<string, unknown>;
  replyId?: string;
  channel?: 'message' | 'user-info' | 'application-context';
};

type LiveListener = (evt: FakeEvt) => void;

const INDEX_PATH = '../../../modules/expo-wcsession/index';
const COMPAT_PATH = '../../../modules/expo-wcsession/compat';
const CONNECTIVITY_PATH = '../../../src/adapters/watch/connectivity';
const HANDSHAKE_PATH = '../../../src/adapters/watch/handshake';

const WATCH_ID_TREE = {
  seIds: ['watch-se-A'],
  setIds: [['watch-set-0', 'watch-set-1', 'watch-set-2']],
};

describe('start-from-watch idTree over expo-wcsession wire (C-id × #54)', () => {
  let journal: FakeEvt[];
  let epoch: string;
  let live: Record<'message' | 'user-info' | 'application-context', Set<LiveListener>>;

  /** Journal + (unless the deaf-lane test dropped live) fire live listeners. */
  function emitLive(
    channel: NonNullable<FakeEvt['channel']>,
    payload: Record<string, unknown>,
  ): void {
    const evt: FakeEvt = {
      seq: (journal[journal.length - 1]?.seq ?? 0) + 1,
      epoch,
      payload,
      channel,
    };
    journal.push(evt);
    for (const cb of live[channel]) {
      const { channel: _c, ...body } = evt;
      cb(body as FakeEvt);
    }
  }

  function fakeIndexFactory() {
    return {
      getIsPaired: jest.fn().mockResolvedValue(true),
      getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
      getReachability: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({}),
      transferUserInfo: jest.fn(),
      updateApplicationContext: jest.fn(),
      replyToMessage: jest.fn(),
      getLatestSeq: jest.fn(() => ({
        epoch,
        seq: journal[journal.length - 1]?.seq ?? 0,
      })),
      getEventsSince: jest.fn((after: number) => journal.filter((e) => e.seq > after)),
      drainPending: jest.fn(() => []),
      addMessageListener: jest.fn((cb: LiveListener) => {
        live.message.add(cb);
        return () => live.message.delete(cb);
      }),
      addUserInfoListener: jest.fn((cb: LiveListener) => {
        live['user-info'].add(cb);
        return () => live['user-info'].delete(cb);
      }),
      addApplicationContextListener: jest.fn((cb: LiveListener) => {
        live['application-context'].add(cb);
        return () => live['application-context'].delete(cb);
      }),
      addReachabilityListener: jest.fn(() => () => {}),
    };
  }

  // Re-required fresh per test (module state: compat watermark + routes,
  // connectivity msgId ring / listener maps).
  let connectivity: typeof import('../../../src/adapters/watch/connectivity');
  let handshake: typeof import('../../../src/adapters/watch/handshake');
  let compat: typeof import('../../../modules/expo-wcsession/compat');

  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    journal = [];
    epoch = 'epoch-A';
    live = { message: new Set(), 'user-info': new Set(), 'application-context': new Set() };
    jest.resetModules();
    jest.doMock(INDEX_PATH, fakeIndexFactory);
    /* eslint-disable @typescript-eslint/no-require-imports */
    compat = require(COMPAT_PATH);
    connectivity = require(CONNECTIVITY_PATH);
    handshake = require(HANDSHAKE_PATH);
    /* eslint-enable @typescript-eslint/no-require-imports */

    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    connectivity.__resetBridgeForTests();
    compat.__resetCompatStateForTests();
    jest.dontMock(INDEX_PATH);
    db.close();
  });

  /** Same template shape as the C-id unit tests: 1 exercise × 3 sets. */
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

  /** The envelope exactly as the Watch's `sendStartFromWatchTUI` builds it. */
  function watchEnvelope(msgId: string, sessionId: string, templateId: string) {
    return {
      msgId,
      ts: 1_700_000,
      kind: 'start-from-watch',
      payload: {
        sessionId,
        templateId,
        idTree: {
          seIds: [...WATCH_ID_TREE.seIds],
          setIds: WATCH_ID_TREE.setIds.map((s) => [...s]),
        },
      },
    };
  }

  type StartEnv = WCMessage & { kind: 'start-from-watch'; payload: StartFromWatchPayload };

  /** Register the production-shaped handler; resolves with the captured env. */
  function captureStartFromWatch(): { envs: StartEnv[]; unsub: () => void } {
    const envs: StartEnv[] = [];
    const unsub = connectivity.addUserInfoListener('start-from-watch', (msg) => {
      envs.push(msg as StartEnv);
    });
    return { envs, unsub };
  }

  async function assertDbAdoptedWatchIds(sessionId: string): Promise<void> {
    const seRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(seRows.map((r) => r.id)).toEqual(WATCH_ID_TREE.seIds);
    const setRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(setRows.map((r) => r.id)).toEqual(WATCH_ID_TREE.setIds[0]);
  }

  it('live lane: nested idTree survives compat + connectivity intake and the DB adopts the Watch ids', async () => {
    await seedTemplate('tpl-wire-live');
    const { envs } = captureStartFromWatch();

    emitLive('user-info', watchEnvelope('m-live-1', 'sess-wire-live', 'tpl-wire-live'));

    // Envelope reached the kind-keyed handler with the NESTED tree intact —
    // no key whitelist, no array flattening, batch contract unwrapped.
    expect(envs).toHaveLength(1);
    expect(envs[0].payload.idTree).toEqual(WATCH_ID_TREE);

    // Production wiring shape: hand the received env to the orchestrator.
    const reconciles: StartFromWatchReconcile[] = [];
    await handshake.onStartFromWatch(
      db,
      envs[0],
      (r) => reconciles.push(r),
      () => 'IPHONE-MINTED-SHOULD-NOT-APPEAR',
    );

    expect(reconciles).toEqual([{ status: 'created', sessionId: 'sess-wire-live' }]);
    await assertDbAdoptedWatchIds('sess-wire-live');
  });

  it('deaf event lane: idTree survives the #54 journal pull (reconcileWatchInbound) and still adopts', async () => {
    await seedTemplate('tpl-wire-pull');
    const { envs } = captureStartFromWatch();

    // Anchor the watermark with one live delivery, then the lane goes deaf —
    // the envelope lands ONLY in the native journal (the #287 deafness family).
    emitLive('user-info', { kind: 'noise', msgId: 'm-noise' });
    compat.__setDebugDropLiveEventsForTests(true);
    emitLive('user-info', watchEnvelope('m-pull-1', 'sess-wire-pull', 'tpl-wire-pull'));
    expect(envs).toHaveLength(0);

    // Phase 2 heal — the pull re-injects through the SAME deliver() route.
    const r = connectivity.reconcileWatchInbound();
    expect(r).toEqual({ pulled: 1, epochChanged: false });
    expect(envs).toHaveLength(1);
    expect(envs[0].payload.idTree).toEqual(WATCH_ID_TREE);

    const reconciles: StartFromWatchReconcile[] = [];
    await handshake.onStartFromWatch(
      db,
      envs[0],
      (r2) => reconciles.push(r2),
      () => 'IPHONE-MINTED-SHOULD-NOT-APPEAR',
    );

    expect(reconciles).toEqual([{ status: 'created', sessionId: 'sess-wire-pull' }]);
    await assertDbAdoptedWatchIds('sess-wire-pull');
  });
});
