/**
 * Slice 13d / D20 — per-field LWW (last-write-wins) reconciliation tests.
 *
 * Activated 2026-05-27: scaffold from Agent Z (item #5 of V coverage
 * audit) now points at the real `setModifiedReducer` shipped under
 * `src/adapters/watch/setModifiedReducer.ts`.
 *
 * ADR-0019 NEW-Q43 Option A — per-field in-memory LWW keyed by
 * `(setId, field) → ts`. When iPhone + Watch concurrently edit the
 * same set, the mirror keeps the field whose `ts` is strictly larger;
 * a stale envelope's diff is dropped field-by-field, NOT the whole
 * envelope. Tie keeps the prior value.
 */

import {
  makeEnvelope,
  createLwwMap,
  clearLwwMap,
  admitDiff,
} from '../../../src/adapters/watch';
import type {
  SetModifiedPayload,
  LwwMap,
} from '../../../src/adapters/watch';

describe('per-field LWW reconciliation', () => {
  let map: LwwMap;

  beforeEach(() => {
    map = createLwwMap();
  });

  // Helper — build a typed set-modified envelope sample. Uses
  // `makeEnvelope` for type-checked construction; the test cares
  // about `payload` + envelope `ts`.
  function mod(
    setId: string,
    diff: SetModifiedPayload['diff'],
    fieldTs: SetModifiedPayload['fieldTs'],
  ) {
    return makeEnvelope('set-modified', {
      sessionId: 'sess-1',
      setId,
      diff,
      fieldTs,
    });
  }

  // -----------------------------------------------------------------
  // (a) Newer wins
  // -----------------------------------------------------------------
  it('accepts a newer write — admitDiff returns the diff intact and updates the map ts', () => {
    const env = mod('set-1', { weight: 80 }, { weight: 2_000 });

    const result = admitDiff(
      map,
      'set-1',
      env.payload.diff,
      env.payload.fieldTs,
      env.ts,
    );

    expect(result.accepted).toEqual({ weight: 80 });
    expect(result.rejected).toEqual([]);
    expect(map.ts.get('set-1:weight')).toBe(2_000);
  });

  // -----------------------------------------------------------------
  // (b) Stale reject
  // -----------------------------------------------------------------
  it('rejects a stale write — admitDiff returns empty accepted and lists the field in rejected', () => {
    // Seed map with ts=2_000 for (set-1, weight)
    admitDiff(map, 'set-1', { weight: 80 }, { weight: 2_000 }, 2_000);

    // Now admit an older write
    const result = admitDiff(
      map,
      'set-1',
      { weight: 75 },
      { weight: 1_000 },
      1_000,
    );

    expect(result.accepted).toEqual({});
    expect(result.rejected).toEqual(['weight']);
    // Map ts unchanged
    expect(map.ts.get('set-1:weight')).toBe(2_000);
  });

  // -----------------------------------------------------------------
  // (c) Tie — prior wins (deterministic tiebreak)
  // -----------------------------------------------------------------
  it('tie ts (fieldTs === existing ts) keeps the prior value — no overwrite', () => {
    admitDiff(map, 'set-1', { weight: 80 }, { weight: 2_000 }, 2_000);

    const result = admitDiff(
      map,
      'set-1',
      { weight: 85 },
      { weight: 2_000 },
      2_000,
    );

    expect(result.accepted).toEqual({});
    expect(result.rejected).toEqual(['weight']);
    expect(map.ts.get('set-1:weight')).toBe(2_000);
  });

  // -----------------------------------------------------------------
  // (d) Multi-field — independent ts per field
  // -----------------------------------------------------------------
  it('multi-field diff resolves field-by-field — one field accepted, one rejected', () => {
    // Seed map { (set-1, weight)=2_000, (set-1, reps)=500 }
    admitDiff(map, 'set-1', { weight: 80 }, { weight: 2_000 }, 2_000);
    admitDiff(map, 'set-1', { reps: 10 }, { reps: 500 }, 500);

    const result = admitDiff(
      map,
      'set-1',
      { weight: 90, reps: 12 },
      { weight: 1_500, reps: 1_000 },
      2_500,
    );

    expect(result.accepted).toEqual({ reps: 12 });
    expect(result.rejected).toEqual(['weight']);
    expect(map.ts.get('set-1:weight')).toBe(2_000); // unchanged
    expect(map.ts.get('set-1:reps')).toBe(1_000); // updated
  });

  // -----------------------------------------------------------------
  // (e) Concurrent edits — interleaved order across two senders
  // -----------------------------------------------------------------
  it('interleaved iPhone + Watch writes converge to the largest-ts-per-field state', () => {
    // iPhone @ ts=1000 { weight: 80 }
    const r1 = admitDiff(
      map,
      'set-1',
      { weight: 80 },
      { weight: 1_000 },
      1_000,
    );
    // Watch  @ ts=1500 { weight: 82 }
    const r2 = admitDiff(
      map,
      'set-1',
      { weight: 82 },
      { weight: 1_500 },
      1_500,
    );
    // iPhone @ ts=1200 { weight: 78 } — late-arriving stale
    const r3 = admitDiff(
      map,
      'set-1',
      { weight: 78 },
      { weight: 1_200 },
      1_200,
    );

    expect(r1.accepted).toEqual({ weight: 80 });
    expect(r2.accepted).toEqual({ weight: 82 });
    expect(r3.accepted).toEqual({});
    expect(r3.rejected).toEqual(['weight']);
    expect(map.ts.get('set-1:weight')).toBe(1_500);
  });

  // -----------------------------------------------------------------
  // (f) Envelope ts used as field ts fallback
  // -----------------------------------------------------------------
  it('when fieldTs map omits a key, the envelope-level ts is used as the implicit field ts', () => {
    // No fieldTs.weight — admitDiff must fall back to envelope ts
    const result = admitDiff(
      map,
      'set-1',
      { weight: 80 },
      {} as SetModifiedPayload['fieldTs'],
      3_000,
    );

    expect(result.accepted).toEqual({ weight: 80 });
    expect(map.ts.get('set-1:weight')).toBe(3_000);
  });

  // -----------------------------------------------------------------
  // (g) Map clear on session end
  // -----------------------------------------------------------------
  it('clearLwwMap wipes the (setId, field) → ts map at session-end', () => {
    admitDiff(map, 'set-1', { weight: 80 }, { weight: 2_000 }, 2_000);
    admitDiff(map, 'set-2', { reps: 10 }, { reps: 1_000 }, 1_000);
    expect(map.ts.size).toBe(2);

    clearLwwMap(map);

    expect(map.ts.size).toBe(0);

    // After clear, a previously-stale write is now admitted from a clean slate
    const result = admitDiff(
      map,
      'set-1',
      { weight: 75 },
      { weight: 1_000 },
      1_000,
    );
    expect(result.accepted).toEqual({ weight: 75 });
    expect(result.rejected).toEqual([]);
  });

  // -----------------------------------------------------------------
  // (h) Unknown / unsupported diff field guard
  // -----------------------------------------------------------------
  it('silently ignores diff fields not in the SetModifiedPayload schema (forward-compat)', () => {
    const diffWithUnknown = {
      weight: 80,
      unknownField: 'x',
    } as unknown as SetModifiedPayload['diff'];

    const result = admitDiff(
      map,
      'set-1',
      diffWithUnknown,
      { weight: 2_000, unknownField: 2_000 } as SetModifiedPayload['fieldTs'],
      2_000,
    );

    // Known field admitted; unknown silently skipped (NOT in accepted, NOT in rejected)
    expect(result.accepted).toEqual({ weight: 80 });
    expect(result.rejected).toEqual([]);
    expect(map.ts.has('set-1:unknownField')).toBe(false);
  });

  // -----------------------------------------------------------------
  // (i) Envelope ts vs fieldTs disagreement — the field decides
  // -----------------------------------------------------------------
  it('newer envelope-ts does NOT rescue a stale fieldTs — per-field is authoritative', () => {
    admitDiff(map, 'set-1', { weight: 80 }, { weight: 1_000 }, 1_000);

    // env.ts=5_000 (newer) but fieldTs.weight=500 (older than seed 1_000)
    const result = admitDiff(
      map,
      'set-1',
      { weight: 75 },
      { weight: 500 },
      5_000,
    );

    expect(result.accepted).toEqual({});
    expect(result.rejected).toEqual(['weight']);
    expect(map.ts.get('set-1:weight')).toBe(1_000);
  });
});
