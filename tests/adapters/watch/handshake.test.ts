/**
 * Slice 13d / D9 — handshake module tests.
 *
 * Layout (Z's scaffold 2026-05-27 → D9 partial active subset → D9 wire-in
 * full coverage):
 *
 *   1. Pure builders (Stage 1 reply, matchesPendingRequest,
 *      buildStartFromIphone). No DB, no native mocks.
 *
 *   2. Impure helpers (loadActiveSessionSummary, loadTemplatePrefetchList,
 *      fetchSessionSnapshot) against an in-memory BetterSqliteDatabase
 *      with migrate() applied — same pattern as
 *      `tests/database/setIsWatchTracked.test.ts`.
 *
 *   3. Orchestrators (onHandshakeRequest, onStartFromWatch) — exercise
 *      the reply-handler contract end-to-end without going through the
 *      WC native bridge. The reply payload is captured via a fake
 *      `replyHandler` closure.
 *
 * Run under `testEnvironment: node` — the WC bridge is never loaded
 * because the orchestrators receive an already-parsed envelope and
 * write to a passed `replyHandler` callback.
 */

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
  endSession,
  getActiveSession,
  getSession,
} from '../../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../../src/adapters/sqlite/setRepository';
import { makeEnvelope } from '../../../src/adapters/watch';
import type {
  HandshakePayload,
  StartFromIphonePayload,
  StartFromWatchPayload,
  WCMessage,
} from '../../../src/adapters/watch';
import {
  buildStage1Reply,
  buildStartFromIphone,
  fetchSessionSnapshot,
  loadActiveSessionSummary,
  loadTemplatePrefetchList,
  matchesPendingRequest,
  onHandshakeRequest,
  onStartFromWatch,
  type SessionSnapshot,
  type Stage1ReplyPayload,
  type Stage1SessionSummary,
  type Stage1TemplateSummary,
} from '../../../src/adapters/watch/handshake';

// The Bench Press row seeded by v001_initial — used as a stable
// `exercise_id` foreign key in session_exercise / set seeds. Other
// exercises require explicit insert + `migrate` doesn't seed them.
const BENCH = '00000000-0000-4000-8000-000000000001';

// =====================================================================
// Stage 1 reply (pure builder)
// =====================================================================

