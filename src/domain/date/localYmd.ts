/**
 * Canonical local-timezone `YYYY-MM-DD` formatter (big-file health #8 dedup,
 * 2026-06-02). Several screens + helpers had byte-identical inline copies of
 * this `getFullYear()`-`getMonth()+1`-`getDate()` + zero-pad logic; this is the
 * single source of truth they now delegate to.
 *
 * LOCAL timezone on purpose — the app keys sessions/PRs by the user's wall-clock
 * day (a 23:30 session belongs to that calendar day, not the UTC next-day). Do
 * NOT swap for `toISOString().slice(0,10)` — that is UTC and would bucket
 * late-evening sessions into the wrong day.
 *
 * Divergent formatters are intentionally NOT folded in here:
 *   - `YYYY/MM/DD` slash form (stats-panel anchor label)
 *   - `YYYY-MM-DD  HH:MM` datetime form (session-time-editor)
 *   - `formatISO(y, m, d)` numeric-args form (calendar/monthGrid)
 */

/** Format a `Date` as a local-timezone `YYYY-MM-DD` string. */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a unix-ms timestamp as a local-timezone `YYYY-MM-DD` string. */
export function formatLocalYmdFromMs(ms: number): string {
  return formatLocalYmd(new Date(ms));
}
