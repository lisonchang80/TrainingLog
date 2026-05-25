/**
 * Slice 10c overnight #16 — A↔B cluster switcher pure-logic helpers.
 *
 * Cluster history pages render two sides (A = current exercise, B = its
 * paired cluster partner) inside a horizontal paging ScrollView. The
 * switcher arrows on each side need to know which one to dim (the one
 * pointing at the boundary the user is already at).
 *
 * This module is pure / no DOM so it can be unit-tested in jest's node
 * env; the wiring (scrollTo / setParams) stays in the .tsx.
 */

export type ClusterSide = 'A' | 'B';

/**
 * Parse the URL `side` param into a strict ClusterSide. Anything that
 * isn't literal 'B' falls back to 'A' so a missing/garbled param won't
 * dim the wrong arrow.
 */
export function parseSide(raw: string | undefined | null): ClusterSide {
  return raw === 'B' ? 'B' : 'A';
}

/**
 * Which side is on the left of the paging viewport. A is always left,
 * B is always right. Kept as a function so callers don't hardcode the
 * mapping in multiple places.
 */
export function sideToPageIndex(side: ClusterSide): 0 | 1 {
  return side === 'A' ? 0 : 1;
}

export function pageIndexToSide(idx: number): ClusterSide {
  return idx >= 1 ? 'B' : 'A';
}

/**
 * The boundary arrow that should be dimmed/disabled on the given side.
 * On A the left arrow ‹ goes nowhere (already at leftmost page); on B
 * the right arrow › is at the rightmost page.
 */
export function switcherArrowDisabled(
  currentSide: ClusterSide,
  arrow: 'left' | 'right'
): boolean {
  if (arrow === 'left') return currentSide === 'A';
  return currentSide === 'B';
}