describe('WC handshake — Stage 1 reply (pure builder, D9 partial)', () => {
  const sampleRequest: HandshakePayload = {
    requestId: 'req-abc',
    clientVersion: '13d.0',
  };

  // -------------------------------------------------------------------
  // (a) absent-session variant
  // -------------------------------------------------------------------
  it('replies with hasActiveSession=false when activeSession is null', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);

    expect(reply.hasActiveSession).toBe(false);
    expect(reply.requestId).toBe('req-abc');
    expect(reply.prefetch.templates).toEqual([]);
    // Discriminated union — no `session` field on the false variant.
    expect((reply as { session?: unknown }).session).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // (b) present-session variant
  // -------------------------------------------------------------------
  it('replies with hasActiveSession=true and minimal summary when activeSession present', () => {
    const active: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 4,
    };
    const reply = buildStage1Reply(sampleRequest, active, []);

    expect(reply.hasActiveSession).toBe(true);
    if (reply.hasActiveSession) {
      expect(reply.session.sessionId).toBe('sess-1');
      expect(reply.session.startedAt).toBe(1_700_000_000_000);
      expect(reply.session.title).toBe('Push Day');
      expect(reply.session.exerciseCount).toBe(4);
    }
  });

  // -------------------------------------------------------------------
  // (c) requestId echo
  // -------------------------------------------------------------------
  it('echoes the original requestId so the Watch can match the reply to its pending request', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);
    expect(reply.requestId).toBe(sampleRequest.requestId);
  });

  // -------------------------------------------------------------------
  // (d) prefetch list carry-through
  // -------------------------------------------------------------------
  it('carries the provided templates list into the reply prefetch field', () => {
    const templates: Stage1TemplateSummary[] = [
      { templateId: 'tpl-1', name: 'Push' },
      { templateId: 'tpl-2', name: 'Pull' },
      { templateId: 'tpl-3', name: 'Legs' },
    ];
    const reply = buildStage1Reply(sampleRequest, null, templates);

    expect(reply.prefetch.templates).toHaveLength(3);
    expect(reply.prefetch.templates[0]).toEqual({
      templateId: 'tpl-1',
      name: 'Push',
    });
    expect(reply.prefetch.templates[2]).toEqual({
      templateId: 'tpl-3',
      name: 'Legs',
    });
  });

  // -------------------------------------------------------------------
  // (e) size budget — Stage 1 lives on the realtime channel
  //     (WC sendMessage cap is 64KB; we target <2KB with a fat
  //     prefetch list of 20 templates to leave headroom for the
  //     envelope wrap + Watch UI naming).
  // -------------------------------------------------------------------
  it('reply payload JSON-stringified size is < 2KB with 20 templates and an active session', () => {
    const active: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 10,
    };
    const templates: Stage1TemplateSummary[] = Array.from(
      { length: 20 },
      (_, i) => ({
        templateId: `tpl-${i}`,
        name: `Template ${i}`,
      }),
    );
    const reply = buildStage1Reply(sampleRequest, active, templates);
    const size = JSON.stringify(reply).length;

    expect(size).toBeLessThan(2048);
  });

  // -------------------------------------------------------------------
  // (e') size budget — typical case (5 templates) stays well under 1KB
  // -------------------------------------------------------------------
  it('reply payload JSON-stringified size is < 1KB with 5 templates and an active session (typical case)', () => {
    const active: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 10,
    };
    const templates: Stage1TemplateSummary[] = Array.from(
      { length: 5 },
      (_, i) => ({
        templateId: `tpl-${i}`,
        name: `Template ${i}`,
      }),
    );
    const reply = buildStage1Reply(sampleRequest, active, templates);

    expect(JSON.stringify(reply).length).toBeLessThan(1024);
  });

  // -------------------------------------------------------------------
  // (f) referential purity — same inputs → equal outputs
  // -------------------------------------------------------------------
  it('is pure — calling twice with the same args produces deep-equal results', () => {
    const a = buildStage1Reply(sampleRequest, null, []);
    const b = buildStage1Reply(sampleRequest, null, []);
    expect(a).toEqual(b);
  });

  // -------------------------------------------------------------------
  // (g) freestyle title round-trips as empty string
  // -------------------------------------------------------------------
  it('preserves an empty-string title (freestyle path) verbatim', () => {
    const freestyle: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: '',
      exerciseCount: 0,
    };
    const reply = buildStage1Reply(sampleRequest, freestyle, []);

    if (reply.hasActiveSession) {
      expect(reply.session.title).toBe('');
      expect(reply.session.exerciseCount).toBe(0);
    } else {
      throw new Error('expected hasActiveSession=true variant');
    }
  });

  // -------------------------------------------------------------------
  // TBDs — open design questions deferred to the D9 wire-in commit.
  // -------------------------------------------------------------------
  it.todo(
    'TBD — does reply payload carry the iPhone now() ts or the original request ts? (decided at wire-in via makeEnvelope wrap)',
  );
});

// =====================================================================
// matchesPendingRequest (race predicate)
// =====================================================================

describe('WC handshake — matchesPendingRequest (pure predicate)', () => {
  const baseReply: Stage1ReplyPayload = {
    requestId: 'req-abc',
    hasActiveSession: false,
    prefetch: { templates: [] },
  };

  it('returns true when the reply requestId matches the pending nonce', () => {
    expect(matchesPendingRequest(baseReply, 'req-abc')).toBe(true);
  });

  it('returns false when the reply requestId is stale (mismatched)', () => {
    expect(matchesPendingRequest(baseReply, 'req-OLD')).toBe(false);
  });

  it('returns false on empty pending nonce (Watch has no outstanding handshake)', () => {
    expect(matchesPendingRequest(baseReply, '')).toBe(false);
  });
});

