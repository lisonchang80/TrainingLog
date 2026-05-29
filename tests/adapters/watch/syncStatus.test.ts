import {
  computeSyncState,
  shouldShowPendingIndicator,
  DEFAULT_STUCK_THRESHOLD_MS,
  type SyncState,
} from '../../../src/adapters/watch/syncStatus';

/**
 * Slice 13d / D33 — Watch sync-status pure logic (ADR-0019 NEW-Q50 Q7).
 *
 * Pure timestamp→SyncState mapping. `now` is always injected; no fake
 * timers / Date.now needed. Covers: idle, synced, syncing, the
 * syncing→stuck transition AT the 30s boundary (29s vs 31s differ),
 * ack-clears-state, and edge cases (ack newer than send, stale ack,
 * missing/malformed timestamps, custom threshold, clock skew).
 */

// A fixed epoch base keeps the arithmetic readable.
const T0 = 1_700_000_000_000;

describe('computeSyncState — resting states', () => {
  it("returns 'idle' when nothing has been sent (lastSentAt missing)", () => {
    expect(computeSyncState({ now: T0 })).toBe('idle');
    expect(computeSyncState({ lastSentAt: null, now: T0 })).toBe('idle');
    expect(computeSyncState({ lastSentAt: undefined, now: T0 })).toBe('idle');
  });

  it("stays 'idle' even if an ack timestamp is present but no send", () => {
    // Defensive: an ack with no send is nonsensical, but must not crash or
    // report 'synced' — there is nothing to be synced against.
    expect(computeSyncState({ lastAckedAt: T0, now: T0 + 1000 })).toBe('idle');
  });

  it("returns 'synced' when ack equals the send time (ack-clears-state)", () => {
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: T0, now: T0 + 5000 }),
    ).toBe('synced');
  });

  it("returns 'synced' when ack is after the send", () => {
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: T0 + 800, now: T0 + 5000 }),
    ).toBe('synced');
  });

  it("ack clears 'stuck': an ack arriving after 30s+ flips back to 'synced'", () => {
    // Send at T0, no ack → stuck at T0+31s ...
    expect(computeSyncState({ lastSentAt: T0, now: T0 + 31_000 })).toBe('stuck');
    // ... then the reverse-TUI ack lands and we are 'synced' again.
    expect(
      computeSyncState({
        lastSentAt: T0,
        lastAckedAt: T0 + 31_500,
        now: T0 + 32_000,
      }),
    ).toBe('synced');
  });
});

describe('computeSyncState — in-flight states (default 30s threshold)', () => {
  it("returns 'syncing' for a fresh send with no ack, within tolerance", () => {
    expect(computeSyncState({ lastSentAt: T0, now: T0 + 1000 })).toBe('syncing');
    expect(computeSyncState({ lastSentAt: T0, now: T0 + 15_000 })).toBe('syncing');
  });

  it("treats a null/undefined ack on an in-flight send as 'syncing'", () => {
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: null, now: T0 + 2000 }),
    ).toBe('syncing');
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: undefined, now: T0 + 2000 }),
    ).toBe('syncing');
  });

  it("returns 'stuck' once an unacked send passes the 30s mark", () => {
    expect(computeSyncState({ lastSentAt: T0, now: T0 + 45_000 })).toBe('stuck');
  });
});

describe('computeSyncState — 30s boundary transition (the load-bearing assert)', () => {
  it("is 'syncing' at 29s and 'stuck' at 31s (the two differ)", () => {
    const at29 = computeSyncState({ lastSentAt: T0, now: T0 + 29_000 });
    const at31 = computeSyncState({ lastSentAt: T0, now: T0 + 31_000 });
    expect(at29).toBe('syncing');
    expect(at31).toBe('stuck');
    expect(at29).not.toBe(at31);
  });

  it("transition is inclusive at exactly 30s: elapsed === threshold is 'stuck'", () => {
    expect(
      computeSyncState({ lastSentAt: T0, now: T0 + DEFAULT_STUCK_THRESHOLD_MS }),
    ).toBe('stuck');
    // One ms before → still syncing.
    expect(
      computeSyncState({
        lastSentAt: T0,
        now: T0 + DEFAULT_STUCK_THRESHOLD_MS - 1,
      }),
    ).toBe('syncing');
  });
});

