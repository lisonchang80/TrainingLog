import {
  computeDefaultTemplateName,
  computeDeleteConfirmMessage,
  shouldShowEditChip,
} from '../../src/domain/session/sessionDetailLabels';

describe('computeDefaultTemplateName (Round F Q3 fallback chain)', () => {
  const dateLabel = '2026-05-24';

  it('returns session title when present and non-empty', () => {
    expect(
      computeDefaultTemplateName({
        sessionTitle: 'Push day v2',
        linkedTemplateName: 'PPL · Push',
        dateLabel,
      })
    ).toBe('Push day v2');
  });

  it('falls through to linkedTemplateName when sessionTitle is null', () => {
    expect(
      computeDefaultTemplateName({
        sessionTitle: null,
        linkedTemplateName: 'PPL · Push',
        dateLabel,
      })
    ).toBe('PPL · Push');
  });

  it('falls through to dateLabel when both sessionTitle and linkedTemplateName are null', () => {
    expect(
      computeDefaultTemplateName({
        sessionTitle: null,
        linkedTemplateName: null,
        dateLabel,
      })
    ).toBe('2026-05-24');
  });

  it('treats whitespace-only sessionTitle as missing (trim)', () => {
    expect(
      computeDefaultTemplateName({
        sessionTitle: '   ',
        linkedTemplateName: 'PPL · Push',
        dateLabel,
      })
    ).toBe('PPL · Push');
  });

  it('treats whitespace-only linkedTemplateName as missing (trim)', () => {
    expect(
      computeDefaultTemplateName({
        sessionTitle: null,
        linkedTemplateName: '   ',
        dateLabel,
      })
    ).toBe('2026-05-24');
  });

  it('treats undefined sessionTitle / linkedTemplateName as missing', () => {
    expect(computeDefaultTemplateName({ dateLabel })).toBe('2026-05-24');
  });
});

describe('computeDeleteConfirmMessage (Round F Q4 dialog copy)', () => {
  it('embeds the session display name in single Chinese quotes', () => {
    expect(
      computeDeleteConfirmMessage({ sessionDisplayName: '2026-05-24' })
    ).toBe('確定刪除『2026-05-24』？這個 session 將永久刪除。');
  });

  it('preserves user-typed session titles verbatim (no escaping)', () => {
    expect(
      computeDeleteConfirmMessage({ sessionDisplayName: 'Push day v2' })
    ).toBe('確定刪除『Push day v2』？這個 session 將永久刪除。');
  });
});

describe('shouldShowEditChip (Round F Q5 header [編] chip toggle)', () => {
  it('returns true when edit mode is on', () => {
    expect(shouldShowEditChip(true)).toBe(true);
  });

  it('returns false when edit mode is off', () => {
    expect(shouldShowEditChip(false)).toBe(false);
  });
});
