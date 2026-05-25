/**
 * Edit-mode snapshot persistence helpers — Card 12R / Round G.
 *
 * Pure helpers for serialising the history-detail edit-mode snapshot to /
 * from `app_settings` JSON kv so that an App force-kill mid-edit can be
 * recovered on next focus (per Round G Q1 拍板：always-restore, no 3-way
 * prompt, 7-day TTL, discardSession cascade).
 *
 * UI / adapter wiring lives in:
 *   - `app/session/[id].tsx` (enterEditMode / commitEditMode /
 *     attemptExitEditMode discard path + useFocusEffect restore)
 *   - `src/adapters/sqlite/sessionRepository.ts::discardSession`
 *     (cascade delete of the snapshot row when the session itself is
 *     discarded — FK semantic、避免 orphan)
 *   - `src/adapters/sqlite/settingsRepository.ts` (deleteSetting helper)
 *
 * This module is intentionally adapter-free so it can be unit-tested
 * without a SQLite instance — only key derivation, TTL math, and
 * runtime shape validation live here.
 */
import type { SessionSnapshot } from '../../adapters/sqlite/sessionRepository';

/**
 * Snapshot TTL — Round G Q2a 拍板 7 天。
 *
 * 動機：若 user 1 個月後回到該 session detail，看到「上次未完成編輯已還原」
 * 通常已無上下文記憶；7 天剛好涵蓋上次健身週末的編輯漂移、又避免長期殘留。
 */
export const EDIT_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The `app_settings` key namespace. One row per session — so concurrent
 * different-session edits don't collide.
 *
 * Key shape: `session_edit_snapshot_${session_id}`.
 */
export function editSnapshotKey(session_id: string): string {
  return `session_edit_snapshot_${session_id}`;
}

/**
 * Value persisted under {@link editSnapshotKey}. `savedAt` is wall-clock
 * `Date.now()` at enterEditMode — used for TTL evaluation on restore.
 */
export interface StoredEditSnapshot {
  snap: SessionSnapshot;
  savedAt: number;
}

/**
 * TTL check — true if the snapshot is older than the cutoff and should be
 * silently discarded instead of restored.
 *
 * Boundary: exact-equal-to-TTL counts as stale (>=), matching the spec
 * intent「超過 7 天則不還原」. `nowMs` and `savedAt` are both wall-clock ms.
 */
export function isEditSnapshotStale(
  savedAt: number,
  nowMs: number,
  ttlMs: number = EDIT_SNAPSHOT_TTL_MS,
): boolean {
  return nowMs - savedAt >= ttlMs;
}

/**
 * Runtime shape validation for the value read back via
 * `getSetting<StoredEditSnapshot>(db, key)`.
 *
 * Why this exists despite TypeScript types: `getSetting` returns
 * `T | null` based on a type assertion — the JSON could be garbage from
 * a manual DB edit, a partially-migrated row, or a schema drift across
 * app versions. We never want to throw inside the focus-restore path,
 * so any malformed value collapses to `null` and the caller silently
 * deletes the key.
 *
 * Validation is intentionally shallow: enough to ensure
 * `restoreSessionFromSnapshot` won't crash on a missing field. The
 * SessionSnapshot inner arrays are not deep-validated — if a single
 * sub-record is malformed we let SQLite surface the failure, since
 * that path is impossible in practice (the snapshot is round-tripped
 * unchanged from `captureSessionSnapshot`).
 */
export function validateStoredEditSnapshot(
  value: unknown,
): StoredEditSnapshot | null {
  if (value == null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
  const snap = v.snap;
  if (snap == null || typeof snap !== 'object') return null;
  const s = snap as Record<string, unknown>;
  if (
    s.session == null ||
    typeof s.session !== 'object' ||
    !Array.isArray(s.sessionExercises) ||
    !Array.isArray(s.sets) ||
    !Array.isArray(s.achievementUnlocks)
  ) {
    return null;
  }
  const session = s.session as Record<string, unknown>;
  if (
    typeof session.id !== 'string' ||
    typeof session.started_at !== 'number'
  ) {
    return null;
  }
  return { snap: snap as SessionSnapshot, savedAt: v.savedAt };
}
