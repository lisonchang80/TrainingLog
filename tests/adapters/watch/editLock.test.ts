/**
 * ADR-0028 cast edit-token lock — pure state machine tests.
 *
 * Proves the four invariants (mutual exclusion / epoch monotonicity / direction
 * follows holder / cast-only) plus the 3-step handshake, force-take, stale-drop,
 * and universal epoch self-heal. The two-side simulation at the bottom is the
 * load-bearing one: it drives BOTH reducers through a real exchange (translating
 * each side's emitted `send` effects into the other side's `recv-*` events) and
 * asserts "never two holders" holds at every step.
 */

import {
  initialEditLockState,
  reduceEditLock,
  canEdit,
  isLockedOut,
} from '../../../src/adapters/watch/editLock';
import type {
  EditLockState,
  EditLockEvent,
  EditLockEffect,
  LockMessageKind,
} from '../../../src/adapters/watch/editLock';

const SID = 'sess-cast-1';

function eff(effects: EditLockEffect[], type: EditLockEffect['type']): EditLockEffect | undefined {
  return effects.find((e) => e.type === type);
}
function sendEff(effects: EditLockEffect[], kind: LockMessageKind) {
  return effects.find(
    (e): e is Extract<EditLockEffect, { type: 'send' }> =>
      e.type === 'send' && e.kind === kind,
  );
}

describe('editLock — initial / cast bootstrap (INV-4 cast-only)', () => {
  it('starts unpaired and editable (solo session, no lock)', () => {
    const s = initialEditLockState('iphone');
    expect(s.status).toBe('unpaired');
    expect(s.epoch).toBe(0);
    expect(canEdit(s)).toBe(true);
    expect(isLockedOut(s)).toBe(false);
  });

  it('iPhone cast-initiated → holder at epoch 1 (發起方初握)', () => {
    const { state, effects } = reduceEditLock(
      initialEditLockState('iphone'),
      { type: 'cast-initiated', sessionId: SID },
    );
    expect(state.status).toBe('holder');
    expect(state.epoch).toBe(1);
    expect(state.sessionId).toBe(SID);
    expect(canEdit(state)).toBe(true);
    // re-cast bumps the generation (re-assert control)
    const recast = reduceEditLock(state, { type: 'cast-initiated', sessionId: SID });
    expect(recast.state.epoch).toBe(2);
  });

  it('Watch cast-received → locked at the seeded epoch, not editable', () => {
    const { state, effects } = reduceEditLock(
      initialEditLockState('watch'),
      { type: 'cast-received', sessionId: SID, epoch: 1 },
    );
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(1);
    expect(canEdit(state)).toBe(false);
    expect(isLockedOut(state)).toBe(true);
    expect(eff(effects, 'apply-snapshot')).toBeDefined();
  });

  it('Watch drops a stale re-cast (same session, lower epoch)', () => {
    let s: EditLockState = reduceEditLock(initialEditLockState('watch'), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 5,
    }).state;
    const r = reduceEditLock(s, { type: 'cast-received', sessionId: SID, epoch: 3 });
    expect(r.state.epoch).toBe(5);
    expect(r.effects).toHaveLength(0);
  });

  it('Watch adopts a different session unconditionally (new pairing)', () => {
    let s: EditLockState = reduceEditLock(initialEditLockState('watch'), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 5,
    }).state;
    const r = reduceEditLock(s, { type: 'cast-received', sessionId: 'other', epoch: 1 });
    expect(r.state.status).toBe('locked');
    expect(r.state.epoch).toBe(1);
    expect(r.state.sessionId).toBe('other');
  });
});

