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
  /** Selected exercise IDs in selection order. */
  exerciseIds: string[];
  /**
   * Selected reusable superset IDs in selection order (ADR-0017 L154
   * amendment / slice 9.8b grill Q1). Independent of `exerciseIds` —
   * Template editor processes reusable supersets first (explode into
   * cluster pair + memory derive) then appends solo exercises after.
   */
  reusableSupersetIds: string[];
}

let mailbox: PickerPayload | null = null;

/** Picker calls this on 完成 before `router.back()`. Replaces any prior unread payload. */
export function submitPick(payload: PickerPayload): void {
  mailbox = {
    exerciseIds: [...payload.exerciseIds],
    reusableSupersetIds: [...payload.reusableSupersetIds],
  };
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
  return mailbox == null
    ? null
    : {
        exerciseIds: [...mailbox.exerciseIds],
        reusableSupersetIds: [...mailbox.reusableSupersetIds],
      };
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

// ---------------------------------------------------------------------------
// Newly-created reusable-superset mailbox — mirrors the exercise mailbox for
// the picker mode's superset tab "+" button round-trip (slice 9.8b grill Q7).
//
// When the user taps "+" in the superset tab while in picker mode, they go to
// /superset/new, create a reusable superset, and on save we want them auto-
// selected on return — same UX as /exercise/new.
// ---------------------------------------------------------------------------

let newlyCreatedSupersetId: string | null = null;

/** /superset/new calls this on save before router.back(). */
export function submitNewlyCreatedSuperset(supersetId: string): void {
  newlyCreatedSupersetId = supersetId;
}

/** Picker / library tab reads + clears on focus. Returns null if empty. */
export function consumeNewlyCreatedSuperset(): string | null {
  const id = newlyCreatedSupersetId;
  newlyCreatedSupersetId = null;
  return id;
}

/** Drop any pending value (e.g. on picker mount to flush stale state). */
export function clearNewlyCreatedSuperset(): void {
  newlyCreatedSupersetId = null;
}

/** Test helper — inspect without clearing. */
export function peekNewlyCreatedSupersetForTest(): string | null {
  return newlyCreatedSupersetId;
}

// ---------------------------------------------------------------------------
// Picker exclusions mailbox — "already added, dim + disable these".
//
// The library picker's dim/disable layer normally derives "already in this
// session" from a live DB lookup (getActiveSession / ?sessionId=). But the
// Template editor has no session — its already-added exercises live in the
// in-memory draft. Before opening the picker it writes them here; the picker
// PEEKS (not consumes) on every focus so re-entering the picker (e.g. after
// creating a custom exercise) keeps dimming. The Template editor clears this
// when it regains focus (its consumePick handler), so a later session-context
// picker never inherits stale template exclusions.
//
// peek-not-consume is the key difference from `submitPick` — the payload must
// survive multiple picker focus cycles within one picker session.
// ---------------------------------------------------------------------------

export interface PickerExclusions {
  /** Solo exercise IDs already in the caller (dim by exercise_id). */
  exerciseIds: string[];
  /** Reusable-superset template IDs already in the caller. */
  reusableSupersetIds: string[];
}

let pickerExclusions: PickerExclusions | null = null;

/** Caller (Template editor) sets this BEFORE pushing the picker. */
export function submitPickerExclusions(payload: PickerExclusions): void {
  pickerExclusions = {
    exerciseIds: [...payload.exerciseIds],
    reusableSupersetIds: [...payload.reusableSupersetIds],
  };
}

/** Picker reads WITHOUT clearing (survives re-focus within a picker session). */
export function peekPickerExclusions(): PickerExclusions | null {
  return pickerExclusions == null
    ? null
    : {
        exerciseIds: [...pickerExclusions.exerciseIds],
        reusableSupersetIds: [...pickerExclusions.reusableSupersetIds],
      };
}

/** Caller clears when the picker session ends (e.g. editor regains focus). */
export function clearPickerExclusions(): void {
  pickerExclusions = null;
}
