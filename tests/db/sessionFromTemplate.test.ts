/**
 * Bug X regression lock — `startSessionFromTemplate` session_exercise tree.
 *
 * `startSessionFromTemplate` is the canonical UUID + session_exercise tree that
 * the Watch live-mirror reconcile (`replaceLiveMirror`) must align to. Bug X
 * (2026-05-30, real device) was a duplicate-session_exercise bug rooted in an
 * ordering-space mismatch: `snapshotForSession` re-indexes session_exercise
 * `ordering` to a dense **1..N** sequence, whereas the Watch wire carries the
 * raw `template_exercise.ordering` (0-based / sparse convention). The first
 * `replaceLiveMirror` fix reconciled *by ordering value* and still duped; the
 * shipped fix reconciles *by position*.
 *
 * The pre-existing `startSessionFromTemplateSets.test.ts` locks the #51
 * SET-copy phase (kind/reps/weight/parent_set_id remap). This file locks the
 * SESSION_EXERCISE-level tree that Bug X actually broke:
 *   - ordering re-indexed to dense 1..N vs sparse/0-based template ordering
 *   - evergreen + normal-zone exercises both copied, `is_evergreen` flag mapped
 *   - dropset chain + superset (cluster) structure snapshotted
 *   - blank template (no exercises) → empty session_exercise tree
 *   - exercise_id linkage back to the source template exercises
 *
 * Because `addTemplateExercise` auto-assigns `ordering` (MAX+1, always dense)
 * and exposes no knob for sparse ordering / parent_id / reusable_superset_id /
 * rest_seconds, the fixtures here INSERT template_exercise rows directly via SQL
 * — mirroring how `startSessionFromTemplateSets.test.ts` inserts template_set
 * rows directly — so the sparse / cluster cases can actually be exercised.
 *
 * Asserts ACTUAL behaviour. Two drifts vs the naive expectation are flagged
 * inline as SUSPECT findings (parent_id NOT remapped; template_exercise_id
 * NULL) — see those tests.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { createTemplate } from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';

interface SessionExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string;
  ordering: number;
  is_evergreen: number;
  parent_id: string | null;
  reusable_superset_id: string | null;
  rest_sec: number | null;
  template_id: string | null;
}

async function fetchSessionExercises(
  db: BetterSqliteDatabase,
  session_id: string,
): Promise<SessionExerciseRow[]> {
  return db.getAllAsync<SessionExerciseRow>(
    `SELECT id, session_id, exercise_id, ordering, is_evergreen, parent_id,
            reusable_superset_id, rest_sec, template_id
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    session_id,
  );
}

/**
 * Insert a template_exercise row with full column control (ordering / section /
 * cluster linkage / rest_seconds), which `addTemplateExercise` cannot express.
 * `updated_at` defaults to 0 (NOT NULL DEFAULT 0) so it is omitted.
 */
