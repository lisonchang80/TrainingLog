import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createProgram,
  getProgram,
  listProgramSubTags,
  overwriteProgram,
  recordProgramSubTag,
  setActiveProgram,
} from '../../src/adapters/sqlite/programRepository';
import {
  attachTemplateToProgram,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import {
  createSession,
  endSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { migrate } from '../../src/db/migrate';
import type { Database } from '../../src/db/types';
import type { ProgramCell, ProgramCore } from '../../src/domain/program/types';

/**
 * Wave 18g (2026-05-22) — overwrite an existing Program in place with new
 * wizard output. Per spec (Phase 6 / `/tmp/phase6-overwrite-program-plan.md`):
 *
 *   - Replace program metadata, cells, and sub_tag dictionary entirely.
 *   - Preserve `is_active`.
 *   - Block when an active (ended_at IS NULL) session has a session_exercise
 *     whose template currently belongs to this program.
 *   - Finished session rows are NOT touched.
 *
 * Test layout (7 cases):
 *   1. Happy path — meta + cells + sub_tag dict all replaced; is_active kept.
 *   2. Active session blocks — guard throws, ZERO writes happen.
 *   3. Finished session preserved — historical sessions stay intact.
 *   4. sub_tag dictionary full replace — old labels gone, new labels written.
 *   5. Cells full replace — old cells DELETE'd, new cells inserted.
 *   6. Idempotency — overwriting twice with same payload yields same state.
 *   7. Cross-program isolation — overwriting A doesn't touch B.
 */

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: 'Overwrite-Test',
  main_tag: null,
  cycle_length: 5,
  cycle_count: 3,
  start_date: '2026-05-01',
  is_active: 0 as const,
  ...over,
});

/**
 * Insert a session_exercise row with `template_id` set so the overwrite
 * guard query (which joins through template.program_id) finds it.
 * `appendSessionExercise` only sets template_id to NULL — direct INSERT
 * is the cleanest path for this scenario.
 */
async function insertSessionExerciseWithTemplate(
  db: Database,
  args: {
    id: string;
    session_id: string;
    exercise_id: string;
    template_id: string;
    ordering: number;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO session_exercise
       (id, session_id, exercise_id, ordering,
        planned_sets, planned_reps, planned_weight_kg,
        template_id, is_evergreen, parent_id, reusable_superset_id, rest_sec)
     VALUES (?, ?, ?, ?, 1, NULL, NULL, ?, 0, NULL, NULL, NULL)`,
    args.id,
    args.session_id,
    args.exercise_id,
    args.ordering,
    args.template_id,
  );
}

async function insertExercise(
  db: Database,
  args: { id: string; name: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
     VALUES (?, ?, 'loaded', 0, 0)`,
    args.id,
    args.name,
  );
}

const buildCell = (
  program_id: string,
  cycle_index: number,
  day_index: number,
  template_id: string | null,
  sub_tag: string | null,
): ProgramCell => ({
  id: uuid(),
  program_id,
  cycle_index,
  day_index,
  template_id,
  sub_tag,
});

async function setup(): Promise<{
  db: BetterSqliteDatabase;
  programId: string;
  templateAId: string;
  templateBId: string;
  templateCId: string;
}> {
  counter = 0;
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  const templateAId = uuid();
  const templateBId = uuid();
  const templateCId = uuid();
  await createTemplate(db, { id: templateAId, name: 'T-A' });
  await createTemplate(db, { id: templateBId, name: 'T-B' });
  await createTemplate(db, { id: templateCId, name: 'T-C' });
  const program = buildProgram();
  await createProgram(db, { program });
  return { db, programId: program.id, templateAId, templateBId, templateCId };
}

