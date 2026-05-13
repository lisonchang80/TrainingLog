import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  applyRecolorSiblings,
  applyRenameSiblings,
  commitTemplateDraft,
  createTemplate,
  getTemplateFull,
  queryMemoryCandidates,
} from '../../src/adapters/sqlite/templateRepository';
import { deriveLatestSetsForExercise } from '../../src/domain/template/templateMemory';
import type {
  Template,
  TemplateExercise,
  TemplateSet,
} from '../../src/domain/template/types';

/**
 * Slice 9.5 repository acceptance tests (ADR-0016 per-set + draft commit +
 * sibling 連動 + 動作記憶 read).
 *
 * Architecture: better-sqlite3 :memory:, same as the slice-3 templates test.
 */

const NOW = 1_700_000_000_000; // arbitrary fixed epoch ms

function frozenNow(offset = 0): () => number {
  return () => NOW + offset;
}

function makeSet(over: Partial<TemplateSet> & { id: string }): TemplateSet {
  return {
    position: 0,
    kind: 'working',
    reps: 8,
    weight: 80,
    parent_set_id: null,
    notes: null,
    ...over,
  };
}

function makeEx(
  over: Partial<TemplateExercise> & { id: string; template_id: string; exercise_id: string }
): TemplateExercise {
  return {
    ordering: 0,
    section: 'general',
    parent_id: null,
    notes: null,
    rest_seconds: null,
    sets: [],
    ...over,
  };
}

describe('templateRepository v2 — getTemplateFull', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => db.close());

  it('returns null for unknown id', async () => {
    expect(await getTemplateFull(db, 'ghost')).toBeNull();
  });

  it('hydrates header + exercises (no sets yet) on a fresh template', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `UPDATE template SET color_hex = '#FF0000' WHERE id = ?`,
      'tpl-1'
    );
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got).toMatchObject({
      id: 'tpl-1',
      name: 'Push',
      color_hex: '#FF0000',
      exercises: [],
    });
  });

  it('hydrates exercises in ordering, sets in position with name joined from exercise table', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: frozenNow() });
    // Manually insert template_exercise + template_set rows (bypasses
    // commit path so we test the read path independently).
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, notes, rest_seconds, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, 90, ?)`,
      'te-1',
      'tpl-1',
      benchId,
      0,
      2,
      NOW
    );
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes)
       VALUES ('s1', 'te-1', 0, 'working', 8, 80, NULL, NULL),
              ('s2', 'te-1', 1, 'working', 6, 85, NULL, NULL)`
    );
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises).toHaveLength(1);
    expect(got!.exercises[0]).toMatchObject({
      id: 'te-1',
      name: 'Bench Press',
      ordering: 0,
      section: 'general',
      rest_seconds: 90,
    });
    expect(got!.exercises[0].sets).toEqual([
      {
        id: 's1',
        position: 0,
        kind: 'working',
        reps: 8,
        weight: 80,
        parent_set_id: null,
        notes: null,
      },
      {
        id: 's2',
        position: 1,
        kind: 'working',
        reps: 6,
        weight: 85,
        parent_set_id: null,
        notes: null,
      },
    ]);
  });

  it('maps is_evergreen 1 → section "evergreen"', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-1', 'tpl-1', ?, 0, 0, 1, ?)`,
      benchId,
      NOW
    );
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises[0].section).toBe('evergreen');
  });
});

