import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { ensureTemplateVariantReady } from '../../src/services/ensureTemplateVariant';
import {
  createTemplate,
  attachTemplateToProgram,
  getTemplateFull,
  findTemplateByTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';

/**
 * Autostart-prefill option 1 推廣 (2026-06-26) — `ensureTemplateVariantReady`
 * resolves-or-CREATES the picked (name, program_id, sub_tag) variant and prefills
 * an empty one from the user's last workout. Backs onSheetStart (ALL selections)
 * + 極簡-mode start. 通用 = (null, null); classified rows get attached so they
 * carry the (program, sub_tag) + the session subtitle reads honestly.
 */

const NOW = 1_700_000_000_000;

describe('ensureTemplateVariantReady', () => {
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
        is_active: 0,
      },
    });
  });

  afterEach(() => db.close());

  /** Seed a completed session with one logged Bench exercise = prefill source. */
  async function seedLastWorkout(): Promise<void> {
    await createSession(db, { id: 'sess-last', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-bench',
      session_id: 'sess-last',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionSet(db, {
      id: 'set-b1',
      session_id: 'sess-last',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  // ── 通用 (null, null) ───────────────────────────────────────────────

  it('creates a 通用 (null,null) row + prefills it from the last workout when none exists', async () => {
    await seedLastWorkout();
    const id = await ensureTemplateVariantReady(db, {
      name: 'Push',
      program_id: null,
      sub_tag: null,
      uuid,
      now,
    });

    const full = await getTemplateFull(db, id);
    expect(full).not.toBeNull();
    expect(full!.name).toBe('Push');
    expect(full!.program_id).toBeNull();
    expect(full!.sub_tag).toBeNull();
    expect(full!.exercises).toHaveLength(1);
    expect(full!.exercises[0].exercise_id).toBe(benchId);
  });

  // ── 分類變體 (program, sub_tag) — option 1 推廣的核心 ────────────────

  it('creates a CLASSIFIED (program, sub_tag) row + attaches the classification when none exists', async () => {
    await seedLastWorkout();
    const id = await ensureTemplateVariantReady(db, {
      name: 'A',
      program_id: 'prog-A',
      sub_tag: '強度A',
      uuid,
      now,
    });

    const full = await getTemplateFull(db, id);
    expect(full).not.toBeNull();
    expect(full!.name).toBe('A');
    // 反 #50：新建的列帶上使用者選的分類（不是退回通用/representative）
    expect(full!.program_id).toBe('prog-A');
    expect(full!.sub_tag).toBe('強度A');
    // 且照樣 prefill
    expect(full!.exercises).toHaveLength(1);
    expect(full!.exercises[0].exercise_id).toBe(benchId);
    // findable as the exact (program, sub_tag) variant
    const found = await findTemplateByTriple(db, {
      name: 'A',
      program_id: 'prog-A',
      sub_tag: '強度A',
    });
    expect(found?.id).toBe(id);
  });

  it('program-only classification (sub_tag null) attaches the program', async () => {
    await seedLastWorkout();
    const id = await ensureTemplateVariantReady(db, {
      name: 'A',
      program_id: 'prog-A',
      sub_tag: null,
      uuid,
      now,
    });
    const full = await getTemplateFull(db, id);
    expect(full!.program_id).toBe('prog-A');
    expect(full!.sub_tag).toBeNull();
  });

  it('does NOT touch an existing classified sibling — only materialises the picked triple', async () => {
    // group「A」only has prog-A·強度B; user picks prog-A·強度A → a NEW row, the
    // existing 強度B sibling is left intact (was the #50 fallback victim before).
    await createTemplate(db, { id: 'tpl-ab', name: 'A', now });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-ab',
      program_id: 'prog-A',
      sub_tag: '強度B',
    });

    const id = await ensureTemplateVariantReady(db, {
      name: 'A',
      program_id: 'prog-A',
      sub_tag: '強度A',
      uuid,
      now,
    });
    expect(id).not.toBe('tpl-ab'); // a fresh row, not the 強度B sibling

    const sibling = await getTemplateFull(db, 'tpl-ab');
    expect(sibling!.sub_tag).toBe('強度B'); // untouched
    const created = await getTemplateFull(db, id);
    expect(created!.sub_tag).toBe('強度A');
  });

  // ── idempotency / existing rows ─────────────────────────────────────

  it('prefills an EXISTING empty row in place (keeps its id)', async () => {
    await seedLastWorkout();
    await createTemplate(db, { id: 'gen-empty', name: 'Pull', now });

    const id = await ensureTemplateVariantReady(db, {
      name: 'Pull',
      program_id: null,
      sub_tag: null,
      uuid,
      now,
    });
    expect(id).toBe('gen-empty'); // same row, not a new one

    const full = await getTemplateFull(db, 'gen-empty');
    expect(full!.exercises).toHaveLength(1);
  });

  it('is idempotent — an existing NON-empty row is returned as-is (no re-prefill)', async () => {
    await seedLastWorkout();
    const firstId = await ensureTemplateVariantReady(db, {
      name: 'Legs',
      program_id: null,
      sub_tag: null,
      uuid,
      now,
    });
    const secondId = await ensureTemplateVariantReady(db, {
      name: 'Legs',
      program_id: null,
      sub_tag: null,
      uuid,
      now,
    });

    expect(secondId).toBe(firstId); // resolved the same row
    const full = await getTemplateFull(db, firstId);
    expect(full!.exercises).toHaveLength(1); // NOT doubled by a 2nd prefill
  });

  it('creates an empty row when there is no prior workout (starts blank)', async () => {
    // no seedLastWorkout() — no session with exercises
    const id = await ensureTemplateVariantReady(db, {
      name: 'Core',
      program_id: 'prog-A',
      sub_tag: '強度A',
      uuid,
      now,
    });

    const full = await getTemplateFull(db, id);
    expect(full!.name).toBe('Core');
    expect(full!.program_id).toBe('prog-A');
    expect(full!.sub_tag).toBe('強度A');
    expect(full!.exercises).toHaveLength(0);
  });
});
