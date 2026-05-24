/**
 * Card 11 / ADR-0014 — startSessionFromTemplate pre-seeds session.title
 * with the template name so the in-session header reads sensibly from the
 * first frame (no separate UPDATE round-trip needed).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import { getSession } from '../../src/adapters/sqlite/sessionRepository';

describe('startSessionFromTemplate — Card 11 session.title pre-seed', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('writes session.title = template.name on insert', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, {
      id: 'tpl-named',
      name: 'Hypertrophy Push A',
      now: () => 100,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-named',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 8,
      default_weight_kg: 60,
      now: () => 100,
      uuid,
    });

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-named',
      uuid,
      now: () => 200,
    });

    const sess = await getSession(db, session_id);
    expect(sess?.title).toBe('Hypertrophy Push A');
  });
});
