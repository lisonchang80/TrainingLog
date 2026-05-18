import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  convertSessionToTemplate,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';

/**
 * Acceptance tests for convertSessionToTemplate — ADR-0019 Q10
 * 「儲存模板」/「另存模板」action bar buttons (slice 10c session detail).
 *
 * Architecture: better-sqlite3 :memory:, same as other adapter tests.
 */

const NOW = 1_700_000_000_000;

describe('convertSessionToTemplate', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;
  let counter = 0;
  const uuid = () => `uuid-${++counter}`;
  const now = () => NOW;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
    counter = 0;
  });

  afterEach(() => db.close());

  async function setupSession(args: {
    session_id: string;
    template_id?: string | null;
  }): Promise<void> {
    await createSession(db, {
      id: args.session_id,
      started_at: NOW,
    });
    await insertSessionExercise(db, {
      id: 'se-bench',
      session_id: args.session_id,
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: args.template_id ?? null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionExercise(db, {
      id: 'se-squat',
      session_id: args.session_id,
      exercise_id: squatId,
      ordering: 2,
      planned_sets: 4,
      planned_reps: 5,
      planned_weight_kg: 100,
      template_id: args.template_id ?? null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: 90,
    });
    // 2 logged working sets for bench
    await insertSessionSet(db, {
      id: 'set-b1',
      session_id: args.session_id,
      exercise_id: benchId,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-b2',
      session_id: args.session_id,
      exercise_id: benchId,
      weight_kg: 65,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 1000,
      set_kind: 'working',
      parent_set_id: null,
    });
    // 3 sets for squat with one warmup + one is_skipped (should be dropped)
    await insertSessionSet(db, {
      id: 'set-s1',
      session_id: args.session_id,
      exercise_id: squatId,
      weight_kg: 50,
      reps: 12,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW + 2000,
      set_kind: 'warmup',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-s2',
      session_id: args.session_id,
      exercise_id: squatId,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 3000,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-s3',
      session_id: args.session_id,
      exercise_id: squatId,
      weight_kg: 110,
      reps: 0,
      is_skipped: 1, // skipped — should NOT make it into template
      ordering: 3,
      created_at: NOW + 4000,
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  it('create mode: new template gets the given name and one exercise per session_exercise', async () => {
    await setupSession({ session_id: 'sess-1', template_id: null });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-1',
      template_name: 'My Freestyle Convert',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl).not.toBeNull();
    expect(tpl!.name).toBe('My Freestyle Convert');
    expect(tpl!.exercises).toHaveLength(2);

    // 1st exercise (bench): 2 working sets recorded
    const bench = tpl!.exercises[0];
    expect(bench.exercise_id).toBe(benchId);
    expect(bench.sets).toHaveLength(2);
    expect(bench.sets.map((s) => s.kind)).toEqual(['working', 'working']);
    expect(bench.sets.map((s) => s.weight)).toEqual([60, 65]);
    expect(bench.sets.map((s) => s.reps)).toEqual([10, 8]);

    // 2nd exercise (squat): warmup + working — skipped set excluded
    const squat = tpl!.exercises[1];
    expect(squat.exercise_id).toBe(squatId);
    expect(squat.sets).toHaveLength(2);
    expect(squat.sets.map((s) => s.kind)).toEqual(['warmup', 'working']);
    expect(squat.rest_seconds).toBe(90); // rest_sec → rest_seconds bridge
    expect(squat.reusable_superset_id).toBeNull(); // verbatim copy (NULL stays NULL)
  });

  it('create mode does NOT modify session_exercise.template_id link', async () => {
    await setupSession({ session_id: 'sess-2', template_id: null });
    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-2',
      template_name: 'Created',
      mode: 'create',
      uuid,
      now,
    });
    const row = await db.getFirstAsync<{ template_id: string | null }>(
      `SELECT template_id FROM session_exercise WHERE id = ?`,
      'se-bench',
    );
    // session_exercise.template_id remains NULL — caller can still bind via
    // update-mode later if desired.
    expect(row?.template_id).toBeNull();
    // But the template itself exists.
    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl?.name).toBe('Created');
  });

  it('update mode (session has linked template_id): overwrites existing template structure', async () => {
    // Pre-seed an existing template with the wrong structure.
    await createTemplate(db, { id: 'tpl-existing', name: 'Old Name', now });
    await setupSession({ session_id: 'sess-3', template_id: 'tpl-existing' });

    const out = await convertSessionToTemplate(db, {
      session_id: 'sess-3',
      template_name: 'Updated Name',
      mode: 'update',
      uuid,
      now: () => NOW + 5000,
    });

    expect(out).toBe('tpl-existing'); // updated in place

    const tpl = await getTemplateFull(db, 'tpl-existing');
    expect(tpl!.name).toBe('Updated Name');
    expect(tpl!.exercises).toHaveLength(2);
    expect(tpl!.exercises[0].exercise_id).toBe(benchId);
    expect(tpl!.exercises[1].exercise_id).toBe(squatId);
  });

  it('update mode (freestyle session, no linked template_id): falls back to create + links session_exercise rows', async () => {
    await setupSession({ session_id: 'sess-4', template_id: null });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-4',
      template_name: 'Newly Linked',
      mode: 'update',
      uuid,
      now,
    });

    // A new template row was created.
    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl?.name).toBe('Newly Linked');

    // Both session_exercise rows now point at the new template.
    const rows = await db.getAllAsync<{ template_id: string | null }>(
      `SELECT template_id FROM session_exercise
        WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-4',
    );
    expect(rows.map((r) => r.template_id)).toEqual([newTplId, newTplId]);
  });

  it('rest_sec passthrough: session_exercise.rest_sec maps to template_exercise.rest_seconds', async () => {
    await setupSession({ session_id: 'sess-5', template_id: null });
    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-5',
      template_name: 'Rest Test',
      mode: 'create',
      uuid,
      now,
    });
    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl!.exercises[0].rest_seconds).toBeNull(); // bench had null
    expect(tpl!.exercises[1].rest_seconds).toBe(90); // squat had 90s
  });

  it('skipped sets are excluded from the template structure', async () => {
    await setupSession({ session_id: 'sess-6', template_id: null });
    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-6',
      template_name: 'Skip Test',
      mode: 'create',
      uuid,
      now,
    });
    const tpl = await getTemplateFull(db, newTplId);
    // squat had 3 set rows — 1 warmup, 1 working, 1 SKIPPED. Only first
    // two should make it into the template.
    expect(tpl!.exercises[1].sets).toHaveLength(2);
  });

  it('empty session (no exercises) → creates an empty template row', async () => {
    await createSession(db, { id: 'sess-empty', started_at: NOW });
    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-empty',
      template_name: 'Empty',
      mode: 'create',
      uuid,
      now,
    });
    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl).not.toBeNull();
    expect(tpl!.exercises).toHaveLength(0);
  });

  // 2026-05-18: 另存模板 bottom sheet 引導 (name + program_id + sub_tag) 3 元組。
  // create mode 帶入 program_id / sub_tag → 寫進 template row。
  it('create mode with program_id + sub_tag: writes them onto the new template row', async () => {
    await setupSession({ session_id: 'sess-meta', template_id: null });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-meta',
      template_name: 'Meta Test',
      mode: 'create',
      program_id: 'prog-foo',
      sub_tag: '5x5',
      uuid,
      now,
    });

    const row = await db.getFirstAsync<{
      program_id: string | null;
      sub_tag: string | null;
    }>(
      `SELECT program_id, sub_tag FROM template WHERE id = ?`,
      newTplId,
    );
    expect(row?.program_id).toBe('prog-foo');
    expect(row?.sub_tag).toBe('5x5');
  });

  it('create mode without program_id / sub_tag: row gets NULL for both (free template)', async () => {
    await setupSession({ session_id: 'sess-free', template_id: null });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-free',
      template_name: 'Free Template',
      mode: 'create',
      uuid,
      now,
    });

    const row = await db.getFirstAsync<{
      program_id: string | null;
      sub_tag: string | null;
    }>(
      `SELECT program_id, sub_tag FROM template WHERE id = ?`,
      newTplId,
    );
    expect(row?.program_id).toBeNull();
    expect(row?.sub_tag).toBeNull();
  });

  it('update mode ignores program_id / sub_tag args (linked template keeps its prior tuple)', async () => {
    // Pre-seed an existing template with a specific program_id + sub_tag.
    await createTemplate(db, { id: 'tpl-tag', name: 'Old Name', now });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ? WHERE id = ?`,
      'prog-orig',
      'orig-tag',
      'tpl-tag',
    );
    await setupSession({ session_id: 'sess-update', template_id: 'tpl-tag' });

    // Pass program_id / sub_tag in args — should be IGNORED for update mode.
    await convertSessionToTemplate(db, {
      session_id: 'sess-update',
      template_name: 'Updated Name',
      mode: 'update',
      program_id: 'prog-DIFFERENT',
      sub_tag: 'DIFFERENT-tag',
      uuid,
      now: () => NOW + 9000,
    });

    const row = await db.getFirstAsync<{
      name: string;
      program_id: string | null;
      sub_tag: string | null;
    }>(
      `SELECT name, program_id, sub_tag FROM template WHERE id = ?`,
      'tpl-tag',
    );
    // Name updated, but program_id / sub_tag stay at original values.
    expect(row?.name).toBe('Updated Name');
    expect(row?.program_id).toBe('prog-orig');
    expect(row?.sub_tag).toBe('orig-tag');
  });

  it('update mode falling back to create (freestyle session) ALSO honors program_id / sub_tag', async () => {
    // No linked template_id on session_exercise rows → create-mode fallback.
    await setupSession({ session_id: 'sess-fallback', template_id: null });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-fallback',
      template_name: 'Fallback With Meta',
      mode: 'update', // → falls back to create because no linked template
      program_id: 'prog-bar',
      sub_tag: '肌耐力',
      uuid,
      now,
    });

    const row = await db.getFirstAsync<{
      program_id: string | null;
      sub_tag: string | null;
    }>(
      `SELECT program_id, sub_tag FROM template WHERE id = ?`,
      newTplId,
    );
    expect(row?.program_id).toBe('prog-bar');
    expect(row?.sub_tag).toBe('肌耐力');
  });
});