describe('editLock — unlock + 3-step handshake (INV-1 mutual exclusion)', () => {
  function lockedWatch(epoch = 1): EditLockState {
    return reduceEditLock(initialEditLockState('watch'), {
      type: 'cast-received',
      sessionId: SID,
      epoch,
    }).state;
  }
  function holderPhone(epoch = 1): EditLockState {
    return reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state; // epoch 1
  }

  it('unlock-pressed → requesting + lock-request + request timer', () => {
    const { state, effects } = reduceEditLock(lockedWatch(1), { type: 'unlock-pressed' });
    expect(state.status).toBe('requesting');
    expect(canEdit(state)).toBe(false);
    expect(sendEff(effects, 'lock-request')?.epoch).toBe(1);
    expect(eff(effects, 'start-request-timer')).toBeDefined();
  });

  it('unlock-pressed is a no-op unless locked', () => {
    const r = reduceEditLock(holderPhone(), { type: 'unlock-pressed' });
    expect(r.state.status).toBe('holder');
    expect(r.effects).toHaveLength(0);
  });

  it('holder receives valid request → offering + grant(E+1, snapshot) + ack timer; cannot edit while offering', () => {
    const { state, effects } = reduceEditLock(holderPhone(1), {
      type: 'recv-lock-request',
      epoch: 1,
    });
    expect(state.status).toBe('offering');
    expect(state.epoch).toBe(1); // holder keeps its epoch until ack
    expect(canEdit(state)).toBe(false); // editing PAUSED during handover
    const grant = sendEff(effects, 'lock-grant');
    expect(grant?.epoch).toBe(2);
    expect(grant?.withSnapshot).toBe(true);
    expect(eff(effects, 'start-ack-timer')).toBeDefined();
  });

  it('requester receives grant → holder(E+1) + apply + ack', () => {
    const requesting = reduceEditLock(lockedWatch(1), { type: 'unlock-pressed' }).state;
    const { state, effects } = reduceEditLock(requesting, {
      type: 'recv-lock-grant',
      epoch: 2,
    });
    expect(state.status).toBe('holder');
    expect(state.epoch).toBe(2);
    expect(canEdit(state)).toBe(true);
    expect(eff(effects, 'apply-snapshot')).toBeDefined();
    expect(sendEff(effects, 'lock-ack')?.epoch).toBe(2);
    expect(eff(effects, 'cancel-request-timer')).toBeDefined();
  });

  it('granter receives ack → locked(E+1)', () => {
    const offering = reduceEditLock(holderPhone(1), {
      type: 'recv-lock-request',
      epoch: 1,
    }).state;
    const { state, effects } = reduceEditLock(offering, { type: 'recv-lock-ack', epoch: 2 });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(2);
    expect(canEdit(state)).toBe(false);
    expect(eff(effects, 'cancel-ack-timer')).toBeDefined();
  });

  it('granter ignores an ack for the wrong epoch', () => {
    const offering = reduceEditLock(holderPhone(1), {
      type: 'recv-lock-request',
      epoch: 1,
    }).state;
    const r = reduceEditLock(offering, { type: 'recv-lock-ack', epoch: 9 });
    expect(r.state.status).toBe('offering');
  });
});

describe('editLock — stale requester + ack-timeout recovery', () => {
  it('holder re-locks a stale requester via lock-sync (does not grant)', () => {
    const holder = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state; // epoch 1
    const bumped = reduceEditLock(holder, { type: 'cast-initiated', sessionId: SID }).state; // epoch 2
    const { state, effects } = reduceEditLock(bumped, { type: 'recv-lock-request', epoch: 1 });
    expect(state.status).toBe('holder'); // stayed holder
    expect(sendEff(effects, 'lock-sync')?.epoch).toBe(2);
    expect(sendEff(effects, 'lock-grant')).toBeUndefined();
  });

  it('requester accepts lock-sync → locked at current epoch', () => {
    const requesting = reduceEditLock(
      reduceEditLock(initialEditLockState('watch'), {
        type: 'cast-received',
        sessionId: SID,
        epoch: 1,
      }).state,
      { type: 'unlock-pressed' },
    ).state;
    const { state, effects } = reduceEditLock(requesting, { type: 'recv-lock-sync', epoch: 2 });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(2);
    expect(eff(effects, 'cancel-request-timer')).toBeDefined();
  });

  it('ack-timeout reverts offering → holder at the SAME epoch (transfer aborted)', () => {
    const offering = reduceEditLock(
      reduceEditLock(initialEditLockState('iphone'), {
        type: 'cast-initiated',
        sessionId: SID,
      }).state,
      { type: 'recv-lock-request', epoch: 1 },
    ).state;
    const { state } = reduceEditLock(offering, { type: 'ack-timeout' });
    expect(state.status).toBe('holder');
    expect(state.epoch).toBe(1);
    expect(canEdit(state)).toBe(true);
  });
});

