/**
 * Slice 13d Phase B — iphoneLiveMirrorProducer.ts tests.
 *
 * The reverse iPhone→Watch live-mirror producer. Per ADR-0019 § 2026-06-24:
 *   - builds a full snapshot via the shared `fetchSessionSnapshot` (localised
 *     exerciseName + notes), stamps `originator:'iphone'` + a monotonic `rev`,
 *     and projects to the plist-clean OMIT-NULL wire shape (拍板#7 ③);
 *   - DUAL-FIRES through the injected transport — sendMessage + appContext
 *     (拍板#3);
 *   - SUPPRESSES while applying a remote snapshot (拍板#7 ② in-flight gate);
 *   - debounce-coalesces a burst of edits into one push.
 *
 * Transport is INJECTED (a spy), not bridge-mocked — mirrors the receiver
 * test's "take the raw object directly" philosophy. Real in-memory SQLite via
 * better-sqlite3 (same fixture as handshake.test.ts's fetchSessionSnapshot).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import {
  buildLiveMirrorPayload,
  pushLiveMirrorToWatch,
  scheduleLiveMirrorPush,
  beginApplyingRemoteSnapshot,
  endApplyingRemoteSnapshot,
  runWhileApplyingRemoteSnapshot,
  isApplyingRemoteSnapshot,
  LIVE_MIRROR_DEBOUNCE_MS,
  __resetLiveMirrorProducerForTests,
  type LiveMirrorTransport,
} from '../../src/services/iphoneLiveMirrorProducer';
import type { Database } from '../../src/db/types';
import type { LiveMirrorPayload, WCMessage } from '../../src/adapters/watch';

// Bench Press row seeded by v001_initial — stable localised name '槓鈴臥推'.
const BENCH = '00000000-0000-4000-8000-000000000001';

async function makeDb(): Promise<Database> {
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  return db;
}

/**
 * Seed a one-exercise session: set-1 (working, weight 100/reps 5, notes +
 * logged) and set-2 (warmup, null weight/reps — exercises the omit-null path).
 */
async function seedSession(db: Database): Promise<void> {
  await createSession(db, {
    id: 'sess-1',
    started_at: 1_700_000_000_000,
    title: 'Push Day',
  });
  await appendSessionExercise(db, {
    id: 'se-1',
    session_id: 'sess-1',
    exercise_id: BENCH,
  });
  await insertSessionSet(db, {
    id: 'set-1',
    session_id: 'sess-1',
    exercise_id: BENCH,
    weight_kg: 100,
    reps: 5,
    is_skipped: 0,
    ordering: 1,
    created_at: 1_700_000_000_001,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: 'se-1',
  });
  await insertSessionSet(db, {
    id: 'set-2',
    session_id: 'sess-1',
    exercise_id: BENCH,
    weight_kg: null,
    reps: null,
    is_skipped: 0,
    ordering: 2,
    created_at: 1_700_000_000_002,
    set_kind: 'warmup',
    parent_set_id: null,
    session_exercise_id: 'se-1',
  });
  // insertSessionSet doesn't write notes/is_logged — set them directly so we
  // can assert they ride the snapshot.
  await db.runAsync(
    `UPDATE "set" SET notes = ?, is_logged = 1 WHERE id = ?`,
    'felt strong',
    'set-1',
  );
}

function spyTransport(): {
  transport: LiveMirrorTransport;
  sent: WCMessage[];
  appContexts: object[];
} {
  const sent: WCMessage[] = [];
  const appContexts: object[] = [];
  const transport: LiveMirrorTransport = {
    sendMessage: (env) => {
      sent.push(env);
      return Promise.resolve({ ok: true });
    },
    updateAppContext: (snap) => {
      appContexts.push(snap);
    },
  };
  return { transport, sent, appContexts };
}

/** The first (only) exercise's sets in a built payload, typed loosely. */
function firstExerciseSets(payload: LiveMirrorPayload): Record<string, unknown>[] {
  const ex = payload.exercises[0] as Record<string, unknown>;
  return ex.sets as Record<string, unknown>[];
}

afterEach(() => {
  __resetLiveMirrorProducerForTests();
});

describe('buildLiveMirrorPayload', () => {
  it('stamps originator:iphone + a monotonic rev, localises the name, carries notes', async () => {
    const db = await makeDb();
    await seedSession(db);

    const payload = await buildLiveMirrorPayload(db, 'sess-1');
    expect(payload).not.toBeNull();
    expect(payload!.sessionId).toBe('sess-1');
    expect(payload!.title).toBe('Push Day');
    expect(payload!.originator).toBe('iphone');
    expect(typeof payload!.rev).toBe('number');
    expect(payload!.rev! > 0).toBe(true);

    const ex = payload!.exercises[0] as Record<string, unknown>;
    // Bug Y contract — localised at the fetchSessionSnapshot boundary (zh).
    expect(ex.exerciseName).toBe('槓鈴臥推');

    const sets = firstExerciseSets(payload!);
    expect(sets).toHaveLength(2);
    expect(sets[0].setId).toBe('set-1');
    expect(sets[0].weight).toBe(100);
    expect(sets[0].reps).toBe(5);
    expect(sets[0].is_logged).toBe(true);
    expect(sets[0].notes).toBe('felt strong');
  });

  it('OMITS null optionals (plist-clean) — a null-weight warmup set has no weight/reps key', async () => {
    const db = await makeDb();
    await seedSession(db);

    const payload = await buildLiveMirrorPayload(db, 'sess-1');
    const warmup = firstExerciseSets(payload!)[1];
    expect(warmup.setId).toBe('set-2');
    expect(warmup.set_kind).toBe('warmup');
    // Null fields are ABSENT (not present-as-null) — matches the forward Swift
    // producer's omit-nil shape that parseLiveMirrorSnapshot normalises back.
    expect('weight' in warmup).toBe(false);
    expect('reps' in warmup).toBe(false);
    expect('notes' in warmup).toBe(false);
    expect('parent_set_id' in warmup).toBe(false);
    // Required fields stay present.
    expect('ordinal' in warmup).toBe(true);
    expect('is_logged' in warmup).toBe(true);
  });

  it('returns null for an unknown session', async () => {
    const db = await makeDb();
    const payload = await buildLiveMirrorPayload(db, 'sess-missing');
    expect(payload).toBeNull();
  });

  it('advances rev strictly on each build (same session)', async () => {
    const db = await makeDb();
    await seedSession(db);
    const a = await buildLiveMirrorPayload(db, 'sess-1');
    const b = await buildLiveMirrorPayload(db, 'sess-1');
    expect(b!.rev! > a!.rev!).toBe(true);
  });
});

