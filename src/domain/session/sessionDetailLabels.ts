/**
 * Session detail page label helpers (ADR-0019 Q10 Round F polish).
 *
 * Two pure helpers extracted so the session detail page's user-visible
 * text can be unit-tested in the node env:
 *
 *   1. `computeDefaultTemplateName(input)` — Round F Q3 拍板 fallback chain
 *      for the "儲存模板 / 另存模板" prompt's default name. Tries in order:
 *        a. session.title      — explicit user-named session (planned schema
 *           addition; pass `null` when the session table doesn't have a title
 *           column yet, see「Schema note」below).
 *        b. linkedTemplateName — the name of the template most of the
 *           session_exercise rows are linked to (from convertSessionToTemplate's
 *           "linked template" definition; pass `null` for freestyle sessions).
 *        c. dateLabel          — `formatDateLabel(session.started_at)`
 *           fallback (already used everywhere else; never null).
 *
 *   2. `computeDeleteConfirmMessage(input)` — Round F Q4 拍板 dialog text.
 *      Was previously a generic「已記錄的 set 將全部刪除，無法復原。」 — now
 *      includes the session's display name so the user knows *which* session
 *      they're about to delete (matters most when the user already navigated
 *      from history → detail and back several times).
 *
 * Schema note (2026-05-24): the `session` table does not currently carry a
 * `title` column (per src/db/schema/v001_initial.ts; v016 added kcal /
 * avg_hr_bpm but no title). Round F's wording「session.title」refers to a
 * planned future addition — until then callers pass `sessionTitle: null` and
 * the chain naturally falls through to linkedTemplateName / dateLabel.
 * Once the column lands, only the call sites change.
 */

export interface DefaultTemplateNameInput {
  /** Optional explicit user-set session title; null when none. */
  sessionTitle?: string | null;
  /** Optional name of the template the session is linked to; null when freestyle. */
  linkedTemplateName?: string | null;
  /** Always-present date fallback, e.g. "2026-05-24". */
  dateLabel: string;
}

export function computeDefaultTemplateName(input: DefaultTemplateNameInput): string {
  const t = trimOrNull(input.sessionTitle);
  if (t != null) return t;
  const l = trimOrNull(input.linkedTemplateName);
  if (l != null) return l;
  return input.dateLabel;
}

export interface DeleteConfirmInput {
  /**
   * The session's display name (whatever the header is showing — title
   * or dateLabel). Caller passes this in; helper just embeds it in the
   * confirm copy so the dialog reads naturally.
   */
  sessionDisplayName: string;
}

export function computeDeleteConfirmMessage(input: DeleteConfirmInput): string {
  return `確定刪除『${input.sessionDisplayName}』？這個 session 將永久刪除。`;
}

function trimOrNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/**
 * Round F Q5 — should the header show the small `[編]` chip?
 * Tiny helper, but extracted so the rendering rule is unit-testable
 * (and stays the single source of truth if more conditions get added —
 * e.g. dirty / has-pending-write — later).
 */
export function shouldShowEditChip(editMode: boolean): boolean {
  return editMode === true;
}
