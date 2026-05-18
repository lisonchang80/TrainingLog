import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
  overwriteTemplateFromSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';

/**
 * Regression tests for `overwriteTemplateFromSession` and (in a later commit)
 * `createTemplateFromSession` — both functions previously filtered session
 * set rows by `exercise_id` only, which produced merged set counts whenever
 * two `session_exercise` rows shared an exercise (e.g. two Reusable
 * Supersets that both contain Chest Dip).
 *
 * Fix: same v019 `session_exercise_id` isolation pattern as #17 / #23 / #24 /
 * #27 / #31 — prefer the precise per-card key, fall back to exercise_id only
 * for pre-v019 NULL-tagged legacy rows.
 *
 * These functions only count `default_sets` (no per-set copy), so the bug's
 * blast radius is narrower than #31's, but the anti-pattern is identical.
 */

const NOW = 1_700_000_000_000;

describe('session repo isolation — overwriteTemplateFromSession / createTemplateFromSession', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let cableId: string;
  let chestDipId: string;
  let counter = 0;
  const uuid = () => `uuid-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    cableId = exercises.find((e) => e.name === 'Cable Crossover')!.id;
    chestDipId = exercises.find((e) => e.name === 'Chest Dip')!.id;
    counter = 0;
  });

  afterEach(() => db.close());

  /**
   * Seed a session shaped like: RS1 (Bench A + ChestDip B) + RS2
   * (Cable A + ChestDip B). Two cards share `chestDipId` but have distinct
   * `session_exercise.id`. Each ChestDip card gets exactly 2 sets tagged with
   * its own `session_exercise_id`.
   *
   * Pre-fix the filter `s.exercise_id === se.exercise_id` matched all 4
   * ChestDip set rows for each ChestDip card → default_sets = 4 on both
   * (merged). Post-fix each card sees its own 2 → default_sets = 2.
   */
  async function seedTwoRsSharingChestDip(sessionId: string): Promise<void> {
    await createSession(db, { id: sessionId, started_at: NOW });

    // RS1
    await insertSessionExercise(db, {
      id: 'se-rs1-a',
      session_id: sessionId,
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
      session_id: sessionId,
      exercise_id: chestDipId,
      ordering: 2,
      planned_sets: 2,
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
      session_id: sessionId,
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
      session_id: sessionId,
      exercise_id: chestDipId,
      ordering: 4,
      planned_sets: 2,
      planned_reps: 8,
      planned_weight_kg: 0,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se-rs2-a',
      reusable_superset_id: null,
      rest_sec: 60,
    });

    // ChestDip RS1 B: 2 sets
    await insertSessionSet(db, {
      id: 'set-rs1-b-1',
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: 'se-rs1-b',
      weight_kg: 0,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-rs1-b-2',
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: 'se-rs1-b',
      weight_kg: 0,
      reps: 7,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 1000,
      set_kind: 'working',
      parent_set_id: null,
    });

    // ChestDip RS2 B: 2 sets (distinct card, same exercise_id)
    await insertSessionSet(db, {
      id: 'set-rs2-b-1',
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: 'se-rs2-b',
      weight_kg: 0,
      reps: 6,
      is_skipped: 0,
      ordering: 3,
      created_at: NOW + 2000,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-rs2-b-2',
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: 'se-rs2-b',
      weight_kg: 0,
      reps: 5,
      is_skipped: 0,
      ordering: 4,
      created_at: NOW + 3000,
      set_kind: 'working',
      parent_set_id: null,
    });

    // Bench RS1 A: 1 set (smoke — should not affect ChestDip default_sets)
    await insertSessionSet(db, {
      id: 'set-rs1-a-1',
      session_id: sessionId,
      exercise_id: benchId,
      session_exercise_id: 'se-rs1-a',
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering: 5,
      created_at: NOW + 4000,
      set_kind: 'working',
      parent_set_id: null,
    });
    // Cable RS2 A: 1 set
    await insertSessionSet(db, {
      id: 'set-rs2-a-1',
      session_id: sessionId,
      exercise_id: cableId,
      session_exercise_id: 'se-rs2-a',
      weight_kg: 20,
      reps: 12,
      is_skipped: 0,
      ordering: 6,
      created_at: NOW + 5000,
      set_kind: 'working',
      parent_set_id: null,
    });
  }
  // Re-exported for the createTemplateFromSession suite in a later commit.
  void seedTwoRsSharingChestDip;

  describe('overwriteTemplateFromSession', () => {
    it('Case 1: two RS cards sharing Chest Dip — each card gets its own default_sets count, not the merged 4', async () => {
      const sessionId = 'sess-overwrite-rs';
      const templateId = 'tpl-target';
      await createTemplate(db, {
        id: templateId,
        name: 'Target Template',
        now: () => NOW,
      });
      await seedTwoRsSharingChestDip(sessionId);

      await overwriteTemplateFromSession(db, {
        session_id: sessionId,
        template_id: templateId,
        uuid,
      });

      const teRows = await db.getAllAsync<{
        exercise_id: string;
        default_sets: number;
        ordering: number;
      }>(
        `SELECT exercise_id, default_sets, ordering
           FROM template_exercise
          WHERE template_id = ?
          ORDER BY ordering ASC`,
        templateId,
      );

      expect(teRows).toHaveLength(4);
      // RS1 A = Bench (1 set), RS1 B = ChestDip (2 sets — not 4),
      // RS2 A = Cable (1 set), RS2 B = ChestDip (2 sets — not 4).
      expect(teRows[0].exercise_id).toBe(benchId);
      expect(teRows[0].default_sets).toBe(1);
      expect(teRows[1].exercise_id).toBe(chestDipId);
      expect(teRows[1].default_sets).toBe(2);
      expect(teRows[2].exercise_id).toBe(cableId);
      expect(teRows[2].default_sets).toBe(1);
      expect(teRows[3].exercise_id).toBe(chestDipId);
      expect(teRows[3].default_sets).toBe(2);
    });

    it('Case 3 (legacy fallback): pre-v019 rows with NULL session_exercise_id still match via exercise_id', async () => {
      const sessionId = 'sess-overwrite-legacy';
      const templateId = 'tpl-legacy';
      await createTemplate(db, {
        id: templateId,
        name: 'Legacy Target',
        now: () => NOW,
      });
      await createSession(db, { id: sessionId, started_at: NOW });
      await insertSessionExercise(db, {
        id: 'se-legacy',
        session_id: sessionId,
        exercise_id: chestDipId,
        ordering: 1,
        planned_sets: 3,
        planned_reps: 8,
        planned_weight_kg: 0,
        template_id: null,
        is_evergreen: 0,
        parent_id: null,
        reusable_superset_id: null,
        rest_sec: null,
      });
      // 3 set rows with NULL session_exercise_id (legacy pre-v019 fixture).
      await insertSessionSet(db, {
        id: 'set-legacy-1',
        session_id: sessionId,
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
        session_id: sessionId,
        exercise_id: chestDipId,
        weight_kg: 0,
        reps: 7,
        is_skipped: 0,
        ordering: 2,
        created_at: NOW + 1000,
        set_kind: 'working',
        parent_set_id: null,
      });
      await insertSessionSet(db, {
        id: 'set-legacy-3',
        session_id: sessionId,
        exercise_id: chestDipId,
        weight_kg: 0,
        reps: 6,
        is_skipped: 0,
        ordering: 3,
        created_at: NOW + 2000,
        set_kind: 'working',
        parent_set_id: null,
      });

      await overwriteTemplateFromSession(db, {
        session_id: sessionId,
        template_id: templateId,
        uuid,
      });

      const row = await db.getFirstAsync<{ default_sets: number }>(
        `SELECT default_sets FROM template_exercise WHERE template_id = ?`,
        templateId,
      );
      // Legacy NULL-tagged rows still flow through via the exercise_id
      // fallback branch.
      expect(row?.default_sets).toBe(3);
    });
  });
});
