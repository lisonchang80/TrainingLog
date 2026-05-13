/**
 * 12-color iOS-system-aligned palette for Template recolor (ADR-0015 + 0016).
 * Bottom-sheet picker renders this in a 4×3 grid (`width:64, height:64,
 * gap:12` per ADR-0016 amendment §I).
 */
export const PALETTE: readonly string[] = [
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#00C7BE', // Mint
  '#30B0C7', // Teal
  '#32ADE6', // Cyan
  '#007AFF', // Blue
  '#5856D6', // Indigo
  '#AF52DE', // Purple
  '#FF2D55', // Pink
  '#A2845E', // Brown
];

/** Deterministic fallback when a Template has empty `color_hex`. */
export function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
