import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  attachTemplateToProgram,
  getSessionLinkedTemplateTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * 5/19 polish #43 — Today banner mirror session's linked template during
 * an in-progress session.
 *
 * `getSessionLinkedTemplateTriple(db, session_id)` returns the (template_name,
 * program_name, sub_tag) triple of the session's "linked template" — the most
 * common non-null `session_exercise.template_id` across the session's rows.
 * Tie-break: earliest `ordering`. Returns null for a freestyle session (no
 * non-null template_id) so the caller can render 「空白訓練」.
 */
describe('getSessionLinkedTemplateTriple (5/19 polish #43)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;
  const NOW = 1_700_000_000_000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for a freestyle session (all session_exercise.template_id IS NULL)', async () => {
    await createSession(db, { id: 'sess-free', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-free-1',
      session_id: 'sess-free',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionExercise(db, {
      id: 'se-free-2',
      session_id: 'sess-free',
      exercise_id: squatId,
      ordering: 2,
      planned_sets: 3,
      planned_reps: 5,
      planned_weight_kg: 100,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    const result = await getSessionLinkedTemplateTriple(db, 'sess-free');
    expect(result).toBeNull();
  });

  it('returns the triple for a single template_id linked across all rows', async () => {
    await createProgram(db, {
      program: {
        id: 'prog-1',
        name: '增肌-Q1',
        main_tag: '增肌',
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-push', name: 'Push Day', now: () => NOW });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-push',
      program_id: 'prog-1',
      sub_tag: '5x5',
    });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-1',
      session_id: 'sess-1',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: 'tpl-push',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    const result = await getSessionLinkedTemplateTriple(db, 'sess-1');
    expect(result).toEqual({
      template_id: 'tpl-push',
      template_name: 'Push Day',
      program_id: 'prog-1',
      program_name: '增肌-Q1',
      sub_tag: '5x5',
    });
  });

  it('returns the shared template triple when multiple rows share the same template_id', async () => {
    await createProgram(db, {
      program: {
        id: 'prog-2',
        name: 'Smoke',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-smoke', name: 'Smoke Day', now: () => NOW });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-smoke',
      program_id: 'prog-2',
      sub_tag: 'TEST-4',
    });
    await createSession(db, { id: 'sess-2', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-a',
      session_id: 'sess-2',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: 'tpl-smoke',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionExercise(db, {
      id: 'se-b',
      session_id: 'sess-2',
      exercise_id: squatId,
      ordering: 2,
      planned_sets: 4,
      planned_reps: 5,
      planned_weight_kg: 100,
      template_id: 'tpl-smoke',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    const result = await getSessionLinkedTemplateTriple(db, 'sess-2');
    expect(result).toEqual({
      template_id: 'tpl-smoke',
      template_name: 'Smoke Day',
      program_id: 'prog-2',
      program_name: 'Smoke',
      sub_tag: 'TEST-4',
    });
  });

  it('returns the most-common template when rows reference multiple template_ids (e.g. user added from library mid-session)', async () => {
    await createTemplate(db, { id: 'tpl-major', name: 'Major', now: () => NOW });
    await createTemplate(db, { id: 'tpl-minor', name: 'Minor', now: () => NOW + 1 });
    await createSession(db, { id: 'sess-mix', started_at: NOW });
    // Two rows pointing at tpl-major, one at tpl-minor — tpl-major wins.
    await insertSessionExercise(db, {
      id: 'se-m1',
      session_id: 'sess-mix',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: 'tpl-major',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionExercise(db, {
      id: 'se-m2',
      session_id: 'sess-mix',
      exercise_id: squatId,
      ordering: 2,
      planned_sets: 3,
      planned_reps: 5,
      planned_weight_kg: 100,
      template_id: 'tpl-major',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionExercise(db, {
      id: 'se-m3',
      session_id: 'sess-mix',
      exercise_id: benchId,
      ordering: 3,
      planned_sets: 2,
      planned_reps: 10,
      planned_weight_kg: 50,
      template_id: 'tpl-minor',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    const result = await getSessionLinkedTemplateTriple(db, 'sess-mix');
    expect(result?.template_id).toBe('tpl-major');
    expect(result?.template_name).toBe('Major');
    // Major has no program / sub_tag attached.
    expect(result?.program_id).toBeNull();
    expect(result?.program_name).toBeNull();
    expect(result?.sub_tag).toBeNull();
  });

  it('returns program_name = null when the linked template has program_id IS NULL', async () => {
    // No program attached; template is freestyle but session_exercise IS linked.
    await createTemplate(db, { id: 'tpl-orphan', name: 'Orphan', now: () => NOW });
    // Don't call attachTemplateToProgram — template.program_id stays NULL.
    await createSession(db, { id: 'sess-orphan', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-o',
      session_id: 'sess-orphan',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: 'tpl-orphan',
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    const result = await getSessionLinkedTemplateTriple(db, 'sess-orphan');
    expect(result).toEqual({
      template_id: 'tpl-orphan',
      template_name: 'Orphan',
      program_id: null,
      program_name: null,
      sub_tag: null,
    });
  });
});
