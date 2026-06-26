import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSessionSet,
  reorderSessionSetsForExercise,
} from '../../src/adapters/sqlite/setRepository';
import {
  convertSessionToTemplate,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';

/**
 * Regression: 另存模板 (convertSessionToTemplate) must capture each card's
 * sets in the VISIBLE order (`display_rank ?? ordering`), not the stale
 * on-disk `ordering`.
 *
 * Before the fix, `convertSessionToTemplate` fetched sets `ORDER BY ordering`
 * and stamped `template_set.position` = loop index — so a session whose sets
 * were reordered / mid-inserted (which writes `display_rank` and LEAVES
 * `ordering` frozen as the identity key, per set-ordering-surfaces / F2 Opt A)
 * saved the template in the PRE-reorder order. The user sees one order in the
 * session but the saved template freezes another.
 *
 * The fix sorts each card's sets with the canonical `sortSetsByDisplayRank`
 * comparator before assigning `position`.
 */
describe('convertSessionToTemplate — set order follows display_rank', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let counter = 0;
  const uuid = () => `uuid-${++counter}`;
  const NOW = 1_700_000_000_000;
  const now = () => NOW;
  const sessionId = 'sess-dr';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    benchId = (await listExercises(db)).find((e) => e.name === 'Bench Press')!.id;
    counter = 0;
    await createSession(db, { id: sessionId, started_at: NOW });
    await insertSessionExercise(db, {
      id: 'se-bench',
      session_id: sessionId,
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
  });

  afterEach(() => db.close());

  async function insertSet(id: string, ordering: number, weight: number) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id: benchId,
      weight_kg: weight,
      reps: 5,
      is_skipped: 0,
      ordering,
      created_at: NOW + ordering,
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  it('captures the reordered (display) order, not the creation order', async () => {
    // Creation order a1,a2,a3 (weights 80,85,90 — used as a stable identity).
    await insertSet('a1', 1, 80);
    await insertSet('a2', 2, 85);
    await insertSet('a3', 3, 90);

    // User drags to a3, a1, a2 → writes display_rank 0,1,2 in that order,
    // ordering stays 1,2,3 (identity key, untouched).
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: benchId,
      orderedIds: ['a3', 'a1', 'a2'],
    });

    const tplId = await convertSessionToTemplate(db, {
      session_id: sessionId,
      template_name: 'Reordered Convert',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, tplId);
    // template_set positions must follow the VISIBLE order a3,a1,a2.
    expect(tpl!.exercises[0].sets.map((s) => s.weight)).toEqual([90, 80, 85]);
  });

  it('falls back to creation order when no display_rank was written', async () => {
    // No reorder → display_rank stays NULL → display order == creation order.
    await insertSet('a1', 1, 80);
    await insertSet('a2', 2, 85);
    await insertSet('a3', 3, 90);

    const tplId = await convertSessionToTemplate(db, {
      session_id: sessionId,
      template_name: 'Untouched Convert',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, tplId);
    expect(tpl!.exercises[0].sets.map((s) => s.weight)).toEqual([80, 85, 90]);
  });
});
