/**
 * Template color palette + deterministic name → color hash.
 *
 * Spec: ADR-0015 § 顏色系統（per Template name）/ Storage 設計.
 *
 * The palette is the 12-color iOS UIColor system palette in canonical order
 * (red → brown). v020 migration backfills existing `template.color_hex = ''`
 * rows by hashing the template name to a palette index. `createTemplate` also
 * uses this fallback when callers don't supply an explicit color.
 *
 * Hash function: a simple sum-of-charCodes mod palette length. Whitespace is
 * trimmed before hashing so `'胸日 A'` and `'胸日 A  '` map to the same color.
 * Empty / whitespace-only strings map deterministically to palette[0] (red).
 *
 * UIColor source values (iOS 13+ system colors, light mode hex equivalents):
 *   red     #FF3B30
 *   orange  #FF9500
 *   yellow  #FFCC00
 *   green   #34C759
 *   mint    #00C7BE
 *   teal    #30B0C7
 *   cyan    #32ADE6
 *   blue    #007AFF
 *   indigo  #5856D6
 *   purple  #AF52DE
 *   pink    #FF2D55
 *   brown   #A2845E
 */
export const TEMPLATE_COLOR_PALETTE: readonly string[] = [
  '#FF3B30', // red
  '#FF9500', // orange
  '#FFCC00', // yellow
  '#34C759', // green
  '#00C7BE', // mint
  '#30B0C7', // teal
  '#32ADE6', // cyan
  '#007AFF', // blue
  '#5856D6', // indigo
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#A2845E', // brown
];

/**
 * Map a template name to a deterministic palette color.
 *
 * - Trims whitespace first so cosmetic edits don't change color.
 * - Empty string (or whitespace-only) → palette[0] (red).
 * - Unicode safe: walks chars via `charCodeAt` which works on any string.
 */
export function colorForTemplateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return TEMPLATE_COLOR_PALETTE[0];
  }
  let sum = 0;
  for (let i = 0; i < trimmed.length; i++) {
    // sum-of-charCodes — simple, deterministic, locale-independent.
    sum = (sum + trimmed.charCodeAt(i)) | 0;
  }
  const idx = ((sum % TEMPLATE_COLOR_PALETTE.length) + TEMPLATE_COLOR_PALETTE.length) %
    TEMPLATE_COLOR_PALETTE.length;
  return TEMPLATE_COLOR_PALETTE[idx];
}
