import { formatTemplateTriple } from '../../src/domain/template/templateManager';

describe('formatTemplateTriple (ADR-0003 三元組顯示 — 5/18 spec)', () => {
  it('returns 「通用」 when both program_name and sub_tag are null', () => {
    expect(formatTemplateTriple(null, null)).toBe('通用');
  });

  it('returns program_name alone when sub_tag is null', () => {
    expect(formatTemplateTriple('推日訓練', null)).toBe('推日訓練');
  });

  it('joins program_name and sub_tag with middle-dot separator', () => {
    expect(formatTemplateTriple('推日訓練', 'TEST-1')).toBe('推日訓練 · TEST-1');
  });

  it('substitutes 「通用」 for null program_name when sub_tag exists', () => {
    expect(formatTemplateTriple(null, 'TEST-1')).toBe('通用 · TEST-1');
  });
});
