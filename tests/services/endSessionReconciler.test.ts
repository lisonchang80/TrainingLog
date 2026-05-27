/**
 * Slice 13d / D7 partial — end-session reconciliation reducer tests.
 *
 * Covers ADR-0019 § Q23 — iPhone fires WC `end-session`, arms a
 * 5-second window, expects Watch ack. Tests run cold under
 * `testEnvironment: node` with no fake timers; the reducer is
 * Clock-injected (`tick` carries the caller's `now`).
 */

import {
  initialReconcilerState,
  reduce,
  didJustReconcile,
  RECONCILE_TIMEOUT_MS,
} from '../../src/services/endSessionReconciler';

describe('endSessionReconciler', () => {
  // -----------------------------------------------------------------
  // (a) idle → waiting on sendEnd
  // -----------------------------------------------------------------
  it('idle + sendEnd transitions to waiting with sentAt captured', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });

    expect(s1.phase).toBe('waiting');
    expect(s1.sessionId).toBe('sess-1');
    expect(s1.sentAt).toBe(1_000);
    expect(s1.ackedAt).toBeNull();
    expect(s1.reconciledAt).toBeNull();
  });

  // -----------------------------------------------------------------
  // (b) waiting + matching ack → acked
  // -----------------------------------------------------------------
  it('waiting + ack with matching sessionId transitions to acked with ackedAt captured', () => {
    let s = initialReconcilerState();
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    s = reduce(s, { kind: 'ack', sessionId: 'sess-1', ts: 2_500 });

    expect(s.phase).toBe('acked');
    expect(s.ackedAt).toBe(2_500);
    expect(s.sessionId).toBe('sess-1'); // unchanged
  });

  // -----------------------------------------------------------------
  // (c) waiting + stale ack (mismatched sessionId) → ignored
  // -----------------------------------------------------------------
  it('waiting + ack with mismatched sessionId returns the same state instance (stale)', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    const s2 = reduce(s1, { kind: 'ack', sessionId: 'sess-OLD', ts: 2_500 });

    expect(s2).toBe(s1);
    expect(s2.phase).toBe('waiting');
  });

  // -----------------------------------------------------------------
  // (d) waiting + tick within window → still waiting
  // -----------------------------------------------------------------
  it('waiting + tick within 5_000ms window returns the same state instance', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    const s2 = reduce(s1, { kind: 'tick', now: 1_000 + RECONCILE_TIMEOUT_MS });

    expect(s2).toBe(s1);
    expect(s2.phase).toBe('waiting');
  });

  // -----------------------------------------------------------------
  // (e) waiting + tick beyond window → reconciled
  // -----------------------------------------------------------------
  it('waiting + tick > 5_000ms past sentAt transitions to reconciled with reconciledAt captured', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    const tickNow = 1_000 + RECONCILE_TIMEOUT_MS + 1;
    const s2 = reduce(s1, { kind: 'tick', now: tickNow });

    expect(s2.phase).toBe('reconciled');
    expect(s2.reconciledAt).toBe(tickNow);
    expect(s2.sessionId).toBe('sess-1');
  });

  // -----------------------------------------------------------------
  // (f) acked + late tick → no-op
  // -----------------------------------------------------------------
  it('acked + tick (even past timeout) returns the same state instance', () => {
    let s = initialReconcilerState();
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    s = reduce(s, { kind: 'ack', sessionId: 'sess-1', ts: 2_000 });
    const before = s;

    s = reduce(s, { kind: 'tick', now: 1_000_000 });

    expect(s).toBe(before);
    expect(s.phase).toBe('acked');
  });

  // -----------------------------------------------------------------
  // (g) reconciled + late ack → no-op (already gave up)
  // -----------------------------------------------------------------
  it('reconciled + ack returns the same state instance (no rescue)', () => {
    let s = initialReconcilerState();
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    s = reduce(s, { kind: 'tick', now: 10_000 });
    expect(s.phase).toBe('reconciled');
    const before = s;

    s = reduce(s, { kind: 'ack', sessionId: 'sess-1', ts: 11_000 });

    expect(s).toBe(before);
  });

  // -----------------------------------------------------------------
  // (h) reset from any non-idle phase returns to initial
  // -----------------------------------------------------------------
  it('reset from any non-idle phase returns to initial state', () => {
    let s = initialReconcilerState();
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    s = reduce(s, { kind: 'reset' });

    expect(s.phase).toBe('idle');
    expect(s.sessionId).toBeNull();
    expect(s.sentAt).toBe(0);
    expect(s.ackedAt).toBeNull();
    expect(s.reconciledAt).toBeNull();
  });

  // -----------------------------------------------------------------
  // (h') reset on already-idle is a no-op (referential equality)
  // -----------------------------------------------------------------
  it('reset on already-idle returns the same state instance', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'reset' });

    expect(s1).toBe(s0);
  });

  // -----------------------------------------------------------------
  // (i) sendEnd while waiting restarts the window with new session
  // -----------------------------------------------------------------
  it('sendEnd from waiting restarts the window with the new session and clears prior fields', () => {
    let s = initialReconcilerState();
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-2', ts: 5_000 });

    expect(s.phase).toBe('waiting');
    expect(s.sessionId).toBe('sess-2');
    expect(s.sentAt).toBe(5_000);
    expect(s.ackedAt).toBeNull();
    expect(s.reconciledAt).toBeNull();

    // Ack against old sess-1 must be ignored
    const before = s;
    s = reduce(s, { kind: 'ack', sessionId: 'sess-1', ts: 6_000 });
    expect(s).toBe(before);
  });

  // -----------------------------------------------------------------
  // (j) boundary: exactly RECONCILE_TIMEOUT_MS past sentAt → still waiting
  // -----------------------------------------------------------------
  it('tick exactly at sentAt + RECONCILE_TIMEOUT_MS does NOT fire (strict >)', () => {
    const s0 = initialReconcilerState();
    const s1 = reduce(s0, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    const s2 = reduce(s1, { kind: 'tick', now: 1_000 + RECONCILE_TIMEOUT_MS });

    expect(s2).toBe(s1);
    expect(s2.phase).toBe('waiting');
  });

  // -----------------------------------------------------------------
  // (k) didJustReconcile predicate
  // -----------------------------------------------------------------
  it('didJustReconcile returns true only on the waiting→reconciled transition', () => {
    let s = initialReconcilerState();
    const sIdle = s;
    s = reduce(s, { kind: 'sendEnd', sessionId: 'sess-1', ts: 1_000 });
    const sWaiting = s;
    s = reduce(s, { kind: 'tick', now: 10_000 });
    const sReconciled = s;

    expect(didJustReconcile(sIdle, sWaiting)).toBe(false);
    expect(didJustReconcile(sWaiting, sReconciled)).toBe(true);
    expect(didJustReconcile(sReconciled, sReconciled)).toBe(false);
  });
});
