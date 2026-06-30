/**
 * Coverage for `remapDraftBody` in `src/domain/template/templateDraft.ts`
 * (lines 49-72) — the 另存模板 / 另存強度 deep-clone-with-fresh-ids helper
 * (2026-06-04 template-editor redesign). It materialises the CURRENT in-memory
 * body into a DIFFERENT template without aliasing the source, remapping the
 * `parent_id` (superset cluster) and `parent_set_id` (dropset chain) linkages
 * through fresh id maps so the structure survives the copy.
 *
 * This function had NO existing test (templateDraft.test.ts imports only
 * cloneTemplate / templatesEqual / computeTemplateDiff). These characterization
 * tests pin: fresh ids, template_id re-point, intra-tree linkage remap, source
 * non-aliasing, and the dangling-pointer `?? null` fallback.
 */
import { remapDraftBody } from '../../src/domain/template/templateDraft';
import type { TemplateExercise } from '../../src/domain/template/types';

/** Deterministic id stub — `new-1`, `new-2`, ... in call order. */
function seqUuid(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

function mkEx(
  id: string,
  opts: { parent_id?: string | null; sets?: TemplateExercise['sets'] } = {},
): TemplateExercise {
  return {
    id,
    template_id: 'src-tpl',
    exercise_id: `lib-${id}`,
    ordering: 0,
    section: 'general',
    parent_id: opts.parent_id ?? null,
    notes: null,
    rest_seconds: 90,
    reusable_superset_id: null,
    sets: opts.sets ?? [
      {
        id: `${id}-s1`,
        position: 0,
        kind: 'working',
        reps: 8,
        weight: 80,
        parent_set_id: null,
        notes: null,
      },
    ],
  };
}

describe('remapDraftBody', () => {
  it('assigns fresh ids and re-points template_id, keeping order', () => {
    const out = remapDraftBody([mkEx('ex-1'), mkEx('ex-2')], 'dst-tpl', seqUuid());

    expect(out).toHaveLength(2);
    // Exercise ids are minted first (one per exercise) before set ids per the
    // pre-pass loop, so ex ids are new-1 / new-2.
    expect(out[0].id).not.toBe('ex-1');
    expect(out[1].id).not.toBe('ex-2');
    expect(out[0].id).not.toBe(out[1].id);
    expect(out.every((e) => e.template_id === 'dst-tpl')).toBe(true);
    // exercise_id (library FK) is preserved — only the row id is new.
    expect(out[0].exercise_id).toBe('lib-ex-1');
    expect(out[1].exercise_id).toBe('lib-ex-2');
  });

  it('mints fresh set ids and re-parents sets to the new exercise', () => {
    const out = remapDraftBody([mkEx('ex-1')], 'dst', seqUuid());
    const ex = out[0];
    expect(ex.sets).toHaveLength(1);
    expect(ex.sets[0].id).not.toBe('ex-1-s1');
    // template_exercise_id linkage on a set is structural via parent_set_id only
    // here; the set keeps its own field values.
    expect(ex.sets[0].reps).toBe(8);
    expect(ex.sets[0].weight).toBe(80);
  });

  it('remaps a superset parent_id to the cloned parent exercise id', () => {
    const parent = mkEx('p');
    const child = mkEx('c', { parent_id: 'p' });
    const out = remapDraftBody([parent, child], 'dst', seqUuid());

    const clonedParent = out[0];
    const clonedChild = out[1];
    // The child's parent_id now points at the CLONED parent's new id, not 'p'.
    expect(clonedChild.parent_id).toBe(clonedParent.id);
    expect(clonedChild.parent_id).not.toBe('p');
  });

  it('remaps a dropset parent_set_id within the same exercise', () => {
    const ex = mkEx('ex-1', {
      sets: [
        {
          id: 'head',
          position: 0,
          kind: 'dropset',
          reps: 8,
          weight: 80,
          parent_set_id: null,
          notes: null,
        },
        {
          id: 'follower',
          position: 1,
          kind: 'dropset',
          reps: 6,
          weight: 60,
          parent_set_id: 'head', // points at the head
          notes: null,
        },
      ],
    });
    const out = remapDraftBody([ex], 'dst', seqUuid());
    const [head, follower] = out[0].sets;

    expect(head.parent_set_id).toBeNull();
    // Follower now points at the head's NEW id, not the stale 'head'.
    expect(follower.parent_set_id).toBe(head.id);
    expect(follower.parent_set_id).not.toBe('head');
  });

  it('does not alias the source (mutating the clone leaves input intact)', () => {
    const src = [mkEx('ex-1')];
    const out = remapDraftBody(src, 'dst', seqUuid());
    out[0].sets[0].reps = 999;
    out[0].ordering = 42;
    expect(src[0].sets[0].reps).toBe(8);
    expect(src[0].ordering).toBe(0);
  });

  it('falls back to null when a parent_id points outside the cloned set (dangling)', () => {
    // child references a parent that is NOT in the exercises passed in → the
    // exIdMap.get(...) ?? null fallback fires.
    const child = mkEx('c', { parent_id: 'ghost-parent' });
    const out = remapDraftBody([child], 'dst', seqUuid());
    expect(out[0].parent_id).toBeNull();
  });

  it('falls back to null when a parent_set_id points outside the exercise (dangling)', () => {
    const ex = mkEx('ex-1', {
      sets: [
        {
          id: 'orphan',
          position: 0,
          kind: 'dropset',
          reps: 6,
          weight: 60,
          parent_set_id: 'ghost-head', // not present in this exercise
          notes: null,
        },
      ],
    });
    const out = remapDraftBody([ex], 'dst', seqUuid());
    expect(out[0].sets[0].parent_set_id).toBeNull();
  });

  it('keeps a null parent_id / parent_set_id as null (no spurious remap)', () => {
    const out = remapDraftBody([mkEx('ex-1')], 'dst', seqUuid());
    expect(out[0].parent_id).toBeNull();
    expect(out[0].sets[0].parent_set_id).toBeNull();
  });

  it('empty input returns an empty array', () => {
    expect(remapDraftBody([], 'dst', seqUuid())).toEqual([]);
  });
});
