/**
 * "Has the user seen this page's help yet?" — backed by the generic
 * `app_settings` key/value store (no migration needed; mirrors
 * `auto_popup_rest_timer` / `app_mode`).
 *
 * Key shape: `help_seen:<pageId>` → JSON `true`. Absent / non-true → not seen.
 * Used by `usePageHelp({ autoShowOnce: true })` to auto-open the help once on
 * a page's first visit, then never again unless the user taps the ⓘ button.
 */

import { getSetting, setSetting } from '@/src/adapters/sqlite/settingsRepository';
import type { Database } from '@/src/db/types';

/** Settings key for a page's "help seen" flag. Exported for tests. */
export function helpSeenKey(pageId: string): string {
  return `help_seen:${pageId}`;
}

/** True once `markHelpSeen` has run for this page; false for fresh installs. */
export async function getHelpSeen(db: Database, pageId: string): Promise<boolean> {
  const v = await getSetting<boolean>(db, helpSeenKey(pageId));
  return v === true;
}

/** Record that the user has now seen this page's help (idempotent). */
export async function markHelpSeen(db: Database, pageId: string): Promise<void> {
  await setSetting<boolean>(db, helpSeenKey(pageId), true);
}
