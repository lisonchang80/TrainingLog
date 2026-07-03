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
  updateSessionExerciseRestSec,
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
import { parseLiveMirrorSnapshot } from '../../src/services/watchLiveMirrorReceiver';
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

  it('item1 — carries per-exercise restSec on the wire, omit-null when unset', async () => {
    const db = await makeDb();
    await seedSession(db);
    // Default: no rest set on the session_exercise → restSec ABSENT (omit-null).
    let payload = await buildLiveMirrorPayload(db, 'sess-1');
    let ex = payload!.exercises[0] as Record<string, unknown>;
    expect('restSec' in ex).toBe(false);
    // After an in-session rest edit (⚙️ menu ⏱️ keypad) → restSec rides the wire
    // so the Watch apply can map it to `restOverride[seId]`.
    await updateSessionExerciseRestSec(db, 'se-1', 120);
    payload = await buildLiveMirrorPayload(db, 'sess-1');
    ex = payload!.exercises[0] as Record<string, unknown>;
    expect(ex.restSec).toBe(120);
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

  it('coalesces a burst but reflects the LATEST db state at fire time', async () => {
    // The debounce timer's callback re-reads the DB at FIRE time (not at
    // schedule time) — so a mutation that lands DURING the window rides the
    // single coalesced push. This proves the producer is not snapshotting
    // state at the first edit and replaying it stale.
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent } = spyTransport();

    scheduleLiveMirrorPush(db, 'sess-1', transport); // edit #1 (weight still 100)
    // A later edit mutates the DB before the debounce elapses.
    await db.runAsync(`UPDATE "set" SET weight_kg = 140 WHERE id = ?`, 'set-1');
    scheduleLiveMirrorPush(db, 'sess-1', transport); // edit #2 — resets the timer
    expect(sent).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(LIVE_MIRROR_DEBOUNCE_MS);
    // Exactly ONE push, carrying the LATEST weight (140), not the first (100).
    expect(sent).toHaveLength(1);
    const sets = firstExerciseSets(sent[0].payload as LiveMirrorPayload);
    expect(sets[0].weight).toBe(140);
  });
});

