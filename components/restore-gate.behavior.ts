/**
 * RestoreGate pure-logic helpers — slice 15 C4 (ADR-0011 + 2026-06-12
 * amendment). Extracted from the .tsx per the repo's behavior-split
 * convention so the four-state gate machine is unit-testable in the
 * node-env jest setup. Zero React imports.
 *
 * The gate is the FIRST-LAUNCH restore entry (grill Q8-C entry A). It
 * mounts ABOVE `<DatabaseProvider>` in app/_layout.tsx so the fresh-install
 * check (grill Q9-A: DB FILE existence, before any open — opening would
 * create the file and destroy the signal) runs before SQLite ever opens.
 *
 * Gate states (spec 四態):
 *   checking   — sentinel/db-exists/discovery probe, bounded by the Q18-A
 *                discovery timeout (the service layer owns the timer)
 *   prompt     — backup found: preview + 還原 / 全新開始
 *                (`blocked` is the prompt's degenerate sibling: backups
 *                exist but none usable — only 全新開始 remains)
 *   restoring  — swap in flight
 *   error      — restore failed: 重試 / 全新開始
 *   proceed    — terminal; the .tsx renders children (the real app)
 */

import { getLocale } from '../src/i18n/strings';
import { formatLocalYmdFromMs } from '../src/domain/date/localYmd';
import type {
  DiscoveryResult,
  InspectRejectReason,
  PickResult,
  RestorePreview,
} from '../src/services/restoreService';

/**
 * AsyncStorage key for the «全新開始 declined» sentinel (grill Q9-A).
 * Deliberately DEVICE-LOCAL and NOT in app_settings/SQLite: it must survive
 * the DB being absent (that is the exact scenario it gates) and must NOT
 * travel inside a backup to other devices.
 */
export const RESTORE_DECLINED_SENTINEL_KEY = 'app.backup.restoreDeclined';

export type GateProceedMode = 'skipped' | 'fresh' | 'restored';

export type GatePhase =
  | { kind: 'checking' }
  | { kind: 'prompt'; preview: RestorePreview }
  | { kind: 'blocked'; reason: InspectRejectReason }
  | { kind: 'restoring'; preview: RestorePreview }
  | { kind: 'error'; message: string; preview: RestorePreview }
  | { kind: 'proceed'; mode: GateProceedMode };

export type GateEvent =
  /** deps not wired / declined sentinel set / DB file already exists. */
  | { type: 'SKIP' }
  /** Discovery: unavailable / timeout / error / empty (Q18-A → silent
   * fresh start; Settings keeps the 重新檢查 escape hatch). */
  | { type: 'NO_BACKUP' }
  | { type: 'FOUND'; preview: RestorePreview }
  /** Backups exist but every copy was rejected (corrupt / version-too-new). */
  | { type: 'ALL_REJECTED'; reason: InspectRejectReason }
  | { type: 'PRESS_RESTORE' }
  | { type: 'PRESS_FRESH' }
  | { type: 'RESTORE_OK' }
  | { type: 'RESTORE_FAIL'; message: string }
  | { type: 'PRESS_RETRY' };

/**
 * The gate's transition function. Invalid (phase, event) combinations
 * return the phase UNCHANGED — late async results (e.g. a discovery
 * resolving after the user already proceeded) must never resurrect the
 * gate. `proceed` is terminal.
 */
export function nextGatePhase(phase: GatePhase, event: GateEvent): GatePhase {
  switch (phase.kind) {
    case 'checking':
      if (event.type === 'SKIP') return { kind: 'proceed', mode: 'skipped' };
      if (event.type === 'NO_BACKUP') return { kind: 'proceed', mode: 'fresh' };
      if (event.type === 'FOUND') return { kind: 'prompt', preview: event.preview };
      if (event.type === 'ALL_REJECTED') return { kind: 'blocked', reason: event.reason };
      return phase;
    case 'prompt':
      if (event.type === 'PRESS_RESTORE') return { kind: 'restoring', preview: phase.preview };
      if (event.type === 'PRESS_FRESH') return { kind: 'proceed', mode: 'fresh' };
      return phase;
    case 'blocked':
      if (event.type === 'PRESS_FRESH') return { kind: 'proceed', mode: 'fresh' };
      return phase;
    case 'restoring':
      if (event.type === 'RESTORE_OK') return { kind: 'proceed', mode: 'restored' };
      if (event.type === 'RESTORE_FAIL') {
        return { kind: 'error', message: event.message, preview: phase.preview };
      }
      return phase;
    case 'error':
      if (event.type === 'PRESS_RETRY') return { kind: 'restoring', preview: phase.preview };
      if (event.type === 'PRESS_FRESH') return { kind: 'proceed', mode: 'fresh' };
      return phase;
    case 'proceed':
      return phase;
  }
}

