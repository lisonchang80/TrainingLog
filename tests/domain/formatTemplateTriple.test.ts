import {
  formatSessionSubtitle,
  formatTemplateTriple,
} from '../../src/domain/template/templateManager';

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

describe('formatSessionSubtitle (2026-06-26 — 模板名·計劃·強度 身份標)', () => {
  it('joins all three parts with middle-dot when present', () => {
    expect(formatSessionSubtitle('胸推日', '推日訓練', '中度日')).toBe(
      '胸推日 · 推日訓練 · 中度日',
    );
  });

  it('drops sub_tag when null (模板名 · 計劃)', () => {
    expect(formatSessionSubtitle('胸推日', '推日訓練', null)).toBe(
      '胸推日 · 推日訓練',
    );
  });

  it('returns the template name alone for a generic template (no program/intensity)', () => {
    expect(formatSessionSubtitle('胸推日', null, null)).toBe('胸推日');
  });

  it('omits an empty template name (freestyle / unnamed)', () => {
    expect(formatSessionSubtitle('', null, null)).toBe('');
    expect(formatSessionSubtitle(null, '推日訓練', '中度日')).toBe(
      '推日訓練 · 中度日',
    );
  });
});