// ---------------------------------------------------------------------
// Wire-contract fidelity — the projected payload must MIRROR the forward
// Swift `SessionSnapshot` Codable shape exactly (the future Phase C Watch
// decoder is the consumer). Field NAMES + omit-null behaviour are the
// load-bearing contract: a snake_case/camelCase slip or a dropped follower
// link silently fails to apply on the Watch later = a wasted device session.
// Canonical shape: ios/.../SessionSnapshot.swift CodingKeys + LiveMirrorProducer.
//   set:      setId, ordinal, weight, reps, rpe, notes, rest_sec, set_kind,
//             is_logged, parent_set_id, display_rank
//   exercise: sessionExerciseId, exerciseId, exerciseName, ordering,
//             plannedSets, sets, parentId, reusableSupersetId
//   top:      sessionId, title, startedAt, exercises, rev, originator
// ---------------------------------------------------------------------
describe('wire-contract fidelity (mirrors forward Swift SessionSnapshot)', () => {
  it('every emitted key matches the forward Swift CodingKeys (snake_case set fields)', async () => {
    const db = await makeDb();
    await seedSession(db);
    const payload = await buildLiveMirrorPayload(db, 'sess-1');

    // Top-level keys.
    expect(Object.keys(payload!).sort()).toEqual(
      ['exercises', 'originator', 'rev', 'sessionId', 'startedAt', 'title'].sort(),
    );

    const ex = payload!.exercises[0] as Record<string, unknown>;
    // Exercise keys — solo bench, so no parentId / reusableSupersetId.
    expect(Object.keys(ex).sort()).toEqual(
      ['exerciseId', 'exerciseName', 'ordering', 'plannedSets', 'sessionExerciseId', 'sets'].sort(),
    );

    const logged = firstExerciseSets(payload!)[0];
    // The logged working set carries its non-null fields. CRITICAL: the keys
    // are snake_case (set_kind / is_logged — NOT setKind / isLogged), matching
    // the Swift CodingKeys rename. A camelCase slip here = silent decode-to-
    // default on the Watch. `rest_sec` is ABSENT here because the seeded
    // session_exercise has a NULL rest_sec (fetchSessionSnapshot denormalises
    // session_exercise.rest_sec onto each set → null → omit-null).
    expect(Object.keys(logged).sort()).toEqual(
      ['is_logged', 'notes', 'ordinal', 'reps', 'setId', 'set_kind', 'weight'].sort(),
    );
    // rpe / rest_sec / parent_set_id / display_rank ABSENT (all null in this
    // fixture → omit-null), NOT present-as-null and NOT renamed.
    expect('rpe' in logged).toBe(false);
    expect('rest_sec' in logged).toBe(false);
    expect('parent_set_id' in logged).toBe(false);
    expect('display_rank' in logged).toBe(false);
    // No camelCase aliases leaked.
    expect('setKind' in logged).toBe(false);
    expect('isLogged' in logged).toBe(false);
    expect('restSec' in logged).toBe(false);
    expect('parentSetId' in logged).toBe(false);
  });

  it('a dropset follower carries parent_set_id (chain head→follower rides the wire)', async () => {
    const db = await makeDb();
    await createSession(db, {
      id: 'sess-ds',
      started_at: 1_700_000_000_000,
      title: 'Drop',
    });
    await appendSessionExercise(db, {
      id: 'se-ds',
      session_id: 'sess-ds',
      exercise_id: BENCH,
    });
    // Head (working) + follower (dropset, parent_set_id → head). Same
    // session_exercise_id so fetchSessionSnapshot buckets them together.
    await insertSessionSet(db, {
      id: 'head-1',
      session_id: 'sess-ds',
      exercise_id: BENCH,
      weight_kg: 100,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_001,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-ds',
    });
    await insertSessionSet(db, {
      id: 'follow-1',
      session_id: 'sess-ds',
      exercise_id: BENCH,
      weight_kg: 80,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: 1_700_000_000_002,
      set_kind: 'dropset',
      parent_set_id: 'head-1',
      session_exercise_id: 'se-ds',
    });

    const payload = await buildLiveMirrorPayload(db, 'sess-ds');
    const sets = firstExerciseSets(payload!);
    expect(sets).toHaveLength(2);
    const head = sets.find((s) => s.setId === 'head-1')!;
    const follower = sets.find((s) => s.setId === 'follow-1')!;
    // Head: no parent_set_id key (omit-null). Follower: parent_set_id = head id.
    expect('parent_set_id' in head).toBe(false);
    expect(follower.parent_set_id).toBe('head-1');
    expect(follower.set_kind).toBe('dropset');
  });

  it('a reusable-superset exercise carries parentId + reusableSupersetId', async () => {
    const db = await makeDb();
    await createSession(db, {
      id: 'sess-rs',
      started_at: 1_700_000_000_000,
      title: 'RS',
    });
    await appendSessionExercise(db, {
      id: 'se-rs',
      session_id: 'sess-rs',
      exercise_id: BENCH,
    });
    // reusable_superset_id is an FK to superset(id) → seed the superset row
    // first. parent_id has no FK (free text mirroring template_exercise).
    await db.runAsync(
      `INSERT INTO superset (id, name, use_count, created_at, updated_at)
       VALUES ('rs-42', 'Push Combo', 0, 1, 1)`,
    );
    // appendSessionExercise always inserts cluster cols NULL — set them
    // directly to exercise the exercise-level omit-null path.
    await db.runAsync(
      `UPDATE session_exercise SET parent_id = ?, reusable_superset_id = ? WHERE id = ?`,
      'se-parent',
      'rs-42',
      'se-rs',
    );

    const payload = await buildLiveMirrorPayload(db, 'sess-rs');
    const ex = payload!.exercises[0] as Record<string, unknown>;
    expect(ex.parentId).toBe('se-parent');
    expect(ex.reusableSupersetId).toBe('rs-42');
    // No snake_case alias leaked (Swift CodingKeys use camelCase for these two).
    expect('reusable_superset_id' in ex).toBe(false);
    expect('parent_id' in ex).toBe(false);
  });

  it('an exercise with ZERO sets projects an empty sets array (no crash)', async () => {
    const db = await makeDb();
    await createSession(db, {
      id: 'sess-empty',
      started_at: 1_700_000_000_000,
      title: 'Empty',
    });
    await appendSessionExercise(db, {
      id: 'se-empty',
      session_id: 'sess-empty',
      exercise_id: BENCH,
    });

    const payload = await buildLiveMirrorPayload(db, 'sess-empty');
    expect(payload).not.toBeNull();
    const ex = payload!.exercises[0] as Record<string, unknown>;
    expect(ex.sets).toEqual([]);
  });

  it('a session with zero exercises projects an empty exercises array', async () => {
    const db = await makeDb();
    await createSession(db, {
      id: 'sess-noex',
      started_at: 1_700_000_000_000,
      title: 'Bare',
    });
    const payload = await buildLiveMirrorPayload(db, 'sess-noex');
    expect(payload).not.toBeNull();
    expect(payload!.exercises).toEqual([]);
  });

  it('the projected payload round-trips through the forward parser unchanged', async () => {
    // The strongest contract assertion: feed the producer's own wire payload
    // (originator flipped to watch, since the parser's echo-drop is upstream of
    // it) into parseLiveMirrorSnapshot — the SAME validator the proven forward
    // Watch→iPhone direction uses. If a field name / nullability were wrong the
    // parser would reject it (null) or drop a field. A clean parse proves the
    // reverse wire shape is byte-compatible with the forward contract.
    const db = await makeDb();
    await seedSession(db);
    const payload = await buildLiveMirrorPayload(db, 'sess-1');
    // Simulate the JSON round-trip the WC bridge performs (omit-null survives).
    const onWire = JSON.parse(JSON.stringify(payload));
    const parsed = parseLiveMirrorSnapshot(onWire);
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe('sess-1');
    expect(parsed!.originator).toBe('iphone');
    expect(parsed!.rev).toBe(payload!.rev);
    const s0 = parsed!.exercises[0]!.sets[0]!;
    // Omitted nulls normalise back to null on parse — the omit-null contract.
    expect(s0.weight).toBe(100);
    expect(s0.rpe).toBeNull();
    expect(s0.display_rank).toBeNull();
    const s1 = parsed!.exercises[0]!.sets[1]!;
    expect(s1.weight).toBeNull(); // the warmup set's omitted weight → null
    expect(s1.parent_set_id).toBeNull();
  });
});

