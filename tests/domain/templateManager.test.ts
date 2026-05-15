import {
  snapshotForSession,
  validateTemplate,
  type TemplateData,
} from '../../src/domain/template/templateManager';

/**
 * Unit tests for Module #5 Template Manager.
 *
 * Snapshot isolation here is structural: a Template's exercise array is
 * copied into independent Session-side rows. Behavioural isolation (Template
 * edits don't change past Sessions) is exercised in the DB integration tests
 * — this file tests the pure transformation contract.
 */

describe('Template Manager — pure logic', () => {
  describe('validateTemplate', () => {
    const baseValid: TemplateData = {
      id: 'tpl-1',
      name: 'Push day',
      exercises: [
        {
          exercise_id: 'ex-1',
          ordering: 1,
          default_sets: 3,
          default_reps: 10,
          default_weight_kg: 60,
          is_evergreen: 0,
        },
      ],
    };

    it('accepts a valid template', () => {
      expect(validateTemplate(baseValid)).toBeNull();
    });

    it('accepts a template with no exercises (stub)', () => {
      expect(validateTemplate({ ...baseValid, exercises: [] })).toBeNull();
    });

    it('accepts null reps and null weight', () => {
      expect(
        validateTemplate({
          ...baseValid,
          exercises: [
            {
              exercise_id: 'ex-1',
              ordering: 1,
              default_sets: 3,
              default_reps: null,
              default_weight_kg: null,
              is_evergreen: 0,
            },
          ],
        })
      ).toBeNull();
    });

    it('rejects empty id', () => {
      expect(validateTemplate({ ...baseValid, id: '' })).toMatch(/id is required/);
    });

    it('rejects empty name', () => {
      expect(validateTemplate({ ...baseValid, name: '' })).toMatch(/name cannot be empty/);
      expect(validateTemplate({ ...baseValid, name: '   ' })).toMatch(/name cannot be empty/);
    });

    it('rejects negative sets', () => {
      expect(
        validateTemplate({
          ...baseValid,
          exercises: [{ ...baseValid.exercises[0], default_sets: -1 }],
        })
      ).toMatch(/default_sets/);
    });

    it('rejects negative reps when set', () => {
      expect(
        validateTemplate({
          ...baseValid,
          exercises: [{ ...baseValid.exercises[0], default_reps: -5 }],
        })
      ).toMatch(/default_reps/);
    });

    it('rejects negative weight when set', () => {
      expect(
        validateTemplate({
          ...baseValid,
          exercises: [{ ...baseValid.exercises[0], default_weight_kg: -10 }],
        })
      ).toMatch(/default_weight_kg/);
    });

    it('rejects missing exercise_id in a row', () => {
      expect(
        validateTemplate({
          ...baseValid,
          exercises: [{ ...baseValid.exercises[0], exercise_id: '' }],
        })
      ).toMatch(/Exercise id is required/);
    });
  });

  describe('snapshotForSession', () => {
    // Factory so tests can't pollute each other through a shared reference.
    const buildTemplate = (): TemplateData => ({
      id: 'tpl-1',
      name: 'Push day',
      exercises: [
        {
          exercise_id: 'bench',
          ordering: 1,
          default_sets: 3,
          default_reps: 10,
          default_weight_kg: 60,
          is_evergreen: 0,
        },
        {
          exercise_id: 'ohp',
          ordering: 2,
          default_sets: 4,
          default_reps: 8,
          default_weight_kg: 40,
          is_evergreen: 0,
        },
      ],
    });

    it('produces one row per template exercise, in order', () => {
      let n = 0;
      const uuid = () => `snap-${++n}`;
      const rows = snapshotForSession({
        template: buildTemplate(),
        session_id: 'sess-1',
        uuid,
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.exercise_id)).toEqual(['bench', 'ohp']);
      expect(rows.map((r) => r.ordering)).toEqual([1, 2]);
    });

    it('re-indexes ordering 1..N regardless of source ordering values', () => {
      const sparse: TemplateData = {
        id: 'tpl-1',
        name: 't',
        exercises: [
          { exercise_id: 'a', ordering: 5, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
          { exercise_id: 'b', ordering: 17, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
          { exercise_id: 'c', ordering: 99, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
        ],
      };
      const rows = snapshotForSession({
        template: sparse,
        session_id: 's',
        uuid: () => 'x',
      });
      expect(rows.map((r) => r.ordering)).toEqual([1, 2, 3]);
    });

    it('sorts by source ordering before re-indexing', () => {
      const scrambled: TemplateData = {
        id: 'tpl-1',
        name: 't',
        exercises: [
          { exercise_id: 'b', ordering: 2, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
          { exercise_id: 'a', ordering: 1, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
          { exercise_id: 'c', ordering: 3, default_sets: 1, default_reps: null, default_weight_kg: null, is_evergreen: 0 },
        ],
      };
      const rows = snapshotForSession({
        template: scrambled,
        session_id: 's',
        uuid: () => 'x',
      });
      expect(rows.map((r) => r.exercise_id)).toEqual(['a', 'b', 'c']);
    });

    it('copies planned_sets/reps/weight verbatim from template defaults', () => {
      const rows = snapshotForSession({
        template: buildTemplate(),
        session_id: 's',
        uuid: () => 'x',
      });
      expect(rows[0]).toMatchObject({
        exercise_id: 'bench',
        planned_sets: 3,
        planned_reps: 10,
        planned_weight_kg: 60,
        template_id: 'tpl-1',
      });
    });

    it('mutating the source template after snapshot does not change snapshot rows', () => {
      const template = buildTemplate();
      const rows = snapshotForSession({
        template,
        session_id: 's',
        uuid: () => 'x',
      });
      // Direct mutation to prove we copied (not aliased) the array.
      template.exercises[0].default_sets = 999;
      template.exercises.push({
        exercise_id: 'late',
        ordering: 3,
        default_sets: 5,
        default_reps: null,
        default_weight_kg: null,
        is_evergreen: 0,
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].planned_sets).toBe(3);
    });

    it('uses injected uuid for each row', () => {
      let n = 0;
      const uuid = () => `id-${++n}`;
      const rows = snapshotForSession({
        template: buildTemplate(),
        session_id: 's',
        uuid,
      });
      expect(rows.map((r) => r.id)).toEqual(['id-1', 'id-2']);
    });

    it('all rows share the given session_id', () => {
      const rows = snapshotForSession({
        template: buildTemplate(),
        session_id: 'session-X',
        uuid: () => 'x',
      });
      expect(rows.every((r) => r.session_id === 'session-X')).toBe(true);
    });

    it('propagates is_evergreen from each TemplateExerciseSpec into the snapshot', () => {
      const tpl: TemplateData = {
        id: 'tpl-1',
        name: 'Mixed',
        exercises: [
          { exercise_id: 'main', ordering: 1, default_sets: 5, default_reps: 5, default_weight_kg: 80, is_evergreen: 0 },
          { exercise_id: 'finisher', ordering: 2, default_sets: 3, default_reps: 12, default_weight_kg: 30, is_evergreen: 1 },
        ],
      };
      const rows = snapshotForSession({ template: tpl, session_id: 's', uuid: () => 'x' });
      expect(rows.map((r) => [r.exercise_id, r.is_evergreen])).toEqual([
        ['main', 0],
        ['finisher', 1],
      ]);
    });

    it('returns an empty array for a template with no exercises', () => {
      const empty: TemplateData = { id: 't', name: 'Empty', exercises: [] };
      const rows = snapshotForSession({
        template: empty,
        session_id: 's',
        uuid: () => 'x',
      });
      expect(rows).toEqual([]);
    });

    // ─────────────────────────────────────────────────────────────────────
    // ADR-0018 v014 — cluster identity propagation (parent_id + rs_id)
    // ─────────────────────────────────────────────────────────────────────

    it('copies reusable_superset_id verbatim from each TemplateExerciseSpec (no remap)', () => {
      const tpl: TemplateData = {
        id: 'tpl-1',
        name: 'Push',
        exercises: [
          {
            id: 'te-bench',
            exercise_id: 'bench',
            ordering: 1,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 80,
            is_evergreen: 0,
            parent_id: null,
            reusable_superset_id: 's1',
          },
          {
            id: 'te-row',
            exercise_id: 'row',
            ordering: 2,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 40,
            is_evergreen: 0,
            parent_id: 'te-bench',
            reusable_superset_id: 's1',
          },
          {
            id: 'te-solo',
            exercise_id: 'lateral',
            ordering: 3,
            default_sets: 3,
            default_reps: 12,
            default_weight_kg: 10,
            is_evergreen: 0,
            parent_id: null,
            reusable_superset_id: null,
          },
        ],
      };
      let n = 0;
      const rows = snapshotForSession({
        template: tpl,
        session_id: 'ses-1',
        uuid: () => `se-${++n}`,
      });
      expect(rows.map((r) => r.reusable_superset_id)).toEqual([
        's1',
        's1',
        null,
      ]);
    });

    it('remaps parent_id from template_exercise.id to the new session_exercise.id (2-pass)', () => {
      const tpl: TemplateData = {
        id: 'tpl-1',
        name: 'Push',
        exercises: [
          {
            id: 'te-bench',
            exercise_id: 'bench',
            ordering: 1,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 80,
            is_evergreen: 0,
            parent_id: null,
            reusable_superset_id: 's1',
          },
          {
            id: 'te-row',
            exercise_id: 'row',
            ordering: 2,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 40,
            is_evergreen: 0,
            parent_id: 'te-bench',
            reusable_superset_id: 's1',
          },
        ],
      };
      let n = 0;
      const rows = snapshotForSession({
        template: tpl,
        session_id: 'ses-1',
        uuid: () => `se-${++n}`,
      });
      // First row is the cluster parent — its own id is 'se-1'; parent_id stays null
      expect(rows[0].id).toBe('se-1');
      expect(rows[0].parent_id).toBeNull();
      // Second row is the child — parent_id remapped from 'te-bench' to 'se-1'
      expect(rows[1].id).toBe('se-2');
      expect(rows[1].parent_id).toBe('se-1');
    });

    it('throws on dangling parent_id (refers to an id not in the template)', () => {
      const tpl: TemplateData = {
        id: 'tpl-broken',
        name: 'Broken',
        exercises: [
          {
            id: 'te-row',
            exercise_id: 'row',
            ordering: 1,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 40,
            is_evergreen: 0,
            parent_id: 'te-bench-missing',
            reusable_superset_id: 's1',
          },
        ],
      };
      expect(() =>
        snapshotForSession({
          template: tpl,
          session_id: 'ses-1',
          uuid: () => 'se-1',
        })
      ).toThrow(/dangling parent_id/);
    });

    it('preserves the solo-only test fixture behavior (no cluster fields → parent_id stays null, rs_id stays null)', () => {
      // Older test fixtures that don't carry id / parent_id / rs_id must still
      // produce snapshots with parent_id = null + rs_id = null (no throw).
      const rows = snapshotForSession({
        template: buildTemplate(),
        session_id: 's',
        uuid: () => 'x',
      });
      expect(rows.every((r) => r.parent_id === null)).toBe(true);
      expect(rows.every((r) => r.reusable_superset_id === null)).toBe(true);
    });
  });
});