/**
 * Pre-discovery short-circuit decision (grill Q9-A). Returns the skip
 * reason, or `null` when this IS a fresh install and discovery should run.
 *
 * Order matters: an unwired registry must skip even before the sentinel
 * read (the .tsx checks deps first and never touches storage).
 */
export function gateSkipReason(input: {
  depsWired: boolean;
  declinedSentinel: boolean;
  dbExists: boolean;
}): 'not-wired' | 'declined' | 'db-exists' | null {
  if (!input.depsWired) return 'not-wired';
  if (input.declinedSentinel) return 'declined';
  if (input.dbExists) return 'db-exists';
  return null;
}

/**
 * Collapse the discovery + pick pipeline results into a single gate event.
 * `pick` is null when discovery didn't reach the pick stage.
 */
export function discoveryOutcomeToEvent(
  discovery: DiscoveryResult,
  pick: PickResult | null
): GateEvent {
  if (discovery.status !== 'found' || pick === null) return { type: 'NO_BACKUP' };
  if (pick.ok) return { type: 'FOUND', preview: pick.preview };
  if (pick.rejected.length === 0) return { type: 'NO_BACKUP' };
  return { type: 'ALL_REJECTED', reason: primaryRejectReason(pick.rejected.map((r) => r.reason)) };
}

/**
 * When several copies were rejected for different reasons, surface the most
 * ACTIONABLE one: 'version-too-new' has a remedy the user can actually
 * perform (update the app), so it wins over corruption noise; otherwise
 * report the newest copy's reason (list order = newest first).
 */
export function primaryRejectReason(reasons: InspectRejectReason[]): InspectRejectReason {
  if (reasons.includes('version-too-new')) return 'version-too-new';
  return reasons[0] ?? 'empty-or-invalid';
}

// ---------------------------------------------------------------------------
// Dynamic i18n (function-form, per src/i18n/dynamic.ts convention — these
// live here instead of dynamic.ts because that file is outside this slice's
// parallel-agent file allow-list).
// ---------------------------------------------------------------------------

const isEn = (): boolean => getLocale() === 'en';

/** ADR-0011 §4 confirmation preview: «備份內含 142 個 Session，最後一筆
 * 2026-04-30» / "Backup contains 142 sessions, last on 2026-04-30". */
export function tRestorePreviewLine(sessionCount: number, lastSessionAt: number | null): string {
  const last = lastSessionAt != null ? formatLocalYmdFromMs(lastSessionAt) : null;
  if (isEn()) {
    const sessions = `Backup contains ${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
    return last ? `${sessions}, last on ${last}` : sessions;
  }
  const sessions = `備份內含 ${sessionCount} 個 Session`;
  return last ? `${sessions}，最後一筆 ${last}` : sessions;
}

/** Source-backup date line under the preview: «備份時間：2026-06-12». */
export function tRestoreBackupDateLine(modifiedAt: number): string {
  const ymd = formatLocalYmdFromMs(modifiedAt);
  return isEn() ? `Backed up on ${ymd}` : `備份時間：${ymd}`;
}

/** User-facing copy for a rejected candidate set (gate `blocked` state and
 * the Settings flow share it). Q10-A locked wording for version-too-new. */
export function tRestoreRejectReason(reason: InspectRejectReason): string {
  switch (reason) {
    case 'version-too-new':
      return isEn()
        ? 'This backup was created by a newer version of TrainingLog. Update the app, then restore.'
        : '此備份來自較新版本的 TrainingLog，請先更新 App 再還原。';
    case 'download-failed':
      return isEn()
        ? 'The backup could not be downloaded from iCloud. Check your connection and try again.'
        : '無法從 iCloud 下載備份，請確認網路後重試。';
    case 'quick-check-failed':
      return isEn()
        ? 'The backup file is damaged and cannot be restored.'
        : '備份檔已損毀，無法還原。';
    case 'not-sqlite':
    case 'empty-or-invalid':
      return isEn() ? 'The file is not a valid TrainingLog backup.' : '這不是有效的 TrainingLog 備份檔。';
  }
}
