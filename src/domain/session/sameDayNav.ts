/**
 * Same-day session navigation — ADR-0015 § Tap 日格行為.
 *
 * Pure helper for the session detail page header `← N/M →` switcher.
 * The history calendar emits a comma-separated list of session ids that share
 * the same date via the `?sameDayIds=` query param; the detail page parses it
 * and uses {@link buildSameDayNavState} to render the ← N/M → indicator and
 * route to siblings via {@link siblingId}.
 *
 * Scope is **same day only** by spec — the switcher never crosses day
 * boundaries. The detail page never recomputes the list itself; the source of
 * truth is whatever the history tab embedded in the query param.
 *
 * Edge case: if `currentId` is not in `ids` (e.g. user opened the detail page
 * directly from a non-history entry point, sameDayIds query param absent or
 * mismatched), the state degrades to a single-session view. Callers should
 * hide the switcher when `total === 1`.
 */

type SameDayNavState = {
  /** Session ids sharing the same date as `currentId`. */
  ids: readonly string[];
  /** `currentId`'s index within `ids`. */
  currentIndex: number;
  /** Convenience accessor for `ids.length`. */
  total: number;
};

/**
 * Parse comma-separated session ids from the `?sameDayIds=` query param.
 *
 * - Empty / undefined input → `[]`.
 * - Whitespace trimmed around each segment; empty segments filtered.
 */
export function parseSameDayIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build navigation state from `currentId` + same-day ids list.
 *
 * If `currentId` is not in `ids` (degenerate input), returns a single-session
 * state `{ ids: [currentId], currentIndex: 0, total: 1 }` so the detail page
 * still renders correctly. Callers should hide the switcher when `total === 1`.
 */
export function buildSameDayNavState(args: {
  currentId: string;
  ids: readonly string[];
}): SameDayNavState {
  const { currentId, ids } = args;
  const idx = ids.indexOf(currentId);
  if (idx === -1) {
    return { ids: [currentId], currentIndex: 0, total: 1 };
  }
  return { ids, currentIndex: idx, total: ids.length };
}

/**
 * Returns the prev/next id in the same-day list, or `null` at boundary.
 *
 * - First id has no prev → `null`.
 * - Last id has no next → `null`.
 * - `total === 1` → both directions `null` (switcher should be hidden anyway).
 */
export function siblingId(
  state: SameDayNavState,
  direction: 'prev' | 'next',
): string | null {
  if (state.total <= 1) return null;
  const target =
    direction === 'prev' ? state.currentIndex - 1 : state.currentIndex + 1;
  if (target < 0 || target >= state.total) return null;
  return state.ids[target] ?? null;
}
