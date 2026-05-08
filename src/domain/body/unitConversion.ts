/**
 * Unit conversion — kg ↔ lb.
 *
 * Storage is always kg; this module is the single source of truth for display
 * conversion. UI never multiplies by 2.2 inline — always pipes through here.
 *
 * The factor 2.20462262 is the NIST-defined exact conversion factor truncated
 * to 8 significant figures, sufficient for sub-gram precision at human-scale
 * weights (tested gym range 20kg–500kg).
 */

import type { UnitPreference } from './types';

export const KG_TO_LB = 2.20462262;

export function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}

export function lbToKg(lb: number): number {
  return lb / KG_TO_LB;
}

/**
 * Convert a kg value into the display unit. Returns the numeric value (caller
 * decides rounding / formatting). Returns null straight through.
 */
export function kgToDisplay(kg: number, unit: UnitPreference): number {
  return unit === 'kg' ? kg : kgToLb(kg);
}

/**
 * Convert a value entered in the user's display unit back to kg for storage.
 */
export function displayToKg(value: number, unit: UnitPreference): number {
  return unit === 'kg' ? value : lbToKg(value);
}

/**
 * Format a kg value for display: rounds to 1 decimal and appends the unit
 * label. Used by chart axes, set rows, body data summaries.
 *
 * Example:
 *   formatWeight(70, 'kg') === '70.0 kg'
 *   formatWeight(70, 'lb') === '154.3 lb'
 */
export function formatWeight(kg: number, unit: UnitPreference): string {
  const v = kgToDisplay(kg, unit);
  return `${v.toFixed(1)} ${unit}`;
}

/**
 * Parse a user-entered weight string into kg. Returns null if the input is
 * blank, NaN, or non-positive. Caller should validate result before persist.
 */
export function parseWeightInput(
  text: string,
  unit: UnitPreference
): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return displayToKg(n, unit);
}
