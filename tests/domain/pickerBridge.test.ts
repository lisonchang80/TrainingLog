import {
  clearNewlyCreated,
  clearPick,
  consumeNewlyCreated,
  consumePick,
  peekNewlyCreatedForTest,
  peekPickForTest,
  submitNewlyCreated,
  submitPick,
} from '../../src/domain/exercise/pickerBridge';

describe('pickerBridge', () => {
  beforeEach(() => clearPick());

  it('returns null when empty', () => {
    expect(consumePick()).toBeNull();
  });

  it('round-trips a payload', () => {
    submitPick({ exerciseIds: ['e1', 'e2', 'e3'] });
    expect(consumePick()).toEqual({ exerciseIds: ['e1', 'e2', 'e3'] });
  });

  it('clears after consume — second consume returns null', () => {
    submitPick({ exerciseIds: ['e1'] });
    consumePick();
    expect(consumePick()).toBeNull();
  });

  it('submit overwrites prior unread payload', () => {
    submitPick({ exerciseIds: ['old'] });
    submitPick({ exerciseIds: ['new', 'er'] });
    expect(consumePick()).toEqual({ exerciseIds: ['new', 'er'] });
  });

  it('clearPick discards pending payload', () => {
    submitPick({ exerciseIds: ['e1'] });
    clearPick();
    expect(consumePick()).toBeNull();
  });

  it('submit copies the array (caller mutation does not affect mailbox)', () => {
    const ids = ['e1', 'e2'];
    submitPick({ exerciseIds: ids });
    ids.push('e3');
    expect(consumePick()?.exerciseIds).toEqual(['e1', 'e2']);
  });

  it('consume returns a fresh array (callers mutate freely)', () => {
    submitPick({ exerciseIds: ['e1'] });
    const a = consumePick();
    submitPick({ exerciseIds: ['e2'] });
    const b = consumePick();
    expect(a?.exerciseIds).toEqual(['e1']);
    expect(b?.exerciseIds).toEqual(['e2']);
  });

  it('peekPickForTest returns a copy without consuming', () => {
    submitPick({ exerciseIds: ['e1'] });
    const p = peekPickForTest();
    expect(p).toEqual({ exerciseIds: ['e1'] });
    // Still consumable
    expect(consumePick()).toEqual({ exerciseIds: ['e1'] });
  });

  it('preserves order across submits', () => {
    submitPick({ exerciseIds: ['c', 'a', 'b'] });
    expect(consumePick()?.exerciseIds).toEqual(['c', 'a', 'b']);
  });
});

describe('pickerBridge — newlyCreated mailbox', () => {
  beforeEach(() => clearNewlyCreated());

  it('returns null when empty', () => {
    expect(consumeNewlyCreated()).toBeNull();
  });

  it('round-trips a single id', () => {
    submitNewlyCreated('ex-123');
    expect(consumeNewlyCreated()).toBe('ex-123');
  });

  it('clears after consume', () => {
    submitNewlyCreated('ex-1');
    consumeNewlyCreated();
    expect(consumeNewlyCreated()).toBeNull();
  });

  it('submit overwrites prior unread value', () => {
    submitNewlyCreated('old');
    submitNewlyCreated('new');
    expect(consumeNewlyCreated()).toBe('new');
  });

  it('clearNewlyCreated discards pending value', () => {
    submitNewlyCreated('ex-1');
    clearNewlyCreated();
    expect(consumeNewlyCreated()).toBeNull();
  });

  it('peekNewlyCreatedForTest returns value without clearing', () => {
    submitNewlyCreated('ex-1');
    expect(peekNewlyCreatedForTest()).toBe('ex-1');
    expect(consumeNewlyCreated()).toBe('ex-1'); // still consumable
  });

  it('is independent of pick mailbox', () => {
    submitPick({ exerciseIds: ['p1', 'p2'] });
    submitNewlyCreated('nc1');
    expect(consumeNewlyCreated()).toBe('nc1');
    expect(consumePick()?.exerciseIds).toEqual(['p1', 'p2']);
  });
});
