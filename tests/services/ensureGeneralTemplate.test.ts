import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { ensureGeneralTemplateReady } from '../../src/services/ensureGeneralTemplate';
import {
  createTemplate,
  getTemplateFull,
  findTemplateByTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';

/**
 * Phase B+ (autostart-prefill) — `ensureGeneralTemplateReady` resolves-or-CREATES
 * a name-group's 通用 (null,null) template and prefills an empty one from the
 * user's last workout. Backs both 計劃-mode 通用 start + 極簡-mode start.
 */

const NOW = 1_700_000_000_000;

describe('ensureGeneralTemplateReady', () => {
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

  it('creates a 通用 (null,null) row + prefills it from the last workout when none exists', async () => {
    await seedLastWorkout();
    const id = await ensureGeneralTemplateReady(db, { name: 'Push', uuid, now });

    const full = await getTemplateFull(db, id);
    expect(full).not.toBeNull();
    expect(full!.name).toBe('Push');
    expect(full!.program_id).toBeNull();
    expect(full!.sub_tag).toBeNull();
    // prefilled with the last workout's exercise (bench)
    expect(full!.exercises).toHaveLength(1);
    expect(full!.exercises[0].exercise_id).toBe(benchId);
  });

  it('prefills an EXISTING empty 通用 row in place (keeps its id)', async () => {
    await seedLastWorkout();
    await createTemplate(db, { id: 'gen-empty', name: 'Pull', now });

    const id = await ensureGeneralTemplateReady(db, { name: 'Pull', uuid, now });
    expect(id).toBe('gen-empty'); // same row, not a new one

    const full = await getTemplateFull(db, 'gen-empty');
    expect(full!.exercises).toHaveLength(1);
  });

  it('is idempotent — an existing NON-empty 通用 row is returned as-is (no re-prefill)', async () => {
    await seedLastWorkout();
    const firstId = await ensureGeneralTemplateReady(db, { name: 'Legs', uuid, now });
    const secondId = await ensureGeneralTemplateReady(db, { name: 'Legs', uuid, now });

    expect(secondId).toBe(firstId); // resolved the same 通用 row
    const full = await getTemplateFull(db, firstId);
    expect(full!.exercises).toHaveLength(1); // NOT doubled by a 2nd prefill
  });

  it('creates an empty 通用 row when there is no prior workout (starts blank)', async () => {
    // no seedLastWorkout() — no session with exercises
    const id = await ensureGeneralTemplateReady(db, { name: 'Core', uuid, now });

    const full = await getTemplateFull(db, id);
    expect(full!.name).toBe('Core');
    expect(full!.program_id).toBeNull();
    expect(full!.exercises).toHaveLength(0);
    // and it's findable as the 通用 variant
    const found = await findTemplateByTriple(db, {
      name: 'Core',
      program_id: null,
      sub_tag: null,
    });
    expect(found?.id).toBe(id);
  });
});
