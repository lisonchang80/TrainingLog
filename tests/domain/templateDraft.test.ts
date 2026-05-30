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

  it('catches exercise count mismatch (added exercise)', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises.push({
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
    expect(templatesEqual(a, b)).toBe(false);
  });

  it('catches an exercise-level rest_seconds change via templatesEqual', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises[0].rest_seconds = 999;
    expect(templatesEqual(a, b)).toBe(false);
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

  it('emits per-field exercise updates for each mutable field', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].ordering = 5;
    d.exercises[0].section = 'evergreen';
    d.exercises[0].parent_id = 'parent-ex';
    d.exercises[0].notes = 'cue';
    d.exercises[0].rest_seconds = 120;
    d.exercises[0].reusable_superset_id = 'rs-1';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([
      {
        id: 'ex-1',
        ordering: 5,
        section: 'evergreen',
        parent_id: 'parent-ex',
        notes: 'cue',
        rest_seconds: 120,
        reusable_superset_id: 'rs-1',
      },
    ]);
    // No structural inserts/deletes for an in-place field edit.
    expect(diff.exerciseInserts).toEqual([]);
    expect(diff.exerciseDeletes).toEqual([]);
    expect(diff.setUpdates).toEqual([]);
  });

  it('emits a minimal exerciseUpdate when only one field changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].rest_seconds = 60;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    // Only the changed field (plus id) appears — no spurious keys.
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', rest_seconds: 60 }]);
  });

  it('treats nullable exercise fields going null→null as no change', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    // parent_id / notes are already null on both; reassign explicitly.
    d.exercises[0].parent_id = null;
    d.exercises[0].notes = null;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([]);
    expect(diff.templatePatch).toBeNull();
  });

  it('emits per-field set updates for kind / position / parent_set_id / notes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].position = 9;
    d.exercises[0].sets[0].kind = 'dropset';
    d.exercises[0].sets[0].parent_set_id = 's2';
    d.exercises[0].sets[0].notes = 'failure';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([
      {
        id: 's1',
        position: 9,
        kind: 'dropset',
        parent_set_id: 's2',
        notes: 'failure',
      },
    ]);
  });

  it('produces an empty diff (null patch, empty lists) for an unchanged clone', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff).toEqual({
      templatePatch: null,
      exerciseInserts: [],
      exerciseUpdates: [],
      exerciseDeletes: [],
      setInserts: [],
      setUpdates: [],
      setDeletes: [],
    });
  });

  it('captures only color_hex when name is unchanged', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.color_hex = '#123456';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.templatePatch).toEqual({ color_hex: '#123456' });
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

describe('templateDraft — exercisesEqual short-circuits', () => {
  it('catches a different exercise-list length', () => {
    const a = buildTemplate();
    const b = cloneTemplate(a);
    b.exercises.push({
      id: 'ex-extra',
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
    expect(templatesEqual(a, b)).toBe(false);
  });

  it('catches an exercise_id / ordering / section change in place', () => {
    const a = buildTemplate();

    const swapped = cloneTemplate(a);
    swapped.exercises[0].exercise_id = 'squat';
    expect(templatesEqual(a, swapped)).toBe(false);

    const reordered = cloneTemplate(a);
    reordered.exercises[0].ordering = 9;
    expect(templatesEqual(a, reordered)).toBe(false);

    const resectioned = cloneTemplate(a);
    resectioned.exercises[0].section = 'evergreen';
    expect(templatesEqual(a, resectioned)).toBe(false);
  });
});

describe('templateDraft — computeTemplateDiff per-field exercise updates', () => {
  it('emits only the ordering field when ordering changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].ordering = 3;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', ordering: 3 }]);
    expect(diff.exerciseInserts).toEqual([]);
    expect(diff.exerciseDeletes).toEqual([]);
  });

  it('emits the section field when section changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].section = 'evergreen';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', section: 'evergreen' }]);
  });

  it('emits the parent_id field when parent_id changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].parent_id = 'ex-parent';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', parent_id: 'ex-parent' }]);
  });

  it('emits the notes field when exercise notes change', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].notes = 'focus on form';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', notes: 'focus on form' }]);
  });

  it('emits the rest_seconds field when rest_seconds changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].rest_seconds = 120;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([{ id: 'ex-1', rest_seconds: 120 }]);
  });

  it('emits the reusable_superset_id field when the RS FK changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].reusable_superset_id = 'rs-42';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([
      { id: 'ex-1', reusable_superset_id: 'rs-42' },
    ]);
  });

  it('bundles multiple changed exercise fields into one update patch', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].ordering = 5;
    d.exercises[0].section = 'evergreen';
    d.exercises[0].rest_seconds = 30;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([
      { id: 'ex-1', ordering: 5, section: 'evergreen', rest_seconds: 30 },
    ]);
  });

  it('emits no exercise update when nothing changed on the exercise', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseUpdates).toEqual([]);
  });
});

describe('templateDraft — computeTemplateDiff per-field set updates', () => {
  it('emits the position field when a set is repositioned', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].position = 9;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([{ id: 's1', position: 9 }]);
  });

  it('emits the kind field when a set kind changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].kind = 'warmup';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([{ id: 's1', kind: 'warmup' }]);
  });

  it('emits the parent_set_id field when a dropset chain link changes', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[1].parent_set_id = 's1';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([{ id: 's2', parent_set_id: 's1' }]);
  });

  it('emits the notes field when set notes change', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].notes = 'last rep grind';
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([{ id: 's1', notes: 'last rep grind' }]);
  });

  it('bundles multiple changed set fields into one update patch', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    d.exercises[0].sets[0].position = 4;
    d.exercises[0].sets[0].kind = 'warmup';
    d.exercises[0].sets[0].reps = 12;
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.setUpdates).toEqual([
      { id: 's1', position: 4, kind: 'warmup', reps: 12 },
    ]);
  });
});

describe('templateDraft — computeTemplateDiff CASCADE dedup edge', () => {
  it('drops a set queued for delete when its parent exercise is also deleted', () => {
    const c = buildTemplate();
    // Add a second committed exercise (with a set) that the draft removes.
    c.exercises.push({
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
          id: 's-row',
          position: 0,
          kind: 'working',
          reps: 10,
          weight: 50,
          parent_set_id: null,
          notes: null,
        },
      ],
    });
    const d = cloneTemplate(c);
    d.exercises = d.exercises.filter((e) => e.id !== 'ex-2');
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff.exerciseDeletes).toEqual(['ex-2']);
    // The row set cascades with the parent exercise; no explicit set delete.
    expect(diff.setDeletes).toEqual([]);
  });

  it('returns a fully-empty diff when committed and draft are identical', () => {
    const c = buildTemplate();
    const d = cloneTemplate(c);
    const diff = computeTemplateDiff({ committed: c, draft: d });
    expect(diff).toEqual({
      templatePatch: null,
      exerciseInserts: [],
      exerciseUpdates: [],
      exerciseDeletes: [],
      setInserts: [],
      setUpdates: [],
      setDeletes: [],
    });
  });
});
