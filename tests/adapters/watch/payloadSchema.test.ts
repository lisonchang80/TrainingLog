import {
  WC_MESSAGE_KINDS,
  isWCEnvelope,
  isWCMessageKind,
  makeEnvelope,
  normaliseForWire,
  __resetEnvelopeCounterForTests,
} from '../../../src/adapters/watch';
import type {
  WCMessageKind,
  WCPayloadMap,
  WCMessage,
} from '../../../src/adapters/watch';

/**
 * Slice 13d / D3 — Watch payload schema unit tests (protocol-only).
 *
 * Per Agent F inventory line 75: ≥ 8 cases. We cover the 8 listed
 * pillars (factory × 13 kinds via it.each, msgId uniqueness, ts
 * shape, Date→epoch, type guards, JSON round-trip, required-field
 * compile-time enforcement, negative payload shape) plus a couple of
 * defensive checks that surfaced while writing the schema (Q6 reject
 * undefined / Map / function; isWCEnvelope rejects malformed inputs).
 */

/** Sample valid payload per kind — used by table-driven tests below. */
function sampleFor<K extends WCMessageKind>(kind: K): WCPayloadMap[K] {
  // The `as` casts here are localised — TypeScript can't track the
  // K-narrowing through a switch returning a union, so we assert at
  // the leaf.
  switch (kind) {
    case 'handshake':
      return {
        requestId: 'req-1',
        clientVersion: '13d.0',
      } as unknown as WCPayloadMap[K];
    case 'start-from-watch':
      return {
        templateId: 'tpl-1',
        programCycleId: 'cyc-1',
        intensityId: 'int-1',
      } as unknown as WCPayloadMap[K];
    case 'start-from-iphone':
      return {
        sessionId: 'sess-1',
        snapshot: { title: '腿 (蹲)', exerciseCount: 4 },
      } as unknown as WCPayloadMap[K];
    case 'start-reconcile':
      // NEW-Q50 reverse-TUI ack. Sample uses 'created' status as the
      // happy-path canonical shape; the 'conflict' variant is covered
      // by per-shape narrowing tests elsewhere.
      return {
        status: 'created',
        sessionId: 'W-deadbeef-0001',
      } as unknown as WCPayloadMap[K];
    case 'set-completed':
      return {
        sessionId: 'sess-1',
        setId: 'set-1',
        is_logged: true,
        weight: 80,
        reps: 8,
      } as unknown as WCPayloadMap[K];
    case 'set-modified':
      return {
        sessionId: 'sess-1',
        setId: 'set-1',
        diff: { weight: 82.5 },
        fieldTs: { weight: 1_700_000_000_000 },
      } as unknown as WCPayloadMap[K];
    case 'set-deleted':
      return { sessionId: 'sess-1', setId: 'set-1' } as unknown as WCPayloadMap[K];
    case 'set-added':
      return {
        sessionId: 'sess-1',
        sessionExerciseId: 'se-1',
        setId: 'set-2',
        ordinal: 3,
        weight: 60,
        reps: 10,
        set_kind: 'working',
      } as unknown as WCPayloadMap[K];
    case 'exercise-added':
      return {
        sessionId: 'sess-1',
        sessionExerciseId: 'se-2',
        exerciseId: 'ex-1',
        exerciseName: '平板槓鈴臥推',
        ordering: 1,
        plannedSets: 3,
      } as unknown as WCPayloadMap[K];
    case 'exercise-deleted':
      return {
        sessionId: 'sess-1',
        sessionExerciseId: 'se-2',
      } as unknown as WCPayloadMap[K];
    case 'hr-tick':
      return {
        sessionId: 'sess-1',
        bpm: 132,
        sampleTs: 1_700_000_000_000,
      } as unknown as WCPayloadMap[K];
    case 'kcal-tick':
      return {
        sessionId: 'sess-1',
        kcal: 215.5,
        sampleTs: 1_700_000_000_000,
      } as unknown as WCPayloadMap[K];
    case 'end-session':
      return {
        sessionId: 'sess-1',
        side: 'iphone',
      } as unknown as WCPayloadMap[K];
    case 'settings-sync':
      return {
        sessionId: 'sess-1',
        settings: { unit: 'kg', rpeVisible: true, restSec: 90 },
      } as unknown as WCPayloadMap[K];
  }
  // Exhaustiveness sentinel — if a new kind is added without a sample,
  // TypeScript treats the absence as `never` and the test grows red.
  const exhaustive: never = kind;
  throw new Error(`Missing sample for kind: ${String(exhaustive)}`);
}

