import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  attachTemplateToProgram,
  createTemplate,
  convertSessionToTemplate,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
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

  // v022 `program_sub_tag` FK requires the program row to exist before
  // `recordProgramSubTag` fires (called from `convertSessionToTemplate`'s
  // create-path when args.program_id is non-null). Tests pre-this commit
  // used phantom program_ids since `template.program_id` was added via
  // ALTER TABLE (SQLite skips FK on added columns). Seed program rows for
  // any test that passes a real program_id.
  async function seedProgram(id: string): Promise<void> {
    await createProgram(db, {
      program: {
        id,
        name: `seed-${id}`,
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-05-29',
        is_active: 0,
      },
    });
  }

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

  it('update mode with a DANGLING linked template_id (template deleted): falls back to create + relinks, no orphan (C2)', async () => {
    // Simulate the linked template having been deleted while
    // session_exercise.template_id was left pointing at it (no FK CASCADE nulls
    // it). Without the existence guard, update mode would treat the ghost id as
    // the overwrite target → strand orphan template_exercise rows (FK off) or
    // trip the FK (FK on). The guard must drop to create-mode + relink instead.
    await setupSession({ session_id: 'sess-ghost', template_id: null });
    await db.runAsync(
      `UPDATE session_exercise SET template_id = ? WHERE session_id = ?`,
      'tpl-ghost-deleted',
      'sess-ghost',
    );
    const ghost = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM template WHERE id = ?`,
      'tpl-ghost-deleted',
    );
    expect(ghost).toBeNull(); // sanity — the linked template really is gone

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-ghost',
      template_name: 'Recovered',
      mode: 'update',
      uuid,
      now,
    });

    // A brand-new template row was created (NOT the ghost id).
    expect(newTplId).not.toBe('tpl-ghost-deleted');
    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl?.name).toBe('Recovered');
    expect(tpl!.exercises).toHaveLength(2);

    // session_exercise rows relinked to the new template.
    const rows = await db.getAllAsync<{ template_id: string | null }>(
      `SELECT template_id FROM session_exercise
        WHERE session_id = ? ORDER BY ordering ASC`,
      'sess-ghost',
    );
    expect(rows.map((r) => r.template_id)).toEqual([newTplId, newTplId]);

    // No orphan template_exercise rows reference the ghost id.
    const orphans = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM template_exercise WHERE template_id = ?`,
      'tpl-ghost-deleted',
    );
    expect(orphans?.c).toBe(0);
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
    await seedProgram('prog-foo');

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

  // 2026-05-18: #31 — Two Reusable Supersets in the same session share an
  // exercise (e.g. RS1=Bench+Chest, RS2=Cable+Chest, both contain Chest Dip).
  // Before this fix the cluster set filter only matched on exercise_id, so
  // each Chest Dip card received the OTHER card's Chest Dip sets too — the
  // saved template ended up with merged set lists on both B sides. We repro
  // the parent_id pair structure with NULL reusable_superset_id (avoids
  // needing a real superset row for the FK — the v019 `session_exercise_id`
  // column on `set` is what drives the bug + the fix; both branches of the
  // filter behave the same regardless of RS template wiring).
  //
  // Same isolation pattern as #17 / #23 / #24 / #27 wave fixes.
  describe('two RS cards sharing an exercise (#31 cluster set isolation)', () => {
    let chestDipId: string;
    let cableId: string;

    beforeEach(async () => {
      const exercises = await listExercises(db);
      chestDipId = exercises.find((e) => e.name === 'Chest Dip')!.id;
      cableId = exercises.find((e) => e.name === 'Cable Crossover')!.id;
    });

    it('Case A: per-card sets stay isolated when session_exercise_id is populated', async () => {
      // Build a session that mimics: RS1 (Bench A + ChestDip B) + RS2
      // (Cable A + ChestDip B). 4 session_exercise rows, two of which share
      // chestDipId. Each card has its own session_exercise.id.
      await createSession(db, { id: 'sess-rs', started_at: NOW });

      // RS1
      await insertSessionExercise(db, {
        id: 'se-rs1-a',
        session_id: 'sess-rs',
        exercise_id: benchId,
        ordering: 1,
        planned_sets: 2,
        planned_reps: 10,
        planned_weight_kg: 60,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: null,
        rest_sec: 60,
      });
      await insertSessionExercise(db, {
        id: 'se-rs1-b',
        session_id: 'sess-rs',
        exercise_id: chestDipId,
        ordering: 2,
        planned_sets: 1,
        planned_reps: 8,
        planned_weight_kg: 0,
        template_id: null,
        is_evergreen: 0,
        parent_id: 'se-rs1-a',
        reusable_superset_id: null,
        rest_sec: 60,
      });

      // RS2
      await insertSessionExercise(db, {
        id: 'se-rs2-a',
        session_id: 'sess-rs',
        exercise_id: cableId,
        ordering: 3,
        planned_sets: 1,
        planned_reps: 12,
        planned_weight_kg: 20,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: null,
        rest_sec: 60,
      });
      await insertSessionExercise(db, {
        id: 'se-rs2-b',
        session_id: 'sess-rs',
        exercise_id: chestDipId,
        ordering: 4,
        planned_sets: 1,
        planned_reps: 8,
        planned_weight_kg: 0,
        template_id: null,
        is_evergreen: 0,
        parent_id: 'se-rs2-a',
        reusable_superset_id: null,
        rest_sec: 60,
      });

      // Bench (RS1 A): 2 sets
      await insertSessionSet(db, {
        id: 'set-rs1-a-1',
        session_id: 'sess-rs',
        exercise_id: benchId,
        session_exercise_id: 'se-rs1-a',
        weight_kg: 60,
        reps: 10,
        is_skipped: 0,
        ordering: 1,
        created_at: NOW,
        set_kind: 'working',
        parent_set_id: null,
      });
      await insertSessionSet(db, {
        id: 'set-rs1-a-2',
        session_id: 'sess-rs',
        exercise_id: benchId,
        session_exercise_id: 'se-rs1-a',
        weight_kg: 65,
        reps: 8,
        is_skipped: 0,
        ordering: 2,
        created_at: NOW + 1000,
        set_kind: 'working',
        parent_set_id: null,
      });

      // Chest Dip (RS1 B): 1 set
      await insertSessionSet(db, {
        id: 'set-rs1-b-1',
        session_id: 'sess-rs',
        exercise_id: chestDipId,
        session_exercise_id: 'se-rs1-b',
        weight_kg: 0,
        reps: 8,
        is_skipped: 0,
        ordering: 3,
        created_at: NOW + 2000,
        set_kind: 'working',
        parent_set_id: null,
      });

      // Cable (RS2 A): 1 set
      await insertSessionSet(db, {
        id: 'set-rs2-a-1',
        session_id: 'sess-rs',
        exercise_id: cableId,
        session_exercise_id: 'se-rs2-a',
        weight_kg: 20,
        reps: 12,
        is_skipped: 0,
        ordering: 4,
        created_at: NOW + 3000,
        set_kind: 'working',
        parent_set_id: null,
      });

      // Chest Dip (RS2 B): 1 set — distinct card from RS1 B even though
      // they share exercise_id.
      await insertSessionSet(db, {
        id: 'set-rs2-b-1',
        session_id: 'sess-rs',
        exercise_id: chestDipId,
        session_exercise_id: 'se-rs2-b',
        weight_kg: 0,
        reps: 6,
        is_skipped: 0,
        ordering: 5,
        created_at: NOW + 4000,
        set_kind: 'working',
        parent_set_id: null,
      });

      const newTplId = await convertSessionToTemplate(db, {
        session_id: 'sess-rs',
        template_name: 'Two RS Sharing Chest Dip',
        mode: 'create',
        uuid,
        now,
      });

      const tpl = await getTemplateFull(db, newTplId);
      expect(tpl).not.toBeNull();
      expect(tpl!.exercises).toHaveLength(4);

      // Order follows session_exercise.ordering ASC.
      const [rs1A, rs1B, rs2A, rs2B] = tpl!.exercises;

      // Bench (RS1 A) — 2 sets, both bench rows.
      expect(rs1A.exercise_id).toBe(benchId);
      expect(rs1A.sets).toHaveLength(2);

      // Chest Dip (RS1 B) — exactly 1 set, NOT 2. This is the bug fix.
      expect(rs1B.exercise_id).toBe(chestDipId);
      expect(rs1B.sets).toHaveLength(1);
      expect(rs1B.sets[0].reps).toBe(8); // the RS1 B set

      // Cable (RS2 A) — 1 set.
      expect(rs2A.exercise_id).toBe(cableId);
      expect(rs2A.sets).toHaveLength(1);

      // Chest Dip (RS2 B) — exactly 1 set, NOT 2. Independent from RS1 B.
      expect(rs2B.exercise_id).toBe(chestDipId);
      expect(rs2B.sets).toHaveLength(1);
      expect(rs2B.sets[0].reps).toBe(6); // the RS2 B set, not 8
    });

    it('Case B: legacy pre-v019 rows with NULL session_exercise_id still fall back to exercise_id match', async () => {
      // Single Chest Dip card, no RS sharing — legacy fixture style where
      // session_exercise_id was never set. The fallback branch in the filter
      // (s.session_exercise_id == null && s.exercise_id === se.exercise_id)
      // ensures these still land in the template.
      await createSession(db, { id: 'sess-legacy', started_at: NOW });
      await insertSessionExercise(db, {
        id: 'se-legacy-dip',
        session_id: 'sess-legacy',
        exercise_id: chestDipId,
        ordering: 1,
        planned_sets: 2,
        planned_reps: 8,
        planned_weight_kg: 0,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: null,
        rest_sec: null,
      });

      // Insert sets WITHOUT session_exercise_id (NULL — pre-v019 untagged).
      await insertSessionSet(db, {
        id: 'set-legacy-1',
        session_id: 'sess-legacy',
        exercise_id: chestDipId,
        // session_exercise_id intentionally omitted → NULL
        weight_kg: 0,
        reps: 8,
        is_skipped: 0,
        ordering: 1,
        created_at: NOW,
        set_kind: 'working',
        parent_set_id: null,
      });
      await insertSessionSet(db, {
        id: 'set-legacy-2',
        session_id: 'sess-legacy',
        exercise_id: chestDipId,
        weight_kg: 0,
        reps: 6,
        is_skipped: 0,
        ordering: 2,
        created_at: NOW + 1000,
        set_kind: 'working',
        parent_set_id: null,
      });

      const newTplId = await convertSessionToTemplate(db, {
        session_id: 'sess-legacy',
        template_name: 'Legacy Fallback',
        mode: 'create',
        uuid,
        now,
      });

      const tpl = await getTemplateFull(db, newTplId);
      expect(tpl!.exercises).toHaveLength(1);
      // Fallback path still picks up both NULL-tagged rows.
      expect(tpl!.exercises[0].sets).toHaveLength(2);
    });
  });

  it('update mode falling back to create (freestyle session) ALSO honors program_id / sub_tag', async () => {
    // No linked template_id on session_exercise rows → create-mode fallback.
    await setupSession({ session_id: 'sess-fallback', template_id: null });
    await seedProgram('prog-bar');

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

  // 2026-05-20 overnight #55 (slice 10c 另存模板 dup-triple guard):
  // create mode (and update-fallback-to-create) now refuses to INSERT a new
  // template row when a row already exists with the same (name, program_id,
  // sub_tag) triple — mirrors `cloneTemplateWithSubTag`'s pattern. UI surfaces
  // the throw as an Alert so user can rename + retry inline.
  describe('create-mode dup-triple guard (overnight #55)', () => {
    it('throws DUPLICATE_TEMPLATE_TRIPLE when (name, program_id, sub_tag) already exists (all non-null)', async () => {
      await setupSession({ session_id: 'sess-dup1', template_id: null });
      await seedProgram('prog-x');

      // First save succeeds.
      await convertSessionToTemplate(db, {
        session_id: 'sess-dup1',
        template_name: 'Dup Name',
        mode: 'create',
        program_id: 'prog-x',
        sub_tag: '5x5',
        uuid,
        now,
      });

      // Second save with the same triple → throws.
      await expect(
        convertSessionToTemplate(db, {
          session_id: 'sess-dup1',
          template_name: 'Dup Name',
          mode: 'create',
          program_id: 'prog-x',
          sub_tag: '5x5',
          uuid,
          now,
        })
      ).rejects.toThrow('DUPLICATE_TEMPLATE_TRIPLE');
    });

    it('throws DUPLICATE_TEMPLATE_TRIPLE for NULL/NULL collisions (free template)', async () => {
      await setupSession({ session_id: 'sess-dup2', template_id: null });

      await convertSessionToTemplate(db, {
        session_id: 'sess-dup2',
        template_name: 'Free Dup',
        mode: 'create',
        uuid,
        now,
      });

      await expect(
        convertSessionToTemplate(db, {
          session_id: 'sess-dup2',
          template_name: 'Free Dup',
          mode: 'create',
          uuid,
          now,
        })
      ).rejects.toThrow('DUPLICATE_TEMPLATE_TRIPLE');
    });

    it('allows same name under a different (program, sub_tag) — siblings via ADR-0003 三元組 identity', async () => {
      await setupSession({ session_id: 'sess-sib', template_id: null });
      await seedProgram('prog-a');

      await convertSessionToTemplate(db, {
        session_id: 'sess-sib',
        template_name: 'Push Day',
        mode: 'create',
        program_id: 'prog-a',
        sub_tag: '5x5',
        uuid,
        now,
      });

      // Same name, different sub_tag → allowed (sibling).
      const sibId = await convertSessionToTemplate(db, {
        session_id: 'sess-sib',
        template_name: 'Push Day',
        mode: 'create',
        program_id: 'prog-a',
        sub_tag: '10x3',
        uuid,
        now,
      });
      const sib = await getTemplateFull(db, sibId);
      expect(sib).not.toBeNull();
    });

    it('update mode does NOT trigger the dup guard (overwrites the linked row in place)', async () => {
      // Pre-create the target template + link it via session_exercise rows.
      await createTemplate(db, { id: 'tpl-target', name: 'Existing', now });
      await setupSession({ session_id: 'sess-upd', template_id: 'tpl-target' });

      // Pre-create ANOTHER template with the SAME name we're about to write
      // (NULL/NULL triple). If the dup guard fired, this would block update.
      await createTemplate(db, { id: 'tpl-other', name: 'New Name', now });

      // Update should succeed — guards out via isUpdatingExisting=true.
      await expect(
        convertSessionToTemplate(db, {
          session_id: 'sess-upd',
          template_name: 'New Name',
          mode: 'update',
          uuid,
          now: () => NOW + 5000,
        })
      ).resolves.toBe('tpl-target');
    });
  });

  describe('overwriteTemplateId (#3 ① triple-collision overwrite)', () => {
    async function countTemplates(): Promise<number> {
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM template`,
      );
      return row?.c ?? 0;
    }

    it('writes the session body into the target row in place, keeps its id', async () => {
      await seedProgram('prog-1');
      await createTemplate(db, { id: 'tpl-Y', name: 'Chest', now });
      await attachTemplateToProgram(db, {
        template_id: 'tpl-Y',
        program_id: 'prog-1',
        sub_tag: 'A',
        now,
      });
      await setupSession({ session_id: 'sess-ow' });
      const before = await countTemplates();

      const ret = await convertSessionToTemplate(db, {
        session_id: 'sess-ow',
        template_name: 'Chest',
        mode: 'create',
        program_id: 'prog-1',
        sub_tag: 'A',
        overwriteTemplateId: 'tpl-Y',
        uuid,
        now: () => NOW + 5000,
      });

      expect(ret).toBe('tpl-Y'); // same row, not a new uuid
      expect(await countTemplates()).toBe(before); // no new template created
      const full = await getTemplateFull(db, 'tpl-Y');
      expect(full?.exercises.length).toBe(2); // session's bench + squat
    });

    it('bypasses the dup-triple guard that would otherwise throw', async () => {
      await seedProgram('prog-1');
      await createTemplate(db, { id: 'tpl-Y', name: 'Chest', now });
      await attachTemplateToProgram(db, {
        template_id: 'tpl-Y',
        program_id: 'prog-1',
        sub_tag: 'A',
        now,
      });
      await setupSession({ session_id: 'sess-ow' });

      // Same (name, program, sub_tag) WITHOUT overwrite → dup guard throws.
      await expect(
        convertSessionToTemplate(db, {
          session_id: 'sess-ow',
          template_name: 'Chest',
          mode: 'create',
          program_id: 'prog-1',
          sub_tag: 'A',
          uuid,
          now,
        }),
      ).rejects.toThrow('DUPLICATE_TEMPLATE_TRIPLE');

      // With overwriteTemplateId → succeeds against the same row.
      await expect(
        convertSessionToTemplate(db, {
          session_id: 'sess-ow',
          template_name: 'Chest',
          mode: 'create',
          program_id: 'prog-1',
          sub_tag: 'A',
          overwriteTemplateId: 'tpl-Y',
          uuid,
          now,
        }),
      ).resolves.toBe('tpl-Y');
    });

    it('preserves the target identity (program_id / sub_tag) even if args differ', async () => {
      await seedProgram('prog-1');
      await seedProgram('prog-2');
      await createTemplate(db, { id: 'tpl-Y', name: 'Chest', now });
      await attachTemplateToProgram(db, {
        template_id: 'tpl-Y',
        program_id: 'prog-1',
        sub_tag: 'A',
        now,
      });
      await setupSession({ session_id: 'sess-ow' });

      await convertSessionToTemplate(db, {
        session_id: 'sess-ow',
        template_name: 'Chest',
        mode: 'create',
        program_id: 'prog-2', // different — must be ignored on overwrite
        sub_tag: 'B',
        overwriteTemplateId: 'tpl-Y',
        uuid,
        now: () => NOW + 5000,
      });

      const full = await getTemplateFull(db, 'tpl-Y');
      expect(full?.program_id).toBe('prog-1'); // kept its own identity
      expect(full?.sub_tag).toBe('A');
    });
  });

  describe('dropset chain conversion', () => {
    // Seed a single bench session_exercise holding a dropset chain
    // (head H + 2 followers F1/F2) so the convert function's second-pass
    // parent_set_id rewrite runs (template_set.parent_set_id must point at
    // the cloned HEAD, not the source set id).
    async function setupDropsetSession(session_id: string): Promise<void> {
      await createSession(db, { id: session_id, started_at: NOW });
      await insertSessionExercise(db, {
        id: 'se-bench-drop',
        session_id,
        exercise_id: benchId,
        ordering: 1,
        planned_sets: 3,
        planned_reps: 8,
        planned_weight_kg: 80,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: null,
        rest_sec: null,
      });
      const seed = async (
        id: string,
        ordering: number,
        weight_kg: number,
        parent_set_id: string | null,
      ) => {
        await insertSessionSet(db, {
          id,
          session_id,
          exercise_id: benchId,
          weight_kg,
          reps: 8,
          is_skipped: 0,
          ordering,
          created_at: NOW + ordering * 1000,
          set_kind: 'dropset',
          parent_set_id,
          session_exercise_id: 'se-bench-drop',
        });
      };
      await seed('drop-h', 1, 80, null); // chain head
      await seed('drop-f1', 2, 60, 'drop-h'); // follower → head
      await seed('drop-f2', 3, 40, 'drop-h'); // follower → head
    }

    it('preserves the dropset chain linkage (followers re-anchored to the cloned head)', async () => {
      await setupDropsetSession('sess-drop');

      const newTplId = await convertSessionToTemplate(db, {
        session_id: 'sess-drop',
        template_name: 'Dropset Convert',
        mode: 'create',
        uuid,
        now,
      });

      const tpl = await getTemplateFull(db, newTplId);
      expect(tpl).not.toBeNull();
      expect(tpl!.exercises).toHaveLength(1);
      const sets = tpl!.exercises[0].sets;
      expect(sets).toHaveLength(3);
      expect(sets.map((s) => s.kind)).toEqual(['dropset', 'dropset', 'dropset']);

      // Head row has no parent; both followers point at the SAME new head id.
      const head = sets[0];
      const f1 = sets[1];
      const f2 = sets[2];
      expect(head.parent_set_id).toBeNull();
      expect(f1.parent_set_id).toBe(head.id);
      expect(f2.parent_set_id).toBe(head.id);
      // The rewritten parent id must be a freshly-cloned template_set id, not
      // the source session set id.
      expect(f1.parent_set_id).not.toBe('drop-h');
      // Weight schedule preserved in chain order.
      expect(sets.map((s) => s.weight)).toEqual([80, 60, 40]);
    });
  });
});
