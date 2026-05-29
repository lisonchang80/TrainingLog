import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createTemplate,
  previewTemplateDeletion,
  executeTemplateDeletion,
  previewTemplateDeletionByName,
  executeDeleteTemplatesByName,
  getTemplate,
} from '../../src/adapters/sqlite/templateRepository';

/**
 * Acceptance tests for the 「同名 template 批量刪除」 feature
 * (slice 13d — feature/delete-same-name-templates).
 *
 * Covers:
 *   - Single-id preview + execute split of the existing deleteTemplate flow
 *     (preview returns affectedCells; execute matches existing semantics)
 *   - Batch-by-name preview + execute
 *   - Case-insensitive name match (COLLATE NOCASE)
 *   - Includes "default variant" (program_id=NULL AND sub_tag=NULL),
 *     bypassing isTemplateDeletable() UI gate
 *   - Sibling isolation when a different name shares a program slot
 *   - Preview reads but does not mutate
 */

const NOW = 1_700_000_000_000;

describe('previewTemplateDeletion + executeTemplateDeletion (single)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => db.close());

  async function seedTemplate(
    id: string,
    name: string,
    opts: { program_id?: string | null; sub_tag?: string | null } = {}
  ): Promise<void> {
    await createTemplate(db, { id, name, now: () => NOW });
    if (opts.program_id !== undefined || opts.sub_tag !== undefined) {
      await db.runAsync(
        `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
        opts.program_id ?? null,
        opts.sub_tag ?? null,
        id
      );
    }
    const te_id = `${id}-te`;
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, rest_seconds, updated_at)
       VALUES (?, ?, ?, 0, 2, 0, NULL, 90, ?)`,
      te_id,
      id,
      benchId,
      NOW
    );
  }

  async function seedProgram(id: string, name: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO program
         (id, name, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
       VALUES (?, ?, 7, 1, '2026-05-29', 1, ?, ?)`,
      id,
      name,
      NOW,
      NOW
    );
  }

  async function seedCell(
    cellId: string,
    program_id: string,
    cycle_index: number,
    day_index: number,
    template_id: string | null,
    sub_tag: string | null = null
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      cellId,
      program_id,
      cycle_index,
      day_index,
      template_id,
      sub_tag
    );
  }

  it('previewTemplateDeletion returns the target template and zero affectedCells when no program references it', async () => {
    await seedTemplate('tpl-X', 'Push');

    const preview = await previewTemplateDeletion(db, 'tpl-X');

    expect(preview.templates).toHaveLength(1);
    expect(preview.templates[0]).toMatchObject({ id: 'tpl-X', name: 'Push' });
    expect(preview.affectedCells).toEqual([]);
  });

  it('previewTemplateDeletion lists affectedCells with program_name when program_cell.template_id points at the target', async () => {
    await seedTemplate('tpl-Y', 'Pull');
    await seedProgram('prog-1', 'T1');
    await seedCell('cell-a', 'prog-1', 0, 0, 'tpl-Y');
    await seedCell('cell-b', 'prog-1', 0, 2, 'tpl-Y');

    const preview = await previewTemplateDeletion(db, 'tpl-Y');

    expect(preview.templates).toHaveLength(1);
    expect(preview.affectedCells).toHaveLength(2);
    expect(preview.affectedCells.every((c) => c.program_name === 'T1')).toBe(true);
    expect(preview.affectedCells.map((c) => c.day_index).sort()).toEqual([0, 2]);
  });

  it('previewTemplateDeletion does not mutate the DB', async () => {
    await seedTemplate('tpl-Z', 'Squat');
    await seedProgram('prog-2', 'T2');
    await seedCell('cell-c', 'prog-2', 0, 0, 'tpl-Z');

    await previewTemplateDeletion(db, 'tpl-Z');

    expect(await getTemplate(db, 'tpl-Z')).not.toBeNull();
    const cellRow = await db.getFirstAsync<{ template_id: string | null }>(
      `SELECT template_id FROM program_cell WHERE id = 'cell-c'`
    );
    expect(cellRow?.template_id).toBe('tpl-Z');
  });

  it('executeTemplateDeletion removes the template and nulls out program_cell.template_id', async () => {
    await seedTemplate('tpl-E', 'Row');
    await seedProgram('prog-3', 'T3');
    await seedCell('cell-d', 'prog-3', 0, 1, 'tpl-E');

    await executeTemplateDeletion(db, 'tpl-E');

    expect(await getTemplate(db, 'tpl-E')).toBeNull();
    const cellRow = await db.getFirstAsync<{ template_id: string | null }>(
      `SELECT template_id FROM program_cell WHERE id = 'cell-d'`
    );
    expect(cellRow?.template_id).toBeNull();
    // The cell row itself stays (schedule preserved).
    const cellCount = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM program_cell WHERE id = 'cell-d'`
    );
    expect(cellCount?.n).toBe(1);
  });
});

