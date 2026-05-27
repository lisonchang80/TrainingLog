/**
 * Slice 13d / D19 — Live Mirror reducer tests.
 *
 * Activated 2026-05-27. Scaffold from Agent Z (item #4 of V coverage
 * audit) now points at the real `liveMirrorReducer` shipped under
 * `src/services/liveMirrorReducer.ts`.
 *
 * Reducer surface (per ADR-0019 § Q19, NEW-Q40/Q41/Q43):
 *   - 6 mirror-affecting kinds (`set-completed/-modified/-deleted/-added`
 *     and `exercise-added/-deleted`) mutate state via immutable transforms.
 *   - 7 out-of-scope kinds are no-ops (referential equality preserved).
 *   - Coarse stale-ts rule: drop any envelope with `ts <= lastAppliedTs`.
 *   - Defensive: null / unknown-kind envelopes return state unchanged.
 *
 * Per-field LWW reconciliation under `set-modified` crosses to
 * `lww.test.ts` (D20); this file only validates the reducer-surface
 * drop + accepted-field application.
 */

import { makeEnvelope } from '../../../src/adapters/watch';
import type { WCMessage } from '../../../src/adapters/watch';
import {
  liveMirrorReducer,
  initialLiveMirrorState,
} from '../../../src/services/liveMirrorReducer';
import type {
  LiveMirrorState,
  MirrorExercise,
} from '../../../src/services/liveMirrorReducer';

/** Seed state helper — exercise se-1 with one set set-1 (working, weight=70, reps=8, not logged). */
function seedStateWithOneSet(baseState: LiveMirrorState): LiveMirrorState {
  const exercise: MirrorExercise = {
    sessionExerciseId: 'se-1',
    exerciseId: 'ex-1',
    exerciseName: '臥推',
    ordering: 0,
    plannedSets: 3,
    sets: [
      {
        setId: 'set-1',
        ordinal: 0,
        weight: 70,
        reps: 8,
        rpe: null,
        rest_sec: null,
        notes: null,
        set_kind: 'working',
        is_logged: false,
      },
    ],
  };
  return { ...baseState, exercises: [exercise] };
}