// =====================================================================
// Stage 2 buildStartFromIphone (pure transform)
// =====================================================================

describe('WC handshake — buildStartFromIphone (Stage 2 pure transform, D9 partial)', () => {
  const minimalSnapshot: SessionSnapshot = {
    sessionId: 'sess-1',
    title: 'Pull Day',
    startedAt: 1_700_000_000_000,
    exercises: [],
  };

  // -------------------------------------------------------------------
  // (a) sessionId surfaced at payload top-level
  // -------------------------------------------------------------------
  it('packages the snapshot into a StartFromIphonePayload with matching sessionId', () => {
    const payload: StartFromIphonePayload = buildStartFromIphone(minimalSnapshot);

    expect(payload.sessionId).toBe('sess-1');
    expect(typeof payload.snapshot).toBe('object');
    expect(payload.snapshot).not.toBeNull();
  });

  // -------------------------------------------------------------------
  // (b) JSON-primitive-clean (round-trips through stringify)
  // -------------------------------------------------------------------
  it('produces a JSON-primitive-clean payload (round-trips through JSON.stringify)', () => {
    const payload = buildStartFromIphone(minimalSnapshot);
    const roundTripped = JSON.parse(JSON.stringify(payload));

    expect(roundTripped).toEqual(payload);
  });

  // -------------------------------------------------------------------
  // (c) snapshot fields preserved verbatim
  // -------------------------------------------------------------------
  it('preserves snapshot fields verbatim (title, startedAt)', () => {
    const payload = buildStartFromIphone(minimalSnapshot);

    expect(payload.snapshot.title).toBe('Pull Day');
    expect(payload.snapshot.startedAt).toBe(1_700_000_000_000);
  });

  // -------------------------------------------------------------------
  // (d) full session tree projection — exercises + sets
  // -------------------------------------------------------------------
  it('serialises a full session tree (exercises + sets) without dropping fields', () => {
    const full: SessionSnapshot = {
      sessionId: 'sess-2',
      title: 'Leg Day',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: 'ex-squat',
          exerciseName: 'Back Squat',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: 100,
              reps: 5,
              rpe: 8,
              rest_sec: 180,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
            {
              setId: 'set-2',
              ordinal: 1,
              weight: 105,
              reps: 5,
              rpe: 8.5,
              rest_sec: 180,
              notes: 'felt heavy',
              set_kind: 'working',
              is_logged: false,
            },
          ],
        },
      ],
    };
    const payload = buildStartFromIphone(full);

    expect(payload.snapshot.exercises).toEqual([
      {
        sessionExerciseId: 'se-1',
        exerciseId: 'ex-squat',
        exerciseName: 'Back Squat',
        ordering: 0,
        plannedSets: 3,
        sets: [
          {
            setId: 'set-1',
            ordinal: 0,
            weight: 100,
            reps: 5,
            rpe: 8,
            rest_sec: 180,
            notes: null,
            set_kind: 'working',
            is_logged: true,
          },
          {
            setId: 'set-2',
            ordinal: 1,
            weight: 105,
            reps: 5,
            rpe: 8.5,
            rest_sec: 180,
            notes: 'felt heavy',
            set_kind: 'working',
            is_logged: false,
          },
        ],
      },
    ]);
  });

  // -------------------------------------------------------------------
  // (e) survives makeEnvelope normaliseForWire — wire-format invariant
  // -------------------------------------------------------------------
  it('produces a payload that survives makeEnvelope normaliseForWire', () => {
    const payload = buildStartFromIphone(minimalSnapshot);
    const env = makeEnvelope('start-from-iphone', payload);

    expect(env.kind).toBe('start-from-iphone');
    expect(env.payload.sessionId).toBe('sess-1');
    expect(env.payload.snapshot).toEqual(payload.snapshot);
  });

  // -------------------------------------------------------------------
  // (f) null-valued fields survive (warmup with no weight/reps yet)
  // -------------------------------------------------------------------
  it('preserves null-valued set fields (placeholder rows pre-logging)', () => {
    const withPlaceholders: SessionSnapshot = {
      sessionId: 'sess-3',
      title: '',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: 'ex-bench',
          exerciseName: 'Bench',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: null,
              reps: null,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'warmup',
              is_logged: false,
            },
          ],
        },
      ],
    };
    const payload = buildStartFromIphone(withPlaceholders);
    const exercises = payload.snapshot.exercises as unknown as ReadonlyArray<{
      sets: ReadonlyArray<Record<string, unknown>>;
    }>;
    const set0 = exercises[0].sets[0];

    expect(set0.weight).toBeNull();
    expect(set0.reps).toBeNull();
    expect(set0.rpe).toBeNull();
    expect(set0.notes).toBeNull();
    expect(set0.set_kind).toBe('warmup');
  });

  // -------------------------------------------------------------------
  // TBDs — wire-in concerns
  // -------------------------------------------------------------------
  it.todo(
    'fetchSessionSnapshot returns the session tree for a given sessionId (impure — D9 wire-in)',
  );
  it.todo(
    'fetchSessionSnapshot returns null/typed empty when sessionId no longer exists (impure — D9 wire-in)',
  );
});