async function insertTemplateExercise(
  db: BetterSqliteDatabase,
  row: {
    id: string;
    template_id: string;
    exercise_id: string;
    ordering: number;
    default_sets?: number;
    default_reps?: number | null;
    default_weight_kg?: number | null;
    is_evergreen?: 0 | 1;
    rest_seconds?: number | null;
    parent_id?: string | null;
    reusable_superset_id?: string | null;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO template_exercise
       (id, template_id, exercise_id, ordering, default_sets, default_reps,
        default_weight_kg, is_evergreen, rest_seconds, parent_id, reusable_superset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.template_id,
    row.exercise_id,
    row.ordering,
    row.default_sets ?? 0,
    row.default_reps ?? null,
    row.default_weight_kg ?? null,
    row.is_evergreen ?? 0,
    row.rest_seconds ?? null,
    row.parent_id ?? null,
    row.reusable_superset_id ?? null,
  );
}

describe('startSessionFromTemplate — Bug X session_exercise tree', () => {
  let db: BetterSqliteDatabase;
  let bench: { id: string };
  let squat: { id: string };
  let dead: { id: string };

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    bench = exercises.find((e) => e.name === 'Bench Press')!;
    squat = exercises.find((e) => e.name === 'Back Squat')!;
    // 'Deadlift' was archived by v028 — any third distinct active exercise works.
    dead = exercises.find((e) => e.name === 'Rack Pull')!;
  });

  afterEach(() => {
    db.close();
  });

  describe('ordering re-index (the Bug X root cause)', () => {
    it('re-indexes session_exercise ordering to a dense 1..N (sparse template orderings collapse)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-sparse', name: 'Sparse', now: () => 100 });
      // Intentionally SPARSE, out-of-insert-order template orderings.
      // bench=5, squat=0, dead=20 — none of which is 1..N. Bug X is exactly
      // the assumption that these values survive into the session.
      await insertTemplateExercise(db, { id: 'te-b', template_id: 'tpl-sparse', exercise_id: bench.id, ordering: 5 });
      await insertTemplateExercise(db, { id: 'te-s', template_id: 'tpl-sparse', exercise_id: squat.id, ordering: 0 });
      await insertTemplateExercise(db, { id: 'te-d', template_id: 'tpl-sparse', exercise_id: dead.id, ordering: 20 });

      const { session_id, planned_count } = await startSessionFromTemplate(db, {
        template_id: 'tpl-sparse',
        uuid,
        now: () => 1_000,
      });

      expect(planned_count).toBe(3);
      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(3);

      // Dense 1..N — NOT the template's {0, 5, 20}.
      expect(se.map((r) => r.ordering)).toEqual([1, 2, 3]);

      // Order follows template.ordering ASC: squat(0) → bench(5) → dead(20).
      expect(se.map((r) => r.exercise_id)).toEqual([squat.id, bench.id, dead.id]);
    });

    it('a single-exercise template at template-ordering 0 yields session ordering 1', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-one', name: 'One', now: () => 100 });
      // Template ordering 0 (the 0-based first-append convention).
      await insertTemplateExercise(db, { id: 'te1', template_id: 'tpl-one', exercise_id: bench.id, ordering: 0 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-one',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(1);
      expect(se[0].ordering).toBe(1);
    });
  });

  describe('section copy (evergreen + normal both snapshotted)', () => {
    it('copies both evergreen and normal exercises with is_evergreen flag mapped', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-mix', name: 'Mix', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-ev', template_id: 'tpl-mix', exercise_id: bench.id, ordering: 0, is_evergreen: 1 });
      await insertTemplateExercise(db, { id: 'te-nm', template_id: 'tpl-mix', exercise_id: squat.id, ordering: 1, is_evergreen: 0 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-mix',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(2);

      const benchSe = se.find((r) => r.exercise_id === bench.id)!;
      const squatSe = se.find((r) => r.exercise_id === squat.id)!;

      // is_evergreen=1 → section 'evergreen' → snapshot is_evergreen 1; 0 → 0.
      expect(benchSe.is_evergreen).toBe(1);
      expect(squatSe.is_evergreen).toBe(0);
    });

    it('snapshots rest_sec from the template exercise (rest_seconds → rest_sec)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-rest', name: 'Rest', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-r', template_id: 'tpl-rest', exercise_id: bench.id, ordering: 0, rest_seconds: 90 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-rest',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se[0].rest_sec).toBe(90);
    });

    it('a NULL template rest_seconds snapshots as NULL rest_sec (verbatim, no 60s coalesce)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-rn', name: 'RestNull', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-rn', template_id: 'tpl-rn', exercise_id: bench.id, ordering: 0, rest_seconds: null });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-rn',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se[0].rest_sec).toBeNull();
    });
  });

  describe('cluster / superset structure snapshot', () => {
    it('remaps the partner parent_id from template_exercise.id → the head session_exercise.id (manual cluster)', async () => {
      // Use a MANUAL cluster (parent_id only, no reusable_superset_id) so the
      // fixture needs no `superset` row — `template_exercise.reusable_superset_id`
      // carries a FK to superset(id) which is enforced in the test DB, whereas
      // `parent_id` has no FK (v014: "no FK, mirrors template_exercise.parent_id").
      // The parent_id remap is the Bug-X-relevant cluster behaviour.
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-ss2', name: 'SS2', now: () => 100 });
      await insertTemplateExercise(db, {
        id: 'te-h2', template_id: 'tpl-ss2', exercise_id: bench.id, ordering: 0,
      });
      await insertTemplateExercise(db, {
        id: 'te-p2', template_id: 'tpl-ss2', exercise_id: squat.id, ordering: 1,
        parent_id: 'te-h2',
      });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-ss2',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(2);
      const headSe = se.find((r) => r.exercise_id === bench.id)!;
      const partnerSe = se.find((r) => r.exercise_id === squat.id)!;

      // The head is a cluster parent → parent_id NULL.
      expect(headSe.parent_id).toBeNull();
      // The partner's parent_id is REMAPPED (snapshotForSession 2-pass idMap)
      // to the head's NEW session_exercise.id — NOT the template id 'te-h2'.
      expect(partnerSe.parent_id).toBe(headSe.id);
      expect(partnerSe.parent_id).not.toBe('te-h2');
      // And it resolves to an actual session_exercise row in this session.
      expect(se.some((r) => r.id === partnerSe.parent_id)).toBe(true);
    });

    it('snapshots reusable_superset_id verbatim on both members (RS-explode cluster)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-ss', name: 'SS', now: () => 100 });
      // template_exercise.reusable_superset_id has a FK to superset(id), so the
      // referenced superset row must exist first. Insert the minimal required
      // columns; `superset` is (id, name, created_at, updated_at) per v011.
      await db.runAsync(
        `INSERT INTO superset (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        'rss-1', 'Push SS', 100, 100,
      );
      // Head of the superset (cluster parent — no parent_id).
      await insertTemplateExercise(db, {
        id: 'te-head', template_id: 'tpl-ss', exercise_id: bench.id, ordering: 0,
        reusable_superset_id: 'rss-1',
      });
      // Partner points at the head via parent_id, shares the RSS id.
      await insertTemplateExercise(db, {
        id: 'te-partner', template_id: 'tpl-ss', exercise_id: squat.id, ordering: 1,
        parent_id: 'te-head', reusable_superset_id: 'rss-1',
      });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-ss',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(2);

      const headSe = se.find((r) => r.exercise_id === bench.id)!;
      const partnerSe = se.find((r) => r.exercise_id === squat.id)!;

      // reusable_superset_id is copied verbatim (foreign id, no remap).
      expect(headSe.reusable_superset_id).toBe('rss-1');
      expect(partnerSe.reusable_superset_id).toBe('rss-1');
    });

    it('snapshots a dropset chain at the set level (chain remapped, ordering 1..N at SE level)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-drop', name: 'Drop', now: () => 100 });
      await insertTemplateExercise(db, {
        id: 'te-drop', template_id: 'tpl-drop', exercise_id: bench.id,
        ordering: 7, // sparse on purpose
      });

      // dropset chain: working head + dropset follower pointing at the head.
      await db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
         VALUES (?, ?, ?, 'working', ?, ?, NULL)`,
        'tdrop-head', 'te-drop', 0, 8, 80,
      );
      await db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
         VALUES (?, ?, ?, 'dropset', ?, ?, ?)`,
        'tdrop-f1', 'te-drop', 1, 6, 60, 'tdrop-head',
      );

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-drop',
        uuid,
        now: () => 1_000,
      });

      // SE-level ordering is still 1..N regardless of the sparse template
      // ordering (7) and the dropset chain below it.
      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(1);
      expect(se[0].ordering).toBe(1);

      // The dropset chain landed at the set level, head + follower, with the
      // follower remapped to the new head id (not 'tdrop-head').
      const sets = await db.getAllAsync<{
        id: string;
        set_kind: string;
        parent_set_id: string | null;
        session_exercise_id: string | null;
      }>(
        `SELECT id, set_kind, parent_set_id, session_exercise_id
           FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
        session_id,
      );
      expect(sets).toHaveLength(2);
      const head = sets.find((s) => s.set_kind === 'working')!;
      const follower = sets.find((s) => s.set_kind === 'dropset')!;
      expect(follower.parent_set_id).toBe(head.id);
      expect(follower.parent_set_id).not.toBe('tdrop-head');
      // Both sets link back to the single session_exercise row.
      expect(head.session_exercise_id).toBe(se[0].id);
      expect(follower.session_exercise_id).toBe(se[0].id);
    });
  });

  describe('blank template', () => {
    it('yields an empty session_exercise tree and planned_count 0', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-blank', name: 'Blank', now: () => 100 });
      // No exercises added.

      const { session_id, planned_count } = await startSessionFromTemplate(db, {
        template_id: 'tpl-blank',
        uuid,
        now: () => 1_000,
      });

      expect(planned_count).toBe(0);
      const se = await fetchSessionExercises(db, session_id);
      expect(se).toHaveLength(0);
    });
  });

  describe('template linkage', () => {
    it('session_exercise.exercise_id points back at the source template exercises', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-link', name: 'Link', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-l1', template_id: 'tpl-link', exercise_id: bench.id, ordering: 0 });
      await insertTemplateExercise(db, { id: 'te-l2', template_id: 'tpl-link', exercise_id: squat.id, ordering: 1 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-link',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      const exIds = se.map((r) => r.exercise_id).sort();
      expect(exIds).toEqual([bench.id, squat.id].sort());
    });

    it('session_exercise.template_id is set to the source template id (per-exercise linkage)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-tid', name: 'Tid', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-tid', template_id: 'tpl-tid', exercise_id: bench.id, ordering: 0 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-tid',
        uuid,
        now: () => 1_000,
      });

      const se = await fetchSessionExercises(db, session_id);
      // snapshotForSession copies template_id = args.template.id onto every row.
      // This is the linkage v014/v023 backfills walk (session_exercise.template_id
      // → template_exercise / template name).
      expect(se[0].template_id).toBe('tpl-tid');
    });

    it('session.title is pre-seeded with the template name (header linkage)', async () => {
      let n = 0;
      const uuid = () => `id-${++n}`;

      await createTemplate(db, { id: 'tpl-title', name: 'Push Day A', now: () => 100 });
      await insertTemplateExercise(db, { id: 'te-t', template_id: 'tpl-title', exercise_id: bench.id, ordering: 0 });

      const { session_id } = await startSessionFromTemplate(db, {
        template_id: 'tpl-title',
        uuid,
        now: () => 1_000,
      });

      const sess = await db.getFirstAsync<{ title: string | null }>(
        `SELECT title FROM session WHERE id = ?`,
        session_id,
      );
      expect(sess?.title).toBe('Push Day A');
    });
  });
});
