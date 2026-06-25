import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import type { SQLParam } from '../../src/db/types';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { isTemplateLinkedToActiveSession } from '../../src/adapters/sqlite/sessionRepository';

/**
 * Acceptance tests for the 5/19 #44 `deleteTemplate` cascade rewrite:
 *
 *   - 3-layer cascade: template_set → template_exercise → template
 *   - Dangling cleanup: session_exercise.template_id → NULL for ENDED
 *     sessions only (active session left alone so an in-progress workout
 *     keeps its 'started from this template' link until it finishes)
 *   - Sibling isolation: same name + different (program_id, sub_tag)
 *     siblings are NOT touched (only the picked triple variant goes)
 *   - Transaction integrity: a mid-cascade error rolls back cleanly
 *
 * Architecture mirrors templateRepositoryV2.test.ts (better-sqlite3
 * :memory: behind the `Database` interface).
 */

const NOW = 1_700_000_000_000;

describe('deleteTemplate — three-layer cascade + dangling cleanup', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => db.close());

  async function seedTemplateWithExerciseAndSets(
    template_id: string,
    name: string,
    opts: { program_id?: string | null; sub_tag?: string | null } = {}
  ): Promise<{ te_id: string; set_ids: string[] }> {
    await createTemplate(db, { id: template_id, name, now: () => NOW });
    if (opts.program_id !== undefined || opts.sub_tag !== undefined) {
      await db.runAsync(
        `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
        opts.program_id ?? null,
        opts.sub_tag ?? null,
        template_id
      );
    }
    const te_id = `${template_id}-te`;
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, rest_seconds, updated_at)
       VALUES (?, ?, ?, 0, 2, 0, NULL, 90, ?)`,
      te_id,
      template_id,
      benchId,
      NOW
    );
    const set_ids = [`${template_id}-s1`, `${template_id}-s2`];
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, 0, 'working', 8, 80, NULL, NULL),
              (?, ?, 1, 'working', 6, 85, NULL, NULL)`,
      set_ids[0],
      te_id,
      set_ids[1],
      te_id
    );
    return { te_id, set_ids };
  }

  async function countRows(
    table: string,
    where: string,
    ...params: SQLParam[]
  ): Promise<number> {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
      ...params
    );
    return row?.n ?? 0;
  }

  it('deletes template + template_exercise + template_set rows for the target template', async () => {
    const { te_id } = await seedTemplateWithExerciseAndSets('tpl-target', 'Push');

    expect(await getTemplate(db, 'tpl-target')).not.toBeNull();
    expect(await countRows('template_exercise', 'template_id = ?', 'tpl-target')).toBe(1);
    expect(await countRows('template_set', 'template_exercise_id = ?', te_id)).toBe(2);

    await deleteTemplate(db, 'tpl-target');

    expect(await getTemplate(db, 'tpl-target')).toBeNull();
    expect(await countRows('template', 'id = ?', 'tpl-target')).toBe(0);
    expect(await countRows('template_exercise', 'template_id = ?', 'tpl-target')).toBe(0);
    expect(await countRows('template_set', 'template_exercise_id = ?', te_id)).toBe(0);
  });

  it('does not touch sibling templates with the same name but different (program_id, sub_tag)', async () => {
    // Insert two programs so siblings can attach.
    await db.runAsync(
      `INSERT INTO program
         (id, name, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
       VALUES ('prog-A', 'A', 7, 1, '2026-01-01', 0, ${NOW}, ${NOW}),
              ('prog-B', 'B', 7, 1, '2026-01-01', 0, ${NOW}, ${NOW})`
    );

    const tgt = await seedTemplateWithExerciseAndSets('tpl-tgt', 'Smoke', {
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
    });
    const sib1 = await seedTemplateWithExerciseAndSets('tpl-sib1', 'Smoke', {
      program_id: 'prog-A',
      sub_tag: 'TEST-2',
    });
    const sib2 = await seedTemplateWithExerciseAndSets('tpl-sib2', 'Smoke', {
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
    });

    await deleteTemplate(db, 'tpl-tgt');

    // Target gone.
    expect(await countRows('template', 'id = ?', 'tpl-tgt')).toBe(0);
    expect(await countRows('template_exercise', 'id = ?', tgt.te_id)).toBe(0);
    expect(await countRows('template_set', 'template_exercise_id = ?', tgt.te_id)).toBe(0);

    // Siblings intact: header row, exercise row, AND both set rows each.
    expect(await countRows('template', 'id = ?', 'tpl-sib1')).toBe(1);
    expect(await countRows('template_exercise', 'id = ?', sib1.te_id)).toBe(1);
    expect(await countRows('template_set', 'template_exercise_id = ?', sib1.te_id)).toBe(2);

    expect(await countRows('template', 'id = ?', 'tpl-sib2')).toBe(1);
    expect(await countRows('template_exercise', 'id = ?', sib2.te_id)).toBe(1);
    expect(await countRows('template_set', 'template_exercise_id = ?', sib2.te_id)).toBe(2);
  });

  it('nulls out session_exercise.template_id for ENDED sessions that pointed at the deleted template', async () => {
    await seedTemplateWithExerciseAndSets('tpl-A', 'Push');

    // Ended session pointing at tpl-A.
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
       VALUES ('sess-ended', ?, ?, NULL)`,
      NOW - 10_000,
      NOW - 5_000
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
          planned_weight_kg, template_id)
       VALUES ('se-ended', 'sess-ended', ?, 0, 2, 8, 80, 'tpl-A')`,
      benchId
    );

    expect(
      await countRows('session_exercise', "template_id = 'tpl-A' AND id = 'se-ended'")
    ).toBe(1);

    await deleteTemplate(db, 'tpl-A');

    // Dangling pointer cleaned up — row still exists but template_id is NULL.
    expect(
      await countRows('session_exercise', "id = 'se-ended' AND template_id IS NULL")
    ).toBe(1);
    // session_exercise row itself untouched — history preserved.
    expect(await countRows('session_exercise', "id = 'se-ended'")).toBe(1);
  });

  it('leaves ACTIVE session session_exercise.template_id intact (ended_at IS NULL)', async () => {
    await seedTemplateWithExerciseAndSets('tpl-A', 'Push');

    // Active session — still running, ended_at NULL.
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
       VALUES ('sess-active', ?, NULL, NULL)`,
      NOW - 1_000
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
          planned_weight_kg, template_id)
       VALUES ('se-active', 'sess-active', ?, 0, 2, 8, 80, 'tpl-A')`,
      benchId
    );

    // Sanity-check before delete.
    expect(
      await countRows('session_exercise', "id = 'se-active' AND template_id = 'tpl-A'")
    ).toBe(1);

    await deleteTemplate(db, 'tpl-A');

    // Active session keeps its pointer (stale to the now-deleted template,
    // but the active workout context preserves the 'started from this
    // template' relationship until it finishes — UI handles a missing
    // template gracefully).
    expect(
      await countRows('session_exercise', "id = 'se-active' AND template_id = 'tpl-A'")
    ).toBe(1);
  });

  // 2026-06-25 audit 🟠 — the editor uses isTemplateLinkedToActiveSession to
  // BLOCK deleting the template an active session was started from (the delete
  // would leave the above stale pointer permanently dangling). Verify the guard.
  describe('isTemplateLinkedToActiveSession (delete guard)', () => {
    it('true when an ACTIVE session references the template', async () => {
      await seedTemplateWithExerciseAndSets('tpl-A', 'Push');
      await db.runAsync(
        `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
         VALUES ('sess-active', ?, NULL, NULL)`,
        NOW - 1_000
      );
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
            planned_weight_kg, template_id)
         VALUES ('se-active', 'sess-active', ?, 0, 2, 8, 80, 'tpl-A')`,
        benchId
      );
      expect(await isTemplateLinkedToActiveSession(db, 'tpl-A')).toBe(true);
    });

    it('false when only an ENDED session references the template', async () => {
      await seedTemplateWithExerciseAndSets('tpl-A', 'Push');
      await db.runAsync(
        `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
         VALUES ('sess-ended', ?, ?, NULL)`,
        NOW - 2_000,
        NOW - 1_000
      );
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
            planned_weight_kg, template_id)
         VALUES ('se-ended', 'sess-ended', ?, 0, 2, 8, 80, 'tpl-A')`,
        benchId
      );
      expect(await isTemplateLinkedToActiveSession(db, 'tpl-A')).toBe(false);
    });

    it('false when no session references the template', async () => {
      await seedTemplateWithExerciseAndSets('tpl-A', 'Push');
      // An active session that points at a DIFFERENT template must not match.
      await db.runAsync(
        `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg)
         VALUES ('sess-other', ?, NULL, NULL)`,
        NOW - 1_000
      );
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
            planned_weight_kg, template_id)
         VALUES ('se-other', 'sess-other', ?, 0, 2, 8, 80, 'tpl-OTHER')`,
        benchId
      );
      expect(await isTemplateLinkedToActiveSession(db, 'tpl-A')).toBe(false);
    });
  });

  it('nulls out program_cell.template_id and leaves the program + cell row intact', async () => {
    await seedTemplateWithExerciseAndSets('tpl-P', 'Push');

    // Program + grid cell scheduling the template at (cycle 0, day 0).
    await db.runAsync(
      `INSERT INTO program
         (id, name, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
       VALUES ('prog-P', 'T1', 7, 1, '2026-05-29', 1, ${NOW}, ${NOW})`
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES ('cell-P', 'prog-P', 0, 0, 'tpl-P', NULL)`
    );

    // Sanity before delete.
    expect(await countRows('program_cell', "id = 'cell-P' AND template_id = 'tpl-P'")).toBe(1);

    // Must not throw — without the program_cell cleanup this trips SQLite
    // error 19 (FOREIGN KEY constraint failed) at commit time.
    await expect(deleteTemplate(db, 'tpl-P')).resolves.toBeUndefined();

    // Template is gone.
    expect(await countRows('template', 'id = ?', 'tpl-P')).toBe(0);
    // Program row + cell row both intact; cell's template_id cleared.
    expect(await countRows('program', "id = 'prog-P'")).toBe(1);
    expect(await countRows('program_cell', "id = 'cell-P' AND template_id IS NULL")).toBe(1);
  });

  it('rolls back atomically on mid-cascade failure (no orphan rows left behind)', async () => {
    const { te_id, set_ids } = await seedTemplateWithExerciseAndSets('tpl-X', 'Pull');

    // Force a failure by feeding a corrupted runAsync mid-transaction. We
    // monkey-patch the db.runAsync so the 3rd call (DELETE FROM
    // template_exercise) throws — the transaction wrapper must roll back
    // the prior UPDATE session_exercise + DELETE FROM template_set.
    const realRun = db.runAsync.bind(db);
    let callCount = 0;
    (db as unknown as { runAsync: typeof db.runAsync }).runAsync = (async (
      sql: string,
      ...params: SQLParam[]
    ) => {
      callCount += 1;
      // Order inside deleteTemplate's transaction:
      //   1. UPDATE session_exercise ...
      //   2. UPDATE program_cell ...
      //   3. DELETE FROM template_set ...
      //   4. DELETE FROM template_exercise ...   <-- throw here
      //   5. DELETE FROM template ...
      if (callCount === 4 && sql.includes('DELETE FROM template_exercise')) {
        throw new Error('simulated mid-cascade failure');
      }
      return realRun(sql, ...params);
    }) as typeof db.runAsync;

    await expect(deleteTemplate(db, 'tpl-X')).rejects.toThrow(
      'simulated mid-cascade failure'
    );

    // Restore the real runAsync for the asserts.
    (db as unknown as { runAsync: typeof db.runAsync }).runAsync = realRun;

    // All four pieces should still be present — transaction rolled back.
    expect(await countRows('template', 'id = ?', 'tpl-X')).toBe(1);
    expect(await countRows('template_exercise', 'id = ?', te_id)).toBe(1);
    expect(await countRows('template_set', 'id = ?', set_ids[0])).toBe(1);
    expect(await countRows('template_set', 'id = ?', set_ids[1])).toBe(1);
  });
});
