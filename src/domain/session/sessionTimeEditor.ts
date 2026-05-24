/**
 * Pure validation + duration computation for the session time editor sheet
 * (overnight #60). The UI sheet is in `components/session/session-time-editor-sheet.tsx`;
 * this module holds the testable logic so the sheet stays a thin presentational
 * shell.
 *
 * Validation rule (kept intentionally minimal for the bottom-sheet UX):
 *   - end > start → valid; expose `duration_sec` (floored sub-second)
 *   - end <= start → invalid with reason 'NON_POSITIVE'
 *
 * We do NOT enforce upper bounds (far-future / pre-epoch) — picker UI already
 * clamps via `maximumDate` / `minimumDate` props at the call site, and the
 * detail-page write path is a sibling concern (sheet only emits via onSave).
 */

type TimeEditValidation =
  | { valid: true; duration_sec: number }
  | { valid: false; reason: 'NON_POSITIVE' };

/**
 * Validate started_at / ended_at pair (epoch ms). Returns:
 *   - `{ valid: true, duration_sec }` when end > start; duration is floor of
 *     (end - start) / 1000 so sub-second drift never bleeds into the UI label.
 *   - `{ valid: false, reason: 'NON_POSITIVE' }` when end <= start. This single
 *     reason covers both "negative" and "zero" duration — the sheet renders
 *     the same warning either way, and downstream callers don't need to
 *     distinguish.
 */
export function validateSessionTimes(
  start_ms: number,
  end_ms: number,
): TimeEditValidation {
  if (end_ms <= start_ms) {
    return { valid: false, reason: 'NON_POSITIVE' };
  }
  return {
    valid: true,
    duration_sec: Math.floor((end_ms - start_ms) / 1000),
  };
}
