/**
 * 🟠-B (overnight 2026-07-07) — `decideFreestyleStart` pure predicate tests.
 *
 * The freestyle (空白訓練) start path was the only live-start with no
 * active-session guard (the template + Watch paths both re-query
 * `getActiveSession` and refuse). This predicate is the pure decision half:
 * given whether a live session already exists, proceed vs adopt-existing.
 *
 * The predicate is pure — no DB or WC bridge needed. The companion integration
 * test (`freestyleStartGuardIntegration.test.ts`) proves the wired behaviour
 * against a real in-memory DB (no duplicate live session created).
 */

import { decideFreestyleStart } from '../../src/services/startSessionGuard';

describe('🟠-B — decideFreestyleStart', () => {
  it('no active session → create (normal freestyle start)', () => {
    expect(decideFreestyleStart({ hasActiveSession: false })).toEqual({
      action: 'create',
    });
  });

  it('active session already exists → adopt-existing (never duplicate)', () => {
    // The concurrency-window case: a Watch-led session landed in the DB while
    // the Training tab was still `idle`, so the 空白訓練 button was still on
    // screen. Re-querying finds it → must NOT create a second live session.
    expect(decideFreestyleStart({ hasActiveSession: true })).toEqual({
      action: 'adopt-existing',
    });
  });
});
