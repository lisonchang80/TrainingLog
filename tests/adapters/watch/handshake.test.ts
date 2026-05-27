/**
 * Slice 13d / D9 partial — pure builder + race-predicate tests.
 *
 * Z's original scaffold (2026-05-27) covered the full handshake
 * module — including impure paths (onHandshakeRequest, onStartFromWatch,
 * fetchSessionSnapshot) that depend on SQLite + the WC sendMessage
 * bridge. This file activates only the **pure** subset that ships
 * with D9 partial; the wire-in describe block at the bottom stays
 * `describe.skip` for the future D9 commit that wires the bridge.
 *
 * Run cold under `testEnvironment: node` — no fake timers, no in-memory
 * DB, no native mocks.
 */

import { makeEnvelope } from '../../../src/adapters/watch';
import type {
  HandshakePayload,
  StartFromIphonePayload,
  StartFromWatchPayload,
} from '../../../src/adapters/watch';
import {
  buildStage1Reply,
  buildStartFromIphone,
  matchesPendingRequest,
  type SessionSnapshot,
  type Stage1ReplyPayload,
  type Stage1SessionSummary,
  type Stage1TemplateSummary,
} from '../../../src/adapters/watch/handshake';

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
// Wire-in scaffold — preserved for the future D9 commit
// =====================================================================

describe.skip('WC handshake (two-stage, ADR-0019 NEW-Q44) — D9 wire-in', () => {
  // Typed sample envelopes — exercise the D3 protocol layer surface.
  const stage1Request = makeEnvelope('handshake', {
    requestId: 'req-abc',
    clientVersion: '13d.0',
  } satisfies HandshakePayload);

  beforeEach(() => {
    // TODO: in-memory BetterSqliteDatabase + migrate, so onHandshakeRequest
    //       can read the active session row via sessionRepository.
    // TODO: jest.spyOn the WC bridge sendMessage to capture the reply
    //       envelope without going to the native module.
  });

  afterEach(() => {
    // TODO: db.close() + jest.restoreAllMocks()
  });

  describe('Stage 1 onHandshakeRequest (impure)', () => {
    it.skip(
      'onHandshakeRequest queries active session + templates, then calls sendMessage with the built reply',
      () => {
        void stage1Request;
      },
    );

    it.skip(
      'onHandshakeRequest replies with hasActiveSession=false when no in-progress row exists',
      () => {
        // TODO: empty db → assert sendMessage payload.hasActiveSession === false
      },
    );

    it.skip(
      'onHandshakeRequest counts session_exercise rows for the active session',
      () => {
        // TODO: seed session + 4 session_exercise rows → assert exerciseCount === 4
      },
    );
  });

  describe('Stage 2 fetchSessionSnapshot (impure)', () => {
    it.skip(
      'fetchSessionSnapshot returns the full session tree for the Stage-1-reported sessionId',
      () => {
        // TODO: assert shape matches the SessionSnapshot type exactly
      },
    );

    it.skip(
      'ignores a Stage 2 fetch whose requestId does not match the currently-pending handshake (race-resistant)',
      () => {
        // TODO: simulate two interleaved handshakes — only the latest
        //       requestId's snapshot is applied. Older reply is dropped
        //       via matchesPendingRequest at the bridge boundary.
      },
    );

    it.skip(
      'returns null / typed empty result when the sessionId no longer exists (user discarded mid-handshake)',
      () => {
        // TODO: Watch held a stale sessionId; iPhone discardSession
        //       happened in the gap — Stage 2 must not crash.
      },
    );
  });

  describe('start-from-watch (Watch initiator, impure)', () => {
    const startFromWatchSample: StartFromWatchPayload = {
      templateId: 'tpl-1',
      programCycleId: 'cyc-1',
      intensityId: 'int-1',
    };

    it.skip(
      'creates a session row when iPhone receives start-from-watch and replies with start-from-iphone',
      () => {
        // TODO: assert createSession was called + reply envelope is
        //       kind: 'start-from-iphone' with the new sessionId.
        void startFromWatchSample;
      },
    );

    it.skip(
      'flips is_watch_tracked=true on the created session (cross-reference setIsWatchTracked.test.ts)',
      () => {
        // TODO: assert sessionRepository.setIsWatchTracked called
        //       with (db, sessionId, true)
      },
    );

    it.skip(
      'handles freestyle path — templateId=null does not throw and creates a session with title=""',
      () => {
        // TODO: payload { templateId: null, programCycleId: null,
        //       intensityId: null } — assert createSession used with
        //       no template, title defaults to ''.
      },
    );
  });
});
