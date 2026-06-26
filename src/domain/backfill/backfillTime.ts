/**
 * 補訓練 (backfill) timestamp helpers — pure, so the noon-anchoring rule is
 * unit-testable without touching the DB or UI (grill 2026-06-26).
 *
 * Decision (2026-06-26 grill, 時間方案 2): a backfilled session defaults to
 * **noon (12:00) local** on the chosen day with a 1-hour nominal window. The
 * user adjusts the exact start/end afterward via the session detail page's
 * existing 「訓練時間」 tap-to-edit (SessionTimeEditorSheet) — so we don't add
 * a bespoke time picker to the create flow.
 *
 * All construction uses the local-timezone `new Date(y, m, d, h, …)` form
 * (NOT epoch arithmetic) so noon means noon in the user's zone, mirroring
 * MonthGridView's local-date bucketing.
 */

/** Default start-of-day hour for a backfilled session: noon. */
export const BACKFILL_DEFAULT_HOUR = 12;

/** Nominal duration so the default window reads e.g. 12:00–13:00, not 0 min. */
export const BACKFILL_DEFAULT_DURATION_MS = 60 * 60 * 1000;

export interface BackfillTimestamps {
  /** Local noon of the target day, in epoch ms. */
  started_at: number;
  /** started_at + the nominal duration, in epoch ms. */
  ended_at: number;
}

/**
 * Build the default { started_at, ended_at } for a calendar day.
 *
 * @param year  full year, e.g. 2026
 * @param month 1-12 (NOT 0-indexed — callers pass human month numbers)
 * @param day   1-31
 */
export function backfillTimestamps(
  year: number,
  month: number,
  day: number,
): BackfillTimestamps {
  const started_at = new Date(
    year,
    month - 1,
    day,
    BACKFILL_DEFAULT_HOUR,
    0,
    0,
    0,
  ).getTime();
  return { started_at, ended_at: started_at + BACKFILL_DEFAULT_DURATION_MS };
}

/**
 * Parse a local `YYYY-MM-DD` string (the calendar cell's `date`) into the
 * default backfill window. Throws on a malformed string so a bad caller fails
 * loudly rather than silently anchoring to epoch 0.
 */
export function backfillTimestampsFromISO(iso: string): BackfillTimestamps {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`backfillTimestampsFromISO: bad date "${iso}"`);
  return backfillTimestamps(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Anchor the backfill window to the LOCAL day of an existing epoch timestamp
 * (used by the session detail page's 補訓練 button — 「補同一天的第二筆」). The
 * source session's exact time is discarded; only its local calendar day is
 * kept, then re-anchored to noon.
 */
export function backfillTimestampsFromEpoch(epochMs: number): BackfillTimestamps {
  const d = new Date(epochMs);
  return backfillTimestamps(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
