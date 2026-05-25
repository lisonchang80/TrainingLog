/**
 * Pure keypad input handling — extracted from
 * `components/shared/numeric-keypad.tsx` so unit tests can exercise the
 * buffer manipulation in node env without rendering the modal.
 *
 * Used by the session set logger's tap-to-edit flow (ADR-0019 Q6, slice
 * 10c Phase 2 commit 4): tap a weight / reps number → modal opens with
 * buffer = String(currentValue) → user taps keys → confirm parses
 * buffer back to a number.
 *
 * Keypad keys:
 *   - '0'-'9': append digit (subject to MAX_BUFFER_LENGTH cap)
 *   - '.':     append decimal point (decimal mode only; no-op if buffer
 *              already contains '.', integer mode, or buffer at cap)
 *   - 'back':  remove last char; if buffer would become empty, returns '0'
 */

export type KeypadMode = 'integer' | 'decimal';

/**
 * Hard cap on buffer length to prevent overflow / weird display.
 * 6 chars covers all realistic weight (e.g. "999.99" = 6) and reps
 * (e.g. "999999" — absurd but harmless) values.
 */
export const MAX_KEYPAD_BUFFER_LENGTH = 6;

/**
 * Apply a single keypad key press to the current buffer string. Pure:
 * given the same `(buffer, key, mode)` always returns the same string.
 */
export function applyKeypadKey(
  buffer: string,
  key: string,
  mode: KeypadMode,
): string {
  if (key === 'back') {
    if (buffer.length <= 1) return '0';
    return buffer.slice(0, -1);
  }

  if (key === '.') {
    if (mode !== 'decimal') return buffer;
    if (buffer.includes('.')) return buffer;
    if (buffer.length >= MAX_KEYPAD_BUFFER_LENGTH) return buffer;
    // "" or "0" → "0." so the user sees the leading zero (defensive: in
    // practice `back` returns '0', not '').
    if (buffer === '' || buffer === '0') return '0.';
    return buffer + '.';
  }

  if (key >= '0' && key <= '9') {
    if (buffer.length >= MAX_KEYPAD_BUFFER_LENGTH) return buffer;
    // "0" → typing a digit replaces it (8, not 08; 0, not 00). But "0." +
    // typing 5 should yield "0.5" (preserve the decimal point) — the
    // bare-"0" check is intentionally narrow (`buffer === '0'`, not
    // `buffer.startsWith('0')`).
    if (buffer === '0') return key;
    return buffer + key;
  }

  // Unknown key — ignore.
  return buffer;
}

/**
 * Parse the buffer string to a numeric value at confirm time.
 *
 *   - "" or "." → 0
 *   - "12." → 12
 *   - "12.34" → 12.34
 *   - "0.5" → 0.5
 *   - non-numeric (shouldn't happen given `applyKeypadKey` guards) → 0
 */
export function parseKeypadBuffer(buffer: string): number {
  if (buffer === '' || buffer === '.') return 0;
  const n = Number(buffer);
  if (!Number.isFinite(n)) return 0;
  return n;
}
