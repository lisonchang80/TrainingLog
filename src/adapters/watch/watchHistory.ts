/**
 * #311-A — iPhone-side handler for the Watch's `history-request` (📊 查看歷史).
 *
 * Mirrors `handshake.ts`'s `onHandshakeRequest` request-reply shape: the Watch
 * sends `history-request { requestId, exerciseId }` over `sendMessage`; this
 * handler queries the iPhone DB, formats DISPLAY-READY records (unit + locale
 * resolved here — the Watch has neither), and answers via the `replyHandler`
 * ack. The reply is NOT a modelled WC kind (same as handshake's Stage 1
 * reply), because its shape pulls in domain/SQLite formatting.
 *
 * Reply carries an explicit `ok` flag so the Watch can tell apart:
 *   - ok:true + records:[]  → genuine "first time doing this exercise"
 *   - ok:false              → iPhone-side query error (Watch shows error, not
 *                             the misleading empty state)
 *   - no reply at all       → unreachable / timeout (Watch's own 4s guard →
 *                             error state). See ADR-0019 D15 Q2 (2026-06-09).
 *
 * Pull-on-tap channel (Q1=A1): cheap + fresh + keeps the start payload lean;
 * the Watch only asks when the user opens the sub-page.
 */

import type { Database } from '../../db/types';
import { queryExerciseHistory } from '../sqlite/exerciseHistoryRepository';
import { getUnitPreference } from '../sqlite/settingsRepository';
import { t } from '../../i18n/strings';
import { classifyBucket, bucketLabel } from '../../domain/pr/buckets';
import {
  buildWatchHistoryRecords,
  type WatchHistoryRecord,
} from '../../domain/watch/watchExerciseHistory';
import type { HistoryRequestPayload, WCMessage } from './payloadSchema';
import { toWireRecord } from './connectivity';

/**
 * Localise a rep-bucket label for the 頂組 line. `bucketLabel` returns the raw
 * zh literal locked in ADR-0007 (`buckets.ts`); round-trip it through the
 * `domain.*` i18n keys (same map the iPhone exercise-history page uses in its
 * local `tPrBucketLabel`) so the Watch wire string honours the phone locale.
 */
const PR_BUCKET_ZH_TO_DOMAIN_KEY: Record<
  string,
  'maxStrength' | 'strength' | 'hypertrophy' | 'muscularEndurance' | 'endurance'
> = {
  最大力量: 'maxStrength',
  力量: 'strength',
  增肌: 'hypertrophy',
  肌耐力: 'muscularEndurance',
  耐力: 'endurance',
};

/** reps → localised rep-bucket label (e.g. 8 → 增肌), '' for null/invalid reps. */
function bucketLabelFor(reps: number | null): string {
  if (reps == null) return '';
  const key = classifyBucket(reps);
  if (key == null) return '';
  const zh = bucketLabel(key);
  const domainKey = PR_BUCKET_ZH_TO_DOMAIN_KEY[zh];
  return domainKey ? t('domain', domainKey) : zh;
}

/** Reply payload (rides replyHandler; not a modelled WC kind). */
export interface WatchHistoryReplyPayload {
  /** Echo of the request nonce so the Watch can drop a stale late ack. */
  requestId: string;
  /** Echo of the requested exercise id (lets the Watch ignore a mismatched reply). */
  exerciseId: string;
  /** false = iPhone-side query error → Watch renders its error state. */
  ok: boolean;
  records: WatchHistoryRecord[];
}

/** i18n keys for the 7 weekday short labels, index = Date.getDay() (0=Sun..6=Sat). */
const WEEKDAY_KEYS = [
  'weekdaySun',
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
] as const;

/**
 * Generous set-row cap. The Watch only needs the last 3 SESSIONS, but
 * `queryExerciseHistory` caps by SET-row count, so fetch a wide window
 * (3 sessions rarely exceed ~50 logged sets) and let the pure builder slice
 * to 3 sessions. 300 ≈ 30 sessions of 10 sets — comfortably covers the tail.
 */
const HISTORY_SET_ROW_CAP = 300;

type ReplyHandler = (resp: Record<string, unknown>) => void;

/**
 * Inbound `history-request` handler. Best-effort, mirrors onHandshakeRequest:
 *   - no `replyHandler` (non-realtime channel) → silently drop.
 *   - query throws → reply `ok:false` so the Watch shows the error state
 *     instead of hanging or lying "no history".
 */
export async function onHistoryRequest(
  db: Database,
  env: WCMessage & { kind: 'history-request'; payload: HistoryRequestPayload },
  replyHandler?: ReplyHandler,
): Promise<void> {
  if (!replyHandler) return;
  const { requestId, exerciseId } = env.payload;
  try {
    const [unit, rows] = await Promise.all([
      getUnitPreference(db),
      queryExerciseHistory(db, exerciseId, { limit: HISTORY_SET_ROW_CAP }),
    ]);
    const weekdayLabels = WEEKDAY_KEYS.map((k) => t('domain', k));
    const records = buildWatchHistoryRecords(rows, {
      unit,
      weekdayLabels,
      topSetLabel: t('status', 'topSetLabel'),
      bucketLabelFor,
    });
    const reply: WatchHistoryReplyPayload = {
      requestId,
      exerciseId,
      ok: true,
      records,
    };
    replyHandler(toWireRecord(reply));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[watchHistory] onHistoryRequest failed:',
      e instanceof Error ? e.message : String(e),
    );
    const reply: WatchHistoryReplyPayload = {
      requestId,
      exerciseId,
      ok: false,
      records: [],
    };
    replyHandler(toWireRecord(reply));
  }
}
