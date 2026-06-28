import {
  clamp,
  pickCoachPlacement,
} from '../../components/help/coachMarkLayout';
import type { Rect, Screen } from '../../components/help/types';

const SCREEN: Screen = { width: 390, height: 844 };

describe('clamp', () => {
  it('returns the value when inside range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
  it('clamps to min and max', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe('pickCoachPlacement', () => {
  it('falls back to centre when target is null', () => {
    const p = pickCoachPlacement(null, SCREEN);
    expect(p.placement).toBe('center');
    expect(p.arrowCenterX).toBe(SCREEN.width / 2);
  });

  it('falls back to centre for a zero-area rect', () => {
    const zero: Rect = { x: 10, y: 10, width: 0, height: 0 };
    expect(pickCoachPlacement(zero, SCREEN).placement).toBe('center');
  });

  it('places the bubble BELOW a target in the top half', () => {
    const top: Rect = { x: 20, y: 80, width: 100, height: 40 };
    const p = pickCoachPlacement(top, SCREEN);
    expect(p.placement).toBe('below');
    // arrow centred under the target: 20 + 100/2 = 70
    expect(p.arrowCenterX).toBe(70);
  });

  it('places the bubble ABOVE a target in the bottom half', () => {
    const bottom: Rect = { x: 200, y: 700, width: 80, height: 40 };
    const p = pickCoachPlacement(bottom, SCREEN);
    expect(p.placement).toBe('above');
    expect(p.arrowCenterX).toBe(240);
  });

  it('clamps the arrow away from the left edge', () => {
    const farLeft: Rect = { x: 0, y: 100, width: 10, height: 10 };
    // centre would be 5, but edgeInset defaults to 24
    expect(pickCoachPlacement(farLeft, SCREEN).arrowCenterX).toBe(24);
  });

  it('clamps the arrow away from the right edge', () => {
    const farRight: Rect = { x: 380, y: 100, width: 10, height: 10 };
    // centre would be 385, clamped to 390 - 24 = 366
    expect(pickCoachPlacement(farRight, SCREEN).arrowCenterX).toBe(366);
  });

  it('uses the exact vertical midpoint boundary as "above"', () => {
    // centre Y exactly at screen.height/2 (422) is NOT < 422 → above
    const mid: Rect = { x: 100, y: 402, width: 50, height: 40 };
    expect(pickCoachPlacement(mid, SCREEN).placement).toBe('above');
  });
});
