import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
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
 * Coverage fill (overnight 2026-06-03 r2) — `convertSessionToTemplate`
 * dropset-follower parent_set_id rewrite second pass (templateRepository.ts
 * lines 1542-1552). The existing convertSessionToTemplate acceptance suite
 * has no source session containing a dropset chain (parent_set_id != null),
 * so the `oldSet.parent_set_id == null → continue` predicate never went
 * false and the UPDATE-parent rewrite never ran.
 *
 * Here we record a dropset HEAD + follower; the converted template must keep
 * the chain, with the follower's parent_set_id remapped to the NEW head
 * template_set id (not the stale session set id).
 */

const NOW = 1_700_000_000_000;

describe('convertSessionToTemplate — dropset chain parent rewrite', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let counter = 0;
  const uuid = () => `uuid-${++counter}`;
  const now = () => NOW;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    counter = 0;
  });

  afterEach(() => db.close());

  it('remaps a dropset follower parent_set_id to the new template head id', async () => {
    await createSession(db, { id: 'sess-drop', started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-bench',
      session_id: 'sess-drop',
      exercise_id: benchId,
      ordering: 1,
      planned_sets: 2,
      planned_reps: 8,
      planned_weight_kg: 80,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    // Dropset HEAD (parent_set_id NULL) + follower pointing at the head.
    await insertSessionSet(db, {
      id: 'set-head',
      session_id: 'sess-drop',
      exercise_id: benchId,
      session_exercise_id: 'se-bench',
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'dropset',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-follower',
      session_id: 'sess-drop',
      exercise_id: benchId,
      session_exercise_id: 'se-bench',
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 1000,
      set_kind: 'dropset',
      parent_set_id: 'set-head',
    });

    const newTplId = await convertSessionToTemplate(db, {
      session_id: 'sess-drop',
      template_name: 'Dropset Convert',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, newTplId);
    expect(tpl!.exercises).toHaveLength(1);
    const sets = tpl!.exercises[0].sets;
    expect(sets).toHaveLength(2);

    const head = sets.find((s) => s.parent_set_id == null)!;
    const follower = sets.find((s) => s.parent_set_id != null)!;
    expect(head).toBeTruthy();
    expect(follower).toBeTruthy();
    // The rewrite second pass must point the follower at the NEW head id,
    // never the stale session-set 'set-head' id.
    expect(follower.parent_set_id).toBe(head.id);
    expect(follower.parent_set_id).not.toBe('set-head');
    // Both rows preserved kind / values.
    expect(head.kind).toBe('dropset');
    expect(follower.kind).toBe('dropset');
    expect(head.weight).toBe(100);
    expect(follower.weight).toBe(80);
  });
});