describe('templateRepository v2 — commitTemplateDraft', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let ohpId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    ohpId = exercises.find((e) => e.name === 'Overhead Press')!.id;
  });

  afterEach(() => db.close());

  async function seedEmptyTemplate(): Promise<Template> {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `UPDATE template SET color_hex = '#FF0000' WHERE id = ?`,
      'tpl-1'
    );
    return {
      id: 'tpl-1',
      name: 'Push',
      color_hex: '#FF0000',
      exercises: [],
    };
  }

  it('is a no-op when draft equals committed (no writes)', async () => {
    const committed = await seedEmptyTemplate();
    const before = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM template WHERE id = 'tpl-1'`
    );
    await commitTemplateDraft(db, {
      committed,
      draft: { ...committed },
      now: frozenNow(1000),
    });
    const after = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM template WHERE id = 'tpl-1'`
    );
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it('inserts new exercises + sets on first save', async () => {
    const committed = await seedEmptyTemplate();
    const draft: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: benchId,
          rest_seconds: 90,
          sets: [
            makeSet({ id: 's1', position: 0, reps: 10, weight: 60 }),
            makeSet({ id: 's2', position: 1, reps: 8, weight: 80 }),
          ],
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft, now: frozenNow(1000) });
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises).toHaveLength(1);
    expect(got!.exercises[0].sets).toHaveLength(2);
    expect(got!.exercises[0].rest_seconds).toBe(90);
    const exRow = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM template_exercise WHERE id = 'te-1'`
    );
    expect(exRow!.updated_at).toBe(NOW + 1000);
  });

  it('rewrites all sets when one set field changes (DELETE + INSERT)', async () => {
    const committed = await seedEmptyTemplate();
    const initial: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: benchId,
          sets: [
            makeSet({ id: 's1', position: 0, reps: 8, weight: 80 }),
            makeSet({ id: 's2', position: 1, reps: 6, weight: 85 }),
          ],
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft: initial, now: frozenNow(1000) });

    // Re-read the persisted state to use as the new "committed" baseline.
    const refreshed = await getTemplateFull(db, 'tpl-1');
    const next: Template = {
      ...refreshed!,
      exercises: [
        {
          ...refreshed!.exercises[0],
          sets: [
            { ...refreshed!.exercises[0].sets[0], reps: 7 }, // edit
            { ...refreshed!.exercises[0].sets[1] },
          ],
        },
      ],
    };
    await commitTemplateDraft(db, {
      committed: refreshed!,
      draft: next,
      now: frozenNow(2000),
    });
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises[0].sets).toEqual([
      { id: 's1', position: 0, kind: 'working', reps: 7, weight: 80, parent_set_id: null, notes: null },
      { id: 's2', position: 1, kind: 'working', reps: 6, weight: 85, parent_set_id: null, notes: null },
    ]);
  });

  it('persists cluster B3 linkage (parent_set_id) and re-reads correctly', async () => {
    const committed = await seedEmptyTemplate();
    const draft: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: benchId,
          sets: [
            makeSet({ id: 'h1', position: 0, kind: 'dropset', reps: 8, weight: 80, parent_set_id: null }),
            makeSet({ id: 'f1', position: 1, kind: 'dropset', reps: 6, weight: 70, parent_set_id: 'h1' }),
          ],
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft, now: frozenNow(1000) });
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises[0].sets[0]).toMatchObject({ id: 'h1', parent_set_id: null });
    expect(got!.exercises[0].sets[1]).toMatchObject({ id: 'f1', parent_set_id: 'h1' });
  });

  it('CASCADE-deletes sets when an exercise is removed from the draft', async () => {
    const committed = await seedEmptyTemplate();
    const initial: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: benchId,
          sets: [makeSet({ id: 's1', position: 0 })],
        }),
        makeEx({
          id: 'te-2',
          template_id: 'tpl-1',
          exercise_id: ohpId,
          ordering: 1,
          sets: [makeSet({ id: 's2', position: 0 })],
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft: initial, now: frozenNow(1000) });
    const refreshed = await getTemplateFull(db, 'tpl-1');
    const dropped: Template = {
      ...refreshed!,
      exercises: refreshed!.exercises.filter((e) => e.id !== 'te-1'),
    };
    await commitTemplateDraft(db, {
      committed: refreshed!,
      draft: dropped,
      now: frozenNow(2000),
    });
    const exRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = 'tpl-1'`
    );
    expect(exRows.map((r) => r.id)).toEqual(['te-2']);
    const setRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set`
    );
    expect(setRows.map((r) => r.id)).toEqual(['s2']);
  });

  it('updates only exercise metadata when no set changes (no DELETE on template_set)', async () => {
    await db.execAsync(`PRAGMA foreign_keys = ON`);
    const committed = await seedEmptyTemplate();
    const initial: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 'tpl-1',
          exercise_id: benchId,
          rest_seconds: 90,
          sets: [
            makeSet({ id: 's1', position: 0, reps: 8, weight: 80 }),
            makeSet({ id: 's2', position: 1, reps: 6, weight: 85 }),
          ],
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft: initial, now: frozenNow(1000) });
    const refreshed = await getTemplateFull(db, 'tpl-1');
    const metaOnly: Template = {
      ...refreshed!,
      exercises: [
        { ...refreshed!.exercises[0], rest_seconds: 120, notes: 'pause @ chest' },
      ],
    };
    await commitTemplateDraft(db, {
      committed: refreshed!,
      draft: metaOnly,
      now: frozenNow(2000),
    });
    const got = await getTemplateFull(db, 'tpl-1');
    expect(got!.exercises[0].rest_seconds).toBe(120);
    expect(got!.exercises[0].notes).toBe('pause @ chest');
    // sets unchanged by id (no rewrite)
    expect(got!.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('templateRepository v2 — sibling group-wide ops', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  it('applyRenameSiblings renames every template sharing the old name', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await createTemplate(db, { id: 't2', name: 'Push', now: frozenNow() });
    await createTemplate(db, { id: 't3', name: 'Pull', now: frozenNow() });
    await applyRenameSiblings(db, { oldName: 'Push', newName: 'Push A', now: frozenNow(1000) });
    const rows = await db.getAllAsync<{ id: string; name: string; updated_at: number }>(
      `SELECT id, name, updated_at FROM template ORDER BY id`
    );
    expect(rows).toEqual([
      { id: 't1', name: 'Push A', updated_at: NOW + 1000 },
      { id: 't2', name: 'Push A', updated_at: NOW + 1000 },
      { id: 't3', name: 'Pull', updated_at: NOW },
    ]);
  });

  it('applyRenameSiblings is a no-op when oldName === newName', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await applyRenameSiblings(db, { oldName: 'Push', newName: 'Push', now: frozenNow(1000) });
    const row = await db.getFirstAsync<{ updated_at: number }>(
      `SELECT updated_at FROM template WHERE id = 't1'`
    );
    expect(row!.updated_at).toBe(NOW);
  });

  it('applyRecolorSiblings recolors every template with the given name', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await createTemplate(db, { id: 't2', name: 'Push', now: frozenNow() });
    await applyRecolorSiblings(db, { name: 'Push', color_hex: '#0000FF', now: frozenNow(1000) });
    const rows = await db.getAllAsync<{ color_hex: string }>(
      `SELECT color_hex FROM template WHERE name = 'Push'`
    );
    expect(rows.every((r) => r.color_hex === '#0000FF')).toBe(true);
  });
});

describe('templateRepository v2 — queryMemoryCandidates', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let ohpId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    ohpId = exercises.find((e) => e.name === 'Overhead Press')!.id;
  });
  afterEach(() => db.close());

  it('returns empty when no template_exercise has the exercise_id', async () => {
    expect(await queryMemoryCandidates(db, { exercise_id: benchId })).toEqual([]);
  });

  it('returns candidates ordered by updated_at DESC and groups sets', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    // Insert older Bench row + sets
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-old', 't1', ?, 0, 0, 0, ?)`,
      benchId,
      NOW
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('so', 'te-old', 0, 'working', 8, 60)`
    );
    // Insert newer Bench row + sets
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-new', 't1', ?, 1, 0, 0, ?)`,
      benchId,
      NOW + 1000
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('sn1', 'te-new', 0, 'working', 6, 90),
              ('sn2', 'te-new', 1, 'working', 4, 95)`
    );
    // Unrelated exercise should not appear
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-other', 't1', ?, 2, 0, 0, ?)`,
      ohpId,
      NOW + 500
    );
    const candidates = await queryMemoryCandidates(db, { exercise_id: benchId });
    expect(candidates.map((c) => c.template_exercise_id)).toEqual(['te-new', 'te-old']);
    expect(candidates[0].sets).toHaveLength(2);
    expect(candidates[1].sets).toHaveLength(1);
  });

  it('feeds deriveLatestSetsForExercise end-to-end (memory read pattern integration)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-1', 't1', ?, 0, 0, 0, ?)`,
      benchId,
      NOW + 1000
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes)
       VALUES ('sa', 'te-1', 0, 'working', 8, 80, NULL, 'should be stripped'),
              ('sb', 'te-1', 1, 'working', 6, 85, NULL, NULL)`
    );
    const candidates = await queryMemoryCandidates(db, { exercise_id: benchId });
    let n = 0;
    const sets = deriveLatestSetsForExercise({
      exercise_id: benchId,
      candidates,
      uuid: () => `new-${++n}`,
    });
    expect(sets).toHaveLength(2);
    expect(sets![0]).toMatchObject({ id: 'new-1', reps: 8, weight: 80, notes: null });
    expect(sets![1]).toMatchObject({ id: 'new-2', reps: 6, weight: 85, notes: null });
  });
});
