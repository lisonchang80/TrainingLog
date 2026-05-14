import {
  clearNewlyCreated,
  clearNewlyCreatedSuperset,
  clearPick,
  consumeNewlyCreated,
  consumeNewlyCreatedSuperset,
  consumePick,
  peekNewlyCreatedForTest,
  peekNewlyCreatedSupersetForTest,
  peekPickForTest,
  submitNewlyCreated,
  submitNewlyCreatedSuperset,
  submitPick,
} from '../../src/domain/exercise/pickerBridge';

describe('pickerBridge', () => {
  beforeEach(() => clearPick());

  it('returns null when empty', () => {
    expect(consumePick()).toBeNull();
  });

  it('round-trips a payload', () => {
    submitPick({ exerciseIds: ['e1', 'e2', 'e3'], reusableSupersetIds: [] });
    expect(consumePick()).toEqual({
      exerciseIds: ['e1', 'e2', 'e3'],
      reusableSupersetIds: [],
    });
  });

  it('round-trips a mixed payload with reusable superset ids', () => {
    submitPick({
      exerciseIds: ['e1', 'e2'],
      reusableSupersetIds: ['s-A', 's-B'],
    });
    expect(consumePick()).toEqual({
      exerciseIds: ['e1', 'e2'],
      reusableSupersetIds: ['s-A', 's-B'],
    });
  });

  it('clears after consume — second consume returns null', () => {
    submitPick({ exerciseIds: ['e1'], reusableSupersetIds: [] });
    consumePick();
    expect(consumePick()).toBeNull();
  });

  it('submit overwrites prior unread payload', () => {
    submitPick({ exerciseIds: ['old'], reusableSupersetIds: ['s-old'] });
    submitPick({ exerciseIds: ['new', 'er'], reusableSupersetIds: ['s-new'] });
    expect(consumePick()).toEqual({
      exerciseIds: ['new', 'er'],
      reusableSupersetIds: ['s-new'],
    });
  });

  it('clearPick discards pending payload', () => {
    submitPick({ exerciseIds: ['e1'], reusableSupersetIds: ['s-1'] });
    clearPick();
    expect(consumePick()).toBeNull();
  });

  it('submit copies the arrays (caller mutation does not affect mailbox)', () => {
    const exIds = ['e1', 'e2'];
    const rsIds = ['s-1'];
    submitPick({ exerciseIds: exIds, reusableSupersetIds: rsIds });
    exIds.push('e3');
    rsIds.push('s-2');
    const out = consumePick();
    expect(out?.exerciseIds).toEqual(['e1', 'e2']);
    expect(out?.reusableSupersetIds).toEqual(['s-1']);
  });

  it('consume returns a fresh payload (callers mutate freely)', () => {
    submitPick({ exerciseIds: ['e1'], reusableSupersetIds: ['s-1'] });
    const a = consumePick();
    submitPick({ exerciseIds: ['e2'], reusableSupersetIds: ['s-2'] });
    const b = consumePick();
    expect(a?.exerciseIds).toEqual(['e1']);
    expect(a?.reusableSupersetIds).toEqual(['s-1']);
    expect(b?.exerciseIds).toEqual(['e2']);
    expect(b?.reusableSupersetIds).toEqual(['s-2']);
  });

  it('peekPickForTest returns a copy without consuming', () => {
    submitPick({ exerciseIds: ['e1'], reusableSupersetIds: ['s-1'] });
    const p = peekPickForTest();
    expect(p).toEqual({ exerciseIds: ['e1'], reusableSupersetIds: ['s-1'] });
    // Still consumable
    expect(consumePick()).toEqual({
      exerciseIds: ['e1'],
      reusableSupersetIds: ['s-1'],
    });
  });

  it('preserves order across submits', () => {
    submitPick({ exerciseIds: ['c', 'a', 'b'], reusableSupersetIds: ['z', 'y'] });
    const out = consumePick();
    expect(out?.exerciseIds).toEqual(['c', 'a', 'b']);
    expect(out?.reusableSupersetIds).toEqual(['z', 'y']);
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
    submitPick({ exerciseIds: ['p1', 'p2'], reusableSupersetIds: [] });
    submitNewlyCreated('nc1');
    expect(consumeNewlyCreated()).toBe('nc1');
    expect(consumePick()?.exerciseIds).toEqual(['p1', 'p2']);
  });
});

describe('pickerBridge — newlyCreatedSuperset mailbox (slice 9.8b grill Q7)', () => {
  beforeEach(() => clearNewlyCreatedSuperset());

  it('returns null when empty', () => {
    expect(consumeNewlyCreatedSuperset()).toBeNull();
  });

  it('round-trips a single id', () => {
    submitNewlyCreatedSuperset('rs-abc');
    expect(consumeNewlyCreatedSuperset()).toBe('rs-abc');
  });

  it('clears after consume', () => {
    submitNewlyCreatedSuperset('rs-1');
    consumeNewlyCreatedSuperset();
    expect(consumeNewlyCreatedSuperset()).toBeNull();
  });

  it('submit overwrites prior unread value', () => {
    submitNewlyCreatedSuperset('old');
    submitNewlyCreatedSuperset('new');
    expect(consumeNewlyCreatedSuperset()).toBe('new');
  });

  it('clearNewlyCreatedSuperset discards pending value', () => {
    submitNewlyCreatedSuperset('rs-1');
    clearNewlyCreatedSuperset();
    expect(consumeNewlyCreatedSuperset()).toBeNull();
  });

  it('peekNewlyCreatedSupersetForTest returns value without clearing', () => {
    submitNewlyCreatedSuperset('rs-1');
    expect(peekNewlyCreatedSupersetForTest()).toBe('rs-1');
    expect(consumeNewlyCreatedSuperset()).toBe('rs-1'); // still consumable
  });

  it('is independent of other mailboxes', () => {
    submitPick({ exerciseIds: ['p1'], reusableSupersetIds: ['rs-p'] });
    submitNewlyCreated('ex-nc');
    submitNewlyCreatedSuperset('rs-nc');
    expect(consumeNewlyCreatedSuperset()).toBe('rs-nc');
    expect(consumeNewlyCreated()).toBe('ex-nc');
    expect(consumePick()).toEqual({
      exerciseIds: ['p1'],
      reusableSupersetIds: ['rs-p'],
    });
  });
});
