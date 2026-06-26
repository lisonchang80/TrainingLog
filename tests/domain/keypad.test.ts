import {
  applyKeypadKey,
  parseKeypadBuffer,
  MAX_KEYPAD_BUFFER_LENGTH,
} from '../../src/domain/keypad';

/**
 * Pure keypad input handling for the session set logger's tap-to-edit
 * flow (ADR-0019 Q6, slice 10c Phase 2 commit 4).
 */

describe('keypad — applyKeypadKey integer mode', () => {
  it('appending a digit to "0" replaces it (no leading zero)', () => {
    expect(applyKeypadKey('0', '8', 'integer')).toBe('8');
  });

  it('appending zero to "0" stays "0"', () => {
    expect(applyKeypadKey('0', '0', 'integer')).toBe('0');
  });

  it('appends a digit to a non-zero buffer', () => {
    expect(applyKeypadKey('12', '5', 'integer')).toBe('125');
  });

  it('ignores the decimal point key in integer mode', () => {
    expect(applyKeypadKey('12', '.', 'integer')).toBe('12');
  });

  it('back on a multi-char buffer removes the last char', () => {
    expect(applyKeypadKey('123', 'back', 'integer')).toBe('12');
  });

  it('back on a single-char buffer returns "0"', () => {
    expect(applyKeypadKey('5', 'back', 'integer')).toBe('0');
  });

  it('back on "0" stays "0"', () => {
    expect(applyKeypadKey('0', 'back', 'integer')).toBe('0');
  });

  it('respects MAX_KEYPAD_BUFFER_LENGTH cap', () => {
    const atCap = '1'.repeat(MAX_KEYPAD_BUFFER_LENGTH);
    expect(applyKeypadKey(atCap, '2', 'integer')).toBe(atCap);
  });

  it('ignores unknown keys', () => {
    expect(applyKeypadKey('12', 'x', 'integer')).toBe('12');
  });
});

describe('keypad — applyKeypadKey decimal mode', () => {
  it('accepts a single decimal point', () => {
    expect(applyKeypadKey('12', '.', 'decimal')).toBe('12.');
  });

  it('ignores a second decimal point', () => {
    expect(applyKeypadKey('12.5', '.', 'decimal')).toBe('12.5');
  });

  it('decimal point on "0" yields "0."', () => {
    expect(applyKeypadKey('0', '.', 'decimal')).toBe('0.');
  });

  it('digit after "0." preserves the decimal point', () => {
    expect(applyKeypadKey('0.', '5', 'decimal')).toBe('0.5');
  });

  it('back on "0." returns "0"', () => {
    expect(applyKeypadKey('0.', 'back', 'decimal')).toBe('0');
  });

  it('back on "12.5" returns "12."', () => {
    expect(applyKeypadKey('12.5', 'back', 'decimal')).toBe('12.');
  });

  it('decimal point at cap is rejected', () => {
    const atCap = '1'.repeat(MAX_KEYPAD_BUFFER_LENGTH);
    expect(applyKeypadKey(atCap, '.', 'decimal')).toBe(atCap);
  });
});

describe('keypad — applyKeypadKey fresh (反白取代, overwrite on first key)', () => {
  it('first digit replaces a multi-digit value (integer)', () => {
    expect(applyKeypadKey('85', '1', 'integer', true)).toBe('1');
  });

  it('first digit replaces a decimal value', () => {
    expect(applyKeypadKey('100.5', '7', 'decimal', true)).toBe('7');
  });

  it('first key "0" replaces with "0" (no leading-zero buildup)', () => {
    expect(applyKeypadKey('85', '0', 'integer', true)).toBe('0');
  });

  it('first "." starts a fresh "0." (decimal)', () => {
    expect(applyKeypadKey('85', '.', 'decimal', true)).toBe('0.');
  });

  it('first back clears the selected value to "0"', () => {
    expect(applyKeypadKey('85', 'back', 'integer', true)).toBe('0');
  });

  it('unknown key keeps the selection while fresh', () => {
    expect(applyKeypadKey('85', 'x', 'integer', true)).toBe('85');
  });

  it('fresh defaults to false → backward-compatible append', () => {
    // The 3-arg call form (no fresh) must behave exactly as before.
    expect(applyKeypadKey('12', '5', 'integer')).toBe('125');
  });
});

