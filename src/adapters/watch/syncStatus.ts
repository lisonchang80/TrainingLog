/**
 * Watch sync-status logic — slice 13d D33 (ADR-0019 § Slice 13d NEW-Q50 Q7).
 *
 * PURE LOGIC ONLY. No React, no native modules, no `Date.now()` — `now` is
 * always injected so the function is deterministic + jest-coverable in the
 * `node` test env. The SwiftUI corner-indicator view (⏳) and the end-fail
 * hint banner are device-gated morning work; this module is the testable
 * core they will read from.
 *
 * ── Spec (ADR-0019 Q7 拍板 (b) "只異常顯 sync indicator") ──────────────────
 *   SetLoggerView 上方 status bar 預設只顯 session title. States:
 *     ├─ happy   (TUI sent + iPhone ack 拿到):        [無 indicator]
 *     ├─ pending (TUI 30s+ 未 ack):                   [⏳ corner icon]
 *     ├─ conflict (Q5):                               [alert sheet — separate path]
 *     └─ end-session 失敗 (TUI 送不出去):             [hint banner]
 *
 * The 30s threshold is "合理 iPhone delay tolerance" — under it, the Watch is
 * the source of truth and trusts the OS to deliver the TUI envelope soon, so
 * NO indicator shows (happy-path silence avoids ⏳→✓ flicker anxiety). Only a
 * persistently-unacked send (≥ 30s) escalates to the ⏳ "stuck" warning.
 *
 * ── SyncState vocabulary (this module's contract) ─────────────────────────
 *   - 'idle'    — nothing has been sent (no in-flight sync). Watch hasn't
 *                 pushed a `start-from-watch` / live-mirror envelope yet, OR
 *                 a prior sync fully completed and was reset. NO indicator.
 *   - 'synced'  — last send was acked (lastAckedAt >= lastSentAt). NO
 *                 indicator. This is the happy-path resting state after a
 *                 round-trip completes. (ADR calls it "happy"; we name the
 *                 enum value 'synced' to read as a noun state.)
 *   - 'syncing' — a send is in flight and the ack is still within the
 *                 tolerance window (now - lastSentAt < thresholdMs). NO
 *                 indicator — we trust the OS to deliver. (ADR "pending"
 *                 BEFORE the 30s mark; renamed to avoid clashing with the
 *                 ⏳ visible state.)
 *   - 'stuck'   — a send has been in flight WITHOUT an ack for >= thresholdMs.
 *                 SHOW the ⏳ corner indicator. (ADR "pending (TUI 30s+ 未
 *                 ack)" → the only state with a visible indicator.)
 *
 * ── Naming note (ADR vocab vs. this enum) — documented per task spec ───────
 *   The ADR's prose uses "happy / pending / conflict / end-fail". Two of
 *   those are NOT pure-timestamp states and therefore are deliberately OUT
 *   of this module:
 *     - 'conflict'  → Q5 first-write-wins; driven by a reverse-TUI
 *                     `start-reconcile` payload (status: 'conflict'), NOT by
 *                     elapsed time. Surfaces as an alert sheet, not the ⏳
 *                     corner. The Watch UI branches on the reconcile payload
 *                     directly; folding it into this enum would conflate a
 *                     time-derived state with an event-derived one.
 *     - 'end-fail'  → end-session TUI send threw / bridge unavailable; a
 *                     transport-result branch (SendResult.ok === false), not
 *                     a timestamp. Surfaces as the hint banner.
 *   So the ADR's single word "pending" is split here into 'syncing' (< 30s,
 *   silent) vs 'stuck' (>= 30s, ⏳) because they render differently — that
 *   IS the whole point of the 30s threshold. 'idle' + 'synced' are the two
 *   silent resting states (nothing sent / round-trip done).
 *
 * ── "pending" / "acked" concretely (see connectivity.ts + watchSessionEnd.ts)
 *   - lastSentAt  = epoch-ms when the Watch fired the outbound TUI envelope
 *                   (`sendUserInfo`, NEW-Q50 Q4 sole outbound channel).
 *   - lastAckedAt = epoch-ms when the matching reverse-TUI reconcile arrived
 *                   (`start-reconcile` / `end-reconcile` via
 *                   `addUserInfoListener`). `watchSessionEnd.ts` already uses
 *                   the same ack-or-timeout shape (5s there; 30s display
 *                   threshold here — different concerns).
 */

