import {
  clamp,
  pickCoachPlacement,
  resolveCoachBubbleAnchor,
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

describe('resolveCoachBubbleAnchor', () => {
  it('centres (top ~ 0.4h) when there is no target hole', () => {
    expect(resolveCoachBubbleAnchor(null, 'center', SCREEN)).toEqual({
      top: Math.round(SCREEN.height * 0.4),
    });
  });

  it('anchors just BELOW a short top target (room exists → unchanged maths)', () => {
    // hole at y=80 h=44 → top = 80 + 44 + 12 = 136
    const a = resolveCoachBubbleAnchor({ y: 80, h: 44 }, 'below', SCREEN, {
      gap: 12,
    });
    expect(a).toEqual({ top: 136 });
  });

  it('anchors just ABOVE a short bottom target (room exists → unchanged maths)', () => {
    // hole at y=700 h=40 → bottom = 844 - (700 - 12) = 156
    const a = resolveCoachBubbleAnchor({ y: 700, h: 40 }, 'above', SCREEN, {
      gap: 12,
    });
    expect(a).toEqual({ bottom: 156 });
  });

  it('OVERLAYS to the bottom-safe band when an "above" target hugs the top (the sidebar regression)', () => {
    // Full-height left sidebar: starts ~y=88, spans almost the whole screen.
    // Naive bottom = 844 - (88 - 12) = 768 → bubble top crosses the status bar.
    const anchor = resolveCoachBubbleAnchor({ y: 88, h: 660 }, 'above', SCREEN, {
      gap: 12,
      safeBottom: 56,
    });
    expect(anchor).toEqual({ bottom: 56 });
  });

  it('OVERLAYS to the top-safe band when a "below" target reaches the bottom', () => {
    // Tall target whose bottom is near the screen floor: naive top would push
    // the bubble off the bottom edge.
    const anchor = resolveCoachBubbleAnchor({ y: 120, h: 680 }, 'below', SCREEN, {
      gap: 12,
      safeTop: 56,
    });
    expect(anchor).toEqual({ top: 56 });
  });

  it('never returns both top and bottom', () => {
    for (const placement of ['above', 'below', 'center'] as const) {
      const a = resolveCoachBubbleAnchor({ y: 200, h: 100 }, placement, SCREEN);
      expect(a.top != null && a.bottom != null).toBe(false);
    }
  });
});
