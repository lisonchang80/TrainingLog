import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSet } from '../../src/adapters/sqlite/setRepository';
import { listProgramsForExercise } from '../../src/adapters/sqlite/exerciseHistoryRepository';

/**
 * Coverage for `listProgramsForExercise` (exerciseHistoryRepository.ts:275) —
 * populates the 進階篩選 Program dropdown on the exercise history page
 * (ADR-0017 Q14 amendment).
 *
 * The query walks set → session_exercise (joined on BOTH session_id AND
 * exercise_id) → template (via se.template_id) → program (via t.program_id),
 * and returns DISTINCT programs that have at least one logged, non-skipped set
 * of the exercise. Unlike the PR / stats queries this one does NOT filter on
 * set_kind, but it DOES gate on `is_skipped = 0 AND is_logged = 1`, so a
 * planned-but-unperformed or skipped set must not surface its program.
 */

const NOW = 1_700_000_000_000;

async function seedProgram(
  db: BetterSqliteDatabase,
  args: { id: string; name: string }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO program
       (id, name, main_tag, cycle_length, cycle_count, start_date,
        is_active, created_at, updated_at)
     VALUES (?, ?, NULL, 7, 1, '2026-01-01', 0, ?, ?)`,
    args.id,
    args.name,
    NOW,
    NOW
  );
}

async function seedTemplate(
  db: BetterSqliteDatabase,
  args: { id: string; name: string; program_id: string | null }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    args.id,
    args.name,
    NOW,
    NOW,
    args.program_id
  );
}

async function seedLoggedSet(
  db: BetterSqliteDatabase,
  args: {
    set_id: string;
    se_id: string;
    session_id: string;
    exercise_id: string;
    template_id: string | null;
    ordering: number;
    set_kind?: 'warmup' | 'working' | 'dropset';
    is_skipped?: 0 | 1;
    is_logged?: 0 | 1;
  }
): Promise<void> {
  await insertSessionExercise(db, {
    id: args.se_id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    ordering: args.ordering,
    planned_sets: 1,
    planned_reps: 8,
    planned_weight_kg: 80,
    template_id: args.template_id,
    is_evergreen: 0,
    parent_id: null,
    reusable_superset_id: null,
  });
  await insertSet(db, {
    id: args.set_id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    weight_kg: 80,
    reps: 8,
    is_skipped: args.is_skipped ?? 0,
    ordering: args.ordering,
    created_at: NOW + args.ordering,
    session_exercise_id: args.se_id,
  });
  // set_kind defaults to 'working' on insert; override + flip is_logged here.
  await db.runAsync(
    `UPDATE "set" SET set_kind = ?, is_logged = ? WHERE id = ?`,
    args.set_kind ?? 'working',
    args.is_logged ?? 1,
    args.set_id
  );
}

describe('listProgramsForExercise (ADR-0017 Q14)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const all = await listExercises(db);
    benchId = all.find((e) => e.name === 'Bench Press')!.id;
    squatId = all.find((e) => e.name === 'Back Squat')!.id;
  });

  afterEach(() => {
    db.close();
  });

  it('returns [] when the exercise has no sets', async () => {
    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
  });

  it('returns the program of a template that has a logged set of the exercise', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await seedTemplate(db, { id: 'tpl-push', name: 'Push', program_id: 'prog-ppl' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
    });

    const out = await listProgramsForExercise(db, benchId);
    expect(out).toEqual([{ id: 'prog-ppl', name: 'PPL' }]);
  });

  it('de-duplicates a program performed across multiple sessions', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await seedTemplate(db, { id: 'tpl-push', name: 'Push', program_id: 'prog-ppl' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await createSession(db, { id: 'sess-2', started_at: NOW + 100_000 });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
    });
    await seedLoggedSet(db, {
      set_id: 's2',
      se_id: 'se2',
      session_id: 'sess-2',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
    });

    const out = await listProgramsForExercise(db, benchId);
    expect(out).toEqual([{ id: 'prog-ppl', name: 'PPL' }]);
  });

  it('returns multiple distinct programs ordered by name ASC', async () => {
    await seedProgram(db, { id: 'prog-z', name: 'Zeta' });
    await seedProgram(db, { id: 'prog-a', name: 'Alpha' });
    await seedTemplate(db, { id: 'tpl-z', name: 'Z-day', program_id: 'prog-z' });
    await seedTemplate(db, { id: 'tpl-a', name: 'A-day', program_id: 'prog-a' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await createSession(db, { id: 'sess-2', started_at: NOW + 100_000 });
    await seedLoggedSet(db, {
      set_id: 's-z',
      se_id: 'se-z',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-z',
      ordering: 1,
    });
    await seedLoggedSet(db, {
      set_id: 's-a',
      se_id: 'se-a',
      session_id: 'sess-2',
      exercise_id: benchId,
      template_id: 'tpl-a',
      ordering: 1,
    });

    const out = await listProgramsForExercise(db, benchId);
    expect(out.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('excludes a program whose only set is skipped (is_skipped=1)', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await seedTemplate(db, { id: 'tpl-push', name: 'Push', program_id: 'prog-ppl' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
      is_skipped: 1,
    });

    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
  });

  it('excludes a program whose only set is planned-but-unperformed (is_logged=0)', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await seedTemplate(db, { id: 'tpl-push', name: 'Push', program_id: 'prog-ppl' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
      is_logged: 0,
    });

    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
  });

  it('counts warmup sets too (no set_kind filter, unlike PR/stats queries)', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await seedTemplate(db, { id: 'tpl-push', name: 'Push', program_id: 'prog-ppl' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's-warm',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-push',
      ordering: 1,
      set_kind: 'warmup',
    });

    // A logged warmup is enough to surface the program in the filter dropdown.
    expect(await listProgramsForExercise(db, benchId)).toEqual([
      { id: 'prog-ppl', name: 'PPL' },
    ]);
  });

  it('excludes a template not attached to any program (template_id present, program_id NULL)', async () => {
    await seedTemplate(db, { id: 'tpl-solo', name: 'Solo', program_id: null });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: 'tpl-solo',
      ordering: 1,
    });

    // INNER JOIN program drops a template whose program_id is NULL.
    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
  });

  it('excludes an ad-hoc set with no template_id (no session_exercise→template link)', async () => {
    await seedProgram(db, { id: 'prog-ppl', name: 'PPL' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's1',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: benchId,
      template_id: null,
      ordering: 1,
    });

    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
  });

  it('scopes by exercise — a program for a different exercise does not leak', async () => {
    await seedProgram(db, { id: 'prog-leg', name: 'Legs' });
    await seedTemplate(db, { id: 'tpl-leg', name: 'Leg-day', program_id: 'prog-leg' });
    await createSession(db, { id: 'sess-1', started_at: NOW });
    await seedLoggedSet(db, {
      set_id: 's-squat',
      se_id: 'se1',
      session_id: 'sess-1',
      exercise_id: squatId,
      template_id: 'tpl-leg',
      ordering: 1,
    });

    // Querying for bench must not return the leg program.
    expect(await listProgramsForExercise(db, benchId)).toEqual([]);
    // Sanity: the leg program IS returned for the squat.
    expect(await listProgramsForExercise(db, squatId)).toEqual([
      { id: 'prog-leg', name: 'Legs' },
    ]);
  });
});
