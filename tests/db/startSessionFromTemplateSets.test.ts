/**
 * Tests for the #51 set-copy phase of `startSessionFromTemplate`.
 *
 * Pre-existing coverage in `tests/db/templates.test.ts` exercises the session
 * + session_exercise level only (snapshot isolation, planned-count, rest_sec).
 * It does NOT cover the post-2026-05-19 #51 behavior where `template_set`
 * rows are materialised into session set rows directly:
 *
 *   - kind / reps / weight / position preserved
 *   - is_logged = 0, is_skipped = 0
 *   - session_exercise_id linkage holds (so #17 isolation queries work)
 *   - parent_set_id remapped from template_set.id space → new session set.id
 *     space (dropset chain heads + followers stay connected after the copy)
 *
 * These tests bolt on that coverage in a separate file so the existing
 * snapshot-isolation suite stays focused.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';

interface SessionSetRow {
  id: string;
  session_id: string;
  exercise_id: string;
  session_exercise_id: string | null;
  weight_kg: number;
  reps: number;
  is_skipped: number;
  is_logged: number;
  ordering: number;
  set_kind: 'warmup' | 'working' | 'dropset';
  parent_set_id: string | null;
  notes: string | null;
}

async function fetchSessionSets(
  db: BetterSqliteDatabase,
  session_id: string,
): Promise<SessionSetRow[]> {
  return db.getAllAsync<SessionSetRow>(
    `SELECT id, session_id, exercise_id, session_exercise_id, weight_kg, reps,
            is_skipped, is_logged, ordering, set_kind, parent_set_id, notes
       FROM "set"
      WHERE session_id = ?
      ORDER BY session_exercise_id, ordering ASC`,
    session_id,
  );
}

describe('startSessionFromTemplate — #51 set copy', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('copies template_set rows into session sets verbatim (kind/reps/weight)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });

    // Mix of warmup / working sets in template, intentionally non-contiguous
    // positions to also assert ordering normalises by position ASC.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'warmup', ?, ?)`,
      'ts-w1',
      teId,
      0,
      10,
      40,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      'ts-1',
      teId,
      1,
      8,
      80,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      'ts-2',
      teId,
      2,
      8,
      85,
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-1',
      uuid,
      now: () => 1_000,
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);

    expect(sets[0]).toMatchObject({
      session_id,
      exercise_id: bench.id,
      set_kind: 'warmup',
      reps: 10,
      weight_kg: 40,
      ordering: 1,
      is_skipped: 0,
      is_logged: 0,
      parent_set_id: null,
    });
    expect(sets[1]).toMatchObject({
      set_kind: 'working',
      reps: 8,
      weight_kg: 80,
      ordering: 2,
      is_logged: 0,
    });
    expect(sets[2]).toMatchObject({
      set_kind: 'working',
      reps: 8,
      weight_kg: 85,
      ordering: 3,
      is_logged: 0,
    });

    // session_exercise_id linkage: all 3 sets share the same SE id
    const seIds = new Set(sets.map((s) => s.session_exercise_id));
    expect(seIds.size).toBe(1);
    expect(sets[0].session_exercise_id).not.toBeNull();

    // The copied sets' ids must be fresh (not the template_set.id literals)
    for (const s of sets) {
      expect(s.id).not.toMatch(/^ts-/);
    }
  });

  it('remaps parent_set_id from template_set space to new session set space (dropset chain)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-d', name: 'Drop', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: 'tpl-d',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });

    // Chain: head (working) + 2 dropset followers pointing at head
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'working', ?, ?, NULL)`,
      'tpl-head',
      teId,
      0,
      8,
      80,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'dropset', ?, ?, ?)`,
      'tpl-d1',
      teId,
      1,
      6,
      70,
      'tpl-head',
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'dropset', ?, ?, ?)`,
      'tpl-d2',
      teId,
      2,
      4,
      60,
      'tpl-head',
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-d',
      uuid,
      now: () => 1_000,
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);

    const head = sets.find((s) => s.set_kind === 'working');
    const followers = sets.filter((s) => s.set_kind === 'dropset');
    expect(head).toBeDefined();
    expect(followers).toHaveLength(2);

    // Head's id is a fresh session-set id; not the template_set id literal.
    expect(head!.id).not.toBe('tpl-head');
    expect(head!.parent_set_id).toBeNull();

    // Both followers point at the NEW head id (remapped), not 'tpl-head'.
    for (const f of followers) {
      expect(f.parent_set_id).toBe(head!.id);
      expect(f.parent_set_id).not.toBe('tpl-head');
    }
  });

  it('multiple template_exercises produce isolated session_exercise_id linkages', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const squat = exercises.find((e) => e.name === 'Back Squat')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-2', name: 'Mix', now: () => 100 });
    const { id: benchTe } = await addTemplateExercise(db, {
      template_id: 'tpl-2',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });
    const { id: squatTe } = await addTemplateExercise(db, {
      template_id: 'tpl-2',
      exercise_id: squat.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });

    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      'tb-1',
      benchTe,
      0,
      8,
      80,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      'tb-2',
      benchTe,
      1,
      8,
      80,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES (?, ?, ?, 'working', ?, ?)`,
      'tsq-1',
      squatTe,
      0,
      5,
      100,
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-2',
      uuid,
      now: () => 1_000,
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);

    const benchSets = sets.filter((s) => s.exercise_id === bench.id);
    const squatSets = sets.filter((s) => s.exercise_id === squat.id);
    expect(benchSets).toHaveLength(2);
    expect(squatSets).toHaveLength(1);

    // Each exercise's sets share a single session_exercise_id, and the two
    // session_exercise_ids are distinct.
    const benchSeIds = new Set(benchSets.map((s) => s.session_exercise_id));
    const squatSeIds = new Set(squatSets.map((s) => s.session_exercise_id));
    expect(benchSeIds.size).toBe(1);
    expect(squatSeIds.size).toBe(1);
    expect([...benchSeIds][0]).not.toBe([...squatSeIds][0]);
  });

  it('template with zero template_set rows yields zero session sets (planned counter unaffected)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-empty', name: 'Empty', now: () => 100 });
    await addTemplateExercise(db, {
      template_id: 'tpl-empty',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: 80,
      uuid,
      now: () => 100,
    });
    // No template_set rows inserted.

    const { session_id, planned_count } = await startSessionFromTemplate(db, {
      template_id: 'tpl-empty',
      uuid,
      now: () => 1_000,
    });

    expect(planned_count).toBe(1);
    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(0);
  });

  it('carries per-set template notes over into the session set rows', async () => {
    // Regression for the per-set-note carryover bug: a note authored on a
    // template_set (template editor) was dropped when starting a session from
    // the template. The exercise-level note (exercise.notes, ADR-0017 global)
    // carried over fine; only the per-SET note was lost. Root cause: the
    // template→session set copy in `sessionFromTemplate` never read
    // `template_set.notes`, and `insertSessionSet` never wrote `set.notes`.
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-notes', name: 'Notes', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: 'tpl-notes',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });

    // Set 0 has a note, set 1 has no note (NULL) — assert both carry through.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, notes)
       VALUES (?, ?, ?, 'working', ?, ?, ?)`,
      'tsn-0',
      teId,
      0,
      8,
      80,
      '爆發力 — 控制離心',
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, notes)
       VALUES (?, ?, ?, 'working', ?, ?, NULL)`,
      'tsn-1',
      teId,
      1,
      8,
      85,
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-notes',
      uuid,
      now: () => 1_000,
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(2);
    expect(sets[0].notes).toBe('爆發力 — 控制離心');
    expect(sets[1].notes).toBeNull();
  });

  it('all materialised sets have is_logged=0 and is_skipped=0 (unlogged plan)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-3', name: 'P', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: 'tpl-3',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });

    for (let i = 0; i < 4; i++) {
      await db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
         VALUES (?, ?, ?, 'working', ?, ?)`,
        `ts-${i}`,
        teId,
        i,
        8,
        80,
      );
    }

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-3',
      uuid,
      now: () => 1_000,
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(4);
    for (const s of sets) {
      expect(s.is_logged).toBe(0);
      expect(s.is_skipped).toBe(0);
    }
  });
});
