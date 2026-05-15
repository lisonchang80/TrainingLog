import {
  bumpUseCount,
  createReusableSuperset,
  defaultSupersetName,
  explodeSupersetForTemplate,
  recolorReusableSuperset,
  renameReusableSuperset,
  validateReusableSupersetDraft,
} from '../../src/domain/superset/supersetManager';
import type { Exercise } from '../../src/domain/exercise/types';

const ex = (over: Partial<Exercise>): Exercise => ({
  id: over.id ?? 'ex-x',
  name: over.name ?? 'X',
  load_type: 'loaded',
  is_builtin: 1,
  is_archived: 0,
  muscle_group_id: 'mg-chest',
  is_custom: 0,
  equipment: '其他',
  notes: null,
  media_path: null,
  cues_text: null,
  ...over,
});

const EX_BENCH = ex({ id: 'ex-bench', name: 'Bench Press' });
const EX_ROW = ex({ id: 'ex-row', name: 'Bent-over Row' });

describe('supersetManager — defaultSupersetName', () => {
  it('joins two exercise names with " + "', () => {
    expect(defaultSupersetName(EX_BENCH, EX_ROW)).toBe('Bench Press + Bent-over Row');
  });
});

describe('supersetManager — validateReusableSupersetDraft', () => {
  const base = {
    name: '推拉組',
    color_hex: null as string | null,
    exercise_ids: ['ex-bench', 'ex-row'] as [string, string],
  };

  it('passes a clean draft', () => {
    expect(validateReusableSupersetDraft(base)).toEqual([]);
  });

  it('rejects empty / whitespace name', () => {
    expect(
      validateReusableSupersetDraft({ ...base, name: '   ' }).some((e) => e.field === 'name')
    ).toBe(true);
  });

  it('rejects name > 60 chars', () => {
    expect(
      validateReusableSupersetDraft({ ...base, name: 'a'.repeat(61) }).some(
        (e) => e.field === 'name'
      )
    ).toBe(true);
  });

  it('accepts null color_hex', () => {
    expect(validateReusableSupersetDraft({ ...base, color_hex: null })).toEqual([]);
  });

  it('accepts valid 7-char #rrggbb', () => {
    expect(validateReusableSupersetDraft({ ...base, color_hex: '#34c759' })).toEqual([]);
  });

  it('rejects bad color_hex format', () => {
    expect(
      validateReusableSupersetDraft({ ...base, color_hex: 'green' }).some(
        (e) => e.field === 'color_hex'
      )
    ).toBe(true);
  });

  it('rejects duplicate exercise_ids', () => {
    expect(
      validateReusableSupersetDraft({
        ...base,
        exercise_ids: ['ex-bench', 'ex-bench'],
      }).some((e) => e.field === 'exercise_ids')
    ).toBe(true);
  });

  it('rejects empty exercise_id slot', () => {
    expect(
      validateReusableSupersetDraft({
        ...base,
        exercise_ids: ['ex-bench', ''] as [string, string],
      }).some((e) => e.field === 'exercise_ids')
    ).toBe(true);
  });

  it('rejects wrong-length exercise_ids array', () => {
    expect(
      validateReusableSupersetDraft({
        ...base,
        exercise_ids: ['ex-bench'] as unknown as [string, string],
      }).some((e) => e.field === 'exercise_ids')
    ).toBe(true);
  });
});

describe('supersetManager — createReusableSuperset', () => {
  it('builds entity + 2 link rows with use_count=0', () => {
    let id = 0;
    const idGen = () => `id-${++id}`;
    const now = () => 1000;
    const { superset, links } = createReusableSuperset({
      draft: {
        name: '  推拉組  ',
        color_hex: '#34c759',
        exercise_ids: ['ex-bench', 'ex-row'],
      },
      idGen,
      now,
    });
    expect(superset).toEqual({
      id: 'id-1',
      name: '推拉組',
      color_hex: '#34c759',
      use_count: 0,
      created_at: 1000,
      updated_at: 1000,
    });
    expect(links).toEqual([
      { superset_id: 'id-1', position: 0, exercise_id: 'ex-bench' },
      { superset_id: 'id-1', position: 1, exercise_id: 'ex-row' },
    ]);
  });
});

describe('supersetManager — rename / recolor / bump', () => {
  const base = {
    id: 's-1',
    name: 'Old',
    color_hex: '#34c759',
    use_count: 3,
    created_at: 1000,
    updated_at: 1000,
  };

  it('renameReusableSuperset trims + bumps updated_at', () => {
    expect(renameReusableSuperset(base, '  New  ', () => 2000)).toEqual({
      ...base,
      name: 'New',
      updated_at: 2000,
    });
  });

  it('recolorReusableSuperset overwrites color + bumps updated_at', () => {
    expect(recolorReusableSuperset(base, null, () => 2000)).toEqual({
      ...base,
      color_hex: null,
      updated_at: 2000,
    });
  });

  it('bumpUseCount increments by 1 + bumps updated_at', () => {
    expect(bumpUseCount(base, () => 2000)).toEqual({
      ...base,
      use_count: 4,
      updated_at: 2000,
    });
  });

  it('rename does NOT touch use_count or exercise pair', () => {
    const renamed = renameReusableSuperset(base, 'Other', () => 2000);
    expect(renamed.use_count).toBe(3);
  });
});

describe('supersetManager — explodeSupersetForTemplate', () => {
  const superset = {
    id: 's-1',
    name: '推拉組',
    color_hex: '#34c759',
    use_count: 5,
    created_at: 0,
    updated_at: 0,
  };

  it('produces parent + child with parent_id linkage', () => {
    let id = 0;
    const idGen = () => `te-${++id}`;
    const rows = explodeSupersetForTemplate({
      superset,
      exercises: [EX_BENCH, EX_ROW],
      template_id: 'tpl-1',
      ordering_start: 3,
      idGen,
    });
    expect(rows).toHaveLength(2);
    const [parent, child] = rows;
    expect(parent.parent_id).toBeNull();
    expect(child.parent_id).toBe(parent.id);
    expect(parent.exercise_id).toBe('ex-bench');
    expect(child.exercise_id).toBe('ex-row');
    expect(parent.ordering).toBe(3);
    expect(child.ordering).toBe(4);
    expect(parent.template_id).toBe('tpl-1');
    expect(child.template_id).toBe('tpl-1');
  });

  it('initialises rows with default section / no sets / null notes+rest', () => {
    const rows = explodeSupersetForTemplate({
      superset,
      exercises: [EX_BENCH, EX_ROW],
      template_id: 'tpl-1',
      ordering_start: 0,
      idGen: () => 'fixed-id',
    });
    for (const r of rows) {
      expect(r.section).toBe('general');
      expect(r.sets).toEqual([]);
      expect(r.notes).toBeNull();
      expect(r.rest_seconds).toBeNull();
    }
  });

  it('carries resolved exercise names onto each row', () => {
    const rows = explodeSupersetForTemplate({
      superset,
      exercises: [EX_BENCH, EX_ROW],
      template_id: 'tpl-1',
      ordering_start: 0,
      idGen: () => 'x',
    });
    expect(rows[0].name).toBe('Bench Press');
    expect(rows[1].name).toBe('Bent-over Row');
  });

  it('does not mutate the source superset (use_count untouched)', () => {
    const before = { ...superset };
    explodeSupersetForTemplate({
      superset,
      exercises: [EX_BENCH, EX_ROW],
      template_id: 'tpl-1',
      ordering_start: 0,
      idGen: () => 'x',
    });
    expect(superset).toEqual(before);
  });
});
