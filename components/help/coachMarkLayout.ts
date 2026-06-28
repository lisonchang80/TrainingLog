/**
 * Pure layout maths for the CoachMarkOverlay caption bubble.
 *
 * Split out of the component (per the `extract-pure-logic` /
 * `rn-component-behavior-split` conventions) so the placement decision is
 * unit-testable without rendering. The component owns the absolute-position
 * styling; this module only decides *where* the bubble goes relative to the
 * highlighted target.
 */

import type { Rect, Screen } from './types';

/** Clamp `v` into the inclusive `[min, max]` range. */
export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export interface CoachPlacement {
  /**
   * 'below'  → bubble sits under the target, arrow points UP at it.
   * 'above'  → bubble sits over the target, arrow points DOWN at it.
   * 'center' → no usable target rect; bubble is screen-centred, no arrow.
   */
  placement: 'above' | 'below' | 'center';
  /**
   * X of the arrow's centre, in screen coordinates. Clamped away from the
   * very edges so the arrow never renders off-screen. Meaningless when
   * placement is 'center' (caller hides the arrow).
   */
  arrowCenterX: number;
}

/**
 * Decide whether the caption bubble goes above or below the highlighted
 * target, and where the arrow should point horizontally.
 *
 * Rule: if the target's vertical centre is in the top half of the screen,
 * put the bubble BELOW it (more room downward); otherwise ABOVE. This keeps
 * the bubble on-screen for targets near either edge without measuring the
 * bubble's own (dynamic) height.
 *
 * @param target  measured target rect, or null when the element isn't mounted
 * @param screen  window dimensions
 * @param edgeInset  min px the arrow stays from the left/right screen edge
 */
export function pickCoachPlacement(
  target: Rect | null,
  screen: Screen,
  edgeInset = 24,
): CoachPlacement {
  if (!target || target.width <= 0 || target.height <= 0) {
    return { placement: 'center', arrowCenterX: screen.width / 2 };
  }
  const targetCenterY = target.y + target.height / 2;
  const placement = targetCenterY < screen.height / 2 ? 'below' : 'above';
  const arrowCenterX = clamp(
    target.x + target.width / 2,
    edgeInset,
    screen.width - edgeInset,
  );
  return { placement, arrowCenterX };
}
