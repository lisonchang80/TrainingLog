/**
 * point2 live-sync (2026-06-12) — watchLiveTicksReceiver reducer tests.
 *
 * Pure-state layer for the iPhone-side `hr-tick` / `kcal-tick` inbound
 * (Q4 channels #9/#10). No DB, no WC bridge mocking — the reducers take
 * the raw inbound envelope as `unknown` (bridge dispatch is owned +
 * tested in connectivity.test.ts; envelope factory in
 * payloadSchema.test.ts).
 *
 * Coverage:
 *   - happy path — first hr/kcal tick seeds state; later tick advances it
 *   - latest-wins ordering — stale / duplicate envelope `ts` dropped,
 *     SAME reference returned (React setState bail-out contract)
 *   - per-metric independence — an hr high-water mark never blocks kcal
 *   - session switch — tick for a new sessionId replaces state wholesale
 *     (other metric resets to null, no cross-session inheritance)
 *   - malformed envelopes — every reject path returns `prev` unchanged
 *   - value sanity floors — bpm must be > 0; kcal may be exactly 0
 *     (cumulative-since-start) but not negative
 *   - liveTicksForSession — projection gates on the iPhone's own active
 *     session id; mismatch / absence renders the '—' fallback shape
 */

import { makeEnvelope } from '../../src/adapters/watch';
import {
  applyHrTick,
  applyKcalTick,
  liveTicksForSession,
  type WatchLiveTicks,
} from '../../src/services/watchLiveTicksReceiver';

/** Well-formed `hr-tick` envelope with a controlled envelope `ts`
 *  (makeEnvelope stamps Date.now(); ordering tests need determinism). */
function hrEnv(sessionId: string, bpm: number, ts: number) {
  return { ...makeEnvelope('hr-tick', { sessionId, bpm, sampleTs: ts - 500 }), ts };
}

function kcalEnv(sessionId: string, kcal: number, ts: number) {
  return {
    ...makeEnvelope('kcal-tick', { sessionId, kcal, sampleTs: ts - 500 }),
    ts,
  };
}

describe('applyHrTick', () => {
  it('seeds state from the first tick (kcal side starts null)', () => {
    const next = applyHrTick(null, hrEnv('sess-1', 132, 1_000));
    expect(next).toEqual({
      sessionId: 'sess-1',
      bpm: 132,
      bpmTs: 1_000,
      kcal: null,
      kcalTs: 0,
    });
  });

  it('advances bpm on a fresher tick, preserving the kcal side', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 120,
      bpmTs: 1_000,
      kcal: 42,
      kcalTs: 900,
    };
    const next = applyHrTick(prev, hrEnv('sess-1', 145, 2_000));
    expect(next).toEqual({
      sessionId: 'sess-1',
      bpm: 145,
      bpmTs: 2_000,
      kcal: 42,
      kcalTs: 900,
    });
    expect(next).not.toBe(prev); // fresh object — React re-renders
  });

  it('drops a stale tick (ts < high-water) — SAME reference back', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 145,
      bpmTs: 2_000,
      kcal: null,
      kcalTs: 0,
    };
    expect(applyHrTick(prev, hrEnv('sess-1', 120, 1_500))).toBe(prev);
  });

  it('drops a duplicate tick (ts === high-water)', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 145,
      bpmTs: 2_000,
      kcal: null,
      kcalTs: 0,
    };
    expect(applyHrTick(prev, hrEnv('sess-1', 145, 2_000))).toBe(prev);
  });

  it('replaces state wholesale on a new sessionId (kcal resets)', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-old',
      bpm: 150,
      bpmTs: 9_000,
      kcal: 200,
      kcalTs: 9_000,
    };
    // Note ts 1_000 < prev high-water 9_000 — the staleness guard is
    // per-SESSION; a new session's clock starts fresh.
    const next = applyHrTick(prev, hrEnv('sess-new', 95, 1_000));
    expect(next).toEqual({
      sessionId: 'sess-new',
      bpm: 95,
      bpmTs: 1_000,
      kcal: null,
      kcalTs: 0,
    });
  });

  it('rejects bpm <= 0 (sensor garbage) and non-finite bpm', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 100,
      bpmTs: 1_000,
      kcal: null,
      kcalTs: 0,
    };
    expect(applyHrTick(prev, hrEnv('sess-1', 0, 2_000))).toBe(prev);
    expect(applyHrTick(prev, hrEnv('sess-1', -5, 2_000))).toBe(prev);
    expect(applyHrTick(prev, hrEnv('sess-1', Number.NaN, 2_000))).toBe(prev);
    expect(
      applyHrTick(prev, hrEnv('sess-1', Number.POSITIVE_INFINITY, 2_000)),
    ).toBe(prev);
  });

  it.each([
    ['non-object envelope', 'nope'],
    ['null envelope', null],
    ['array envelope', [1, 2]],
    ['missing ts', { payload: { sessionId: 's', bpm: 100 } }],
    ['non-numeric ts', { ts: 'now', payload: { sessionId: 's', bpm: 100 } }],
    ['missing payload', { ts: 1_000 }],
    ['non-object payload', { ts: 1_000, payload: 'x' }],
    ['missing sessionId', { ts: 1_000, payload: { bpm: 100 } }],
    ['empty sessionId', { ts: 1_000, payload: { sessionId: '', bpm: 100 } }],
    ['missing bpm', { ts: 1_000, payload: { sessionId: 's' } }],
    ['string bpm', { ts: 1_000, payload: { sessionId: 's', bpm: '100' } }],
  ])('malformed envelope (%s) returns prev unchanged', (_label, env) => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 100,
      bpmTs: 500,
      kcal: 10,
      kcalTs: 500,
    };
    expect(applyHrTick(prev, env)).toBe(prev);
    expect(applyHrTick(null, env)).toBeNull();
  });
});