describe('overwriteProgram', () => {
  it('case 1: happy path — replaces meta + cells + sub_tag dict, preserves is_active', async () => {
    const { db, programId, templateAId, templateBId } = await setup();
    // Seed old state
    await setActiveProgram(db, { id: programId });
    await recordProgramSubTag(db, programId, 'old-1');
    await recordProgramSubTag(db, programId, 'old-2');

    // Overwrite with brand new payload
    await overwriteProgram(db, {
      program_id: programId,
      new_program: {
        id: programId,
        name: 'Renamed',
        main_tag: null,
        cycle_length: 7,
        cycle_count: 4,
        start_date: '2026-06-01',
        is_active: 0 as const,
      },
      new_cells: [
        buildCell(programId, 0, 0, templateAId, 'new-tag'),
        buildCell(programId, 1, 3, templateBId, 'new-tag'),
      ],
      new_sub_tags: ['new-tag', 'another'],
    });

    const after = await getProgram(db, programId);
    expect(after?.program.name).toBe('Renamed');
    expect(after?.program.cycle_length).toBe(7);
    expect(after?.program.cycle_count).toBe(4);
    expect(after?.program.start_date).toBe('2026-06-01');
    // is_active preserved.
    expect(after?.program.is_active).toBe(1);
    // Cells replaced.
    expect(after?.cells.length).toBe(2);
    expect(after?.cells[0].template_id).toBe(templateAId);
    expect(after?.cells[1].template_id).toBe(templateBId);
    // sub_tag dict replaced — old labels gone.
    const tags = await listProgramSubTags(db, programId);
    expect(tags).toEqual(['another', 'new-tag']);
    db.close();
  });

  it('case 2: active session for this program blocks overwrite, ZERO writes happen', async () => {
    const { db, programId, templateAId } = await setup();
    // Attach template to this program so the guard query finds it.
    await attachTemplateToProgram(db, {
      template_id: templateAId,
      program_id: programId,
      sub_tag: null,
    });
    // Seed an active session with a session_exercise pointing at templateA.
    const exerciseId = uuid();
    await insertExercise(db, { id: exerciseId, name: 'Bench' });
    const sessionId = uuid();
    await createSession(db, { id: sessionId, started_at: Date.now() });
    await insertSessionExerciseWithTemplate(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: exerciseId,
      template_id: templateAId,
      ordering: 1,
    });
    // Seed some pre-existing state to verify no rollback writes.
    await recordProgramSubTag(db, programId, 'pre-existing');

    // Attempt overwrite — should throw.
    await expect(
      overwriteProgram(db, {
        program_id: programId,
        new_program: {
          id: programId,
          name: 'Should-Not-Save',
          main_tag: null,
          cycle_length: 7,
          cycle_count: 4,
          start_date: '2026-06-01',
          is_active: 0 as const,
        },
        new_cells: [buildCell(programId, 0, 0, templateAId, 'will-not-save')],
        new_sub_tags: ['will-not-save'],
      }),
    ).rejects.toThrow('PROGRAM_HAS_ACTIVE_SESSION');

    // Verify nothing changed.
    const after = await getProgram(db, programId);
    expect(after?.program.name).toBe('Overwrite-Test');
    expect(after?.program.cycle_length).toBe(5);
    expect(after?.program.cycle_count).toBe(3);
    const tags = await listProgramSubTags(db, programId);
    expect(tags).toEqual(['pre-existing']);
    db.close();
  });

  it('case 3: finished session for this program does NOT block overwrite + history preserved', async () => {
    const { db, programId, templateAId } = await setup();
    await attachTemplateToProgram(db, {
      template_id: templateAId,
      program_id: programId,
      sub_tag: null,
    });
    // Finished historical session.
    const exerciseId = uuid();
    await insertExercise(db, { id: exerciseId, name: 'Bench' });
    const sessionId = uuid();
    const t0 = Date.now();
    await createSession(db, { id: sessionId, started_at: t0 });
    await insertSessionExerciseWithTemplate(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: exerciseId,
      template_id: templateAId,
      ordering: 1,
    });
    await endSession(db, { id: sessionId, ended_at: t0 + 60_000 });

    // Should succeed (no active session).
    await overwriteProgram(db, {
      program_id: programId,
      new_program: {
        id: programId,
        name: 'After-Overwrite',
        main_tag: null,
        cycle_length: 5,
        cycle_count: 3,
        start_date: '2026-05-01',
        is_active: 0 as const,
      },
      new_cells: [],
      new_sub_tags: [],
    });

    // Session row still exists with the same template reference.
    const row = await db.getFirstAsync<{
      id: string;
      ended_at: number;
    }>(`SELECT id, ended_at FROM session WHERE id = ?`, sessionId);
    expect(row?.id).toBe(sessionId);
    expect(row?.ended_at).toBe(t0 + 60_000);
    const seRow = await db.getFirstAsync<{ template_id: string }>(
      `SELECT template_id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(seRow?.template_id).toBe(templateAId);
    db.close();
  });

  it('case 4: sub_tag dictionary fully replaced (old labels purged, new labels written)', async () => {
    const { db, programId, templateAId } = await setup();
    await recordProgramSubTag(db, programId, 'I-1');
    await recordProgramSubTag(db, programId, 'I-2');
    await recordProgramSubTag(db, programId, 'I-3');

    await overwriteProgram(db, {
      program_id: programId,
      new_program: {
        id: programId,
        name: 'Overwrite-Test',
        main_tag: null,
        cycle_length: 5,
        cycle_count: 3,
        start_date: '2026-05-01',
        is_active: 0 as const,
      },
      new_cells: [buildCell(programId, 0, 0, templateAId, 'II-1')],
      new_sub_tags: ['II-1', 'II-2'],
    });

    const tags = await listProgramSubTags(db, programId);
    // Old labels purged, new labels present (alphabetical order via listProgramSubTags).
    expect(tags).toEqual(['II-1', 'II-2']);
    // Empty / null entries in `new_sub_tags` are silently skipped — verify
    // we don't crash and produce a clean dictionary.
    await overwriteProgram(db, {
      program_id: programId,
      new_program: {
        id: programId,
        name: 'Overwrite-Test',
        main_tag: null,
        cycle_length: 5,
        cycle_count: 3,
        start_date: '2026-05-01',
        is_active: 0 as const,
      },
      new_cells: [],
      new_sub_tags: ['', 'III-1'],
    });
    const tags2 = await listProgramSubTags(db, programId);
    expect(tags2).toEqual(['III-1']);
    db.close();
  });

  it('case 5: cells fully replaced (old cells DELETE\'d, new cells INSERTed)', async () => {
    const { db, templateAId, templateBId, templateCId } = await setup();
    // Seed old cells via createProgram with initial cells.
    counter = 100; // start fresh ID space for new program
    const program2 = buildProgram({ name: 'Cells-Replace-Test' });
    const oldCells = [
      buildCell(program2.id, 0, 0, templateAId, 'old-tag-1'),
      buildCell(program2.id, 1, 1, templateBId, 'old-tag-2'),
      buildCell(program2.id, 2, 2, templateCId, null),
    ];
    await createProgram(db, { program: program2, cells: oldCells });
    const before = await getProgram(db, program2.id);
    expect(before?.cells.length).toBe(3);

    await overwriteProgram(db, {
      program_id: program2.id,
      new_program: {
        id: program2.id,
        name: 'Cells-Replace-Test',
        main_tag: null,
        cycle_length: 5,
        cycle_count: 3,
        start_date: '2026-05-01',
        is_active: 0 as const,
      },
      new_cells: [buildCell(program2.id, 0, 0, templateBId, 'new-only')],
      new_sub_tags: ['new-only'],
    });

    const after = await getProgram(db, program2.id);
    // All 3 old cells gone; 1 new cell.
    expect(after?.cells.length).toBe(1);
    expect(after?.cells[0].template_id).toBe(templateBId);
    expect(after?.cells[0].sub_tag).toBe('new-only');
    expect(after?.cells[0].cycle_index).toBe(0);
    expect(after?.cells[0].day_index).toBe(0);
    db.close();
  });

  it('case 6: idempotent — running overwriteProgram twice with same payload yields same state', async () => {
    const { db, programId, templateAId } = await setup();
    const payload = {
      program_id: programId,
      new_program: {
        id: programId,
        name: 'Stable',
        main_tag: null,
        cycle_length: 5,
        cycle_count: 3,
        start_date: '2026-05-01',
        is_active: 0 as const,
      },
      new_cells: [buildCell(programId, 0, 0, templateAId, 'X')],
      new_sub_tags: ['X', 'Y'],
    };
    await overwriteProgram(db, payload);
    const first = await getProgram(db, programId);
    const tagsFirst = await listProgramSubTags(db, programId);

    // Second overwrite with identical payload. Cell IDs in `new_cells` are
    // re-generated each call in real usage; here we simulate that by passing
    // fresh IDs but the same logical content.
    payload.new_cells = [buildCell(programId, 0, 0, templateAId, 'X')];
    await overwriteProgram(db, payload);
    const second = await getProgram(db, programId);
    const tagsSecond = await listProgramSubTags(db, programId);

    // Same content (just different cell IDs since we DELETE+INSERT).
    expect(second?.program.name).toBe(first?.program.name);
    expect(second?.program.cycle_length).toBe(first?.program.cycle_length);
    expect(second?.program.cycle_count).toBe(first?.program.cycle_count);
    expect(second?.cells.length).toBe(first?.cells.length);
    expect(second?.cells[0].template_id).toBe(first?.cells[0].template_id);
    expect(second?.cells[0].sub_tag).toBe(first?.cells[0].sub_tag);
    expect(tagsSecond).toEqual(tagsFirst);
    db.close();
  });

  it('case 7: cross-program isolation — overwriting A leaves B untouched', async () => {
    const { db, programId: programAId, templateAId } = await setup();
    counter = 200;
    // Seed second program with its own cells + sub_tag dict.
    const programB = buildProgram({ name: 'Program-B' });
    const programBId = programB.id;
    await createProgram(db, {
      program: programB,
      cells: [buildCell(programBId, 0, 0, templateAId, 'b-tag')],
    });
    await recordProgramSubTag(db, programBId, 'b-tag');
    await recordProgramSubTag(db, programBId, 'b-other');

    // Overwrite Program A.
    await overwriteProgram(db, {
      program_id: programAId,
      new_program: {
        id: programAId,
        name: 'Overwrite-Test',
        main_tag: null,
        cycle_length: 7,
        cycle_count: 5,
        start_date: '2026-06-01',
        is_active: 0 as const,
      },
      new_cells: [buildCell(programAId, 0, 0, templateAId, 'a-new')],
      new_sub_tags: ['a-new'],
    });

    // Program B untouched.
    const afterB = await getProgram(db, programBId);
    expect(afterB?.program.name).toBe('Program-B');
    expect(afterB?.program.cycle_length).toBe(5);
    expect(afterB?.cells.length).toBe(1);
    expect(afterB?.cells[0].sub_tag).toBe('b-tag');
    const tagsB = await listProgramSubTags(db, programBId);
    expect(tagsB).toEqual(['b-other', 'b-tag']);
    db.close();
  });
});
