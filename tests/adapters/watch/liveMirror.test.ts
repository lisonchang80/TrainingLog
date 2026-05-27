/**
 * Slice 13d / D19 — Live Activity mirror reducer test scaffold.
 *
 * Scaffold built by Agent Z 2026-05-27, following V's coverage-audit
 * report `24-overnight-V-coverage-audit.md` item #4 (medium priority).
 *
 * The actual `liveMirrorReducer` module is NOT yet land in main as of
 * `8ca6671`. Per V's report + ADR-0019 § Q19, the reducer feeds the
 * iPhone-side Live Activity (Dynamic Island / lock-screen widget)
 * driven by inbound WC messages from the Watch. Expected location:
 *   - `src/services/liveMirrorReducer.ts` (the reducer)
 *   - mirrored state shape lives somewhere like `src/services/liveMirrorState.ts`
 *
 * Per V's spec the reducer SHOULD handle 6 message kinds (out of the
 * 13 in `WC_MESSAGE_KINDS`):
 *   - `set-completed`  → flip `is_logged` + update weight / reps
 *   - `set-modified`   → per-field diff merge (LWW — see lww.test.ts)
 *   - `set-deleted`    → drop from in-memory set list
 *   - `set-added`      → insert at the supplied ordinal
 *   - `exercise-added` → append exercise card
 *   - `exercise-deleted` → drop the card
 *   - everything else (`hr-tick`, `kcal-tick`, `handshake`, ...) → no-op
 *
 * Stale-timestamp rule: any envelope with `ts <= mirror.lastAppliedTs`
 * for the same `(sessionId, setId|exerciseId)` target is dropped on
 * arrival — LWW reconciliation lives one layer deeper but the reducer
 * surface is responsible for the coarse drop.
 *
 * This file is **scaffold-only**. Implementers should:
 *   1. Replace the commented import block once `liveMirrorReducer.ts` lands.
 *   2. Flip `describe.skip` → `describe`.
 *   3. Fill the test bodies — sample envelopes built via `makeEnvelope`
 *      already type-check via the D3 protocol layer.
 */

import { makeEnvelope } from '../../../src/adapters/watch';
import type { WCMessage } from '../../../src/adapters/watch';

// TODO: import once liveMirrorReducer.ts ships:
//   import {
//     liveMirrorReducer,
//     initialLiveMirrorState,
//   } from '../../../src/services/liveMirrorReducer';
//   import type { LiveMirrorState } from '../../../src/services/liveMirrorReducer';

describe.skip('liveMirrorReducer — Live Activity inbound message reducer (scaffold)', () => {
  // -----------------------------------------------------------------
  // Test fixture helpers — these are scaffold-ready and will compile.
  // The reducer call (`liveMirrorReducer(state, env)`) is what's missing.
  // -----------------------------------------------------------------

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
      sessionExerciseId: 'se-2',
    }),
    hrTick: makeEnvelope('hr-tick', {
      sessionId: 'sess-1',
      bpm: 132,
      sampleTs: 1_700_000_000_000,
    }),
  } as const satisfies Record<string, WCMessage>;

  beforeEach(() => {
    // TODO: build a fresh `initialLiveMirrorState` per test so no
    //       cross-test state leakage in the reducer-under-test.
  });

  // -----------------------------------------------------------------
  // (a) set-completed
  // -----------------------------------------------------------------
  describe('set-completed', () => {
    it.skip(
      'flips is_logged false → true on the targeted set and updates weight + reps',
      () => {
        // TODO: assert state.sets[setId].is_logged === true
        //       and matches envelope.payload.weight / reps.
        void sampleEnvelopes.setCompleted;
      },
    );
    it.skip(
      'is a no-op when the targeted set is not in the mirror (out-of-order arrive)',
      () => {
        // TODO: feed envelope first, then exercise-added/set-added — the
        // reducer should drop the set-completed silently.
      },
    );
    it.todo(
      'TBD — should set-completed for unknown sessionId fan into a "pending session" buffer?',
    );
  });

  // -----------------------------------------------------------------
  // (b) set-modified
  // -----------------------------------------------------------------
  describe('set-modified', () => {
    it.skip(
      'applies sparse diff (only listed fields change; others retain prior values)',
      () => {
        // TODO: ensure unmodified fields (reps, notes) stay at prior state.
        void sampleEnvelopes.setModified;
      },
    );
    it.skip(
      'drops a set-modified envelope whose ts is older than the last applied ts for the same set (stale rule)',
      () => {
        // TODO: apply env A (ts=2000), then env B (ts=1000) — B should be ignored.
      },
    );
    it.todo(
      'per-field LWW reconciliation crosses-over to lww.test.ts — only test the reducer-surface drop here',
    );
  });

  // -----------------------------------------------------------------
  // (c) set-deleted
  // -----------------------------------------------------------------
  describe('set-deleted', () => {
    it.skip('removes the set from state.sets', () => {
      // TODO
      void sampleEnvelopes.setDeleted;
    });
    it.skip('does not throw / no-ops when setId is unknown', () => {
      // TODO
    });
  });

  // -----------------------------------------------------------------
  // (d) set-added
  // -----------------------------------------------------------------
  describe('set-added', () => {
    it.skip('inserts the new set at the supplied ordinal under the exercise', () => {
      // TODO
      void sampleEnvelopes.setAdded;
    });
    it.skip(
      'is a no-op when the parent sessionExerciseId is not in the mirror (out-of-order arrive)',
      () => {
        // TODO
      },
    );
  });

  // -----------------------------------------------------------------
  // (e) exercise-added / exercise-deleted
  // -----------------------------------------------------------------
  describe('exercise-added', () => {
    it.skip('appends the exercise card with the supplied ordering', () => {
      // TODO
      void sampleEnvelopes.exerciseAdded;
    });
    it.skip('initialises an empty sets list for the new exercise', () => {
      // TODO
    });
  });

  describe('exercise-deleted', () => {
    it.skip('removes the exercise + cascades cleanup of its sets', () => {
      // TODO
      void sampleEnvelopes.exerciseDeleted;
    });
  });

  // -----------------------------------------------------------------
  // (f) Non-reducer-relevant kinds are no-ops
  // -----------------------------------------------------------------
  describe('out-of-scope kinds', () => {
    it.skip('hr-tick does not mutate Live Activity state', () => {
      // TODO: assert deep-equal state pre/post.
      void sampleEnvelopes.hrTick;
    });
    it.skip('kcal-tick does not mutate Live Activity state', () => {
      // TODO
    });
    it.skip('handshake / start-from-* / settings-sync / end-session are no-ops here', () => {
      // TODO: handshake + lifecycle are owned by handshake.test.ts.
    });
  });

  // -----------------------------------------------------------------
  // (g) Unknown kind / malformed envelope
  // -----------------------------------------------------------------
  describe('defensive — bad input', () => {
    it.skip('returns state unchanged for an envelope whose kind is not in WC_MESSAGE_KINDS', () => {
      // TODO: cast a fake kind through `as unknown as WCMessage`.
    });
    it.skip('returns state unchanged for null / undefined envelope', () => {
      // TODO
    });
  });

  // -----------------------------------------------------------------
  // (h) Stale-ts rule on the reducer surface
  // -----------------------------------------------------------------
  it.skip(
    'all set-* / exercise-* envelopes with ts <= mirror.lastAppliedTs are dropped without throw',
    () => {
      // TODO: parameterise over the 6 set-/exercise- kinds.
    },
  );
});
