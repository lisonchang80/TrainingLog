/**
 * Slice 13d / D20 — per-field LWW (last-write-wins) reconciliation scaffold.
 *
 * Scaffold built by Agent Z 2026-05-27, following V's coverage-audit
 * report `24-overnight-V-coverage-audit.md` item #5 (medium priority).
 *
 * Context — ADR-0019 NEW-Q43 Option A chose **per-field in-memory LWW**
 * keyed by `(setId, field) → ts`. When iPhone and Watch concurrently
 * edit the same set, the mirror keeps the field whose `ts` is newer;
 * a "stale" envelope's diff is dropped field-by-field, NOT the whole
 * envelope. This is finer-grained than the coarse reducer-level
 * `lastAppliedTs` check (see liveMirror.test.ts (h) for that one).
 *
 * The actual `setModifiedReducer.ts` (or `lwwMap.ts` / similar) is NOT
 * yet land in main as of `8ca6671`. Expected location per V:
 *   - `src/services/setModifiedReducer.ts`
 *
 * Expected API (educated guess — implementer to confirm):
 *   interface LwwMap {
 *     // (setId, fieldName) → ts of last accepted write
 *     ts: Map<string, number>;
 *   }
 *   function admitDiff(
 *     map: LwwMap,
 *     setId: string,
 *     diff: SetModifiedPayload['diff'],
 *     fieldTs: SetModifiedPayload['fieldTs'],
 *     envelopeTs: number,
 *   ): { accepted: SetModifiedPayload['diff']; rejected: string[] };
 *
 * This file is **scaffold-only**. Implementers should:
 *   1. Replace the commented import block once the reducer lands.
 *   2. Flip `describe.skip` → `describe`.
 *   3. Fill the test bodies using the typed `makeEnvelope` samples.
 */

import { makeEnvelope } from '../../../src/adapters/watch';
import type { SetModifiedPayload } from '../../../src/adapters/watch';

// TODO: import once setModifiedReducer.ts ships:
//   import {
//     admitDiff,
//     createLwwMap,
//   } from '../../../src/services/setModifiedReducer';
//   import type { LwwMap } from '../../../src/services/setModifiedReducer';

describe.skip('per-field LWW reconciliation (scaffold)', () => {
  // -----------------------------------------------------------------
  // Helper — build a typed set-modified payload sample for a test.
  // Uses `makeEnvelope` for type-checked construction; the test cares
  // about `payload` + envelope `ts`.
  // -----------------------------------------------------------------
  function mod(
    setId: string,
    diff: SetModifiedPayload['diff'],
    fieldTs: SetModifiedPayload['fieldTs'],
  ) {
    const env = makeEnvelope('set-modified', {
      sessionId: 'sess-1',
      setId,
      diff,
      fieldTs,
    });
    return env;
  }

  beforeEach(() => {
    // TODO: instantiate a fresh `LwwMap` per test
    //       (e.g. `const map = createLwwMap()`).
  });

  // -----------------------------------------------------------------
  // (a) Newer wins
  // -----------------------------------------------------------------
  it.skip(
    'accepts a newer write — admitDiff returns the diff intact and updates the map ts',
    () => {
      // TODO:
      //   const env = mod('set-1', { weight: 80 }, { weight: 2_000 });
      //   const result = admitDiff(map, 'set-1', env.payload.diff, env.payload.fieldTs, env.ts);
      //   expect(result.accepted).toEqual({ weight: 80 });
      //   expect(result.rejected).toEqual([]);
      void mod;
    },
  );

  // -----------------------------------------------------------------
  // (b) Stale reject
  // -----------------------------------------------------------------
  it.skip(
    'rejects a stale write — admitDiff returns empty accepted and lists the field in rejected',
    () => {
      // TODO: seed map with ts=2_000 for (set-1, weight), then admit a
      //       diff with fieldTs.weight=1_000 — `weight` should appear in
      //       result.rejected and NOT in result.accepted.
    },
  );

  // -----------------------------------------------------------------
  // (c) Tie — keep the prior value (implementation-defined; document choice)
  // -----------------------------------------------------------------
  it.skip(
    'tie ts (fieldTs === existing ts) keeps the prior value — no overwrite',
    () => {
      // TODO: this is a deterministic-tiebreak rule — assert and pin.
    },
  );

  // -----------------------------------------------------------------
  // (d) Multi-field — independent ts per field
  // -----------------------------------------------------------------
  it.skip(
    'multi-field diff resolves field-by-field — one field accepted, one rejected',
    () => {
      // TODO: seed map { (set-1, weight)=2_000, (set-1, reps)=500 }.
      //       Admit diff { weight: 90, reps: 12 } with
      //       fieldTs { weight: 1_500 (stale), reps: 1_000 (newer) }.
      //       Expect accepted = { reps: 12 } and rejected = ['weight'].
    },
  );

  // -----------------------------------------------------------------
  // (e) Concurrent edits — interleaved order across two senders
  // -----------------------------------------------------------------
  it.skip(
    'interleaved iPhone + Watch writes converge to the largest-ts-per-field state',
    () => {
      // TODO: simulate envelope sequence in arrival order:
      //   iPhone @ ts=1000 { weight: 80 }
      //   Watch  @ ts=1500 { weight: 82 }
      //   iPhone @ ts=1200 { weight: 78 }   ← stale, rejected
      //   Expect final accepted weight = 82.
    },
  );

  // -----------------------------------------------------------------
  // (f) Envelope ts used as field ts fallback
  // -----------------------------------------------------------------
  it.skip(
    'when fieldTs map omits a key, the envelope-level ts is used as the implicit field ts',
    () => {
      // TODO: per payloadSchema doc-comment line 174-176 — admitDiff
      //       must fall back to env.ts for any field not in fieldTs.
    },
  );

  // -----------------------------------------------------------------
  // (g) Map clear on session end
  // -----------------------------------------------------------------
  it.skip(
    'clearLwwMap (or similar) wipes the (setId, field) → ts map at session-end',
    () => {
      // TODO: covers ADR-0019 NEW-Q43 Option A line "in-memory map
      //       cleared on session end".
    },
  );

  // -----------------------------------------------------------------
  // (h) Unknown / unsupported diff field guard
  // -----------------------------------------------------------------
  it.skip(
    'silently ignores diff fields not in the SetModifiedPayload schema (forward-compat)',
    () => {
      // TODO: pass `{ unknownField: 'x' } as any` — admitDiff should
      //       not crash; it may either reject the unknown key or
      //       skip-and-warn.
    },
  );

  // -----------------------------------------------------------------
  // (i) Envelope ts vs fieldTs disagreement — the field decides
  // -----------------------------------------------------------------
  it.skip(
    'newer envelope-ts does NOT rescue a stale fieldTs — per-field is authoritative',
    () => {
      // TODO: send env.ts=5_000 with fieldTs.weight=500. If map has
      //       weight @ ts=1_000, the write is still rejected because
      //       500 < 1_000 — envelope ts only fallbacks for missing
      //       fieldTs entries.
    },
  );
});
