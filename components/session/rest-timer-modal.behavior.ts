/**
 * Pure-logic helpers for RestTimerModal finish-edge side effects (Slice 13a C7).
 *
 * The modal's existing finish edge fires expo-haptics Success notification
 * AND auto-dismisses after 400ms. Slice 13a C7 adds a 0.3s sine 440Hz beep
 * (`assets/sounds/rest-timer-done.wav`) via expo-audio next to that haptic.
 *
 * This module exposes the one-shot transition predicate so the dispatch
 * decision is testable under `testEnvironment: node` (no RN renderer +
 * no expo-audio mock plumbing). Same split pattern as
 * session-title-editor.behavior.ts (F2/F4) and hr-zone-chart.behavior.ts.
 *
 * See ADR-0019 § Slice 13 Phase A Amendment Q2.3 (c) F1 — 短音 deferred
 * from slice 10d, landed in 13a.
 */

export type RestTimerStatus = 'idle' | 'running' | 'finished';

/**
 * Return true on exactly the transition into 'finished' AND only the first
 * time per cycle. Callers maintain a `fired` ref that flips to true after
 * dispatch; this predicate then returns false until the ref resets (cancel
 * / re-trigger).
 *
 * Behavior contract:
 *   - finished + !fired → TRUE (do play)
 *   - finished + fired → FALSE (already played; idempotent)
 *   - running / idle (any fired) → FALSE
 */
export function shouldFireFinishEdge(
  status: RestTimerStatus,
  alreadyFired: boolean,
): boolean {
  return status === 'finished' && !alreadyFired;
}
