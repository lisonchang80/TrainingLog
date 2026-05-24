import type { Database } from '../types';

/**
 * v023 — session.title column (ADR-0014 + Card 11).
 *
 * Background
 * ----------
 * ADR-0014 planned `session.title` from the start but it never landed. The
 * History tab's MonthGridView already references it (comment at
 * `src/components/history/MonthGridView.tsx:118`), and the in-session header
 * on the 訓練 tab is currently hardcoded to `t('tabs', 'training')` (changed
 * from `'Today'` in 973c50a). Card 11 introduces tap-to-edit on that header,
 * which requires the column to exist + be backfilled.
 *
 * Backfill
 * --------
 * Existing sessions get title = linked template's name (resolved via the
 * most-common-prefix shortcut: look up `template.name` keyed by
 * `session.template_id` — but `session` itself has no `template_id` column;
 * the linkage is via `session_exercise.template_id`. We resolve the
 * template id per session through the first matching `session_exercise` row
 * and fall back to '' (freestyle) when no row carries a non-null template_id.
 *
 * Idempotency
 * -----------
 * The ALTER TABLE is guarded by `PRAGMA table_info(session)` so re-runs
 * skip the column creation. The backfill UPDATE is intentionally NOT gated
 * — it's idempotent on its own (the `WHERE title = ''` clause leaves any
 * user-set title untouched), and running it always means a partial DB
 * (column added by a prior interrupted run but backfill skipped) can still
 * heal on the next launch.
 *
 * Future writes
 * -------------
 *   - `createSession` defaults to '' (freestyle path).
 *   - `startSessionFromTemplate` populates with `template.name` at insert
 *     time (handled in the adapter).
 *   - In-session tap-to-edit goes through `updateSessionTitle`.
 */
export async function v023_session_title(db: Database): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(session)`
  );
  if (!cols.some((c) => c.name === 'title')) {
    await db.execAsync(`
      ALTER TABLE session ADD COLUMN title TEXT NOT NULL DEFAULT '';
    `);
  }

  // Backfill existing sessions: derive title from the linked template via
  // session_exercise.template_id (since the session row itself has no
  // template_id column — the linkage lives one level down). Sessions whose
  // session_exercise rows are all freestyle (template_id IS NULL) keep
  // title = '' from the column DEFAULT. Run unconditionally — the `WHERE
  // title = ''` clause keeps it idempotent (won't clobber any title a user
  // has already typed in via the in-session editor).
  await db.execAsync(`
    UPDATE session
       SET title = COALESCE(
         (SELECT t.name
            FROM session_exercise se
            JOIN template t ON t.id = se.template_id
           WHERE se.session_id = session.id
             AND se.template_id IS NOT NULL
           LIMIT 1),
         ''
       )
     WHERE title = '';
  `);
}
