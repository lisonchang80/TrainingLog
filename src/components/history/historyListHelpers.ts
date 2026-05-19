/**
 * History list helpers — pure functions for the ADR-0015 表列 (escape hatch)
 * view. Extracted so they can be unit-tested without React Native dependencies.
 *
 * Two responsibilities:
 *   - `groupSessionsByDate`: bucket sessions into Map<YYYY-MM-DD, Session[]>
 *     using the *local* timezone (mirrors how the user picks dates on the
 *     calendar — they think in "today's date" not UTC).
 *   - `buildSameDayIdMap`: from that grouped map, produce
 *     Map<sessionId → string[] of every sibling session id sharing the date>.
 *     The list **includes the session itself** so the same-day switcher in
 *     the session detail page can navigate by index. Even a single-session
 *     date yields a one-element list; the detail-page switcher renders
 *     no chrome when total = 1 (Agent C's territory).
 *
 * Date bucket key format: `YYYY-MM-DD` (zero-padded), local timezone.
 */

import type { Session } from '../../domain/session/types';

/** Format a unix-ms timestamp as a local-timezone `YYYY-MM-DD` bucket key. */
export function dateKeyFromTimestamp(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Group sessions by their local-timezone `YYYY-MM-DD` bucket. Preserves the
 * input order within each bucket (callers feed `listSessions` newest-first,
 * so each bucket's array is also newest-first). Empty input → empty map.
 */
export function groupSessionsByDate(
  sessions: ReadonlyArray<Session>
): Map<string, Session[]> {
  const out = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = dateKeyFromTimestamp(s.started_at);
    const arr = out.get(key);
    if (arr) arr.push(s);
    else out.set(key, [s]);
  }
  return out;
}

/**
 * From the grouped map, produce a `sessionId → sameDayIds[]` lookup. Every
 * session's entry contains ALL the sibling ids on the same date INCLUDING
 * itself. Single-session days produce one-element arrays — the detail page
 * switcher hides chrome when length = 1.
 *
 * Order of `sameDayIds` matches the order in the grouped bucket (so
 * newest-first when fed from `listSessions`).
 */
export function buildSameDayIdMap(
  grouped: ReadonlyMap<string, ReadonlyArray<Session>>
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const sessions of grouped.values()) {
    const ids = sessions.map((s) => s.id);
    for (const s of sessions) {
      out.set(s.id, ids);
    }
  }
  return out;
}
