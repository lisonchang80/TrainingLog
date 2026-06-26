/**
 * Goal 3a (2026-06-26) — iPhone-side handler for the Watch's `notes-request`
 * (備註 on an in-session exercise card's ⋯ menu).
 *
 * Mirrors `watchHistory.ts`'s `onHistoryRequest` request-reply shape: the Watch
 * sends `notes-request { requestId, exerciseId }` over `sendMessage`; this
 * handler reads the single exercise's per-EXERCISE global note (`exercise.notes`,
 * ADR-0017 — the SAME column the iPhone library detail page + session card
 * read/write, so it auto-syncs at the DB level with Goal 4), and answers via the
 * `replyHandler` ack. The reply is NOT a modelled WC kind (same as handshake's
 * Stage 1 reply / history's reply) — it rides the replyHandler.
 *
 * Why pull-on-tap (拍板 3a): the per-exercise note can't ride the Stage 1
 * prefetch — that tree spans ALL templates' exercises and is sized against the
 * 64 KB WC envelope cap (`loadTemplateExerciseTree` deliberately omits notes).
 * A single on-demand pull keeps the start payload lean + always-fresh, mirroring
 * #311 history exactly.
 *
 * Reply carries an explicit `ok` flag so the Watch can tell apart:
 *   - ok:true + notes:''  → genuine "this exercise has no note"
 *   - ok:false            → iPhone-side query error (Watch shows error, not the
 *                           misleading empty state)
 *   - no reply at all     → unreachable / timeout (Watch's own 6s guard → error)
 *
 * Notes are DISPLAY-ONLY on the wrist (the Watch has no note editor); editing
 * stays on the iPhone library detail / session card (Goal 4).
 */

import type { Database } from '../../db/types';
import { getExerciseNotes } from '../sqlite/exerciseLibraryRepository';
import type { NotesRequestPayload, WCMessage } from './payloadSchema';
import { toWireRecord } from './connectivity';

/** Reply payload (rides replyHandler; not a modelled WC kind). */
export interface WatchNotesReplyPayload {
  /** Echo of the request nonce so the Watch can drop a stale late ack. */
  requestId: string;
  /** Echo of the requested exercise id (lets the Watch ignore a mismatched reply). */
  exerciseId: string;
  /** false = iPhone-side query error → Watch renders its error state. */
  ok: boolean;
  /**
   * The exercise's global note. ALWAYS a string ('' when the exercise has no
   * note); never null — NSNull would make WCSession reject the plist reply
   * (same contract as `WatchHistoryRecord.topSetLine`).
   */
  notes: string;
}

type ReplyHandler = (resp: Record<string, unknown>) => void;

/**
 * Inbound `notes-request` handler. Best-effort, mirrors onHistoryRequest:
 *   - no `replyHandler` (non-realtime channel) → silently drop.
 *   - query throws → reply `ok:false` so the Watch shows the error state
 *     instead of hanging or lying "no note".
 */
export async function onNotesRequest(
  db: Database,
  env: WCMessage & { kind: 'notes-request'; payload: NotesRequestPayload },
  replyHandler?: ReplyHandler,
): Promise<void> {
  if (!replyHandler) return;
  const { requestId, exerciseId } = env.payload;
  try {
    const notes = await getExerciseNotes(db, exerciseId);
    const reply: WatchNotesReplyPayload = {
      requestId,
      exerciseId,
      ok: true,
      // '' on the wire, never null (NSNull breaks the plist reply).
      notes: notes ?? '',
    };
    replyHandler(toWireRecord(reply));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[watchNotes] onNotesRequest failed:',
      e instanceof Error ? e.message : String(e),
    );
    const reply: WatchNotesReplyPayload = {
      requestId,
      exerciseId,
      ok: false,
      notes: '',
    };
    replyHandler(toWireRecord(reply));
  }
}
