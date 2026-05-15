/**
 * Picker Bridge — single-shot mailbox for /library?mode=picker → caller hand-off
 * (ADR-0017 L2 picker mode).
 *
 * When the Template editor opens the Library in picker mode, the picker
 * collects multi-select state, calls `submitPick(...)` on 完成, then
 * `router.back()`. The Template editor's focus listener calls `consumePick()`
 * to retrieve the selection and clears the mailbox in the same call so a
 * later re-focus doesn't re-add the same exercises.
 *
 * In-process singleton — fine for v1 (single-window mobile app). No
 * persistence: if the app is killed mid-pick, selection is lost.
 *
 * Pure module — testable. The DOM coupling lives in route handlers.
 */

export interface PickerPayload {
  /** Selected exercise IDs in insertion order (matches picker's selection-order rule). */
  exerciseIds: string[];
}

let mailbox: PickerPayload | null = null;

/** Picker calls this on 完成 before `router.back()`. Replaces any prior unread payload. */
export function submitPick(payload: PickerPayload): void {
  mailbox = { exerciseIds: [...payload.exerciseIds] };
}

/** Caller (Template editor) reads + clears in one operation. Returns null if empty. */
export function consumePick(): PickerPayload | null {
  const p = mailbox;
  mailbox = null;
  return p;
}

/** Discard any pending payload — call on picker mount or on caller back-out. */
export function clearPick(): void {
  mailbox = null;
}

/** Test helper — inspect without clearing. */
export function peekPickForTest(): PickerPayload | null {
  return mailbox == null ? null : { exerciseIds: [...mailbox.exerciseIds] };
}

// ---------------------------------------------------------------------------
// Newly-created-exercise mailbox — opposite direction from `submitPick`.
//
// When the user creates a Custom Exercise from inside picker mode, the
// /exercise/new form writes the new exercise's id here, then router.back()
// returns to the picker. The picker's useFocusEffect drains the mailbox and
// auto-selects the id so the user doesn't have to find it in the grid.
//
// Browse mode also drains the mailbox (no-op effect) so a stale id never
// leaks into a later picker session.
// ---------------------------------------------------------------------------

let newlyCreatedId: string | null = null;

/** /exercise/new calls this on save before router.back(). */
export function submitNewlyCreated(exerciseId: string): void {
  newlyCreatedId = exerciseId;
}

/** Picker / library tab reads + clears on focus. Returns null if empty. */
export function consumeNewlyCreated(): string | null {
  const id = newlyCreatedId;
  newlyCreatedId = null;
  return id;
}

/** Drop any pending value (e.g. on picker mount to flush stale state). */
export function clearNewlyCreated(): void {
  newlyCreatedId = null;
}

/** Test helper — inspect without clearing. */
export function peekNewlyCreatedForTest(): string | null {
  return newlyCreatedId;
}
