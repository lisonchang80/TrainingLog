/**
 * Slice 13a C7 — rest timer finish-edge sound dispatch + asset sanity.
 *
 * Two slices of coverage:
 *   1. Pure dispatch predicate (`shouldFireFinishEdge`) — one-shot guard
 *      for the haptic + beep side effect. The JSX component is unreachable
 *      under `testEnvironment: node`, so the decision logic lives in
 *      `rest-timer-modal.behavior.ts` and is tested here.
 *   2. Asset sanity — the wav file exists at the canonical path and is
 *      under 50 KB (per ADR-0019 § Phase A Amendment risk: keep bundle
 *      footprint negligible while the audio piece is still a placeholder).
 *
 * Phase A bundle: 0.3s sine 440Hz with 5ms attack/decay, mono 16-bit
 * 44.1 kHz → ~26 KB (well under the 50 KB ceiling).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { shouldFireFinishEdge } from '../../components/session/rest-timer-modal.behavior';

describe('shouldFireFinishEdge', () => {
  it('fires on the first finished tick (not yet fired)', () => {
    expect(shouldFireFinishEdge('finished', false)).toBe(true);
  });

  it('does not fire a second time once already fired (one-shot)', () => {
    expect(shouldFireFinishEdge('finished', true)).toBe(false);
  });

  it('does not fire while running', () => {
    expect(shouldFireFinishEdge('running', false)).toBe(false);
  });

  it('does not fire while idle', () => {
    expect(shouldFireFinishEdge('idle', false)).toBe(false);
  });
});

/**
 * Bug F7 regression contract (slice 13a manual smoke 2026-05-25).
 *
 * Symptom: 第二組打 ✓ 後 modal 一打開就立即 fire haptic + 短音，沒有 60s 倒數。
 *
 * Root cause: `RestTimerModal` 的 finish-edge `useEffect` 原本 deps 帶了
 * `[state.status, onSkip, finishPlayer]`。父層（Today / detail page）都用
 * inline closure 傳 `onSkip={() => setRestTimerTarget(null)}`，每次
 * re-render 都是新 ref → effect 每 render 都會 re-run。第二組 ✓ 觸發時：
 *
 *   1. `[triggerKey]` effect：firedHapticRef = false 重設 + setState(running) queue
 *   2. `[visible]` effect：同樣 reset
 *   3. finish-edge effect 跑（onSkip ref 變了）：state.status 仍是 stale
 *      'finished'、firedHapticRef 剛重設成 false →
 *      shouldFireFinishEdge('finished', false) → TRUE → 立即 fire
 *
 * Fix: 把 onSkip + finishPlayer 從 effect deps 拿掉，用 ref pattern 取最新值。
 * effect 只跟 state.status 變化。
 *
 * **Predicate alone cannot catch this** — `shouldFireFinishEdge('finished',
 * false)` IS correctly `true` by design (first-tick contract). The bug lives
 * in WHEN the modal consults the predicate. The tests below document the
 * orchestration contract this fix relies on; the actual integration coverage
 * lives in the manual smoke matrix (`/tmp/slice13a-impl-plan.md` S7).
 */
describe('F7 regression — predicate call contract on second cycle', () => {
  it('cycle 1: running → finished fires once, then one-shot prevents re-fire', () => {
    expect(shouldFireFinishEdge('running', false)).toBe(false); // ticking
    expect(shouldFireFinishEdge('finished', false)).toBe(true); // first-tick fire
    expect(shouldFireFinishEdge('finished', true)).toBe(false); // one-shot guard
  });

  it('cycle 2: re-trigger MUST first transition status back to running before resetting firedFlag', () => {
    // The correct orchestration: triggerKey-change effect resets firedFlag AND
    // queues setState(running). Modal MUST NOT consult the predicate again
    // until the next render where state.status = 'running'.
    expect(shouldFireFinishEdge('running', false)).toBe(false); // ✓ ticking again
    expect(shouldFireFinishEdge('finished', false)).toBe(true); // ✓ fires after 60s
  });

  it('would-fire-prematurely shape (DO NOT let this be reachable in the modal)', () => {
    // If the finish-edge effect re-runs while state.status is stale-'finished'
    // and firedFlag was JUST reset to false (e.g. because an inline-closure
    // prop ref changed and was in the dep list), the predicate returns true
    // and the modal fires immediately. This is the F7 bug shape.
    //
    // The modal must prevent this by NOT including unstable refs (inline
    // closures, useAudioPlayer return value) in the finish-edge effect's deps.
    expect(shouldFireFinishEdge('finished', false)).toBe(true);
  });
});

describe('rest-timer-done.wav asset', () => {
  const wavPath = resolve(__dirname, '../../assets/sounds/rest-timer-done.wav');

  it('exists at the canonical path', () => {
    expect(existsSync(wavPath)).toBe(true);
  });

  it('is under 50 KB (bundle footprint guard, ADR-0019 § Phase A risks)', () => {
    const sizeKB = statSync(wavPath).size / 1024;
    expect(sizeKB).toBeLessThan(50);
  });
});