describe('applyKcalTick', () => {
  it('seeds state from the first tick (bpm side starts null)', () => {
    const next = applyKcalTick(null, kcalEnv('sess-1', 0, 1_000));
    expect(next).toEqual({
      sessionId: 'sess-1',
      bpm: null,
      bpmTs: 0,
      kcal: 0,
      kcalTs: 1_000,
    });
  });

  it('accepts kcal === 0 (session just started, cumulative-since-start)', () => {
    const next = applyKcalTick(null, kcalEnv('sess-1', 0, 1_000));
    expect(next?.kcal).toBe(0);
  });

  it('rejects negative kcal', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: null,
      bpmTs: 0,
      kcal: 5,
      kcalTs: 1_000,
    };
    expect(applyKcalTick(prev, kcalEnv('sess-1', -1, 2_000))).toBe(prev);
  });

  it('advances kcal on a fresher tick, preserving the bpm side', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: 130,
      bpmTs: 1_800,
      kcal: 12,
      kcalTs: 1_000,
    };
    const next = applyKcalTick(prev, kcalEnv('sess-1', 18, 2_000));
    expect(next).toEqual({
      sessionId: 'sess-1',
      bpm: 130,
      bpmTs: 1_800,
      kcal: 18,
      kcalTs: 2_000,
    });
  });

  it('drops stale / duplicate kcal ticks — SAME reference back', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-1',
      bpm: null,
      bpmTs: 0,
      kcal: 18,
      kcalTs: 2_000,
    };
    expect(applyKcalTick(prev, kcalEnv('sess-1', 12, 1_000))).toBe(prev);
    expect(applyKcalTick(prev, kcalEnv('sess-1', 18, 2_000))).toBe(prev);
  });

  it('replaces state wholesale on a new sessionId (bpm resets)', () => {
    const prev: WatchLiveTicks = {
      sessionId: 'sess-old',
      bpm: 150,
      bpmTs: 9_000,
      kcal: 200,
      kcalTs: 9_500,
    };
    const next = applyKcalTick(prev, kcalEnv('sess-new', 1, 1_000));
    expect(next).toEqual({
      sessionId: 'sess-new',
      bpm: null,
      bpmTs: 0,
      kcal: 1,
      kcalTs: 1_000,
    });
  });
});

describe('per-metric independence', () => {
  it('an hr high-water mark never blocks a kcal tick with lower ts', () => {
    // hr arrived at ts 5_000; kcal arrives "late" at ts 3_000 — but the
    // kcal high-water is its OWN (0), so it must apply.
    const afterHr = applyHrTick(null, hrEnv('sess-1', 140, 5_000));
    const afterKcal = applyKcalTick(afterHr, kcalEnv('sess-1', 30, 3_000));
    expect(afterKcal).toEqual({
      sessionId: 'sess-1',
      bpm: 140,
      bpmTs: 5_000,
      kcal: 30,
      kcalTs: 3_000,
    });
  });

  it('interleaved stream converges to the latest value of each metric', () => {
    let state: WatchLiveTicks | null = null;
    state = applyHrTick(state, hrEnv('s', 100, 1_000));
    state = applyKcalTick(state, kcalEnv('s', 2, 1_100));
    state = applyHrTick(state, hrEnv('s', 110, 4_000));
    state = applyKcalTick(state, kcalEnv('s', 5, 4_100));
    state = applyHrTick(state, hrEnv('s', 105, 3_000)); // late — dropped
    state = applyKcalTick(state, kcalEnv('s', 3, 3_100)); // late — dropped
    expect(state).toEqual({
      sessionId: 's',
      bpm: 110,
      bpmTs: 4_000,
      kcal: 5,
      kcalTs: 4_100,
    });
  });
});

describe('liveTicksForSession', () => {
  const ticks: WatchLiveTicks = {
    sessionId: 'sess-1',
    bpm: 142,
    bpmTs: 2_000,
    kcal: 37,
    kcalTs: 2_100,
  };

  it('projects bpm + kcal when the session matches', () => {
    expect(liveTicksForSession(ticks, 'sess-1')).toEqual({
      bpm: 142,
      kcal: 37,
    });
  });

  it('renders empty for a different session (stale-tick paint guard)', () => {
    expect(liveTicksForSession(ticks, 'sess-2')).toEqual({
      bpm: null,
      kcal: null,
    });
  });

  it('renders empty when no ticks or no active session', () => {
    expect(liveTicksForSession(null, 'sess-1')).toEqual({
      bpm: null,
      kcal: null,
    });
    expect(liveTicksForSession(ticks, null)).toEqual({
      bpm: null,
      kcal: null,
    });
    expect(liveTicksForSession(null, null)).toEqual({
      bpm: null,
      kcal: null,
    });
  });

  it('passes through a half-populated state (one metric still null)', () => {
    const hrOnly = applyHrTick(null, hrEnv('sess-1', 99, 1_000));
    expect(liveTicksForSession(hrOnly, 'sess-1')).toEqual({
      bpm: 99,
      kcal: null,
    });
  });
});