describe('editLock — offering re-grants a re-pressed lock-request (issue 2 fix)', () => {
  // Device repro: holder asleep → Watch unlock times out (對方沒回應) → Watch
  // 保留鎖定 → holder wakes + processes the queued request → offering (grant
  // dropped by the now-locked Watch) → Watch re-presses unlock. The 2nd request
  // must NOT be silently dropped while we sit in offering, or the Watch times out
  // again even though the holder is alive.
  it('a second lock-request@epoch while offering re-sends the grant + restarts ack timer', () => {
    let s = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state; // holder@1
    const r1 = reduceEditLock(s, { type: 'recv-lock-request', epoch: 1 });
    expect(r1.state.status).toBe('offering');
    expect(r1.state.epoch).toBe(1);
    expect(sendEff(r1.effects, 'lock-grant')?.epoch).toBe(2);
    s = r1.state; // offering@1

    const r2 = reduceEditLock(s, { type: 'recv-lock-request', epoch: 1 });
    expect(r2.state.status).toBe('offering'); // stays offering
    expect(r2.state.epoch).toBe(1);
    expect(sendEff(r2.effects, 'lock-grant')?.epoch).toBe(2); // re-granted, NOT dropped
    expect(eff(r2.effects, 'start-ack-timer')).toBeDefined(); // ack timer restarted
  });

  it('a STALE re-request (epoch < mine) from offering re-locks via lock-sync, not grant', () => {
    let s = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state; // holder@1
    s = reduceEditLock(s, { type: 'cast-initiated', sessionId: SID }).state; // holder@2
    s = reduceEditLock(s, { type: 'recv-lock-request', epoch: 2 }).state; // offering@2
    const r = reduceEditLock(s, { type: 'recv-lock-request', epoch: 1 });
    expect(sendEff(r.effects, 'lock-sync')?.epoch).toBe(2);
    expect(sendEff(r.effects, 'lock-grant')).toBeUndefined();
  });

  it('a SUPERSEDING request (epoch > mine) from offering still demotes', () => {
    const offering = reduceEditLock(
      reduceEditLock(initialEditLockState('iphone'), {
        type: 'cast-initiated',
        sessionId: SID,
      }).state,
      { type: 'recv-lock-request', epoch: 1 },
    ).state; // offering@1
    const { state } = reduceEditLock(offering, { type: 'recv-lock-request', epoch: 5 });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(5);
  });

  it('UNPAIRED ignores a lock-request — no demote (holder-mid-restart deadlock guard)', () => {
    // iPhone just relaunched: editLock is unpaired@0 while the async holder
    // restore is still in flight. A Watch (retried) request@3 must NOT demote it
    // to locked — that would leave nobody to grant → permanent dual-lockout.
    const { state, effects } = reduceEditLock(initialEditLockState('iphone'), {
      type: 'recv-lock-request',
      epoch: 3,
    });
    expect(state.status).toBe('unpaired'); // stayed unpaired, NOT demoted
    expect(state.epoch).toBe(0);
    expect(effects).toHaveLength(0);
  });

  it('reclaim-holder from UNPAIRED → holder at the given epoch (restart recovery)', () => {
    // iPhone relaunched unpaired (restore missed); a request for its active
    // session reclaims the token at the requester's epoch so it can then grant.
    const { state } = reduceEditLock(initialEditLockState('iphone'), {
      type: 'reclaim-holder',
      sessionId: SID,
      epoch: 4,
    });
    expect(state.status).toBe('holder');
    expect(state.epoch).toBe(4);
    expect(state.sessionId).toBe(SID);
  });

  it('reclaim-holder is a no-op when already paired (never overwrites a live side)', () => {
    const locked = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 3,
    }).state; // locked@3
    const { state } = reduceEditLock(locked, {
      type: 'reclaim-holder',
      sessionId: SID,
      epoch: 9,
    });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(3);
  });

  it('reclaim → request → grant: unpaired iPhone recovers and hands the token to the requester', () => {
    // Full restart-recovery chain on the iPhone side: reclaim holder@E, then the
    // same request grants @E+1, so the Watch (requesting@E) can become holder.
    let s = reduceEditLock(initialEditLockState('iphone'), {
      type: 'reclaim-holder',
      sessionId: SID,
      epoch: 5,
    }).state; // holder@5
    const r = reduceEditLock(s, { type: 'recv-lock-request', epoch: 5 });
    expect(r.state.status).toBe('offering');
    expect(sendEff(r.effects, 'lock-grant')?.epoch).toBe(6);
  });
});

