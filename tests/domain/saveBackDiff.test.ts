import {
  aggregateActuals,
  computeSaveBackDiff,
  type RawSetRow,
  type SessionPlanRow,
} from '../../src/domain/template/saveBackDiff';

/**
 * Slice 4 — pure-logic Save-back diff. Mirrors the structure of
 * templateManager.test.ts: tests build their own fixtures via factory
 * functions to avoid the cross-test mutation pollution caught in slice 3.
 */

describe('Save-back differential — pure logic', () => {
  const buildPlan = (): SessionPlanRow[] => [
    {
      exercise_id: 'bench',
      ordering: 1,
      planned_sets: 3,
      planned_reps: 10,
      planned_weight_kg: 60,
      is_evergreen: 0,
    },
    {
      exercise_id: 'squat',
      ordering: 2,
      planned_sets: 5,
      planned_reps: 5,
      planned_weight_kg: 100,
      is_evergreen: 0,
    },
  ];

  describe('aggregateActuals', () => {
    it('counts non-skipped sets and reports last set per exercise', () => {
      const sets: RawSetRow[] = [
        { exercise_id: 'bench', weight_kg: 50, reps: 10, is_skipped: 0, ordering: 1 },
        { exercise_id: 'bench', weight_kg: 60, reps: 10, is_skipped: 0, ordering: 2 },
        { exercise_id: 'bench', weight_kg: 65, reps: 8, is_skipped: 0, ordering: 3 },
        { exercise_id: 'squat', weight_kg: 100, reps: 5, is_skipped: 0, ordering: 4 },
      ];
      const out = aggregateActuals(sets);
      expect(out).toEqual([
        { exercise_id: 'bench', setCount: 3, reps: 8, weight_kg: 65 },
        { exercise_id: 'squat', setCount: 1, reps: 5, weight_kg: 100 },
      ]);
    });

    it('drops skipped sets before counting', () => {
      const sets: RawSetRow[] = [
        { exercise_id: 'bench', weight_kg: 60, reps: 10, is_skipped: 0, ordering: 1 },
        { exercise_id: 'bench', weight_kg: 60, reps: 10, is_skipped: 1, ordering: 2 },
      ];
      const out = aggregateActuals(sets);
      expect(out[0].setCount).toBe(1);
    });

    it('returns empty array when no sets', () => {
      expect(aggregateActuals([])).toEqual([]);
    });

    it('preserves first-appearance order, sorted by ordering ascending', () => {
      const sets: RawSetRow[] = [
        { exercise_id: 'b', weight_kg: 0, reps: 1, is_skipped: 0, ordering: 2 },
        { exercise_id: 'a', weight_kg: 0, reps: 1, is_skipped: 0, ordering: 1 },
        { exercise_id: 'b', weight_kg: 0, reps: 1, is_skipped: 0, ordering: 3 },
      ];
      const out = aggregateActuals(sets);
      expect(out.map((x) => x.exercise_id)).toEqual(['a', 'b']);
    });
  });

  describe('computeSaveBackDiff', () => {
    it('emits no changes when actual matches plan exactly', () => {
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 3, reps: 10, weight_kg: 60 },
          { exercise_id: 'squat', setCount: 5, reps: 5, weight_kg: 100 },
        ],
      });
      expect(out).toEqual([]);
    });

    it('emits modify when sets/reps/weight differ', () => {
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 4, reps: 8, weight_kg: 70 },
          { exercise_id: 'squat', setCount: 5, reps: 5, weight_kg: 100 },
        ],
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'modify',
        exercise_id: 'bench',
        is_evergreen: 0,
        planned: { sets: 3, reps: 10, weight_kg: 60 },
        actual: { sets: 4, reps: 8, weight_kg: 70 },
      });
    });

    it('emits remove when a planned exercise was skipped (general zone only)', () => {
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 3, reps: 10, weight_kg: 60 },
        ],
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'remove',
        exercise_id: 'squat',
        is_evergreen: 0,
        planned: { sets: 5, reps: 5, weight_kg: 100 },
      });
    });

    it('SUPPRESSES remove for evergreen entries (ADR-0005 + criterion #4)', () => {
      const evergreenPlan: SessionPlanRow[] = [
        {
          exercise_id: 'finisher',
          ordering: 1,
          planned_sets: 3,
          planned_reps: 15,
          planned_weight_kg: 30,
          is_evergreen: 1,
        },
      ];
      const out = computeSaveBackDiff({
        plan: evergreenPlan,
        actual: [], // user skipped the finisher
      });
      expect(out).toEqual([]);
    });

    it('still allows MODIFY for evergreen entries (only remove is forbidden)', () => {
      const out = computeSaveBackDiff({
        plan: [
          {
            exercise_id: 'finisher',
            ordering: 1,
            planned_sets: 3,
            planned_reps: 15,
            planned_weight_kg: 30,
            is_evergreen: 1,
          },
        ],
        actual: [
          { exercise_id: 'finisher', setCount: 3, reps: 12, weight_kg: 32.5 },
        ],
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'modify',
        is_evergreen: 1,
        actual: { sets: 3, reps: 12, weight_kg: 32.5 },
      });
    });

    it('emits add for an exercise the user did but did NOT plan', () => {
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 3, reps: 10, weight_kg: 60 },
          { exercise_id: 'squat', setCount: 5, reps: 5, weight_kg: 100 },
          { exercise_id: 'pullup', setCount: 4, reps: 8, weight_kg: 0 },
        ],
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'add',
        exercise_id: 'pullup',
        is_evergreen: 0,
        actual: { sets: 4, reps: 8, weight_kg: 0 },
      });
    });

    it('add diff entries are appended after modify/remove ones', () => {
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 5, reps: 5, weight_kg: 80 }, // modify
          // squat skipped → remove
          { exercise_id: 'pullup', setCount: 3, reps: 10, weight_kg: 0 }, // add
        ],
      });
      expect(out.map((c) => [c.type, c.exercise_id])).toEqual([
        ['modify', 'bench'],
        ['remove', 'squat'],
        ['add', 'pullup'],
      ]);
    });

    it('reorder edge case (ADR-0005): same exercises, just logged in a different order — no change', () => {
      // User logged squat first then bench — irrelevant to the diff because
      // matching is by exercise_id, not by row position.
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'squat', setCount: 5, reps: 5, weight_kg: 100 },
          { exercise_id: 'bench', setCount: 3, reps: 10, weight_kg: 60 },
        ],
      });
      expect(out).toEqual([]);
    });

    it('zero-set actual entries are ignored on the add side', () => {
      // Defensive: aggregateActuals never produces these, but if a caller
      // hand-builds the input, we still don't propose adding "0 sets at 0 kg".
      const out = computeSaveBackDiff({
        plan: buildPlan(),
        actual: [
          { exercise_id: 'bench', setCount: 3, reps: 10, weight_kg: 60 },
          { exercise_id: 'squat', setCount: 5, reps: 5, weight_kg: 100 },
          { exercise_id: 'phantom', setCount: 0, reps: null, weight_kg: null },
        ],
      });
      expect(out).toEqual([]);
    });

    it('mixed evergreen + general: modify-evergreen + remove-general + add-new', () => {
      const out = computeSaveBackDiff({
        plan: [
          {
            exercise_id: 'finisher',
            ordering: 1,
            planned_sets: 3,
            planned_reps: 15,
            planned_weight_kg: 30,
            is_evergreen: 1,
          },
          {
            exercise_id: 'bench',
            ordering: 2,
            planned_sets: 3,
            planned_reps: 10,
            planned_weight_kg: 60,
            is_evergreen: 0,
          },
        ],
        actual: [
          { exercise_id: 'finisher', setCount: 3, reps: 12, weight_kg: 35 },
          { exercise_id: 'curl', setCount: 4, reps: 12, weight_kg: 15 },
        ],
      });
      const summary = out.map((c) => ({ type: c.type, ex: c.exercise_id }));
      expect(summary).toEqual([
        { type: 'modify', ex: 'finisher' },
        { type: 'remove', ex: 'bench' },
        { type: 'add', ex: 'curl' },
      ]);
    });
  });
});