// =====================================================================
// Impure helpers — DB-backed (D9 wire-in)
// =====================================================================

describe('WC handshake — impure helpers (in-memory SQLite, D9 wire-in)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------
  // loadActiveSessionSummary
  // -------------------------------------------------------------------

  describe('loadActiveSessionSummary', () => {
    it('returns null when no in-progress session exists', async () => {
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toBeNull();
    });

    it('returns minimal summary with exerciseCount=0 for a bare freestyle session', async () => {
      await createSession(db, {
        id: 'sess-bare',
        started_at: 1_700_000_000_000,
      });
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toEqual({
        sessionId: 'sess-bare',
        startedAt: 1_700_000_000_000,
        title: '',
        exerciseCount: 0,
      });
    });

    it('counts session_exercise rows for the active session', async () => {
      await createSession(db, {
        id: 'sess-plan',
        started_at: 1_700_000_000_000,
        title: 'Push Day',
      });
      // Seed 3 session_exercise rows; appendSessionExercise refuses
      // dup solo exercise so each row uses a different exercise_id.
      // BENCH is the only seeded exercise — insert two more via raw
      // SQL to avoid spinning up exerciseRepository fixtures here.
      await db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, ?, ?)`,
        '00000000-0000-4000-8000-000000000099',
        'TestEx2',
        'loaded',
        0,
      );
      await db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, ?, ?)`,
        '00000000-0000-4000-8000-00000000009a',
        'TestEx3',
        'loaded',
        0,
      );
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-plan',
        exercise_id: BENCH,
      });
      await appendSessionExercise(db, {
        id: 'se-2',
        session_id: 'sess-plan',
        exercise_id: '00000000-0000-4000-8000-000000000099',
      });
      await appendSessionExercise(db, {
        id: 'se-3',
        session_id: 'sess-plan',
        exercise_id: '00000000-0000-4000-8000-00000000009a',
      });

      const summary = await loadActiveSessionSummary(db);
      expect(summary?.exerciseCount).toBe(3);
      expect(summary?.title).toBe('Push Day');
    });

    it('skips ended sessions (ended_at IS NOT NULL)', async () => {
      await createSession(db, {
        id: 'sess-done',
        started_at: 1_700_000_000_000,
      });
      await endSession(db, { id: 'sess-done', ended_at: 1_700_000_100_000 });
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // loadTemplatePrefetchList
  // -------------------------------------------------------------------

  describe('loadTemplatePrefetchList', () => {
    it('returns empty array when no templates exist', async () => {
      const list = await loadTemplatePrefetchList(db);
      expect(list).toEqual([]);
    });

    it('projects (id, name) and caps at the limit', async () => {
      const now = 1_700_000_000_000;
      for (let i = 0; i < 3; i++) {
        await db.runAsync(
          `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
          `tpl-${i}`,
          `Template ${i}`,
          now + i,
          now + i,
        );
      }
      const list = await loadTemplatePrefetchList(db, 20);
      expect(list).toHaveLength(3);
      // listTemplates orders by updated_at DESC, so newest (tpl-2) first.
      expect(list[0]).toEqual({ templateId: 'tpl-2', name: 'Template 2' });
      expect(list[2]).toEqual({ templateId: 'tpl-0', name: 'Template 0' });
    });

    it('respects the limit parameter (caps to first N)', async () => {
      const now = 1_700_000_000_000;
      for (let i = 0; i < 25; i++) {
        await db.runAsync(
          `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
          `tpl-${i}`,
          `Template ${i}`,
          now + i,
          now + i,
        );
      }
      const list = await loadTemplatePrefetchList(db, 20);
      expect(list).toHaveLength(20);
    });

    it('defaults to 20 templates max (size-budget invariant)', async () => {
      const now = 1_700_000_000_000;
      for (let i = 0; i < 30; i++) {
        await db.runAsync(
          `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
          `tpl-${i}`,
          `Template ${i}`,
          now + i,
          now + i,
        );
      }
      const list = await loadTemplatePrefetchList(db);
      expect(list).toHaveLength(20);
    });
  });

  // -------------------------------------------------------------------
  // fetchSessionSnapshot
  // -------------------------------------------------------------------

  describe('fetchSessionSnapshot', () => {
    it('returns null when sessionId does not exist (Watch held stale id)', async () => {
      const snap = await fetchSessionSnapshot(db, 'sess-missing');
      expect(snap).toBeNull();
    });

    it('returns empty exercises[] for a bare freestyle session with no plan', async () => {
      await createSession(db, {
        id: 'sess-bare',
        started_at: 1_700_000_000_000,
      });
      const snap = await fetchSessionSnapshot(db, 'sess-bare');
      expect(snap).not.toBeNull();
      expect(snap?.sessionId).toBe('sess-bare');
      expect(snap?.title).toBe('');
      expect(snap?.exercises).toEqual([]);
    });

    it('hydrates exercises + sets (with column renames at the wire boundary)', async () => {
      await createSession(db, {
        id: 'sess-full',
        started_at: 1_700_000_000_000,
        title: 'Pull Day',
      });
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-full',
        exercise_id: BENCH,
      });
      // Seed two sets attached to se-1.
      await insertSessionSet(db, {
        id: 'set-1',
        session_id: 'sess-full',
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
        session_id: 'sess-full',
        exercise_id: BENCH,
        weight_kg: 105,
        reps: 4,
        is_skipped: 0,
        ordering: 2,
        created_at: 1_700_000_000_002,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: 'se-1',
      });

      const snap = await fetchSessionSnapshot(db, 'sess-full');
      expect(snap?.title).toBe('Pull Day');
      expect(snap?.exercises).toHaveLength(1);
      const ex = snap?.exercises[0];
      expect(ex?.exerciseId).toBe(BENCH);
      expect(ex?.exerciseName).toBe('Bench Press');
      expect(ex?.sets).toHaveLength(2);
      // Column renames at the wire boundary:
      //   weight_kg → weight
      //   ordering  → ordinal
      //   is_logged (number 0/1) → is_logged (boolean)
      expect(ex?.sets[0].weight).toBe(100);
      expect(ex?.sets[0].ordinal).toBe(1);
      expect(ex?.sets[0].is_logged).toBe(false);
      expect(ex?.sets[1].weight).toBe(105);
      expect(ex?.sets[1].ordinal).toBe(2);
      // rpe + rest_sec defaults — no schema column for rpe yet; rest_sec
      // denormalises from session_exercise (null when unset).
      expect(ex?.sets[0].rpe).toBeNull();
      expect(ex?.sets[0].rest_sec).toBeNull();
    });

    it('drops sets whose session_exercise_id is null (legacy backfill miss)', async () => {
      await createSession(db, {
        id: 'sess-orphan',
        started_at: 1_700_000_000_000,
      });
      await appendSessionExercise(db, {
        id: 'se-orphan',
        session_id: 'sess-orphan',
        exercise_id: BENCH,
      });
      // Orphan set — has session_exercise_id explicitly NULL.
      await insertSessionSet(db, {
        id: 'set-orphan',
        session_id: 'sess-orphan',
        exercise_id: BENCH,
        weight_kg: 50,
        reps: 5,
        is_skipped: 0,
        ordering: 1,
        created_at: 1_700_000_000_001,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: null,
      });
      const snap = await fetchSessionSnapshot(db, 'sess-orphan');
      // Exercise card hydrates with empty sets[] — the orphan set is dropped.
      expect(snap?.exercises[0].sets).toEqual([]);
    });

    it('handles null-valued set fields (placeholder rows pre-logging)', async () => {
      await createSession(db, {
        id: 'sess-warmup',
        started_at: 1_700_000_000_000,
      });
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-warmup',
        exercise_id: BENCH,
      });
      await insertSessionSet(db, {
        id: 'set-warm',
        session_id: 'sess-warmup',
        exercise_id: BENCH,
        weight_kg: null,
        reps: null,
        is_skipped: 0,
        ordering: 1,
        created_at: 1_700_000_000_001,
        set_kind: 'warmup',
        parent_set_id: null,
        session_exercise_id: 'se-1',
      });
      const snap = await fetchSessionSnapshot(db, 'sess-warmup');
      const set0 = snap?.exercises[0].sets[0];
      expect(set0?.weight).toBeNull();
      expect(set0?.reps).toBeNull();
      expect(set0?.set_kind).toBe('warmup');
    });
  });
});

// =====================================================================
// Orchestrators — D9 wire-in (handshake + start-from-watch)
// =====================================================================

describe('WC handshake — onHandshakeRequest (orchestrator, D9 wire-in)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (requestId = 'req-1'): WCMessage & {
    kind: 'handshake';
    payload: HandshakePayload;
  } =>
    makeEnvelope('handshake', {
      requestId,
      clientVersion: '13d.0',
    } satisfies HandshakePayload);

  it('replies with hasActiveSession=false on an empty DB', async () => {
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    expect(replies).toHaveLength(1);
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.requestId).toBe('req-1');
    expect(reply.hasActiveSession).toBe(false);
    expect(reply.prefetch.templates).toEqual([]);
  });

  it('replies with hasActiveSession=true + session summary + templates when both are present', async () => {
    await createSession(db, {
      id: 'sess-x',
      started_at: 1_700_000_000_000,
      title: 'Push',
    });
    await appendSessionExercise(db, {
      id: 'se-1',
      session_id: 'sess-x',
      exercise_id: BENCH,
    });
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-1',
      'My Template',
      1_700_000_000_000,
      1_700_000_000_000,
    );

    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv('req-X'), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;

    expect(reply.requestId).toBe('req-X');
    expect(reply.hasActiveSession).toBe(true);
    if (reply.hasActiveSession) {
      expect(reply.session.sessionId).toBe('sess-x');
      expect(reply.session.title).toBe('Push');
      expect(reply.session.exerciseCount).toBe(1);
    }
    expect(reply.prefetch.templates).toHaveLength(1);
    expect(reply.prefetch.templates[0]).toEqual({
      templateId: 'tpl-1',
      name: 'My Template',
    });
  });

  it('silently drops the request when replyHandler is undefined (lib bug / TUI fallback)', async () => {
    // Should not throw. With no replyHandler the orchestrator has
    // nowhere to send the result, so it skips DB work entirely.
    await expect(
      onHandshakeRequest(db, buildEnv(), undefined),
    ).resolves.toBeUndefined();
  });

  it('falls back to empty reply when the DB read throws (best-effort semantics)', async () => {
    // Close the db so any subsequent read throws — exercise the catch branch.
    db.close();
    const replies: Record<string, unknown>[] = [];
    // Use a fresh closed db; the catch block must still call replyHandler
    // with a synthetic empty payload (Watch picker shouldn't hang).
    await onHandshakeRequest(db, buildEnv('req-err'), (r) => replies.push(r));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({
      requestId: 'req-err',
      hasActiveSession: false,
      prefetch: { templates: [] },
    });
    // Re-open before afterEach.close() runs (harmless re-close otherwise).
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
});

describe('WC handshake — onStartFromWatch (orchestrator, D9 wire-in)', () => {
  let db: BetterSqliteDatabase;
  let uuidCounter = 0;
  const uuid = () => `uid-${++uuidCounter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (
    payload: StartFromWatchPayload,
  ): WCMessage & {
    kind: 'start-from-watch';
    payload: StartFromWatchPayload;
  } => makeEnvelope('start-from-watch', payload);

  it('creates a freestyle session when templateId is null + replies with the snapshot', async () => {
    const replies: Record<string, unknown>[] = [];
    await onStartFromWatch(
      db,
      buildEnv({ templateId: null, programCycleId: null, intensityId: null }),
      uuid,
      (r) => replies.push(r),
    );

    const reply = replies[0] as unknown as StartFromIphonePayload;
    expect(reply.sessionId).not.toBe('');
    expect(reply.snapshot).toBeDefined();

    // The created session is the active one + freestyle title = ''.
    const active = await getActiveSession(db);
    expect(active?.id).toBe(reply.sessionId);
    expect(active?.title).toBe('');
  });

  it('flips is_watch_tracked=true on the created session', async () => {
    const replies: Record<string, unknown>[] = [];
    await onStartFromWatch(
      db,
      buildEnv({ templateId: null, programCycleId: null, intensityId: null }),
      uuid,
      (r) => replies.push(r),
    );
    const reply = replies[0] as unknown as StartFromIphonePayload;
    const session = await getSession(db, reply.sessionId);
    expect(session?.is_watch_tracked).toBe(true);
  });

  it('adopts an existing active session instead of creating a duplicate (race-safe)', async () => {
    await createSession(db, {
      id: 'pre-existing',
      started_at: 1_700_000_000_000,
      title: 'Pre',
    });
    const replies: Record<string, unknown>[] = [];
    await onStartFromWatch(
      db,
      buildEnv({ templateId: null, programCycleId: null, intensityId: null }),
      uuid,
      (r) => replies.push(r),
    );
    const reply = replies[0] as unknown as StartFromIphonePayload;
    expect(reply.sessionId).toBe('pre-existing');
    // Watch initiated adoption still flips the tracked flag.
    const session = await getSession(db, 'pre-existing');
    expect(session?.is_watch_tracked).toBe(true);
  });

  it('silently no-ops when replyHandler is undefined (lib bug / TUI fallback)', async () => {
    await expect(
      onStartFromWatch(
        db,
        buildEnv({ templateId: null, programCycleId: null, intensityId: null }),
        uuid,
        undefined,
      ),
    ).resolves.toBeUndefined();
    // No session was created (orchestrator early-returns).
    const active = await getActiveSession(db);
    expect(active).toBeNull();
  });

  it('replies with empty payload when create / fetch path throws (best-effort)', async () => {
    db.close();
    const replies: Record<string, unknown>[] = [];
    await onStartFromWatch(
      db,
      buildEnv({ templateId: null, programCycleId: null, intensityId: null }),
      uuid,
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({ sessionId: '', snapshot: {} });
    // Re-open db so afterEach.close() doesn't crash.
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  // -------------------------------------------------------------------
  // Sample envelope kept for typing — exercise the protocol surface.
  // -------------------------------------------------------------------
  it('typed StartFromWatchPayload sample envelope round-trips through makeEnvelope', () => {
    const sample: StartFromWatchPayload = {
      templateId: 'tpl-1',
      programCycleId: 'cyc-1',
      intensityId: 'int-1',
    };
    const env = makeEnvelope('start-from-watch', sample);
    expect(env.kind).toBe('start-from-watch');
    expect(env.payload).toEqual(sample);
  });
});
