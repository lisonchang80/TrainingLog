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