describe('editLock — request timeout dialog → force-take / keep-lock (Q2)', () => {
  function requesting(epoch = 1): EditLockState {
    return reduceEditLock(
      reduceEditLock(initialEditLockState('watch'), {
        type: 'cast-received',
        sessionId: SID,
        epoch,
      }).state,
      { type: 'unlock-pressed' },
    ).state;
  }

  it('request-timeout shows the dialog, stays requesting', () => {
    const { state, effects } = reduceEditLock(requesting(1), { type: 'request-timeout' });
    expect(state.status).toBe('requesting');
    expect(state.requestTimedOut).toBe(true);
    expect(eff(effects, 'show-timeout-dialog')).toBeDefined();
  });

  it('force-take → holder(E+1) + lock-takeover broadcast', () => {
    const timedOut = reduceEditLock(requesting(1), { type: 'request-timeout' }).state;
    const { state, effects } = reduceEditLock(timedOut, { type: 'force-take' });
    expect(state.status).toBe('holder');
    expect(state.epoch).toBe(2);
    expect(state.requestTimedOut).toBe(false);
    expect(sendEff(effects, 'lock-takeover')?.epoch).toBe(2);
    expect(eff(effects, 'hide-timeout-dialog')).toBeDefined();
  });

  it('keep-lock → back to locked at the same epoch', () => {
    const timedOut = reduceEditLock(requesting(1), { type: 'request-timeout' }).state;
    const { state, effects } = reduceEditLock(timedOut, { type: 'keep-lock' });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(1);
    expect(eff(effects, 'cancel-request-timer')).toBeDefined();
  });
});

