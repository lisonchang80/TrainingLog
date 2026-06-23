/**
 * Tests for the locale "version" subscription store in `src/i18n/strings.ts`.
 *
 * This store is what makes a language switch re-render the whole app without a
 * restart: `setLocale()` bumps a version counter and notifies subscribers, the
 * root layout subscribes via `useLocale()` and re-keys the navigator.
 *
 * Covered:
 *   - `setLocale` to a NEW locale bumps the version and notifies listeners.
 *   - `setLocale` to the CURRENT locale is a no-op (no bump, no notify) so a
 *     redundant pick (or boot hydration to the default) never remounts.
 *   - `subscribeLocale` returns a working unsubscribe.
 *   - `getLocale` still reflects the active locale after a switch.
 */

import {
  getLocale,
  setLocale,
  getLocaleVersion,
  subscribeLocale,
} from '../../src/i18n/strings';

// Default starting locale is 'zh' (module singleton). Reset after each test so
// ordering between this suite and others stays deterministic.
afterEach(() => {
  setLocale('zh');
});

describe('locale version store', () => {
  test('switching to a new locale bumps the version', () => {
    setLocale('zh'); // ensure baseline
    const before = getLocaleVersion();
    setLocale('en');
    expect(getLocaleVersion()).toBe(before + 1);
    expect(getLocale()).toBe('en');
  });

  test('switching to the current locale is a no-op (no version bump)', () => {
    setLocale('en');
    const after = getLocaleVersion();
    setLocale('en'); // redundant pick — should not bump
    expect(getLocaleVersion()).toBe(after);
    expect(getLocale()).toBe('en');
  });

  test('subscribers are notified on an effective change', () => {
    setLocale('zh');
    let calls = 0;
    const unsub = subscribeLocale(() => {
      calls += 1;
    });
    setLocale('en'); // change → notify
    expect(calls).toBe(1);
    setLocale('en'); // no change → no notify
    expect(calls).toBe(1);
    setLocale('zh'); // change back → notify
    expect(calls).toBe(2);
    unsub();
  });

  test('unsubscribe stops further notifications', () => {
    setLocale('zh');
    let calls = 0;
    const unsub = subscribeLocale(() => {
      calls += 1;
    });
    setLocale('en');
    expect(calls).toBe(1);
    unsub();
    setLocale('zh');
    expect(calls).toBe(1); // listener removed, not called again
  });

  test('multiple subscribers all fire on a change', () => {
    setLocale('zh');
    let a = 0;
    let b = 0;
    const unsubA = subscribeLocale(() => {
      a += 1;
    });
    const unsubB = subscribeLocale(() => {
      b += 1;
    });
    setLocale('en');
    expect(a).toBe(1);
    expect(b).toBe(1);
    unsubA();
    unsubB();
  });
});