describe('keypad — fresh typing sequence (component semantics)', () => {
  // The component opens with fresh=true and flips it to false after the first
  // key press, so only the FIRST key overwrites; the rest append normally.
  function typeFresh(
    keys: string[],
    mode: 'integer' | 'decimal',
    start: string,
  ): { buffer: string; value: number } {
    let buffer = start;
    let fresh = true;
    for (const k of keys) {
      buffer = applyKeypadKey(buffer, k, mode, fresh);
      fresh = false;
    }
    return { buffer, value: parseKeypadBuffer(buffer) };
  }

  it('open on 85, type 1 2 → 12 (replace then append)', () => {
    const { buffer, value } = typeFresh(['1', '2'], 'integer', '85');
    expect(buffer).toBe('12');
    expect(value).toBe(12);
  });

  it('open on 100, type 6 0 → 60 (decimal)', () => {
    const { buffer } = typeFresh(['6', '0'], 'decimal', '100');
    expect(buffer).toBe('60');
  });

  it('open on 60, type . 5 → 0.5', () => {
    const { buffer, value } = typeFresh(['.', '5'], 'decimal', '60');
    expect(buffer).toBe('0.5');
    expect(value).toBe(0.5);
  });

  it('confirm without pressing keeps the original value', () => {
    const { value } = typeFresh([], 'integer', '85');
    expect(value).toBe(85);
  });
});

describe('keypad — parseKeypadBuffer', () => {
  it('parses "12" as 12', () => {
    expect(parseKeypadBuffer('12')).toBe(12);
  });

  it('parses "12.5" as 12.5', () => {
    expect(parseKeypadBuffer('12.5')).toBe(12.5);
  });

  it('parses "12." as 12 (trailing dot is harmless)', () => {
    expect(parseKeypadBuffer('12.')).toBe(12);
  });

  it('parses "0.5" as 0.5', () => {
    expect(parseKeypadBuffer('0.5')).toBe(0.5);
  });

  it('parses empty string as 0', () => {
    expect(parseKeypadBuffer('')).toBe(0);
  });

  it('parses lone "." as 0', () => {
    expect(parseKeypadBuffer('.')).toBe(0);
  });

  it('parses non-numeric garbage as 0', () => {
    expect(parseKeypadBuffer('abc')).toBe(0);
  });

  it('parses "0" as 0', () => {
    expect(parseKeypadBuffer('0')).toBe(0);
  });
});

describe('keypad — typing sequences (integration)', () => {
  // Simulate a user typing the full sequence; verify the final parsed value.

  function typeSequence(
    keys: string[],
    mode: 'integer' | 'decimal',
    start = '0',
  ): { buffer: string; value: number } {
    let buffer = start;
    for (const k of keys) {
      buffer = applyKeypadKey(buffer, k, mode);
    }
    return { buffer, value: parseKeypadBuffer(buffer) };
  }

  it('types "85" from initial "0" (integer reps)', () => {
    const { buffer, value } = typeSequence(['8', '5'], 'integer');
    expect(buffer).toBe('85');
    expect(value).toBe(85);
  });

  it('types "0.5" from initial "0" (decimal weight)', () => {
    const { buffer, value } = typeSequence(['.', '5'], 'decimal');
    expect(buffer).toBe('0.5');
    expect(value).toBe(0.5);
  });

  it('types "100" then backspaces to "10" (integer)', () => {
    const { buffer, value } = typeSequence(
      ['1', '0', '0', 'back'],
      'integer',
    );
    expect(buffer).toBe('10');
    expect(value).toBe(10);
  });

  it('types "100.5" from initial "0" (decimal)', () => {
    const { buffer, value } = typeSequence(
      ['1', '0', '0', '.', '5'],
      'decimal',
    );
    expect(buffer).toBe('100.5');
    expect(value).toBe(100.5);
  });

  it('rejects a second decimal point mid-typing', () => {
    const { buffer } = typeSequence(['1', '2', '.', '5', '.'], 'decimal');
    expect(buffer).toBe('12.5');
  });

  it('clearing all chars one by one ends at "0"', () => {
    const { buffer } = typeSequence(
      ['back', 'back', 'back', 'back'],
      'integer',
      '12',
    );
    expect(buffer).toBe('0');
  });

  it('typing past MAX_KEYPAD_BUFFER_LENGTH caps the buffer', () => {
    // Initial "0" + 7 digits ought to be capped at MAX_KEYPAD_BUFFER_LENGTH
    // characters (the initial "0" is replaced by the first digit).
    const keys = ['1', '2', '3', '4', '5', '6', '7'];
    const { buffer } = typeSequence(keys, 'integer');
    expect(buffer).toHaveLength(MAX_KEYPAD_BUFFER_LENGTH);
    expect(buffer).toBe('123456');
  });
});
