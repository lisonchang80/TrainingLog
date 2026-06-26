/**
 * 補訓練 (backfill) session creation — grill 2026-06-26, 架構方案 B.
 *
 * A backfilled session is born ALREADY-FINISHED (`ended_at` set on the same
 * transaction that creates it), so it:
 *   - never occupies the single-active-session slot (no clash with a live
 *     in-progress workout, no Watch `start-from-iphone` push),
 *   - lands directly in history bucketed by its back-dated `started_at`
 *     (MonthGridView groups by local date), and
 *   - opens in the session detail page's edit mode for the user to tick sets
 *     (sets are seeded `is_logged = 0` from the template, so the page starts
 *     「完全未打勾」 exactly as specced).
 *
 * The actual session/exercise/set machinery is reused verbatim from the live
 * start path — `createSession` (blank) and `startSessionFromTemplate`
 * (template / program). The only new wiring is the `ended_at` finalize +
 * `skip_active_guard` flag those functions gained for backfill.
 */
import type { Database } from '../db/types';
import {
  createSession,
  endSession,
} from '../adapters/sqlite/sessionRepository';
import { startSessionFromTemplate } from '../adapters/sqlite/sessionFromTemplate';

/**
 * Backfill a 空白訓練 (blank / freestyle) session for a past day. Created with
 * no exercises — the user adds them in the detail page's edit mode.
 */
export async function backfillBlankSession(
  db: Database,
  args: {
    id: string;
    started_at: number;
    ended_at: number;
    /** Omit → createSession auto-pulls the latest body_metric snapshot. */
    bodyweight_snapshot_kg?: number | null;
    title?: string;
  },
): Promise<string> {
  await db.withTransactionAsync(async () => {
    await createSession(db, {
      id: args.id,
      started_at: args.started_at,
      bodyweight_snapshot_kg: args.bodyweight_snapshot_kg,
      title: args.title,
    });
    await endSession(db, { id: args.id, ended_at: args.ended_at });
  });
  return args.id;
}

/**
 * Backfill a 模板訓練 / 計劃訓練 session for a past day, seeded from a template
 * (sets copied 1:1, all `is_logged = 0`). `program_id` / `sub_tag` are the
 * template's own classification — decorative here (the calendar derives the
 * session's 計劃·強度 from its linked template), kept for parity with the live
 * start path.
 */
export async function backfillSessionFromTemplate(
  db: Database,
  args: {
    template_id: string;
    started_at: number;
    ended_at: number;
    uuid: () => string;
    program_id?: string;
    sub_tag?: string | null;
  },
): Promise<string> {
  const { session_id } = await startSessionFromTemplate(db, {
    template_id: args.template_id,
    uuid: args.uuid,
    now: () => args.started_at,
    ended_at: args.ended_at,
    skip_active_guard: true,
    program_id: args.program_id,
    sub_tag: args.sub_tag ?? null,
  });
  return session_id;
}
