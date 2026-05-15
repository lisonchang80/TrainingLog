import type { Database } from '../types';

/**
 * v014 — Session-side cluster grouping (ADR-0018).
 *
 * Adds `parent_id` and `reusable_superset_id` columns to `session_exercise`
 * so that templated clusters (RS-explode + ADR-0016 manual) and future
 * ad-hoc clusters can be reconstructed in session detail / RS history pages
 * without walking the brittle `session_exercise.template_id → template_exercise`
 * indirection (`exerciseHistoryRepository.ts:382-403` self-documents three
 * breakage modes).
 *
 * Columns:
 *   - `parent_id TEXT NULL` — no FK, mirrors `template_exercise.parent_id`
 *     (v009) convention. Points to another `session_exercise.id` within the
 *     same session. NULL = solo.
 *   - `reusable_superset_id TEXT NULL` — FK to `superset(id)` with
 *     `ON DELETE SET NULL`, mirrors the v013 pattern on `template_exercise`.
 *     NULL = manual / ad-hoc cluster; NOT NULL = templated explode path.
 *
 * Backfill (β' — skip-on-ambiguity, ADR-0018):
 *   For each `session_exercise` whose `template_id IS NOT NULL`, copy
 *   `reusable_superset_id` directly from the matching `template_exercise`
 *   and remap `parent_id` to the session-side `session_exercise.id` of the
 *   cluster parent in the same session. Templates whose `template_exercise`
 *   rows have a duplicate `exercise_id` (rare; manual additions of the same
 *   exercise twice) are entirely skipped — those sessions keep both columns
 *   NULL and fall through to the indirection fallback in
 *   `queryReusableSupersetHistory`.
 *
 * Failure modes:
 *   - Ambiguous template → all sessions sourced from it stay NULL.
 *   - This is strictly preferable to mislabeling: a `LIMIT 1` would copy a
 *     cluster's RS id onto an unrelated second occurrence of the same
 *     exercise, producing a phantom cluster.
 *   - Silent (no console.warn / no UI surface) — migration runs at app
 *     start with no user interaction.
 *
 * Idempotency: PRAGMA table_info introspection before each ADD COLUMN, so
 * a re-run on an already-migrated DB is a no-op. The backfill UPDATE
 * statements are also idempotent because the predicates (`template_id IS
 * NOT NULL` + NOT ambiguous) and the LIMIT-1 deterministic mapping yield
 * the same result on repeat runs.
 */
export async function v014_session_exercise_cluster(
  db: Database
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(session_exercise)`
  );
  const have = new Set(cols.map((c) => c.name));

  if (!have.has('parent_id')) {
    await db.execAsync(`
      ALTER TABLE session_exercise
        ADD COLUMN parent_id TEXT;
    `);
  }

  if (!have.has('reusable_superset_id')) {
    await db.execAsync(`
      ALTER TABLE session_exercise
        ADD COLUMN reusable_superset_id TEXT
        REFERENCES superset(id) ON DELETE SET NULL;
    `);
  }

  // Backfill — β' skip-on-ambiguity. Wrapped in the migration's transaction
  // (migrate.ts already calls each fn inside withTransactionAsync).
  //
  // Step 1: backfill reusable_superset_id (no remap — foreign id pointing to
  //         superset.id, copy through as-is).
  await db.execAsync(`
    UPDATE session_exercise
       SET reusable_superset_id = (
         SELECT te.reusable_superset_id
           FROM template_exercise te
          WHERE te.template_id = session_exercise.template_id
            AND te.exercise_id = session_exercise.exercise_id
          ORDER BY te.ordering ASC
          LIMIT 1
       )
     WHERE template_id IS NOT NULL
       AND reusable_superset_id IS NULL
       AND template_id NOT IN (
         SELECT template_id
           FROM template_exercise
          GROUP BY template_id, exercise_id
         HAVING COUNT(*) > 1
       );
  `);

  // Step 2: backfill parent_id (remap te.parent_id → session-side se.id).
  //
  // For each session_exercise row whose source template_exercise has a
  // non-null parent_id, find that parent template_exercise's exercise_id,
  // then locate the session_exercise row in the SAME session with that
  // exercise_id. That row is the cluster parent on the session side.
  await db.execAsync(`
    UPDATE session_exercise AS se
       SET parent_id = (
         SELECT se_parent.id
           FROM template_exercise te_self
           JOIN template_exercise te_parent
             ON te_parent.id = te_self.parent_id
           JOIN session_exercise se_parent
             ON se_parent.session_id = se.session_id
            AND se_parent.exercise_id = te_parent.exercise_id
          WHERE te_self.template_id = se.template_id
            AND te_self.exercise_id = se.exercise_id
          ORDER BY te_self.ordering ASC
          LIMIT 1
       )
     WHERE se.template_id IS NOT NULL
       AND se.parent_id IS NULL
       AND se.template_id NOT IN (
         SELECT template_id
           FROM template_exercise
          GROUP BY template_id, exercise_id
         HAVING COUNT(*) > 1
       );
  `);
}
