import { ToastController } from '../../src/domain/ui/toastController';

describe('ToastController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts hidden (message=null, id=0)', () => {
    const c = new ToastController();
    expect(c.getState()).toEqual({ message: null, icon: null, id: 0 });
  });

  it('show() makes message visible and bumps id; auto-dismisses after default 2500ms', () => {
    const c = new ToastController();
    c.show('已更新模板');
    expect(c.getState().message).toBe('已更新模板');
    expect(c.getState().icon).toBe('success');
    expect(c.getState().id).toBe(1);

    jest.advanceTimersByTime(2499);
    expect(c.getState().message).toBe('已更新模板');

    jest.advanceTimersByTime(1);
    expect(c.getState().message).toBeNull();
  });

  it('show() respects custom durationMs and icon', () => {
    const c = new ToastController();
    c.show('oops', { icon: 'error', durationMs: 500 });
    expect(c.getState().icon).toBe('error');

    jest.advanceTimersByTime(499);
    expect(c.getState().message).toBe('oops');
    jest.advanceTimersByTime(1);
    expect(c.getState().message).toBeNull();
  });

  it('second show() replaces the first and resets the timer (single-slot)', () => {
    const c = new ToastController();
    c.show('first', { durationMs: 1000 });
    jest.advanceTimersByTime(900);
    c.show('second', { durationMs: 1000 });
    // After 900ms the original would have dismissed in 100ms — but second
    // show() resets, so we still see "second" after another 900ms.
    jest.advanceTimersByTime(900);
    expect(c.getState().message).toBe('second');
    expect(c.getState().id).toBe(2);

    jest.advanceTimersByTime(100);
    expect(c.getState().message).toBeNull();
  });

  it('hide() dismisses immediately and clears any pending timer', () => {
    const c = new ToastController();
    c.show('hi', { durationMs: 5000 });
    expect(c.getState().message).toBe('hi');

    c.hide();
    expect(c.getState().message).toBeNull();

    // No further state change should fire even if timers advance.
    const states: (string | null)[] = [];
    c.subscribe(() => states.push(c.getState().message));
    jest.advanceTimersByTime(10_000);
    expect(states).toEqual([]);
  });

  it('subscribe() fires on show + on auto-dismiss; unsubscribe stops further notifications', () => {
    const c = new ToastController();
    const events: (string | null)[] = [];
    const unsub = c.subscribe(() => events.push(c.getState().message));

    c.show('x', { durationMs: 100 });
    jest.advanceTimersByTime(100);
    expect(events).toEqual(['x', null]);

    unsub();
    c.show('y', { durationMs: 100 });
    jest.advanceTimersByTime(100);
    expect(events).toEqual(['x', null]); // no new events after unsubscribe
  });
});
