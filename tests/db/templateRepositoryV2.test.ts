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
  queryReusableSupersetMemory,
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
    reusable_superset_id: null,
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
          parent_id, rest_seconds, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, 90, ?)`,
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

describe('templateRepository v2 — per-Exercise global notes (ADR-0017 amendment)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => db.close());

  it('commit writes notes to exercise.notes (write-through target)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    const committed: Template = {
      id: 't1',
      name: 'Push',
      color_hex: '',
      exercises: [],
    };
    const draft: Template = {
      ...committed,
      exercises: [
        makeEx({
          id: 'te-1',
          template_id: 't1',
          exercise_id: benchId,
          notes: '胸貼槓',
        }),
      ],
    };
    await commitTemplateDraft(db, { committed, draft, now: frozenNow(1000) });
    const exRow = await db.getFirstAsync<{ notes: string | null }>(
      `SELECT notes FROM exercise WHERE id = ?`,
      benchId
    );
    expect(exRow!.notes).toBe('胸貼槓');
    // Sanity: the template_exercise row exists post-commit (the legacy
    // notes column was DROPped in v012; existence is enough).
    const teRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE id = 'te-1'`
    );
    expect(teRow).not.toBeNull();
  });

  it('reads notes from exercise.notes via getTemplateFull', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    // Seed: notes live on exercise.notes
    await db.runAsync(
      `UPDATE exercise SET notes = ? WHERE id = ?`,
      'global cue',
      benchId
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, rest_seconds, updated_at)
       VALUES ('te-1', 't1', ?, 0, 0, 0, NULL, NULL, ?)`,
      benchId,
      NOW
    );
    const got = await getTemplateFull(db, 't1');
    expect(got!.exercises[0].notes).toBe('global cue');
  });

  it('editing notes in Template A propagates to Template B that uses the same exercise', async () => {
    await createTemplate(db, { id: 'tA', name: 'A', now: frozenNow() });
    await createTemplate(db, { id: 'tB', name: 'B', now: frozenNow() });
    // Both templates contain the same exercise
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('teA', 'tA', ?, 0, 0, 0, ?), ('teB', 'tB', ?, 0, 0, 0, ?)`,
      benchId,
      NOW,
      benchId,
      NOW
    );
    // Edit notes via Template A's commit path
    const committedA = (await getTemplateFull(db, 'tA'))!;
    const draftA: Template = {
      ...committedA,
      exercises: [{ ...committedA.exercises[0], notes: 'A 的筆記' }],
    };
    await commitTemplateDraft(db, { committed: committedA, draft: draftA, now: frozenNow(1000) });
    // Template B sees the same notes (per-Exercise global)
    const gotB = await getTemplateFull(db, 'tB');
    expect(gotB!.exercises[0].notes).toBe('A 的筆記');
  });

  it('notes-only edit triggers anyChange (not a no-op)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-1', 't1', ?, 0, 0, 0, ?)`,
      benchId,
      NOW
    );
    const committed = (await getTemplateFull(db, 't1'))!;
    // Same draft except notes is touched
    const draft: Template = {
      ...committed,
      exercises: [{ ...committed.exercises[0], notes: 'new note' }],
    };
    await commitTemplateDraft(db, { committed, draft, now: frozenNow(1000) });
    const exRow = await db.getFirstAsync<{ notes: string | null }>(
      `SELECT notes FROM exercise WHERE id = ?`,
      benchId
    );
    expect(exRow!.notes).toBe('new note');
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

  it('isolates solo memory from reusable-superset clusters (slice 9.8b grill Q4)', async () => {
    // ADR-0016 amendment / slice 9.8b: solo memory must not see rows that
    // were exploded from a reusable superset (rs_id NOT NULL).
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    // Seed a reusable superset so the FK is valid
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('s1', '胸+輔', NULL, 1, ?, ?)`,
      NOW,
      NOW
    );
    // Solo Bench row (older)
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen, updated_at)
       VALUES ('te-solo', 't1', ?, 0, 0, 0, ?)`,
      benchId,
      NOW
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('solo-1', 'te-solo', 0, 'working', 10, 60)`
    );
    // In-cluster Bench row (newer, but should be excluded from solo lookup)
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('te-cluster', 't1', ?, 1, 0, 0, NULL, 's1', ?)`,
      benchId,
      NOW + 5000
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('cluster-1', 'te-cluster', 0, 'working', 5, 90)`
    );

    const candidates = await queryMemoryCandidates(db, { exercise_id: benchId });
    // Only the solo row should be returned even though the cluster row is newer.
    expect(candidates.map((c) => c.template_exercise_id)).toEqual(['te-solo']);
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

