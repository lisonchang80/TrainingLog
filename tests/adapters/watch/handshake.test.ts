/**
 * Slice 13d / D9 — two-stage WC handshake protocol scaffold.
 *
 * Scaffold built by Agent Z 2026-05-27, following V's coverage-audit
 * report `24-overnight-V-coverage-audit.md` item #6 (medium priority).
 *
 * Context — ADR-0019 NEW-Q44 specifies a **two-stage** handshake:
 *
 *   Stage 1 — Watch → iPhone: `handshake` envelope carrying
 *             { requestId, clientVersion }. iPhone replies with a
 *             small payload: { hasActiveSession: bool, sessionId?,
 *             startedAt?, title?, exerciseCount? } — enough for the
 *             Watch picker to decide between Adopt / Discard / Plan.
 *             Reply payload MUST be < ~1KB (Q6/Q7 wire budget).
 *
 *   Stage 2 — Watch → iPhone (lazy, only if user picks Adopt):
 *             `start-from-iphone`-style follow-up that fetches the
 *             full SessionSnapshot. Race-resistant via `requestId`
 *             echo — Watch ignores any Stage 1 reply whose requestId
 *             doesn't match its current pending request.
 *
 * The handshake module is NOT yet land in main as of `8ca6671`.
 * Expected location:
 *   - `src/adapters/watch/handshake.ts` — wraps the protocol layer +
 *     `sessionRepository.getActiveSession` + the (future) snapshot
 *     fetch.
 *
 * Also covered here per V's report:
 *   - **start-from-watch**: Watch picker fires it → iPhone creates
 *     session row + replies with the canonical sessionId + flips
 *     `is_watch_tracked` via `setIsWatchTracked(_, _, true)`
 *     (cross-references setIsWatchTracked.test.ts).
 *   - **start-from-iphone**: iPhone-side session create asks Watch to
 *     adopt; Watch hydrates its mirror from the snapshot.
 *
 * This file is **scaffold-only**. Implementers should:
 *   1. Replace the commented import block once handshake.ts lands.
 *   2. Flip `describe.skip` → `describe`.
 *   3. Fill the test bodies. Sample envelopes use `makeEnvelope`.
 */

import { makeEnvelope } from '../../../src/adapters/watch';
import type {
  HandshakePayload,
  StartFromIphonePayload,
  StartFromWatchPayload,
} from '../../../src/adapters/watch';

// TODO: import once handshake.ts ships:
//   import {
//     onHandshakeRequest,
//     onStartFromWatch,
//     buildStartFromIphone,
//     fetchSessionSnapshot, // Stage 2 lazy fetch
//   } from '../../../src/adapters/watch/handshake';

describe.skip('WC handshake (two-stage, ADR-0019 NEW-Q44) — scaffold', () => {
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

  // -----------------------------------------------------------------
  // Stage 1 — handshake reply shape
  // -----------------------------------------------------------------
  describe('Stage 1 reply shape', () => {
    it.skip(
      'replies with hasActiveSession=false when no active session exists',
      () => {
        // TODO: db is empty → reply payload.hasActiveSession === false
        //       and no sessionId / title / startedAt fields present.
        void stage1Request;
      },
    );

    it.skip(
      'replies with hasActiveSession=true + minimal session summary when an in-progress session exists',
      () => {
        // TODO: createSession in db → reply payload.hasActiveSession === true,
        //       contains sessionId / startedAt / title /
        //       exerciseCount. No full set list — full snapshot is
        //       Stage 2.
      },
    );

    it.skip(
      'reply payload JSON-stringified size is < 1KB even with a 10-exercise session',
      () => {
        // TODO: seed 10 exercises × 5 sets, build reply, assert
        //       JSON.stringify(reply.payload).length < 1024.
        //       Critical because WC sendMessage has a hard 64KB cap
        //       but Stage 1 lives on the realtime channel.
      },
    );

    it.skip(
      'reply echoes the original requestId so the Watch can match it to its pending request',
      () => {
        // TODO: reply payload.requestId === stage1Request.payload.requestId.
      },
    );

    it.todo(
      'TBD — reply ts is the iPhone-side now() or the original request ts?',
    );
  });

  // -----------------------------------------------------------------
  // Stage 2 — lazy snapshot fetch race
  // -----------------------------------------------------------------
  describe('Stage 2 lazy snapshot fetch', () => {
    it.skip(
      'fetchSessionSnapshot returns the full session tree (exercises + sets + clusters) for the Stage-1-reported sessionId',
      () => {
        // TODO: assert the shape matches what liveMirror.test.ts (e)
        //       feeds into its reducer (exercise list + set list).
      },
    );

    it.skip(
      'ignores a Stage 2 fetch whose requestId does not match the currently-pending handshake (race-resistant)',
      () => {
        // TODO: simulate two interleaved handshakes — only the latest
        //       requestId's snapshot is applied. Older reply is dropped.
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

  // -----------------------------------------------------------------
  // start-from-watch path
  // -----------------------------------------------------------------
  describe('start-from-watch (Watch initiator)', () => {
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
        //       with (db, sessionId, true) — or assert via getSession
        //       once the setter lands.
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

  // -----------------------------------------------------------------
  // start-from-iphone path
  // -----------------------------------------------------------------
  describe('start-from-iphone (iPhone initiator)', () => {
    it.skip(
      'buildStartFromIphone serialises the active session into a JSON-primitive snapshot',
      () => {
        // TODO: assert the produced envelope's payload.snapshot is
        //       deep-stringify-safe (no Date, no Map). The D3
        //       normaliseForWire layer enforces this at the envelope
        //       factory boundary — assert the snapshot fields too.
      },
    );

    it.skip(
      'buildStartFromIphone includes a non-empty sessionId and a snapshot record',
      () => {
        // TODO: shape check — payload.sessionId.length > 0, payload.snapshot
        //       is a plain object.
        const sample: StartFromIphonePayload = {
          sessionId: 'sess-1',
          snapshot: { title: 'foo', exerciseCount: 4 },
        };
        // The type alias is referenced here so a future API rename
        // surfaces this scaffold's import in compile errors.
        void sample;
      },
    );
  });
});
