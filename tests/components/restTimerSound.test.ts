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