// ---------------------------------------------------------------------
// rev monotonicity — the iPhone's OWN per-session high-water (拍板#7 ①), a
// SEPARATE counter from the watch-rev the receiver tracks. Must be strictly
// increasing within a session across any build/push/scheduled-push mix, and
// independent across sessions.
// ---------------------------------------------------------------------
describe('rev monotonicity', () => {
  it('strictly increases across a build → push → scheduled-push mix (same session)', async () => {
    jest.useFakeTimers();
    try {
      const db = await makeDb();
      await seedSession(db);
      const { transport, sent } = spyTransport();

      const r1 = (await buildLiveMirrorPayload(db, 'sess-1'))!.rev!;
      const p2 = await pushLiveMirrorToWatch(db, 'sess-1', transport);
      expect(p2.pushed).toBe(true);
      const r2 = p2.pushed ? p2.rev : -1;
      scheduleLiveMirrorPush(db, 'sess-1', transport);
      await jest.advanceTimersByTimeAsync(LIVE_MIRROR_DEBOUNCE_MS);
      // The scheduled push fired — its payload is the last entry in `sent`.
      const r3 = (sent[sent.length - 1].payload as LiveMirrorPayload).rev!;

      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps independent high-water marks per session (no cross-session gating)', async () => {
    const db = await makeDb();
    await seedSession(db); // sess-1
    await createSession(db, {
      id: 'sess-2',
      started_at: 1_700_000_000_000,
      title: 'Other',
    });

    // Advance sess-1's rev several times.
    await buildLiveMirrorPayload(db, 'sess-1');
    await buildLiveMirrorPayload(db, 'sess-1');
    const s1 = (await buildLiveMirrorPayload(db, 'sess-1'))!.rev!;
    // sess-2's FIRST build starts from its own (empty) counter — its rev is
    // governed only by Date.now()+max, never by sess-1's high-water.
    const s2 = (await buildLiveMirrorPayload(db, 'sess-2'))!.rev!;
    // Both are valid monotonic stamps; neither inherits the other's counter.
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(0);
    // A further sess-1 build still advances strictly above its own last rev,
    // unaffected by sess-2's interleaved build.
    const s1b = (await buildLiveMirrorPayload(db, 'sess-1'))!.rev!;
    expect(s1b).toBeGreaterThan(s1);
  });
});

// ---------------------------------------------------------------------
// In-flight gate — the re-check AFTER the DB await (拍板#7 ②). A push must
// be suppressed even when the apply gate OPENS mid-build (the await window).
// ---------------------------------------------------------------------
describe('in-flight gate — re-check after the await', () => {
  it('suppresses a push when the apply gate closes DURING the DB read', async () => {
    const db = await makeDb();
    await seedSession(db);
    const { transport, sent, appContexts } = spyTransport();

    // Wrap the db so the first getFirstAsync (the snapshot session-row read)
    // opens the apply gate the instant the producer awaits it — modelling an
    // inbound remote-apply that begins between the gate's pre-check and the
    // post-await re-check. The producer must observe applyDepth > 0 on the
    // re-check and return { suppressed } WITHOUT firing either channel.
    let armed = false;
    const racingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'getFirstAsync') {
          return (...args: unknown[]) => {
            if (!armed) {
              armed = true;
              beginApplyingRemoteSnapshot(); // gate opens mid-build
            }
            return (target.getFirstAsync as (...a: unknown[]) => unknown)(
              ...args,
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Database;

    const result = await pushLiveMirrorToWatch(racingDb, 'sess-1', transport);
    expect(result).toEqual({ pushed: false, reason: 'suppressed' });
    expect(sent).toHaveLength(0);
    expect(appContexts).toHaveLength(0);

    endApplyingRemoteSnapshot(); // cleanup
  });
});
