import {
  cloneTemplate,
  templatesEqual,
  computeTemplateDiff,
} from '../../src/domain/template/templateDraft';
import type { Template } from '../../src/domain/template/types';

function buildTemplate(): Template {
  return {
    id: 'tpl-1',
    name: 'Push',
    color_hex: '#FF0000',
    exercises: [
      {
        id: 'ex-1',
        template_id: 'tpl-1',
        exercise_id: 'bench',
        ordering: 0,
        section: 'general',
        parent_id: null,
        notes: null,
        rest_seconds: 90,
        reusable_superset_id: null,
        sets: [
          {
            id: 's1',
            position: 0,
            kind: 'working',
            reps: 8,
            weight: 80,
            parent_set_id: null,
            notes: null,
          },
          {
            id: 's2',
            position: 1,
            kind: 'working',
            reps: 6,
            weight: 85,
            parent_set_id: null,
            notes: null,
          },
        ],
      },
    ],
  };
}

describe('templateDraft — cloneTemplate', () => {
  it('produces a deep clone (mutating clone leaves source intact)', () => {
    const src = buildTemplate();
    const clone = cloneTemplate(src);
    clone.name = 'Mutated';
    clone.exercises[0].sets[0].reps = 999;
    clone.exercises.push({
      id: 'ex-2',
      template_id: 'tpl-1',
      exercise_id: 'row',
      ordering: 1,
      section: 'general',
      parent_id: null,
      notes: null,
      rest_seconds: null,
      reusable_superset_id: null,
      sets: [],
    });
    expect(src.name).toBe('Push');
    expect(src.exercises[0].sets[0].reps).toBe(8);
    expect(src.exercises).toHaveLength(1);
  });
});

describe('templateDraft — templatesEqual', () => {
  it('returns true on identical content', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    expect(templatesEqual(a, b)).toBe(true);
  });

  it('catches name + color_hex differences', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.name = 'Pull';
    expect(templatesEqual(a, b)).toBe(false);
    const c = cloneTemplate(a);
    c.color_hex = '#00FF00';
    expect(templatesEqual(a, c)).toBe(false);
  });

  it('catches a single-set reps/weight edit', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises[0].sets[0].reps = 7;
    expect(templatesEqual(a, b)).toBe(false);
  });

  it('catches set additions and removals', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises[0].sets.push({
      id: 's3',
      position: 2,
      kind: 'working',
      reps: 4,
      weight: 90,
      parent_set_id: null,
      notes: null,
    });
    expect(templatesEqual(a, b)).toBe(false);
  });

  it('catches notes / rest_seconds changes', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises[0].notes = 'focus on form';
    expect(templatesEqual(a, b)).toBe(false);
    const c = cloneTemplate(a);
    c.exercises[0].rest_seconds = 120;
    expect(templatesEqual(a, c)).toBe(false);
  });

  it('treats null and missing-equivalent fields as equal', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    a.exercises[0].sets[0].notes = null;
    b.exercises[0].sets[0].notes = null;
    expect(templatesEqual(a, b)).toBe(true);
  });
});

describe('templateDraft — computeTemplateDiff', () => {
  it('captures template-level rename + recolor as templatePatch', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.name = 'Pull';
    d.color_hex = '#00FF00';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.templatePatch).toEqual({ name: 'Pull', color_hex: '#00FF00' });
  });

  it('captures set-level patches as setUpdates', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].reps = 7;
    d.exercises[0].sets[1].weight = 90;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([
      { id: 's1', reps: 7 },
      { id: 's2', weight: 90 },
    ]);
    expect(diff.setInserts).toEqual([]);
    expect(diff.setDeletes).toEqual([]);
  });

  it('emits setInserts for new draft sets', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets.push({
      id: 's3',
      position: 2,
      kind: 'working',
      reps: 4,
      weight: 90,
      parent_set_id: null,
      notes: null,
    });
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setInserts).toEqual([
      {
        id: 's3',
        template_exercise_id: 'ex-1',
        position: 2,
        kind: 'working',
        reps: 4,
        weight: 90,
        parent_set_id: null,
        notes: null,
      },
    ]);
  });

  it('emits setDeletes for removed sets', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets = d.exercises[0].sets.filter((s) => s.id !== 's2');
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setDeletes).toEqual(['s2']);
  });

  it('skips explicit setDeletes for sets cascaded with a deleted exercise', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises = [];
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseDeletes).toEqual(['ex-1']);
    expect(diff.setDeletes).toEqual([]); // CASCADE in DB handles them
  });

  it('emits an exerciseInsert for a brand-new exercise', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises.push({
      id: 'ex-2',
      template_id: 'tpl-1',
      exercise_id: 'row',
      ordering: 1,
      section: 'general',
      parent_id: null,
      notes: null,
      rest_seconds: null,
      reusable_superset_id: null,
      sets: [
        {
          id: 'sN',
          position: 0,
          kind: 'working',
          reps: 10,
          weight: 50,
          parent_set_id: null,
          notes: null,
        },
      ],
    });
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseInserts).toEqual([
      {
        id: 'ex-2',
        template_id: 'tpl-1',
        exercise_id: 'row',
        ordering: 1,
        section: 'general',
        parent_id: null,
        notes: null,
        rest_seconds: null,
        reusable_superset_id: null,
      },
    ]);
    expect(diff.setInserts).toEqual([
      {
        id: 'sN',
        template_exercise_id: 'ex-2',
        position: 0,
        kind: 'working',
        reps: 10,
        weight: 50,
        parent_set_id: null,
        notes: null,
      },
    ]);
  });
});
