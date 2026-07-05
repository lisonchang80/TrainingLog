/**
 * Issue #55 ① (2026-07-05, 拍板 A) — Watch-led start 直接鎖.
 *
 * The Watch-led `start-from-watch` envelope now carries the Watch's holder
 * `lockEpoch`; after the iPhone reconciles 'created' it adopts LOCKED at that
 * epoch immediately (via `cast-received`), instead of waiting for the Watch's
 * first live-mirror — whose initial force-push can race ahead of session
 * creation on a fast transport and be dropped by the recv-mirror unpaired
 * guard (the sim timing hole; on-device the transport delay loses that race).
 *
 * Covered here:
 *   1. `shouldAdoptWatchLedLock` — the pure adoption gate. Its whole reason
 *      to exist: TUI is an OS-durable at-least-once queue that can REDELIVER
 *      a start envelope after an app restart (in-memory msgId ring empty),
 *      and the reducer's cast-received adopts UNCONDITIONALLY on a
 *      new-pairing (different/null sessionId) state — so a stale
 *      `lockEpoch=1` replay onto a fresh post-restart machine would rewind a
 *      persisted holder@2 / locked@2 to locked@1 (INV-2 violation →
 *      split-brain). The gate consults both the live state and the persisted
 *      restart-resilience snapshot.
 *   2. The reducer path the seed drives (`cast-received` from a fresh
 *      machine adopts LOCKED at the Watch's epoch).
 *   3. Source lock — both start-from-watch listener legs in index.tsx feed
 *      the seed (msg-leg wins intake in the common foreground case, so
 *      TUI-leg-only wiring would reopen the hole).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  initialEditLockState,
  reduceEditLock,
  shouldAdoptWatchLedLock,
  type EditLockState,
} from '../../../src/adapters/watch/editLock';

const SID = 'sess-watch-led';

function freshIphone(): EditLockState {
  return initialEditLockState('iphone');
}

describe('#55 ① — shouldAdoptWatchLedLock (pure adoption gate)', () => {
  it('fresh machine + no persisted row + lockEpoch 1 → adopt', () => {
    expect(
      shouldAdoptWatchLedLock({
        current: freshIphone(),
        persisted: null,
        sessionId: SID,
        lockEpoch: 1,
      }),
    ).toBe(true);
  });

  it('lockEpoch absent (pre-#55 Watch) → no adopt (mirror path owns it)', () => {
    expect(
      shouldAdoptWatchLedLock({
        current: freshIphone(),
        persisted: null,
        sessionId: SID,
        lockEpoch: undefined,
      }),
    ).toBe(false);
  });

  it.each([0, -1, NaN, Infinity])(
    'degenerate lockEpoch %p → no adopt',
    (epoch) => {
      expect(
        shouldAdoptWatchLedLock({
          current: freshIphone(),
          persisted: null,
          sessionId: SID,
          lockEpoch: epoch,
        }),
      ).toBe(false);
    },
  );

  it('empty sessionId → no adopt', () => {
    expect(
      shouldAdoptWatchLedLock({
        current: freshIphone(),
        persisted: null,
        sessionId: '',
        lockEpoch: 1,
      }),
    ).toBe(false);
  });

  it('live state already locked@1 for this session → dup delivery is a no-op', () => {
    const current: EditLockState = {
      role: 'iphone',
      status: 'locked',
      epoch: 1,
      sessionId: SID,
      requestTimedOut: false,
    };
    expect(
      shouldAdoptWatchLedLock({
        current,
        persisted: null,
        sessionId: SID,
        lockEpoch: 1,
      }),
    ).toBe(false);
  });

  it('live state advanced to holder@2 (unlocked since) → stale replay must not rewind', () => {
    const current: EditLockState = {
      role: 'iphone',
      status: 'holder',
      epoch: 2,
      sessionId: SID,
      requestTimedOut: false,
    };
    expect(
      shouldAdoptWatchLedLock({
        current,
        persisted: null,
        sessionId: SID,
        lockEpoch: 1,
      }),
    ).toBe(false);
  });

  it('post-restart replay: live state fresh but PERSISTED row is at epoch 2 → must not rewind (INV-2)', () => {
    // The dangerous case the gate exists for: after an iPhone restart the
    // in-memory machine is unpaired@0/null — cast-received would adopt a
    // replayed lockEpoch=1 unconditionally (new-pairing bypass) and clobber
    // the persisted holder@2 the restore effect is about to re-seed.
    expect(
      shouldAdoptWatchLedLock({
        current: freshIphone(),
        persisted: { sessionId: SID, epoch: 2 },
        sessionId: SID,
        lockEpoch: 1,
      }),
    ).toBe(false);
  });

  it('persisted row belongs to a DIFFERENT (old cast) session → adopt the new pairing', () => {
    expect(
      shouldAdoptWatchLedLock({
        current: freshIphone(),
        persisted: { sessionId: 'sess-previous-cast', epoch: 7 },
        sessionId: SID,
        lockEpoch: 1,
      }),
    ).toBe(true);
  });

  it('same session, lockEpoch ahead of both live + persisted → adopt (normal forward move)', () => {
    const current: EditLockState = {
      role: 'iphone',
      status: 'locked',
      epoch: 1,
      sessionId: SID,
      requestTimedOut: false,
    };
    expect(
      shouldAdoptWatchLedLock({
        current,
        persisted: { sessionId: SID, epoch: 1 },
        sessionId: SID,
        lockEpoch: 2,
      }),
    ).toBe(true);
  });
});

describe('#55 ① — the seed drives cast-received: fresh iPhone adopts LOCKED at the Watch epoch', () => {
  it('unpaired@0/null + cast-received(sid, 1) → locked@1, sessionId adopted', () => {
    const { state, effects } = reduceEditLock(freshIphone(), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 1,
    });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(1);
    expect(state.sessionId).toBe(SID);
    // The snapshot effect is a no-op for the start path (the session tree
    // arrives via the start reconcile / live-mirror), but the machine's
    // contract stays uniform.
    expect(effects).toContainEqual({ type: 'apply-snapshot' });
  });

  it('locked@1 then the mirror the Watch sends at the same epoch applies (no drop, no demote)', () => {
    const locked = reduceEditLock(freshIphone(), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 1,
    }).state;
    const { state, effects } = reduceEditLock(locked, {
      type: 'recv-mirror',
      epoch: 1,
    });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(1);
    expect(effects).toContainEqual({ type: 'apply-snapshot' });
  });
});

describe('#55 ① — index.tsx wires the seed on BOTH start-from-watch legs (source lock)', () => {
  const source = readFileSync(
    join(__dirname, '../../../app/(tabs)/index.tsx'),
    'utf8',
  );

  it('both the TUI and the message listener call seedLockFromStart', () => {
    // The msg leg wins intake in the common foreground case (shared msgId
    // ring) — seeding only the TUI leg would silently reopen the hole.
    const calls = source.match(/seedLockFromStart\(env, outcome\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('the seed routes through the hook (guarded adoption), not a raw dispatch', () => {
    expect(source).toMatch(/seedWatchLedLock\(/);
  });
});