describe('previewTemplateDeletionByName + executeDeleteTemplatesByName (batch)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => db.close());

  async function seedTemplate(
    id: string,
    name: string,
    opts: { program_id?: string | null; sub_tag?: string | null } = {}
  ): Promise<void> {
    await createTemplate(db, { id, name, now: () => NOW });
    if (opts.program_id !== undefined || opts.sub_tag !== undefined) {
      await db.runAsync(
        `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
        opts.program_id ?? null,
        opts.sub_tag ?? null,
        id
      );
    }
    const te_id = `${id}-te`;
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, rest_seconds, updated_at)
       VALUES (?, ?, ?, 0, 2, 0, NULL, 90, ?)`,
      te_id,
      id,
      benchId,
      NOW
    );
  }

  async function seedProgram(id: string, name: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO program
         (id, name, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
       VALUES (?, ?, 7, 1, '2026-05-29', 1, ?, ?)`,
      id,
      name,
      NOW,
      NOW
    );
  }

  async function seedCell(
    cellId: string,
    program_id: string,
    cycle_index: number,
    day_index: number,
    template_id: string | null,
    sub_tag: string | null = null
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      cellId,
      program_id,
      cycle_index,
      day_index,
      template_id,
      sub_tag
    );
  }

  it('preview returns all templates with the same name across program/sub_tag triples, including the default variant', async () => {
    await seedProgram('prog-A', 'T1');
    await seedTemplate('tpl-a1', 'Test', { program_id: 'prog-A', sub_tag: 'T1-1' });
    await seedTemplate('tpl-a2', 'Test', { program_id: 'prog-A', sub_tag: 'T1-2' });
    // Default variant — program_id NULL AND sub_tag NULL.
    await seedTemplate('tpl-default', 'Test');
    // A sibling with a different name — must NOT appear.
    await seedTemplate('tpl-other', 'Push', { program_id: 'prog-A', sub_tag: 'T1-1' });

    const preview = await previewTemplateDeletionByName(db, 'Test');

    expect(preview.templates).toHaveLength(3);
    const ids = preview.templates.map((t) => t.id).sort();
    expect(ids).toEqual(['tpl-a1', 'tpl-a2', 'tpl-default']);
  });

  it('preview is case-insensitive on the template name', async () => {
    await seedTemplate('tpl-1', 'Test');
    await seedTemplate('tpl-2', 'test');
    await seedTemplate('tpl-3', 'TEST');
    await seedTemplate('tpl-4', 'Other');

    const preview = await previewTemplateDeletionByName(db, 'test');

    expect(preview.templates.map((t) => t.id).sort()).toEqual(['tpl-1', 'tpl-2', 'tpl-3']);
  });

  it('preview aggregates affectedCells across all matched templates', async () => {
    await seedProgram('prog-X', 'TX');
    await seedProgram('prog-Y', 'TY');
    await seedTemplate('tpl-x1', 'Test', { program_id: 'prog-X', sub_tag: 'A' });
    await seedTemplate('tpl-y1', 'Test', { program_id: 'prog-Y', sub_tag: 'B' });
    await seedTemplate('tpl-default', 'Test');
    await seedCell('cell-x1', 'prog-X', 0, 0, 'tpl-x1');
    await seedCell('cell-y1', 'prog-Y', 0, 1, 'tpl-y1');
    await seedCell('cell-y2', 'prog-Y', 0, 3, 'tpl-y1');
    // A cell pointing at a different template — must NOT appear.
    await seedTemplate('tpl-other', 'Squat');
    await seedCell('cell-other', 'prog-X', 0, 2, 'tpl-other');

    const preview = await previewTemplateDeletionByName(db, 'Test');

    expect(preview.affectedCells).toHaveLength(3);
    const byProgram = preview.affectedCells.reduce<Record<string, number>>(
      (acc, c) => {
        acc[c.program_name] = (acc[c.program_name] ?? 0) + 1;
        return acc;
      },
      {}
    );
    expect(byProgram).toEqual({ TX: 1, TY: 2 });
  });

  it('preview returns empty arrays when the name does not exist', async () => {
    await seedTemplate('tpl-1', 'OnlyThis');

    const preview = await previewTemplateDeletionByName(db, 'GhostName');

    expect(preview.templates).toEqual([]);
    expect(preview.affectedCells).toEqual([]);
  });

  it('preview does not mutate the DB', async () => {
    await seedProgram('prog-P', 'TP');
    await seedTemplate('tpl-p1', 'Test', { program_id: 'prog-P', sub_tag: 'A' });
    await seedCell('cell-p1', 'prog-P', 0, 0, 'tpl-p1');

    await previewTemplateDeletionByName(db, 'Test');

    expect(await getTemplate(db, 'tpl-p1')).not.toBeNull();
    const cellRow = await db.getFirstAsync<{ template_id: string | null }>(
      `SELECT template_id FROM program_cell WHERE id = 'cell-p1'`
    );
    expect(cellRow?.template_id).toBe('tpl-p1');
  });

  it('execute deletes all matched templates (case-insensitive) and nulls referenced program_cell.template_id', async () => {
    await seedProgram('prog-1', 'T1');
    await seedTemplate('tpl-1', 'Test', { program_id: 'prog-1', sub_tag: 'A' });
    await seedTemplate('tpl-2', 'test'); // default variant, lowercase
    await seedTemplate('tpl-keep', 'Other', { program_id: 'prog-1', sub_tag: 'A' });
    await seedCell('cell-x', 'prog-1', 0, 0, 'tpl-1');

    await executeDeleteTemplatesByName(db, 'TEST');

    expect(await getTemplate(db, 'tpl-1')).toBeNull();
    expect(await getTemplate(db, 'tpl-2')).toBeNull();
    expect(await getTemplate(db, 'tpl-keep')).not.toBeNull();
    const cellRow = await db.getFirstAsync<{ template_id: string | null }>(
      `SELECT template_id FROM program_cell WHERE id = 'cell-x'`
    );
    expect(cellRow?.template_id).toBeNull();
  });

  it('execute is a no-op when the name does not exist', async () => {
    await seedTemplate('tpl-1', 'Keep');

    await expect(
      executeDeleteTemplatesByName(db, 'Ghost')
    ).resolves.toBeUndefined();

    expect(await getTemplate(db, 'tpl-1')).not.toBeNull();
  });

  it('execute deletes the default variant (program_id NULL, sub_tag NULL) without UI-gate intervention', async () => {
    await seedTemplate('tpl-default', 'Test'); // pure default

    await executeDeleteTemplatesByName(db, 'Test');

    expect(await getTemplate(db, 'tpl-default')).toBeNull();
  });
});
