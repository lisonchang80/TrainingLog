import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createProgram,
  deleteProgram,
  deleteProgramSubTag,
  listProgramSubTags,
  upsertCell,
} from '../../src/adapters/sqlite/programRepository';
import {
  createTemplate,
  attachTemplateToProgram,
  findTemplateByTriple,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Programs-tab「刪除計劃 / 刪除強度」(2026-06-26).
 *   - deleteProgram: orphans templates → 通用, removes cells + program;
 *     active-session guard throws PROGRAM_HAS_ACTIVE_SESSION.
 *   - deleteProgramSubTag: un-tags template.sub_tag + program_cell.sub_tag for
 *     the (program, sub_tag) pair, removes the program_sub_tag dict row;
 *     scoped to the exact pair; active-session guard throws.
 */

const NOW = 1_700_000_000_000;

describe('deleteProgram / deleteProgramSubTag', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;
  const now = () => NOW;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    benchId = (await listExercises(db)).find((e) => e.name === 'Bench Press')!.id;
    counter = 0;
    await createProgram(db, {
      program: {
        id: 'prog-A',
        name: '計畫A',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 1,
      },
    });
  });

  afterEach(() => db.close());

  /** A template classified under prog-A with the given sub_tag. */
  async function classifiedTemplate(id: string, sub_tag: string): Promise<void> {
    await createTemplate(db, { id, name: id, now });
    await attachTemplateToProgram(db, {
      template_id: id,
      program_id: 'prog-A',
      sub_tag,
      now,
    });
  }

  /** Start an in-progress session whose one exercise links `template_id`. */
  async function inProgressSessionLinking(template_id: string): Promise<void> {
    await createSession(db, { id: 'sess-live', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-1',
      session_id: 'sess-live',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
  }

  // ── deleteProgram ───────────────────────────────────────────────────

  it('deleteProgram orphans templates → 通用 and removes the program', async () => {
    await classifiedTemplate('tpl-1', '強度A');
    await deleteProgram(db, 'prog-A');

    const full = await getTemplateFull(db, 'tpl-1');
    expect(full).not.toBeNull();
    expect(full!.program_id).toBeNull();
    expect(full!.sub_tag).toBeNull();

    const prog = await db.getFirstAsync(`SELECT id FROM program WHERE id = ?`, 'prog-A');
    expect(prog).toBeNull();
  });

  it('deleteProgram throws PROGRAM_HAS_ACTIVE_SESSION when a template backs an in-progress session', async () => {
    await classifiedTemplate('tpl-1', '強度A');
    await inProgressSessionLinking('tpl-1');

    await expect(deleteProgram(db, 'prog-A')).rejects.toThrow(
      'PROGRAM_HAS_ACTIVE_SESSION',
    );
    // nothing changed
    const full = await getTemplateFull(db, 'tpl-1');
    expect(full!.program_id).toBe('prog-A');
    const prog = await db.getFirstAsync(`SELECT id FROM program WHERE id = ?`, 'prog-A');
    expect(prog).not.toBeNull();
  });

  // ── deleteProgramSubTag ─────────────────────────────────────────────

  it('un-tags templates + cells for the pair and removes the dict label', async () => {
    await classifiedTemplate('tpl-1', '強度A');
    // a grid cell carrying the same sub_tag
    await upsertCell(db, {
      program_id: 'prog-A',
      cycle_index: 0,
      day_index: 0,
      template_id: 'tpl-1',
      sub_tag: '強度A',
      uuid,
      now,
    });
    expect(await listProgramSubTags(db, 'prog-A')).toContain('強度A');

    await deleteProgramSubTag(db, { program_id: 'prog-A', sub_tag: '強度A' });

    // template kept, but sub_tag nulled (program-only); program_id intact
    const full = await getTemplateFull(db, 'tpl-1');
    expect(full!.program_id).toBe('prog-A');
    expect(full!.sub_tag).toBeNull();
    // cell sub_tag nulled
    const cell = await db.getFirstAsync<{ sub_tag: string | null }>(
      `SELECT sub_tag FROM program_cell WHERE program_id = ? AND cycle_index = 0 AND day_index = 0`,
      'prog-A',
    );
    expect(cell!.sub_tag).toBeNull();
    // dict label removed
    expect(await listProgramSubTags(db, 'prog-A')).not.toContain('強度A');
  });

  it('only affects the exact (program, sub_tag) pair', async () => {
    await classifiedTemplate('tpl-a', '強度A');
    await classifiedTemplate('tpl-b', '強度B'); // sibling sub_tag, same program
    // a second program with the SAME sub_tag string
    await createProgram(db, {
      program: {
        id: 'prog-Z',
        name: '計畫Z',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-z', name: 'tpl-z', now });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-z',
      program_id: 'prog-Z',
      sub_tag: '強度A',
      now,
    });

    await deleteProgramSubTag(db, { program_id: 'prog-A', sub_tag: '強度A' });

    // prog-A 強度B untouched
    expect((await getTemplateFull(db, 'tpl-b'))!.sub_tag).toBe('強度B');
    // prog-Z 強度A untouched (different program)
    const z = await getTemplateFull(db, 'tpl-z');
    expect(z!.program_id).toBe('prog-Z');
    expect(z!.sub_tag).toBe('強度A');
    expect(await listProgramSubTags(db, 'prog-Z')).toContain('強度A');
    // findTemplateByTriple confirms the deleted variant is now (prog-A, null)
    expect(
      await findTemplateByTriple(db, {
        name: 'tpl-a',
        program_id: 'prog-A',
        sub_tag: '強度A',
      }),
    ).toBeNull();
  });

  it('throws PROGRAM_HAS_ACTIVE_SESSION when the pair backs an in-progress session', async () => {
    await classifiedTemplate('tpl-1', '強度A');
    await inProgressSessionLinking('tpl-1');

    await expect(
      deleteProgramSubTag(db, { program_id: 'prog-A', sub_tag: '強度A' }),
    ).rejects.toThrow('PROGRAM_HAS_ACTIVE_SESSION');
    // unchanged
    expect((await getTemplateFull(db, 'tpl-1'))!.sub_tag).toBe('強度A');
    expect(await listProgramSubTags(db, 'prog-A')).toContain('強度A');
  });
});