describe('pushLiveMirrorToWatch — dual-fire', () => {
  it('fires BOTH sendMessage (live-mirror envelope) and updateAppContext with the same payload', async () => {
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent, appContexts } = spyTransport();

    const result = await pushLiveMirrorToWatch(db, 'sess-1', transport);
    expect(result.pushed).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('live-mirror');
    const sentPayload = sent[0].payload as LiveMirrorPayload;
    expect(sentPayload.originator).toBe('iphone');
    expect(sentPayload.sessionId).toBe('sess-1');

    expect(appContexts).toHaveLength(1);
    // Same payload CONTENT dual-fired through both channels (makeEnvelope
    // clones into the envelope, so it's not the same reference — deep-equal).
    expect(appContexts[0]).toEqual(sentPayload);
    if (result.pushed) expect(sentPayload.rev).toBe(result.rev);
  });

  it('returns no-session (no transport calls) when the session does not exist', async () => {
    const db = await makeDb();
    const { transport, sent, appContexts } = spyTransport();
    const result = await pushLiveMirrorToWatch(db, 'sess-missing', transport);
    expect(result).toEqual({ pushed: false, reason: 'no-session' });
    expect(sent).toHaveLength(0);
    expect(appContexts).toHaveLength(0);
  });

  it('swallows a transport throw (fire-and-forget) and still fires appContext', async () => {
    const db = await makeDb();
    await seedSession(db);
    const appContexts: object[] = [];
    const transport: LiveMirrorTransport = {
      sendMessage: () => {
        throw new Error('not reachable');
      },
      updateAppContext: (snap) => {
        appContexts.push(snap);
      },
    };
    // Must not reject despite sendMessage throwing synchronously.
    const result = await pushLiveMirrorToWatch(db, 'sess-1', transport);
    expect(result.pushed).toBe(true);
    expect(appContexts).toHaveLength(1);
  });
});

describe('in-flight gate (拍板#7 ②)', () => {
  it('suppresses push while applying a remote snapshot', async () => {
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent, appContexts } = spyTransport();

    beginApplyingRemoteSnapshot();
    expect(isApplyingRemoteSnapshot()).toBe(true);
    const blocked = await pushLiveMirrorToWatch(db, 'sess-1', transport);
    expect(blocked).toEqual({ pushed: false, reason: 'suppressed' });
    expect(sent).toHaveLength(0);
    expect(appContexts).toHaveLength(0);

    endApplyingRemoteSnapshot();
    expect(isApplyingRemoteSnapshot()).toBe(false);
    const allowed = await pushLiveMirrorToWatch(db, 'sess-1', transport);
    expect(allowed.pushed).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('runWhileApplyingRemoteSnapshot brackets the gate and releases on throw', async () => {
    await expect(
      runWhileApplyingRemoteSnapshot(async () => {
        expect(isApplyingRemoteSnapshot()).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Gate released despite the throw.
    expect(isApplyingRemoteSnapshot()).toBe(false);
  });

  it('nested begin/end keeps the gate closed until depth returns to 0', () => {
    beginApplyingRemoteSnapshot();
    beginApplyingRemoteSnapshot();
    endApplyingRemoteSnapshot();
    expect(isApplyingRemoteSnapshot()).toBe(true);
    endApplyingRemoteSnapshot();
    expect(isApplyingRemoteSnapshot()).toBe(false);
  });
});

describe('scheduleLiveMirrorPush — debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces a burst of edits into a single push', async () => {
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent, appContexts } = spyTransport();

    scheduleLiveMirrorPush(db, 'sess-1', transport);
    scheduleLiveMirrorPush(db, 'sess-1', transport);
    scheduleLiveMirrorPush(db, 'sess-1', transport);
    // Nothing fired yet (still within the debounce window).
    expect(sent).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(LIVE_MIRROR_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(appContexts).toHaveLength(1);
  });

  it('does not arm a timer while applying a remote snapshot', async () => {
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent } = spyTransport();

    beginApplyingRemoteSnapshot();
    scheduleLiveMirrorPush(db, 'sess-1', transport);
    endApplyingRemoteSnapshot();

    await jest.advanceTimersByTimeAsync(LIVE_MIRROR_DEBOUNCE_MS);
    expect(sent).toHaveLength(0);
  });
});