describe('computeSyncState — edge cases', () => {
  it("treats a stale ack (older than the latest send) as not-yet-acked", () => {
    // A newer send (T0+10s) supersedes an older ack (T0+1s). The current
    // send is in flight → syncing (within tolerance) or stuck (beyond).
    expect(
      computeSyncState({
        lastSentAt: T0 + 10_000,
        lastAckedAt: T0 + 1000,
        now: T0 + 12_000,
      }),
    ).toBe('syncing');
    expect(
      computeSyncState({
        lastSentAt: T0 + 10_000,
        lastAckedAt: T0 + 1000,
        now: T0 + 45_000,
      }),
    ).toBe('stuck');
  });

  it("never reports 'stuck' for a future/clock-skewed send (negative elapsed)", () => {
    // now BEFORE lastSentAt → elapsed negative → syncing, never stuck.
    expect(computeSyncState({ lastSentAt: T0 + 5000, now: T0 })).toBe('syncing');
  });

  it("ignores a non-finite lastSentAt (NaN/Infinity) → idle", () => {
    expect(computeSyncState({ lastSentAt: NaN, now: T0 })).toBe('idle');
    expect(computeSyncState({ lastSentAt: Infinity, now: T0 })).toBe('idle');
  });

  it("ignores a non-finite lastAckedAt and falls through to in-flight logic", () => {
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: NaN, now: T0 + 2000 }),
    ).toBe('syncing');
    expect(
      computeSyncState({ lastSentAt: T0, lastAckedAt: Infinity, now: T0 + 2000 }),
    ).toBe('syncing');
  });

  it("honours a custom threshold (e.g. 10s)", () => {
    expect(
      computeSyncState({ lastSentAt: T0, now: T0 + 9000, thresholdMs: 10_000 }),
    ).toBe('syncing');
    expect(
      computeSyncState({ lastSentAt: T0, now: T0 + 11_000, thresholdMs: 10_000 }),
    ).toBe('stuck');
  });

  it("falls back to the 30s default when thresholdMs is non-finite", () => {
    expect(
      computeSyncState({ lastSentAt: T0, now: T0 + 29_000, thresholdMs: NaN }),
    ).toBe('syncing');
    expect(
      computeSyncState({
        lastSentAt: T0,
        now: T0 + 31_000,
        thresholdMs: undefined,
      }),
    ).toBe('stuck');
  });

  it("honours a 0ms threshold (always-escalate mode) for an in-flight send", () => {
    // elapsed 0 >= 0 → stuck immediately; an acked send is still synced.
    expect(
      computeSyncState({ lastSentAt: T0, now: T0, thresholdMs: 0 }),
    ).toBe('stuck');
    expect(
      computeSyncState({
        lastSentAt: T0,
        lastAckedAt: T0,
        now: T0,
        thresholdMs: 0,
      }),
    ).toBe('synced');
  });
});

describe('shouldShowPendingIndicator', () => {
  it("shows the ⏳ indicator ONLY for 'stuck' (Q7 只異常顯)", () => {
    const visibility: Record<SyncState, boolean> = {
      idle: false,
      synced: false,
      syncing: false,
      stuck: true,
    };
    (Object.keys(visibility) as SyncState[]).forEach((state) => {
      expect(shouldShowPendingIndicator(state)).toBe(visibility[state]);
    });
  });

  it("end-to-end: a send sitting unacked for 31s drives the ⏳ on", () => {
    const state = computeSyncState({ lastSentAt: T0, now: T0 + 31_000 });
    expect(shouldShowPendingIndicator(state)).toBe(true);
  });
});

describe('DEFAULT_STUCK_THRESHOLD_MS', () => {
  it('is 30 seconds per ADR-0019 Q7', () => {
    expect(DEFAULT_STUCK_THRESHOLD_MS).toBe(30_000);
  });
});
