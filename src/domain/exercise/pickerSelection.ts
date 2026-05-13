/**
 * Picker Selection — pure helpers for /library?mode=picker multi-select state
 * (ADR-0017 Q15, L2 step).
 *
 * State is a plain `readonly string[]` of exercise IDs in insertion order;
 * the array's order is the order the caller (Template editor) receives them
 * back via `pickerBridge`. Adding an already-present id is a no-op (so the
 * displayed selection count matches unique selections).
 */

export type PickerSelection = readonly string[];

export const EMPTY_SELECTION: PickerSelection = [];

/** Append `id` to selection if not present; return new array. No mutation. */
export function addSelection(state: PickerSelection, id: string): string[] {
  if (state.includes(id)) return [...state];
  return [...state, id];
}

/** Drop `id` from selection if present; return new array. No mutation. */
export function removeSelection(state: PickerSelection, id: string): string[] {
  const idx = state.indexOf(id);
  if (idx < 0) return [...state];
  return [...state.slice(0, idx), ...state.slice(idx + 1)];
}

/** Toggle membership — convenience for card tap handlers. */
export function toggleSelection(state: PickerSelection, id: string): string[] {
  return state.includes(id) ? removeSelection(state, id) : addSelection(state, id);
}

/** O(1) membership check (set semantics on an ordered array). */
export function isSelected(state: PickerSelection, id: string): boolean {
  return state.includes(id);
}

/** Insertion-order rank: 0-based; -1 if not selected. */
export function selectionRank(state: PickerSelection, id: string): number {
  return state.indexOf(id);
}

/** Returns true when selection is empty — used to disable the 完成 footer. */
export function isEmpty(state: PickerSelection): boolean {
  return state.length === 0;
}
