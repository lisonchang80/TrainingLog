import {
  renameSiblings,
  recolorSiblings,
  flipExerciseSectionInTemplate,
} from '../../src/domain/template/templateSiblings';
import type { Template } from '../../src/domain/template/types';

function tpl(over: Partial<Template> & { id: string; name: string }): Template {
  return {
    color_hex: '#FF0000',
    exercises: [],
    ...over,
  };
}

describe('templateSiblings — renameSiblings', () => {
  it('renames every template whose name matches oldName', () => {
    const ts = [
      tpl({ id: 't1', name: 'Push' }),
      tpl({ id: 't2', name: 'Push' }),
      tpl({ id: 't3', name: 'Pull' }),
    ];
    const out = renameSiblings({ templates: ts, oldName: 'Push', newName: 'Push A' });
    expect(out.map((t) => t.name)).toEqual(['Push A', 'Push A', 'Pull']);
  });

  it('returns the same array reference when oldName === newName', () => {
    const ts = [tpl({ id: 't1', name: 'Push' })];
    expect(renameSiblings({ templates: ts, oldName: 'Push', newName: 'Push' })).toBe(ts);
  });

  it('is a no-op when no template matches oldName', () => {
    const ts = [tpl({ id: 't1', name: 'Pull' })];
    const out = renameSiblings({ templates: ts, oldName: 'Push', newName: 'Push A' });
    expect(out).toEqual(ts);
  });
});

describe('templateSiblings — recolorSiblings', () => {
  it('recolors every template whose name matches', () => {
    const ts = [
      tpl({ id: 't1', name: 'Push', color_hex: '#FF0000' }),
      tpl({ id: 't2', name: 'Push', color_hex: '#FF0000' }),
      tpl({ id: 't3', name: 'Pull', color_hex: '#00FF00' }),
    ];
    const out = recolorSiblings({ templates: ts, name: 'Push', color_hex: '#0000FF' });
    expect(out.map((t) => t.color_hex)).toEqual(['#0000FF', '#0000FF', '#00FF00']);
  });

  it('accepts empty color_hex (unset / hash fallback)', () => {
    const ts = [tpl({ id: 't1', name: 'Push', color_hex: '#FF0000' })];
    const out = recolorSiblings({ templates: ts, name: 'Push', color_hex: '' });
    expect(out[0].color_hex).toBe('');
  });
});

describe('templateSiblings — flipExerciseSectionInTemplate', () => {
  function buildTemplateWithSuperset(): Template {
    return {
      id: 't1',
      name: 'Push',
      color_hex: '#FF0000',
      exercises: [
        {
          id: 'plain',
          template_id: 't1',
          exercise_id: 'bench',
          ordering: 0,
          section: 'general',
          parent_id: null,
          notes: null,
          rest_seconds: null,
          sets: [],
        },
        {
          id: 'ss-parent',
          template_id: 't1',
          exercise_id: 'curl',
          ordering: 1,
          section: 'general',
          parent_id: null,
          notes: null,
          rest_seconds: null,
          sets: [],
        },
        {
          id: 'ss-child-1',
          template_id: 't1',
          exercise_id: 'tricep',
          ordering: 2,
          section: 'general',
          parent_id: 'ss-parent',
          notes: null,
          rest_seconds: null,
          sets: [],
        },
        {
          id: 'ss-child-2',
          template_id: 't1',
          exercise_id: 'lateral',
          ordering: 3,
          section: 'general',
          parent_id: 'ss-parent',
          notes: null,
          rest_seconds: null,
          sets: [],
        },
      ],
    };
  }

  it('flips a plain exercise without touching others', () => {
    const t = buildTemplateWithSuperset();
    const out = flipExerciseSectionInTemplate({
      template: t,
      exercise_id: 'plain',
      section: 'evergreen',
    });
    const byId = Object.fromEntries(out.exercises.map((e) => [e.id, e.section]));
    expect(byId).toEqual({
      plain: 'evergreen',
      'ss-parent': 'general',
      'ss-child-1': 'general',
      'ss-child-2': 'general',
    });
  });

  it('flipping a superset parent cascades to all its children', () => {
    const t = buildTemplateWithSuperset();
    const out = flipExerciseSectionInTemplate({
      template: t,
      exercise_id: 'ss-parent',
      section: 'evergreen',
    });
    const byId = Object.fromEntries(out.exercises.map((e) => [e.id, e.section]));
    expect(byId).toEqual({
      plain: 'general',
      'ss-parent': 'evergreen',
      'ss-child-1': 'evergreen',
      'ss-child-2': 'evergreen',
    });
  });

  it('flipping a superset child also flips parent + all siblings', () => {
    const t = buildTemplateWithSuperset();
    const out = flipExerciseSectionInTemplate({
      template: t,
      exercise_id: 'ss-child-1',
      section: 'evergreen',
    });
    const byId = Object.fromEntries(out.exercises.map((e) => [e.id, e.section]));
    expect(byId).toEqual({
      plain: 'general',
      'ss-parent': 'evergreen',
      'ss-child-1': 'evergreen',
      'ss-child-2': 'evergreen',
    });
  });

  it('returns the same reference when nothing changes', () => {
    const t = buildTemplateWithSuperset();
    const out = flipExerciseSectionInTemplate({
      template: t,
      exercise_id: 'plain',
      section: 'general',
    });
    expect(out).toBe(t);
  });

  it('returns the original template when exercise_id is not found', () => {
    const t = buildTemplateWithSuperset();
    const out = flipExerciseSectionInTemplate({
      template: t,
      exercise_id: 'ghost',
      section: 'evergreen',
    });
    expect(out).toBe(t);
  });
});
