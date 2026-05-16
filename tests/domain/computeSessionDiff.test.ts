import {
  computeSessionDiff,
  type SessionExerciseLite,
  type SessionSetLite,
  type TemplateExerciseLite,
} from '../../src/domain/session/computeSessionDiff';

/**
 * ADR-0019 Q9d — Session-vs-template diff for the Today-tab finish flow.
 *
 * The function is used to decide whether to show the 3-option Save-back
 * dialog (template-based session, has_diff = true) or skip it entirely
 * (template-based session, has_diff = false). 7 diff_kinds covered.
 */

function se(args: Partial<SessionExerciseLite> & { id: string; exercise_id: string }): SessionExerciseLite {
  return {
    rest_sec: null,
    parent_id: null,
    reusable_superset_id: null,
    ...args,
  };
}

function set(
  exercise_id: string,
  reps: number | null,
  weight_kg: number | null,
  is_skipped = 0,
): SessionSetLite {
  return { exercise_id, reps, weight_kg, is_skipped };
}

function tex(args: Partial<TemplateExerciseLite> & { exercise_id: string }): TemplateExerciseLite {
  return {
    planned_sets: 3,
    planned_reps: 10,
    planned_weight_kg: 60,
    rest_sec: null,
    parent_id: null,
    reusable_superset_id: null,
    ...args,
  };
}

describe('computeSessionDiff', () => {
  it('matching plan + sets → no diff', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1' })] },
    });
    expect(out.has_diff).toBe(false);
    expect(out.diff_kinds).toEqual([]);
  });

  it('user added an ad-hoc exercise → add_exercise', () => {
    const out = computeSessionDiff({
      sessionExercises: [
        se({ id: 'se1', exercise_id: 'ex1' }),
        se({ id: 'se2', exercise_id: 'ex_new' }),
      ],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1' })] },
    });
    expect(out.has_diff).toBe(true);
    expect(out.diff_kinds).toContain('add_exercise');
  });

  it('user deleted a planned exercise → delete_exercise', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
      ],
      template: {
        exercises: [
          tex({ exercise_id: 'ex1' }),
          tex({ exercise_id: 'ex_dropped' }),
        ],
      },
    });
    expect(out.has_diff).toBe(true);
    expect(out.diff_kinds).toContain('delete_exercise');
  });

  it('set count differs → sets', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      // template plans 3 but user only did 2
      sessionSets: [set('ex1', 10, 60), set('ex1', 10, 60)],
      template: { exercises: [tex({ exercise_id: 'ex1', planned_sets: 3 })] },
    });
    expect(out.diff_kinds).toContain('sets');
  });

  it('reps differ on any set → reps', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 8, 60), // ← off-plan reps
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1' })] },
    });
    expect(out.diff_kinds).toContain('reps');
  });

  it('weight differs on any set → weight', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 65), // ← off-plan weight
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1' })] },
    });
    expect(out.diff_kinds).toContain('weight');
  });

  it('rest_sec differs (NULL vs 90) → rest_sec', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1', rest_sec: 90 })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1', rest_sec: null })] },
    });
    expect(out.diff_kinds).toContain('rest_sec');
  });

  it('rest_sec NULL vs NULL → no rest_sec diff', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1', rest_sec: null })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
      ],
      template: { exercises: [tex({ exercise_id: 'ex1', rest_sec: null })] },
    });
    expect(out.diff_kinds).not.toContain('rest_sec');
  });

  it('cluster newly formed in session → cluster', () => {
    const out = computeSessionDiff({
      sessionExercises: [
        se({ id: 'se1', exercise_id: 'ex1' }),
        // session-side: child with parent_id pointing at parent
        se({
          id: 'se2',
          exercise_id: 'ex2',
          parent_id: 'se1',
          reusable_superset_id: 'rs1',
        }),
      ],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
      ],
      template: {
        exercises: [
          tex({ exercise_id: 'ex1' }),
          tex({ exercise_id: 'ex2' }), // ← solo in template
        ],
      },
    });
    expect(out.diff_kinds).toContain('cluster');
  });

  it('cluster present in both template and session (same rs_id) → no cluster diff', () => {
    const out = computeSessionDiff({
      sessionExercises: [
        se({
          id: 'se1',
          exercise_id: 'ex1',
          reusable_superset_id: 'rs1',
        }),
        se({
          id: 'se2',
          exercise_id: 'ex2',
          parent_id: 'se1',
          reusable_superset_id: 'rs1',
        }),
      ],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
      ],
      template: {
        exercises: [
          tex({
            exercise_id: 'ex1',
            reusable_superset_id: 'rs1',
          }),
          tex({
            exercise_id: 'ex2',
            parent_id: 'te1',
            reusable_superset_id: 'rs1',
          }),
        ],
      },
    });
    expect(out.diff_kinds).not.toContain('cluster');
  });

  it('cluster swapped to different rs_id → cluster', () => {
    const out = computeSessionDiff({
      sessionExercises: [
        se({ id: 'se1', exercise_id: 'ex1', reusable_superset_id: 'rs2' }),
        se({
          id: 'se2',
          exercise_id: 'ex2',
          parent_id: 'se1',
          reusable_superset_id: 'rs2',
        }),
      ],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
        set('ex2', 10, 60),
      ],
      template: {
        exercises: [
          tex({ exercise_id: 'ex1', reusable_superset_id: 'rs1' }),
          tex({
            exercise_id: 'ex2',
            parent_id: 'te1',
            reusable_superset_id: 'rs1',
          }),
        ],
      },
    });
    expect(out.diff_kinds).toContain('cluster');
  });

  it('multiple diffs accumulate in stable order', () => {
    const out = computeSessionDiff({
      sessionExercises: [
        se({ id: 'se1', exercise_id: 'ex1', rest_sec: 90 }),
        se({ id: 'se_added', exercise_id: 'ex_new' }),
      ],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 12, 65), // reps + weight diff
        // only 2 sets vs plan 3
        set('ex_new', 8, 50),
      ],
      template: {
        exercises: [
          tex({ exercise_id: 'ex1', planned_sets: 3, rest_sec: 60 }),
          tex({ exercise_id: 'ex_dropped' }), // delete
        ],
      },
    });
    expect(out.has_diff).toBe(true);
    // Stable order from DiffKind union declaration
    expect(out.diff_kinds).toEqual([
      'add_exercise',
      'delete_exercise',
      'sets',
      'reps',
      'weight',
      'rest_sec',
    ]);
  });

  it('is_skipped sets do NOT count toward set-count diff', () => {
    const out = computeSessionDiff({
      sessionExercises: [se({ id: 'se1', exercise_id: 'ex1' })],
      sessionSets: [
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60),
        set('ex1', 10, 60, 1), // skipped — excluded
      ],
      template: { exercises: [tex({ exercise_id: 'ex1', planned_sets: 3 })] },
    });
    expect(out.diff_kinds).not.toContain('sets');
    expect(out.has_diff).toBe(false);
  });
});