describe('liveMirrorReducer — Live Activity inbound message reducer', () => {
  /** Pre-built sample envelopes used across all reducer tests. */
  const sampleEnvelopes = {
    setCompleted: makeEnvelope('set-completed', {
      sessionId: 'sess-1',
      setId: 'set-1',
      is_logged: true,
      weight: 80,
      reps: 8,
    }),
    setModified: makeEnvelope('set-modified', {
      sessionId: 'sess-1',
      setId: 'set-1',
      diff: { weight: 82.5 },
      fieldTs: { weight: 1_700_000_000_000 },
    }),
    setDeleted: makeEnvelope('set-deleted', {
      sessionId: 'sess-1',
      setId: 'set-1',
    }),
    setAdded: makeEnvelope('set-added', {
      sessionId: 'sess-1',
      sessionExerciseId: 'se-1',
      setId: 'set-99',
      ordinal: 3,
      weight: 60,
      reps: 10,
      set_kind: 'working',
    }),
    exerciseAdded: makeEnvelope('exercise-added', {
      sessionId: 'sess-1',
      sessionExerciseId: 'se-2',
      exerciseId: 'ex-1',
      exerciseName: '平板槓鈴臥推',
      ordering: 1,
      plannedSets: 3,
    }),
    exerciseDeleted: makeEnvelope('exercise-deleted', {
      sessionId: 'sess-1',
      sessionExerciseId: 'se-1',
    }),
    hrTick: makeEnvelope('hr-tick', {
      sessionId: 'sess-1',
      bpm: 132,
      sampleTs: 1_700_000_000_000,
    }),
  } as const satisfies Record<string, WCMessage>;

  let state: LiveMirrorState;

  beforeEach(() => {
    state = initialLiveMirrorState();
  });

  // -----------------------------------------------------------------
  // (a) set-completed
  // -----------------------------------------------------------------
  describe('set-completed', () => {
    it('flips is_logged false → true on the targeted set and updates weight + reps', () => {
      state = seedStateWithOneSet(state);

      const next = liveMirrorReducer(state, sampleEnvelopes.setCompleted);

      expect(next.exercises[0].sets[0].is_logged).toBe(true);
      expect(next.exercises[0].sets[0].weight).toBe(80);
      expect(next.exercises[0].sets[0].reps).toBe(8);
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.setCompleted.ts);
    });

    it('is a no-op when the targeted set is not in the mirror (out-of-order arrive)', () => {
      // empty state — set-1 not present
      const next = liveMirrorReducer(state, sampleEnvelopes.setCompleted);

      expect(next).toBe(state);
      expect(next.lastAppliedTs).toBe(0);
    });

    it.todo(
      'TBD — should set-completed for unknown sessionId fan into a "pending session" buffer?',
    );
  });

  // -----------------------------------------------------------------
  // (b) set-modified
  // -----------------------------------------------------------------
  describe('set-modified', () => {
    it('applies sparse diff (only listed fields change; others retain prior values)', () => {
      state = seedStateWithOneSet(state);

      const next = liveMirrorReducer(state, sampleEnvelopes.setModified);

      expect(next.exercises[0].sets[0].weight).toBe(82.5);
      expect(next.exercises[0].sets[0].reps).toBe(8); // unchanged
      expect(next.exercises[0].sets[0].notes).toBeNull(); // unchanged
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.setModified.ts);
    });

    it('drops a set-modified envelope whose ts is older than the last applied ts for the same set (stale rule)', () => {
      state = seedStateWithOneSet(state);

      // Apply newer first
      const newer = makeEnvelope('set-modified', {
        sessionId: 'sess-1',
        setId: 'set-1',
        diff: { weight: 90 },
        fieldTs: { weight: 5_000 },
      });
      const afterNewer = liveMirrorReducer(state, newer);
      expect(afterNewer.exercises[0].sets[0].weight).toBe(90);
      const tsAfterNewer = afterNewer.lastAppliedTs;

      // Now an older one — should be dropped at the reducer surface
      const older: typeof newer = {
        ...newer,
        msgId: `${newer.msgId}-older`,
        ts: tsAfterNewer - 1,
        payload: { ...newer.payload, diff: { weight: 75 }, fieldTs: { weight: 100 } },
      };

      const afterOlder = liveMirrorReducer(afterNewer, older);
      expect(afterOlder).toBe(afterNewer);
      expect(afterOlder.exercises[0].sets[0].weight).toBe(90);
    });

    it.todo(
      'per-field LWW reconciliation crosses-over to lww.test.ts — only test the reducer-surface drop here',
    );
  });

  // -----------------------------------------------------------------
  // (c) set-deleted
  // -----------------------------------------------------------------
  describe('set-deleted', () => {
    it('removes the set from state.exercises[i].sets', () => {
      state = seedStateWithOneSet(state);

      const next = liveMirrorReducer(state, sampleEnvelopes.setDeleted);

      expect(next.exercises[0].sets).toHaveLength(0);
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.setDeleted.ts);
    });

    it('does not throw / no-ops when setId is unknown', () => {
      // empty state — set-1 not present
      const next = liveMirrorReducer(state, sampleEnvelopes.setDeleted);

      expect(next).toBe(state);
    });
  });

  // -----------------------------------------------------------------
  // (d) set-added
  // -----------------------------------------------------------------
  describe('set-added', () => {
    it('inserts the new set at the supplied ordinal under the exercise (sorted)', () => {
      state = seedStateWithOneSet(state); // se-1 has set-1 at ordinal 0

      const next = liveMirrorReducer(state, sampleEnvelopes.setAdded);

      expect(next.exercises[0].sets).toHaveLength(2);
      expect(next.exercises[0].sets[0].setId).toBe('set-1'); // ordinal 0
      expect(next.exercises[0].sets[1].setId).toBe('set-99'); // ordinal 3
      expect(next.exercises[0].sets[1].is_logged).toBe(false); // fresh set
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.setAdded.ts);
    });

    it('is a no-op when the parent sessionExerciseId is not in the mirror (out-of-order arrive)', () => {
      // empty state — se-1 not present
      const next = liveMirrorReducer(state, sampleEnvelopes.setAdded);

      expect(next).toBe(state);
    });
  });

  // -----------------------------------------------------------------
  // (e) exercise-added
  // -----------------------------------------------------------------
  describe('exercise-added', () => {
    it('appends the exercise card with the supplied ordering', () => {
      state = seedStateWithOneSet(state); // se-1 at ordering 0

      const next = liveMirrorReducer(state, sampleEnvelopes.exerciseAdded);

      expect(next.exercises).toHaveLength(2);
      expect(next.exercises[0].sessionExerciseId).toBe('se-1'); // ordering 0
      expect(next.exercises[1].sessionExerciseId).toBe('se-2'); // ordering 1
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.exerciseAdded.ts);
    });

    it('initialises an empty sets list for the new exercise', () => {
      const next = liveMirrorReducer(state, sampleEnvelopes.exerciseAdded);

      expect(next.exercises[0].sets).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  // (f) exercise-deleted
  // -----------------------------------------------------------------
  describe('exercise-deleted', () => {
    it('removes the exercise + cascades cleanup of its sets', () => {
      state = seedStateWithOneSet(state); // se-1 has 1 set

      const next = liveMirrorReducer(state, sampleEnvelopes.exerciseDeleted);

      expect(next.exercises).toHaveLength(0);
      expect(next.lastAppliedTs).toBe(sampleEnvelopes.exerciseDeleted.ts);
    });
  });

  // -----------------------------------------------------------------
  // (g) Non-reducer-relevant kinds are no-ops
  // -----------------------------------------------------------------
  describe('out-of-scope kinds', () => {
    it('hr-tick does not mutate Live Activity state (referential equality)', () => {
      state = seedStateWithOneSet(state);

      const next = liveMirrorReducer(state, sampleEnvelopes.hrTick);

      expect(next).toBe(state);
    });

    it('kcal-tick does not mutate Live Activity state', () => {
      const kcal = makeEnvelope('kcal-tick', {
        sessionId: 'sess-1',
        kcal: 250,
        sampleTs: 1_700_000_000_000,
      });

      const next = liveMirrorReducer(state, kcal);

      expect(next).toBe(state);
    });

    it('handshake / start-from-* / settings-sync / end-session are no-ops here', () => {
      const offTopic: WCMessage[] = [
        makeEnvelope('handshake', { requestId: 'r1', clientVersion: '13d.0' }),
        makeEnvelope('start-from-watch', {
          templateId: null,
          programCycleId: null,
          intensityId: null,
        }),
        makeEnvelope('start-from-iphone', {
          sessionId: 'sess-1',
          snapshot: {},
        }),
        makeEnvelope('end-session', { sessionId: 'sess-1', side: 'iphone' }),
        makeEnvelope('settings-sync', {
          sessionId: 'sess-1',
          settings: { unit: 'kg' },
        }),
      ];

      for (const env of offTopic) {
        expect(liveMirrorReducer(state, env)).toBe(state);
      }
    });
  });

  // -----------------------------------------------------------------
  // (h) Unknown kind / malformed envelope
  // -----------------------------------------------------------------
  describe('defensive — bad input', () => {
    it('returns state unchanged for an envelope whose kind is not in WC_MESSAGE_KINDS', () => {
      const bogus = {
        msgId: 'bogus-1',
        ts: 5_000,
        kind: 'not-a-kind',
        payload: {},
      } as unknown as WCMessage;

      expect(liveMirrorReducer(state, bogus)).toBe(state);
    });

    it('returns state unchanged for null / undefined envelope', () => {
      expect(liveMirrorReducer(state, null)).toBe(state);
      expect(liveMirrorReducer(state, undefined)).toBe(state);
    });
  });

  // -----------------------------------------------------------------
  // (i) Stale-ts rule on the reducer surface — parameterised
  // -----------------------------------------------------------------
  describe('stale-ts coarse drop', () => {
    it.each([
      ['set-completed', sampleEnvelopes.setCompleted],
      ['set-modified', sampleEnvelopes.setModified],
      ['set-deleted', sampleEnvelopes.setDeleted],
      ['set-added', sampleEnvelopes.setAdded],
      ['exercise-added', sampleEnvelopes.exerciseAdded],
      ['exercise-deleted', sampleEnvelopes.exerciseDeleted],
    ])(
      '%s with ts <= lastAppliedTs is dropped without throw',
      (_label, env) => {
        // Bump lastAppliedTs above the envelope's ts
        const aheadState: LiveMirrorState = {
          ...seedStateWithOneSet(state),
          lastAppliedTs: env.ts + 1_000,
        };

        const next = liveMirrorReducer(aheadState, env);

        expect(next).toBe(aheadState);
      },
    );
  });
});
