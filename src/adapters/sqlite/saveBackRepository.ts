import type { Database } from '../../db/types';
import type { SaveBackChange } from '../../domain/template/saveBackDiff';

/**
 * Persist the user-confirmed Save-back changes against a Template.
 *
 * For each accepted `SaveBackChange`:
 *   - 'modify' → UPDATE template_exercise.default_sets/reps/weight to match
 *                actual. Matched by (template_id, exercise_id) — Slice 4
 *                templates have at most one row per exercise so this is
 *                unambiguous.
 *   - 'remove' → DELETE FROM template_exercise (only when is_evergreen = 0;
 *                we defend the invariant here in addition to the diff filter).
 *   - 'add'    → INSERT a new template_exercise row appended at the end of
 *                the template, in the general zone.
 *
 * All writes happen inside a single transaction, and the parent template's
 * `updated_at` is bumped exactly once at the end.
 *
 * `uuid` is REQUIRED — Hermes lacks `crypto.randomUUID`; production injects
 * `randomUUID` from `expo-crypto`, tests inject a deterministic stub.
 */
export async function applySaveBack(
  db: Database,
  args: {
    template_id: string;
    accepted: SaveBackChange[];
    uuid: () => string;
    now?: () => number;
  }
): Promise<void> {
  if (args.accepted.length === 0) return;
  const ts = (args.now ?? Date.now)();

  await db.withTransactionAsync(async () => {
    // Compute the next ordering once up front; if multiple 'add' entries are
    // in the batch, increment locally so they stack at the end in order.
    const row = await db.getFirstAsync<{ max_ordering: number | null }>(
      `SELECT MAX(ordering) AS max_ordering FROM template_exercise WHERE template_id = ?`,
      args.template_id
    );
    let nextOrdering = (row?.max_ordering ?? 0) + 1;

    for (const change of args.accepted) {
      switch (change.type) {
        case 'modify': {
          if (!change.actual) continue;
          await db.runAsync(
            `UPDATE template_exercise
                SET default_sets = ?, default_reps = ?, default_weight_kg = ?
              WHERE template_id = ? AND exercise_id = ?`,
            change.actual.sets,
            change.actual.reps,
            change.actual.weight_kg,
            args.template_id,
            change.exercise_id
          );
          break;
        }
        case 'remove': {
          // Defence in depth: never delete an evergreen row even if a malformed
          // change slipped through. The diff already filters these out.
          if (change.is_evergreen === 1) continue;
          await db.runAsync(
            `DELETE FROM template_exercise
              WHERE template_id = ? AND exercise_id = ? AND is_evergreen = 0`,
            args.template_id,
            change.exercise_id
          );
          break;
        }
        case 'add': {
          if (!change.actual) continue;
          await db.runAsync(
            `INSERT INTO template_exercise
               (id, template_id, exercise_id, ordering,
                default_sets, default_reps, default_weight_kg, is_evergreen)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            args.uuid(),
            args.template_id,
            change.exercise_id,
            nextOrdering++,
            change.actual.sets,
            change.actual.reps,
            change.actual.weight_kg
          );
          break;
        }
      }
    }

    await db.runAsync(
      `UPDATE template SET updated_at = ? WHERE id = ?`,
      ts,
      args.template_id
    );
  });
}
