import {
  TEMPLATE_COLOR_PALETTE,
  colorForTemplateName,
} from '../../../src/domain/template/templateColor';

describe('templateColor', () => {
  it('palette has exactly 12 iOS system colors in canonical order', () => {
    expect(TEMPLATE_COLOR_PALETTE).toHaveLength(12);
    // First (red) and last (brown) sanity-check the canonical ordering.
    expect(TEMPLATE_COLOR_PALETTE[0]).toBe('#FF3B30');
    expect(TEMPLATE_COLOR_PALETTE[11]).toBe('#A2845E');
    // Every entry is a 7-char hex string.
    for (const hex of TEMPLATE_COLOR_PALETTE) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('colorForTemplateName is deterministic across calls', () => {
    const a = colorForTemplateName('胸日 A');
    const b = colorForTemplateName('胸日 A');
    expect(a).toBe(b);
    // Re-running multiple times keeps returning the same value.
    for (let i = 0; i < 5; i++) {
      expect(colorForTemplateName('胸日 A')).toBe(a);
    }
  });

  it('trims whitespace before hashing so cosmetic edits keep color', () => {
    const base = colorForTemplateName('Push Day');
    expect(colorForTemplateName('  Push Day  ')).toBe(base);
    expect(colorForTemplateName('\tPush Day\n')).toBe(base);
  });

  it('empty / whitespace-only strings map to palette[0] (red)', () => {
    expect(colorForTemplateName('')).toBe(TEMPLATE_COLOR_PALETTE[0]);
    expect(colorForTemplateName('   ')).toBe(TEMPLATE_COLOR_PALETTE[0]);
    expect(colorForTemplateName('\t\n')).toBe(TEMPLATE_COLOR_PALETTE[0]);
  });

  it('different names usually pick different colors (statistical, allow rare collisions)', () => {
    const names = ['推日 A', '拉日 B', '腿日 C', '上肢 D', 'Push', 'Pull', 'Legs'];
    const colors = new Set(names.map(colorForTemplateName));
    // We accept some collisions but expect at least half of inputs to land
    // on distinct palette slots.
    expect(colors.size).toBeGreaterThanOrEqual(Math.ceil(names.length / 2));
  });

  it('returns a value from the palette for unicode (Chinese) inputs', () => {
    const color = colorForTemplateName('全身爆破日');
    expect(TEMPLATE_COLOR_PALETTE).toContain(color);
  });
});