describe('editLock — universal epoch self-heal (INV-2)', () => {
  it('old holder demotes to locked on a higher-epoch takeover', () => {
    const holder = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state; // epoch 1
    const { state, effects } = reduceEditLock(holder, { type: 'recv-lock-takeover', epoch: 2 });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(2);
    expect(eff(effects, 'apply-snapshot')).toBeDefined();
  });

  it('holder demotes on a higher-epoch live-mirror (superseded)', () => {
    const holder = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state;
    const { state } = reduceEditLock(holder, { type: 'recv-mirror', epoch: 2 });
    expect(state.status).toBe('locked');
    expect(state.epoch).toBe(2);
  });

  it('locked side applies a same-epoch mirror', () => {
    const locked = reduceEditLock(initialEditLockState('watch'), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 1,
    }).state;
    const { state, effects } = reduceEditLock(locked, { type: 'recv-mirror', epoch: 1 });
    expect(state.status).toBe('locked');
    expect(eff(effects, 'apply-snapshot')).toBeDefined();
  });

  it('drops a stale (lower-epoch) mirror', () => {
    const locked = reduceEditLock(initialEditLockState('watch'), {
      type: 'cast-received',
      sessionId: SID,
      epoch: 5,
    }).state;
    const { state, effects } = reduceEditLock(locked, { type: 'recv-mirror', epoch: 3 });
    expect(state.epoch).toBe(5);
    expect(effects).toHaveLength(0);
  });

  it('ignores a mirror entirely while unpaired (INV-4)', () => {
    const r = reduceEditLock(initialEditLockState('iphone'), { type: 'recv-mirror', epoch: 9 });
    expect(r.state.status).toBe('unpaired');
    expect(r.effects).toHaveLength(0);
  });

  it('ended tears the pairing down to unpaired', () => {
    const holder = reduceEditLock(initialEditLockState('iphone'), {
      type: 'cast-initiated',
      sessionId: SID,
    }).state;
    const { state } = reduceEditLock(holder, { type: 'ended' });
    expect(state.status).toBe('unpaired');
    expect(state.sessionId).toBeNull();
    expect(state.epoch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Two-side simulation — the real mutual-exclusion proof.
// ---------------------------------------------------------------------------

describe('editLock — two-side simulation (never two holders)', () => {
  type Side = { state: EditLockState };

  /** Translate a sender effect into the matching inbound event for the peer. */
  function inboundFor(e: Extract<EditLockEffect, { type: 'send' }>): EditLockEvent {
    switch (e.kind) {
      case 'lock-request':
        return { type: 'recv-lock-request', epoch: e.epoch };
      case 'lock-grant':
        return { type: 'recv-lock-grant', epoch: e.epoch };
      case 'lock-ack':
        return { type: 'recv-lock-ack', epoch: e.epoch };
      case 'lock-takeover':
        return { type: 'recv-lock-takeover', epoch: e.epoch };
      case 'lock-sync':
        return { type: 'recv-lock-sync', epoch: e.epoch };
    }
  }

  function holderCount(a: Side, b: Side): number {
    return [a.state, b.state].filter((s) => s.status === 'holder').length;
  }

  it('iPhone casts, Watch grabs the token via a clean 3-step handshake', () => {
    const phone: Side = { state: initialEditLockState('iphone') };
    const watch: Side = { state: initialEditLockState('watch') };

    // cast
    let r = reduceEditLock(phone.state, { type: 'cast-initiated', sessionId: SID });
    phone.state = r.state;
    watch.state = reduceEditLock(watch.state, {
      type: 'cast-received',
      sessionId: SID,
      epoch: phone.state.epoch,
    }).state;
    expect(holderCount(phone, watch)).toBe(1); // only iPhone

    // Watch unlock → request
    r = reduceEditLock(watch.state, { type: 'unlock-pressed' });
    watch.state = r.state;
    const req = sendEff(r.effects, 'lock-request')!;
    expect(holderCount(phone, watch)).toBe(1);

    // iPhone receives request → offering + grant
    r = reduceEditLock(phone.state, inboundFor(req));
    phone.state = r.state;
    const grant = sendEff(r.effects, 'lock-grant')!;
    expect(holderCount(phone, watch)).toBe(0); // offering ≠ holder — safe gap

    // Watch receives grant → holder + ack
    r = reduceEditLock(watch.state, inboundFor(grant));
    watch.state = r.state;
    const ack = sendEff(r.effects, 'lock-ack')!;
    expect(holderCount(phone, watch)).toBe(1); // only Watch now

    // iPhone receives ack → locked
    r = reduceEditLock(phone.state, inboundFor(ack));
    phone.state = r.state;

    expect(phone.state.status).toBe('locked');
    expect(watch.state.status).toBe('holder');
    expect(phone.state.epoch).toBe(2);
    expect(watch.state.epoch).toBe(2);
    expect(holderCount(phone, watch)).toBe(1);
    // direction follows holder: only the Watch may edit now
    expect(canEdit(watch.state)).toBe(true);
    expect(canEdit(phone.state)).toBe(false);
  });

  it('force-take + reconnect: old holder self-heals to locked, never two holders', () => {
    const phone: Side = { state: initialEditLockState('iphone') };
    const watch: Side = { state: initialEditLockState('watch') };

    let r = reduceEditLock(phone.state, { type: 'cast-initiated', sessionId: SID });
    phone.state = r.state; // holder(1)
    watch.state = reduceEditLock(watch.state, {
      type: 'cast-received',
      sessionId: SID,
      epoch: 1,
    }).state; // locked(1)

    // Watch unlock, iPhone unreachable → request never reaches phone
    watch.state = reduceEditLock(watch.state, { type: 'unlock-pressed' }).state;
    watch.state = reduceEditLock(watch.state, { type: 'request-timeout' }).state;
    r = reduceEditLock(watch.state, { type: 'force-take' });
    watch.state = r.state;
    const takeover = sendEff(r.effects, 'lock-takeover')!;
    expect(watch.state.status).toBe('holder');
    expect(watch.state.epoch).toBe(2);
    // iPhone still thinks it holds (epoch 1) — TRANSIENT, but its edits are on
    // the losing epoch and will be overwritten when it demotes.
    expect(holderCount(phone, watch)).toBe(2); // transient only

    // iPhone reconnects, receives the takeover (or any epoch-2 mirror) → demote
    phone.state = reduceEditLock(phone.state, inboundFor(takeover)).state;
    expect(phone.state.status).toBe('locked');
    expect(phone.state.epoch).toBe(2);
    expect(holderCount(phone, watch)).toBe(1); // healed
  });
});
