import {
  STICKY_KEY_LAST_PROGRAM_ID,
  STICKY_KEY_LAST_SUB_TAG,
  listTemplateGroupsByName,
} from '../../src/domain/training/templateListGroups';
import type { TemplateSummary } from '../../src/adapters/sqlite/templateRepository';

function row(
  partial: Partial<TemplateSummary> & { id: string; name: string }
): TemplateSummary {
  return {
    id: partial.id,
    name: partial.name,
    created_at: partial.created_at ?? 0,
    updated_at: partial.updated_at ?? 0,
    program_id: partial.program_id ?? null,
    sub_tag: partial.sub_tag ?? null,
    exerciseCount: partial.exerciseCount ?? 0,
  };
}

describe('listTemplateGroupsByName (ADR-0024 § 2.c dedupe)', () => {
  it('returns rows untouched when names are already unique', () => {
    const input = [row({ id: 'a', name: 'Push' }), row({ id: 'b', name: 'Pull' })];
    expect(listTemplateGroupsByName(input)).toEqual(input);
  });

  it('keeps the FIRST row per name (caller passes newest-first)', () => {
    // newest-edited-first ordering — see listTemplates ORDER BY updated_at DESC
    const newest = row({ id: 'newest', name: 'Push', updated_at: 1000 });
    const middle = row({ id: 'middle', name: 'Push', updated_at: 500 });
    const oldest = row({ id: 'oldest', name: 'Push', updated_at: 100 });
    const out = listTemplateGroupsByName([newest, middle, oldest]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('newest');
  });

  it('preserves the input ordering across distinct names', () => {
    const input = [
      row({ id: '1', name: 'A' }),
      row({ id: '2', name: 'B' }),
      row({ id: '3', name: 'A' }), // dupe — dropped
      row({ id: '4', name: 'C' }),
    ];
    const out = listTemplateGroupsByName(input);
    expect(out.map((r) => r.id)).toEqual(['1', '2', '4']);
  });

  it('handles empty input', () => {
    expect(listTemplateGroupsByName([])).toEqual([]);
  });

  it('exposes the canonical sticky-key strings used by start-sheet contract', () => {
    // single-key GLOBAL scope per ADR-0024 § 2.c — these strings must not
    // change without bumping the ADR ledger.
    expect(STICKY_KEY_LAST_PROGRAM_ID).toBe('start_dialog_last_program_id');
    expect(STICKY_KEY_LAST_SUB_TAG).toBe('start_dialog_last_sub_tag');
  });
});
