/**
 * 補訓練 (backfill) session creation — grill 2026-06-26, 架構方案 B.
 *
 * Locks the two invariants that make 方案 B safe:
 *   1. A backfilled session is BORN FINISHED — `ended_at` is set on creation
 *      (> started_at), so it never occupies the single-active-session slot.
 *   2. The template path SKIPS the active-session guard, so a backfill can be
 *      created while a real live session is in progress — without disturbing
 *      which session `getActiveSession` reports.
 * Plus: blank → no exercises; template → seeded sets land 「完全未打勾」
 * (is_logged = 0); started_at is the back-dated value (calendar bucketing).
 */
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';
import {
  createSession,
  getActiveSession,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  backfillBlankSession,
  backfillSessionFromTemplate,
} from '../../src/services/backfillSession';

async function insertTemplateExercise(
  db: BetterSqliteDatabase,
  row: { id: string; template_id: string; exercise_id: string; ordering: number },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO template_exercise
       (id, template_id, exercise_id, ordering, default_sets, default_reps,
        default_weight_kg, is_evergreen, rest_seconds, parent_id, reusable_superset_id)
     VALUES (?, ?, ?, ?, 0, 8, 20, 0, NULL, NULL, NULL)`,
    row.id,
    row.template_id,
    row.exercise_id,
    row.ordering,
  );
}

async function insertTemplateSet(
  db: BetterSqliteDatabase,
  row: { id: string; template_exercise_id: string; position: number },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO template_set
       (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
     VALUES (?, ?, ?, 'working', 8, 80, NULL)`,
    row.id,
    row.template_exercise_id,
    row.position,
  );
}

describe('backfillSession', () => {
  let db: BetterSqliteDatabase;
  let bench: { id: string };
  const uuid = (() => {
    let n = 0;
    return () => `bf-${++n}`;
  })();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    bench = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
  });

  afterEach(() => {
    db.close();
  });

  describe('backfillBlankSession', () => {
    it('creates a session born finished (ended_at set, > started_at) with no exercises', async () => {
      const id = await backfillBlankSession(db, {
        id: 'blank-1',
        started_at: 1_000,
        ended_at: 1_000 + 3_600_000,
      });
      expect(id).toBe('blank-1');

      const row = await db.getFirstAsync<{
        started_at: number;
        ended_at: number | null;
      }>(`SELECT started_at, ended_at FROM session WHERE id = ?`, id);
      expect(row?.started_at).toBe(1_000);
      expect(row?.ended_at).not.toBeNull();
      expect(row!.ended_at!).toBeGreaterThan(row!.started_at);

      const se = await db.getAllAsync(
        `SELECT id FROM session_exercise WHERE session_id = ?`,
        id,
      );
      expect(se).toHaveLength(0);
    });

    it('floors ended_at to > started_at even if an equal end is passed', async () => {
      await backfillBlankSession(db, {
        id: 'blank-2',
        started_at: 5_000,
        ended_at: 5_000, // endSession floors this to started_at + 1
      });
      const row = await db.getFirstAsync<{ started_at: number; ended_at: number }>(
        `SELECT started_at, ended_at FROM session WHERE id = ?`,
        'blank-2',
      );
      expect(row!.ended_at).toBeGreaterThan(row!.started_at);
    });

    it('never occupies the active slot (no live session afterward)', async () => {
      await backfillBlankSession(db, {
        id: 'blank-3',
        started_at: 1_000,
        ended_at: 2_000,
      });
      expect(await getActiveSession(db)).toBeNull();
    });
  });

  describe('backfillSessionFromTemplate', () => {
    beforeEach(async () => {
      await createTemplate(db, { id: 'tpl', name: 'Push Day', now: () => 100 });
      await insertTemplateExercise(db, {
        id: 'te-1',
        template_id: 'tpl',
        exercise_id: bench.id,
        ordering: 0,
      });
      await insertTemplateSet(db, {
        id: 'ts-1',
        template_exercise_id: 'te-1',
        position: 0,
      });
    });

    it('creates a finished session seeded from the template, back-dated', async () => {
      const id = await backfillSessionFromTemplate(db, {
        template_id: 'tpl',
        started_at: 1_000,
        ended_at: 1_000 + 3_600_000,
        uuid,
      });
      const row = await db.getFirstAsync<{
        started_at: number;
        ended_at: number | null;
        title: string | null;
      }>(`SELECT started_at, ended_at, title FROM session WHERE id = ?`, id);
      expect(row?.started_at).toBe(1_000);
      expect(row?.ended_at).not.toBeNull();
      expect(row?.title).toBe('Push Day'); // pre-seeded template name

      const se = await db.getAllAsync(
        `SELECT id FROM session_exercise WHERE session_id = ?`,
        id,
      );
      expect(se).toHaveLength(1);
    });

    it('seeds sets 「完全未打勾」 (is_logged = 0)', async () => {
      const id = await backfillSessionFromTemplate(db, {
        template_id: 'tpl',
        started_at: 1_000,
        ended_at: 2_000,
        uuid,
      });
      const sets = await db.getAllAsync<{ is_logged: number }>(
        `SELECT is_logged FROM "set" WHERE session_id = ?`,
        id,
      );
      expect(sets.length).toBeGreaterThan(0);
      expect(sets.every((s) => s.is_logged === 0)).toBe(true);
    });

    it('skips the active-session guard — backfill while a live session is in progress', async () => {
      // A real live session (ended_at NULL) is in progress.
      await createSession(db, { id: 'live', started_at: 9_000 });
      expect((await getActiveSession(db))?.id).toBe('live');

      // Backfill into the past — would throw without skip_active_guard.
      const id = await backfillSessionFromTemplate(db, {
        template_id: 'tpl',
        started_at: 1_000,
        ended_at: 2_000,
        uuid,
      });
      const bf = await db.getFirstAsync<{ ended_at: number | null }>(
        `SELECT ended_at FROM session WHERE id = ?`,
        id,
      );
      expect(bf?.ended_at).not.toBeNull(); // born finished

      // The LIVE session is still the active one — backfill didn't steal it.
      expect((await getActiveSession(db))?.id).toBe('live');
    });
  });
});