describe('templateRepository v2 — queryReusableSupersetMemory (slice 9.8b grill Q4)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let ohpId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    ohpId = exercises.find((e) => e.name === 'Overhead Press')!.id;
    // Seed reusable supersets so FK is valid
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('s-A', '胸+肩', NULL, 0, ?, ?)`,
      NOW,
      NOW
    );
  });
  afterEach(() => db.close());

  it('returns empty when no prior cluster exists for the rs_id', async () => {
    expect(
      await queryReusableSupersetMemory(db, { reusable_superset_id: 's-A' })
    ).toEqual([]);
  });

  it('returns parent + child of the latest cluster (by updated_at)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    // Older cluster
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('p-old', 't1', ?, 0, 0, 0, NULL, 's-A', ?)`,
      benchId,
      NOW
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('p-old-1', 'p-old', 0, 'working', 8, 60)`
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('c-old', 't1', ?, 1, 0, 0, 'p-old', 's-A', ?)`,
      ohpId,
      NOW
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('c-old-1', 'c-old', 0, 'working', 8, 30)`
    );
    // Newer cluster (same rs_id, different template later)
    await createTemplate(db, { id: 't2', name: 'Push 2', now: frozenNow(2000) });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('p-new', 't2', ?, 0, 0, 0, NULL, 's-A', ?)`,
      benchId,
      NOW + 5000
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('p-new-1', 'p-new', 0, 'working', 5, 90)`
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('c-new', 't2', ?, 1, 0, 0, 'p-new', 's-A', ?)`,
      ohpId,
      NOW + 5000
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('c-new-1', 'c-new', 0, 'working', 5, 40)`
    );

    const candidates = await queryReusableSupersetMemory(db, {
      reusable_superset_id: 's-A',
    });
    expect(candidates).toHaveLength(2);
    // [0] = parent of latest cluster, [1] = child
    expect(candidates[0].template_exercise_id).toBe('p-new');
    expect(candidates[0].exercise_id).toBe(benchId);
    expect(candidates[0].sets.map((s) => s.reps)).toEqual([5]);
    expect(candidates[1].template_exercise_id).toBe('c-new');
    expect(candidates[1].exercise_id).toBe(ohpId);
    expect(candidates[1].sets.map((s) => s.weight)).toEqual([40]);
  });

  it('returns empty when only a parent exists without a paired child (corruption guard)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('p-lonely', 't1', ?, 0, 0, 0, NULL, 's-A', ?)`,
      benchId,
      NOW
    );
    expect(
      await queryReusableSupersetMemory(db, { reusable_superset_id: 's-A' })
    ).toEqual([]);
  });

  it('does not bleed into solo memory (cross-check with queryMemoryCandidates)', async () => {
    await createTemplate(db, { id: 't1', name: 'Push', now: frozenNow() });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('p1', 't1', ?, 0, 0, 0, NULL, 's-A', ?)`,
      benchId,
      NOW + 1000
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, is_evergreen,
          parent_id, reusable_superset_id, updated_at)
       VALUES ('c1', 't1', ?, 1, 0, 0, 'p1', 's-A', ?)`,
      ohpId,
      NOW + 1000
    );
    // Solo lookup for benchId must return nothing — the only Bench row is
    // inside a reusable cluster.
    const solo = await queryMemoryCandidates(db, { exercise_id: benchId });
    expect(solo).toEqual([]);
    // Reusable lookup returns the cluster pair.
    const rs = await queryReusableSupersetMemory(db, { reusable_superset_id: 's-A' });
    expect(rs).toHaveLength(2);
  });
});
