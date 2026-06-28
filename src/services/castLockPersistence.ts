/**
 * Cast edit-token lock — persistence (ADR-0028 restart-resilience amendment).
 *
 * The lock state (epoch + which side holds) lives in-memory in `useCastEditLock`;
 * an iPhone app restart would reset it to UNPAIRED/epoch 0 and desync from the
 * Watch (device smoke ①: after a restart the Watch's lock-request reads as
 * "epoch > mine" → the iPhone demotes instead of granting → 解除鎖定 deadlocks).
 *
 * Fix (拍板 2026-06-28): the iPhone is the source of truth, so it persists a
 * COLLAPSED lock snapshot to `app_settings` and re-seeds `useCastEditLock` on
 * launch. The transient handover statuses collapse to their stable underlying
 * side — `offering → holder`, `requesting → locked` — so a restart in the middle
 * of a handover lands on a sane resting state (the epoch rule self-heals any
 * residual skew on the next message). UNPAIRED / session-end clears the row.
 *
 * Watch side persists NOTHING — it restores by the iPhone re-casting on
 * handshake (see the `hasLocalSession` field + the handshake listener re-cast).
 *
 * Pure over the injected `Database` + the `getSetting/setSetting/deleteSetting`
 * primitives, so jest covers it without a native bridge.
 */

import type { Database } from '../db/types';
import {
  getSetting,
  setSetting,
  deleteSetting,
} from '../adapters/sqlite/settingsRepository';
import type { EditLockState } from '../adapters/watch';

/** `app_settings` key for the persisted cast lock snapshot (single active cast). */
export const CAST_LOCK_STATE_KEY = 'cast_lock_state';

/** The collapsed, restart-safe lock snapshot persisted on the iPhone. */
export interface PersistedCastLock {
  sessionId: string;
  epoch: number;
  /** Stable resting side — `offering`→`holder`, `requesting`→`locked`. */
  status: 'holder' | 'locked';
}

/**
 * Persist (or clear) the lock snapshot for the iPhone. UNPAIRED or a missing
 * sessionId clears the row (no stale cast pairing survives a solo session).
 * Fire-and-forget at the call site; never throws fatally (a failed write just
 * means a restart won't restore — degrades to the pre-amendment behaviour).
 */
export async function persistCastLock(
  db: Database,
  state: EditLockState,
): Promise<void> {
  if (state.status === 'unpaired' || !state.sessionId) {
    await deleteSetting(db, CAST_LOCK_STATE_KEY);
    return;
  }
  const status: 'holder' | 'locked' =
    state.status === 'holder' || state.status === 'offering'
      ? 'holder'
      : 'locked';
  await setSetting<PersistedCastLock>(db, CAST_LOCK_STATE_KEY, {
    sessionId: state.sessionId,
    epoch: state.epoch,
    status,
  });
}

/** Load the persisted lock snapshot, or null when none / malformed. */
export async function loadCastLock(
  db: Database,
): Promise<PersistedCastLock | null> {
  const raw = await getSetting<PersistedCastLock>(db, CAST_LOCK_STATE_KEY);
  if (
    raw == null ||
    typeof raw.sessionId !== 'string' ||
    typeof raw.epoch !== 'number' ||
    (raw.status !== 'holder' && raw.status !== 'locked')
  ) {
    return null;
  }
  return raw;
}

/** Clear the persisted lock snapshot (session end / discard / unpair). */
export async function clearCastLock(db: Database): Promise<void> {
  await deleteSetting(db, CAST_LOCK_STATE_KEY);
}
