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

/** Vertical anchor for the caption bubble — exactly one of `top` / `bottom`. */
export interface CoachBubbleAnchor {
  /** px from the top edge (mutually exclusive with `bottom`). */
  top?: number;
  /** px from the bottom edge (mutually exclusive with `top`). */
  bottom?: number;
}

/**
 * Resolve the caption bubble's vertical anchor so it stays fully on-screen even
 * when the spotlight target is very tall or hugs a screen edge.
 *
 * Normal case (small control, room on the chosen side): anchor the bubble just
 * past the spotlight — `below` → `top`, `above` → `bottom` — identical to the
 * previous inline maths.
 *
 * Edge case (the library left-sidebar regression, 2026-06-29): a full-height
 * target — or one starting right under the status bar — leaves no room on the
 * chosen side, so the naive anchor pushes the bubble off-screen (its top
 * crossed the status bar). When that happens we OVERLAY the bubble, pinning it
 * to the OPPOSITE safe band so it never overflows.
 *
 * The bubble height is dynamic and never measured; `minBubbleH` is a
 * conservative estimate used only to detect "no room on this side". The check
 * is insensitive to its exact value — real overflow cases miss by hundreds of
 * px — so a normal target is never falsely overlaid.
 *
 * @param hole       padded spotlight rect (y/height in window coords), or null
 * @param placement  the side `pickCoachPlacement` chose
 * @param screen     window dimensions
 */
export function resolveCoachBubbleAnchor(
  hole: { y: number; h: number } | null,
  placement: CoachPlacement['placement'],
  screen: Screen,
  opts: {
    gap?: number;
    safeTop?: number;
    safeBottom?: number;
    minBubbleH?: number;
  } = {},
): CoachBubbleAnchor {
  const gap = opts.gap ?? 12;
  const safeTop = opts.safeTop ?? 56;
  const safeBottom = opts.safeBottom ?? 56;
  const minBubbleH = opts.minBubbleH ?? 150;

  if (!hole || placement === 'center') {
    return { top: Math.round(screen.height * 0.4) };
  }

  if (placement === 'below') {
    const top = hole.y + hole.h + gap;
    // No room below the spotlight → overlay near the top-safe band.
    if (top + minBubbleH > screen.height - safeBottom) return { top: safeTop };
    return { top };
  }

  // 'above'
  const bottom = screen.height - (hole.y - gap);
  // No room above the spotlight → overlay near the bottom-safe band.
  if (bottom + minBubbleH > screen.height - safeTop) return { bottom: safeBottom };
  return { bottom };
}
