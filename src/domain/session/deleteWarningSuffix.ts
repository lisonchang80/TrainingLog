/**
 * Delete-confirmation warning suffix (big-file health #8 dedup, 2026-06-02).
 *
 * The 🗑️ 刪除動作 confirm Alert appends a suffix describing how many sets will
 * be lost — "(N 組，其中 M 組已完成)" / "(N 組未完成)" / "" — and this exact
 * count-then-branch logic was duplicated 4× (Today + session-detail, each with a
 * cluster path and a solo path). The two paths differ ONLY in which i18n message
 * pair they format with, so the messages are injected as deps and this stays a
 * pure, locale-agnostic decision function.
 *
 * Branch rule (verbatim from the original inline copies):
 *   - any logged set  → `withLogged(total, logged)`
 *   - else any set    → `unfinished(total)`
 *   - else            → '' (no sets, no warning)
 */

/** Minimal shape the suffix reads off each set row — the `is_logged` 0/1 flag. */
export interface DeleteWarningSet {
  is_logged: number;
}

/** The locale-bound message pair the caller formats the counts with. */
export interface DeleteWarningMessages {
  /** Some sets already logged: e.g. tWarningTotalSetsWithLogged(total, logged). */
  withLogged: (total: number, logged: number) => string;
  /** Sets exist but none logged: e.g. tWarningTotalSetsUnfinished(total). */
  unfinished: (total: number) => string;
}

/**
 * Compute the delete-confirmation suffix for a set list. `total` = sets.length,
 * `logged` = count of `is_logged === 1`. Empty list → ''.
 */
export function computeDeleteWarningSuffix(
  sets: ReadonlyArray<DeleteWarningSet>,
  msg: DeleteWarningMessages,
): string {
  const total = sets.length;
  const logged = sets.filter((s) => s.is_logged === 1).length;
  if (logged > 0) return msg.withLogged(total, logged);
  if (total > 0) return msg.unfinished(total);
  return '';
}