/**
 * The four pure, timestamp-derived sync states. Only `'stuck'` renders a
 * visible indicator (⏳). See module header for the ADR-vocab mapping and
 * why `'conflict'` / `'end-fail'` are intentionally excluded.
 */
export type SyncState = 'idle' | 'synced' | 'syncing' | 'stuck';

/**
 * Default "stuck" threshold — 30s per ADR-0019 Q7 ("合理 iPhone delay
 * tolerance" / "TUI 30s+ 未 ack 才顯 ⏳"). Below this an in-flight send is
 * `'syncing'` (silent); at-or-above it is `'stuck'` (⏳).
 */
export const DEFAULT_STUCK_THRESHOLD_MS = 30_000;

export interface SyncStatusInput {
  /**
   * Epoch-ms of the most recent outbound sync send (TUI `start-from-watch`
   * or live-mirror push). `null` / `undefined` means nothing has ever been
   * sent → `'idle'`.
   */
  lastSentAt?: number | null;
  /**
   * Epoch-ms of the most recent inbound reconcile ack (reverse TUI). `null` /
   * `undefined` means no ack received yet. When `lastAckedAt >= lastSentAt`
   * the latest send is considered acked → `'synced'`.
   */
  lastAckedAt?: number | null;
  /** Current time, epoch-ms. MUST be injected — never `Date.now()` here. */
  now: number;
  /**
   * Stuck threshold in ms. Defaults to {@link DEFAULT_STUCK_THRESHOLD_MS}
   * (30s). The transition is `>=`: at exactly `thresholdMs` elapsed the
   * state is already `'stuck'` (29s → syncing, 30s/31s → stuck).
   */
  thresholdMs?: number;
}

/**
 * `true` iff the provided value is a usable epoch-ms timestamp (a finite
 * number). Guards against `null` / `undefined` / `NaN` / `Infinity` so a
 * malformed timestamp never silently produces a wrong state.
 */
function isTimestamp(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compute the pure {@link SyncState} from send/ack timestamps + `now`.
 *
 * Decision order (first match wins):
 *   1. No send timestamp at all              → `'idle'`
 *   2. Ack at-or-after the latest send        → `'synced'`   (happy path)
 *   3. In flight, elapsed >= thresholdMs      → `'stuck'`    (⏳ shows)
 *   4. In flight, elapsed  < thresholdMs      → `'syncing'`  (silent)
 *
 * Edge cases:
 *   - `lastAckedAt` newer than `lastSentAt` → `'synced'` (a stale ack for an
 *     older send still proves the round-trip closed; a newer send would bump
 *     `lastSentAt` past it).
 *   - `lastAckedAt` present but OLDER than `lastSentAt` → treated as
 *     not-yet-acked for the current send → falls through to syncing/stuck
 *     (a fresh send invalidates an older ack).
 *   - `now` earlier than `lastSentAt` (clock skew / future send) → elapsed
 *     is negative, which is `< thresholdMs` → `'syncing'` (never spuriously
 *     `'stuck'`).
 *   - Non-finite `thresholdMs` falls back to the 30s default; non-positive
 *     thresholds are honoured (>= 0 elapsed is immediately stuck) since a
 *     caller may legitimately want a 0ms "always escalate" mode in tests.
 *
 * Pure — no side effects, no `Date.now()`. Inject `now`.
 */
export function computeSyncState(input: SyncStatusInput): SyncState {
  const { lastSentAt, lastAckedAt, now } = input;
  const thresholdMs = isTimestamp(input.thresholdMs)
    ? input.thresholdMs
    : DEFAULT_STUCK_THRESHOLD_MS;

  // 1. Nothing sent → idle (no in-flight sync).
  if (!isTimestamp(lastSentAt)) return 'idle';

  // 2. Acked at-or-after the latest send → synced (happy path, no indicator).
  if (isTimestamp(lastAckedAt) && lastAckedAt >= lastSentAt) return 'synced';

  // 3 / 4. Send in flight (no valid ack for it). Branch on elapsed vs threshold.
  const elapsed = now - lastSentAt;
  return elapsed >= thresholdMs ? 'stuck' : 'syncing';
}

/**
 * `true` iff the state warrants the visible ⏳ corner indicator. Per Q7
 * "只異常顯" only `'stuck'` shows — `'idle'` / `'synced'` / `'syncing'` are
 * all silent. Convenience wrapper so the SwiftUI layer reads a boolean
 * instead of re-encoding the enum→visibility mapping.
 */
export function shouldShowPendingIndicator(state: SyncState): boolean {
  return state === 'stuck';
}