describe('payloadSchema', () => {
  beforeEach(() => {
    __resetEnvelopeCounterForTests();
  });

  // ---------------------------------------------------------------
  // (a) Factory builds correct envelope for all 13 kinds
  // ---------------------------------------------------------------
  it.each(WC_MESSAGE_KINDS)('makeEnvelope produces a valid envelope for %s', (kind) => {
    const env = makeEnvelope(kind, sampleFor(kind));
    expect(env.kind).toBe(kind);
    expect(env.payload).toEqual(sampleFor(kind));
    expect(typeof env.msgId).toBe('string');
    expect(env.msgId.length).toBeGreaterThan(0);
    expect(typeof env.ts).toBe('number');
    expect(Number.isFinite(env.ts)).toBe(true);
  });

  // ---------------------------------------------------------------
  // (b) msgId uniqueness across rapid successive calls
  // ---------------------------------------------------------------
  it('msgId is unique across many consecutive envelopes', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const env = makeEnvelope('hr-tick', {
        sessionId: 'sess-1',
        bpm: 100 + (i % 50),
        sampleTs: Date.now(),
      });
      ids.add(env.msgId);
    }
    expect(ids.size).toBe(500);
  });

  // ---------------------------------------------------------------
  // (c) `ts` is number and within +/-50ms of Date.now()
  // ---------------------------------------------------------------
  it('ts is approximately Date.now() at construction time', () => {
    const before = Date.now();
    const env = makeEnvelope('handshake', sampleFor('handshake'));
    const after = Date.now();
    expect(typeof env.ts).toBe('number');
    expect(env.ts).toBeGreaterThanOrEqual(before);
    expect(env.ts).toBeLessThanOrEqual(after);
  });

  // ---------------------------------------------------------------
  // (d) Date inside payload auto-converts to epoch ms
  // ---------------------------------------------------------------
  it('Date instances inside payload are converted to epoch ms', () => {
    const sampleTs = new Date('2026-05-27T10:00:00.000Z');
    // We intentionally feed a Date through the public surface; the
    // factory's `normaliseForWire` strips Date instances. Cast via
    // `unknown` so the per-kind TypeScript shape doesn't reject the
    // input — runtime behaviour is what we're verifying.
    const env = makeEnvelope('hr-tick', {
      sessionId: 'sess-1',
      bpm: 120,
      sampleTs: sampleTs as unknown as number,
    });
    expect(typeof env.payload.sampleTs).toBe('number');
    expect(env.payload.sampleTs).toBe(sampleTs.getTime());
  });

  it('normaliseForWire walks nested Dates', () => {
    const input = {
      a: new Date('2026-01-01T00:00:00.000Z'),
      nested: { b: new Date('2026-02-02T00:00:00.000Z'), c: 'x' },
      arr: [new Date('2026-03-03T00:00:00.000Z'), 42],
    };
    const out = normaliseForWire(input) as Record<string, unknown>;
    expect(out.a).toBe(new Date('2026-01-01T00:00:00.000Z').getTime());
    expect((out.nested as Record<string, unknown>).b).toBe(
      new Date('2026-02-02T00:00:00.000Z').getTime(),
    );
    expect((out.nested as Record<string, unknown>).c).toBe('x');
    const arr = out.arr as unknown[];
    expect(arr[0]).toBe(new Date('2026-03-03T00:00:00.000Z').getTime());
    expect(arr[1]).toBe(42);
  });

  // ---------------------------------------------------------------
  // (e) Type guards
  // ---------------------------------------------------------------
  it('isWCMessageKind accepts the 13 known kinds and rejects others', () => {
    for (const kind of WC_MESSAGE_KINDS) {
      expect(isWCMessageKind(kind)).toBe(true);
    }
    expect(isWCMessageKind('nope')).toBe(false);
    expect(isWCMessageKind(undefined)).toBe(false);
    expect(isWCMessageKind(null)).toBe(false);
    expect(isWCMessageKind(42)).toBe(false);
    expect(isWCMessageKind({ kind: 'handshake' })).toBe(false);
  });

  it('isWCEnvelope accepts a built envelope and rejects malformed shapes', () => {
    const good = makeEnvelope('end-session', sampleFor('end-session'));
    expect(isWCEnvelope(good)).toBe(true);

    expect(isWCEnvelope(null)).toBe(false);
    expect(isWCEnvelope('string')).toBe(false);
    expect(isWCEnvelope({})).toBe(false);
    expect(isWCEnvelope({ msgId: '', ts: 1, kind: 'handshake', payload: {} })).toBe(
      false,
    );
    expect(
      isWCEnvelope({ msgId: 'x', ts: 'now', kind: 'handshake', payload: {} }),
    ).toBe(false);
    expect(isWCEnvelope({ msgId: 'x', ts: 1, kind: 'unknown', payload: {} })).toBe(
      false,
    );
    expect(isWCEnvelope({ msgId: 'x', ts: 1, kind: 'handshake', payload: null })).toBe(
      false,
    );
  });

  // ---------------------------------------------------------------
  // (f) JSON.stringify round-trip is structurally identical
  // ---------------------------------------------------------------
  it.each(WC_MESSAGE_KINDS)(
    'JSON.stringify round-trip preserves envelope shape for %s',
    (kind) => {
      const env = makeEnvelope(kind, sampleFor(kind));
      const round = JSON.parse(JSON.stringify(env));
      expect(round).toEqual(env);
      // And the round-tripped object still passes the type guard.
      expect(isWCEnvelope(round)).toBe(true);
    },
  );

  // ---------------------------------------------------------------
  // (g) Required fields are enforced at compile time
  // ---------------------------------------------------------------
  it('omitting a required field on set-completed is a TypeScript error', () => {
    // @ts-expect-error — `weight` and `reps` are required.
    makeEnvelope('set-completed', {
      sessionId: 'sess-1',
      setId: 'set-1',
      is_logged: true,
    });
    // Sanity: the fully-typed call still passes.
    const ok = makeEnvelope('set-completed', sampleFor('set-completed'));
    expect(ok.kind).toBe('set-completed');
  });

  it('omitting a required field on handshake is a TypeScript error', () => {
    // @ts-expect-error — `clientVersion` is required.
    makeEnvelope('handshake', { requestId: 'r-1' });
    // Sanity assertion so this `it` block actually does something at runtime.
    expect(WC_MESSAGE_KINDS).toContain('handshake');
  });

  // ---------------------------------------------------------------
  // (h) Negative case — wrong payload shape is a TypeScript error
  // ---------------------------------------------------------------
  it('passing wrong payload shape for a kind is a TypeScript error', () => {
    // @ts-expect-error — `hr-tick` payload is not the right shape for `end-session`.
    makeEnvelope('end-session', sampleFor('hr-tick'));
    // @ts-expect-error — unknown kind literal.
    makeEnvelope('completely-fake-kind', { sessionId: 'sess-1' });
    // @ts-expect-error — extra-shaped object missing the required fields.
    makeEnvelope('end-session', { sessionId: 'sess-1' });
    // Sanity assertion — keep the `it` block honest at runtime.
    expect(true).toBe(true);
  });

  // ---------------------------------------------------------------
  // Additional Q6 wire-rule defences
  // ---------------------------------------------------------------
  it('normaliseForWire rejects undefined / function / Map / Set', () => {
    expect(() => normaliseForWire({ a: undefined })).toThrow(/undefined/);
    expect(() =>
      normaliseForWire({ fn: () => 42 } as unknown as Record<string, unknown>),
    ).toThrow(/function/);
    expect(() => normaliseForWire({ m: new Map() })).toThrow(/Map/);
    expect(() => normaliseForWire({ s: new Set() })).toThrow(/Map \/ Set/);
  });

  // ---------------------------------------------------------------
  // Compile-time discriminated-union narrowing sanity
  // ---------------------------------------------------------------
  it('switch on kind narrows payload type', () => {
    const env: WCMessage = makeEnvelope('hr-tick', sampleFor('hr-tick'));
    switch (env.kind) {
      case 'hr-tick':
        // If narrowing failed this would be a TS error — at runtime
        // we just assert the field exists.
        expect(typeof env.payload.bpm).toBe('number');
        break;
      default:
        throw new Error('unexpected kind');
    }
  });
});
