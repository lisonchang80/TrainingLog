import {
  clamp,
  computeCoachScrollOffset,
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

  it('centres (top ~ 0.4h) when hole is present but placement is "center"', () => {
    // A stray 'center' placement with a non-null hole still centres — the hole
    // is only consulted for 'above'/'below'.
    expect(resolveCoachBubbleAnchor({ y: 300, h: 80 }, 'center', SCREEN)).toEqual({
      top: Math.round(SCREEN.height * 0.4),
    });
  });

  it('a "below" target with just enough room is NOT overlaid (boundary, top kept)', () => {
    // Pick a hole so naive top + minBubbleH lands EXACTLY at the bottom-safe
    // boundary (top + 150 == 844 - 56 = 788 → top == 638). 638 is NOT > 788, so
    // the boundary keeps the natural anchor (not overlaid).
    // top = y + h + gap = 600 + 26 + 12 = 638.
    const a = resolveCoachBubbleAnchor({ y: 600, h: 26 }, 'below', SCREEN, {
      gap: 12,
      safeBottom: 56,
      minBubbleH: 150,
    });
    expect(a).toEqual({ top: 638 });
  });

  it('a "below" target one px past the boundary IS overlaid to the top-safe band', () => {
    // top = 601 + 26 + 12 = 639; 639 + 150 = 789 > 788 → overlay to safeTop.
    const a = resolveCoachBubbleAnchor({ y: 601, h: 26 }, 'below', SCREEN, {
      gap: 12,
      safeTop: 56,
      safeBottom: 56,
      minBubbleH: 150,
    });
    expect(a).toEqual({ top: 56 });
  });

  it('an "above" target hugging the very top edge (y=0) overlays to the bottom-safe band', () => {
    // bottom = 844 - (0 - 12) = 856; 856 + 150 ≫ 844 - 56 → overlay bottom.
    const a = resolveCoachBubbleAnchor({ y: 0, h: 40 }, 'above', SCREEN, {
      gap: 12,
      safeTop: 56,
      safeBottom: 56,
    });
    expect(a).toEqual({ bottom: 56 });
  });

  it('honours custom gap in the natural-anchor maths', () => {
    // below: top = y + h + gap = 100 + 40 + 30 = 170 (room exists → unchanged).
    const a = resolveCoachBubbleAnchor({ y: 100, h: 40 }, 'below', SCREEN, {
      gap: 30,
    });
    expect(a).toEqual({ top: 170 });
  });
});

describe('pickCoachPlacement — extra edges', () => {
  it('treats a negative-area (negative height) rect as no target', () => {
    const bad: Rect = { x: 10, y: 10, width: 50, height: -5 };
    expect(pickCoachPlacement(bad, SCREEN).placement).toBe('center');
  });

  it('places BELOW a target whose centre sits one px above the midline', () => {
    // centreY = 421 < 422 → below.
    const r: Rect = { x: 100, y: 401, width: 50, height: 40 };
    expect(pickCoachPlacement(r, SCREEN).placement).toBe('below');
  });

  it('respects a custom edgeInset when clamping the arrow', () => {
    const farLeft: Rect = { x: 0, y: 100, width: 10, height: 10 };
    // centre 5, custom inset 40 → clamped to 40.
    expect(pickCoachPlacement(farLeft, SCREEN, 40).arrowCenterX).toBe(40);
  });
});

describe('computeCoachScrollOffset', () => {
  const SCREEN_H = 844;
  // defaults: topSafe 96, bottomSafe 170, desiredRatio 0.26 → desiredTop ≈ 219.44

  it('returns null when the target is already comfortably in view', () => {
    // top 300 >= 96 AND bottom 380 <= 844 - 170 = 674 → no scroll.
    expect(
      computeCoachScrollOffset({ y: 300, height: 80 }, 0, SCREEN_H),
    ).toBeNull();
  });

  it('scrolls down to park a below-the-fold target ~26% down the screen', () => {
    // target at y=700 (below the 674 bottom-safe line) → scroll.
    // next = max(0, currentOffset + (700 - 844*0.26)) = 0 + (700 - 219.44) = 480.56
    const next = computeCoachScrollOffset({ y: 700, height: 40 }, 0, SCREEN_H);
    expect(next).toBeCloseTo(700 - SCREEN_H * 0.26, 5);
    expect(next).toBeGreaterThan(0);
  });

  it('adds the current content offset to the absolute target position', () => {
    // The math is offset-relative: same rect, +1000 current offset → +1000 result.
    const a = computeCoachScrollOffset({ y: 700, height: 40 }, 0, SCREEN_H)!;
    const b = computeCoachScrollOffset({ y: 700, height: 40 }, 1000, SCREEN_H)!;
    expect(b - a).toBe(1000);
  });

  it('clamps the result at 0 — never scrolls into negative offset', () => {
    // A target above the top-safe band (y=20 < 96) → triggers scroll; but
    // currentOffset 0 + (20 - 219.44) is negative → clamped to 0.
    expect(
      computeCoachScrollOffset({ y: 20, height: 30 }, 0, SCREEN_H),
    ).toBe(0);
  });

  it('scrolls when the target top is under the header band even if its bottom fits', () => {
    // top 50 < 96 → not "already visible" → scroll (the top-safe guard fires).
    const next = computeCoachScrollOffset({ y: 50, height: 30 }, 500, SCREEN_H);
    // next = max(0, 500 + (50 - 219.44)) = 330.56
    expect(next).toBeCloseTo(500 + (50 - SCREEN_H * 0.26), 5);
  });

  it('boundary: target exactly at topSafe and exactly at the bottom-safe line is in view', () => {
    // top == 96 (>= 96 ok) AND bottom == 674 (<= 674 ok) → null.
    expect(
      computeCoachScrollOffset({ y: 96, height: 578 }, 0, SCREEN_H),
    ).toBeNull();
  });

  it('honours custom safe bands and desiredRatio', () => {
    // With topSafe 200, a target at y=150 now counts as above the band → scroll.
    // desiredRatio 0.5 → desiredTop = 422; next = 0 + (150 - 422) → clamped 0.
    const next = computeCoachScrollOffset({ y: 150, height: 40 }, 0, SCREEN_H, {
      topSafe: 200,
      bottomSafe: 100,
      desiredRatio: 0.5,
    });
    expect(next).toBe(0);
  });
});
