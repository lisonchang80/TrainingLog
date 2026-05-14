import type { Database } from '../types';

/**
 * v013 — ALTER template_exercise ADD reusable_superset_id TEXT NULL FK,
 *        ON DELETE SET NULL (ADR-0017 L154 amendment, slice 9.8b).
 *
 * Background — ADR-0017 L154 originally read「不存 template_exercise.reusable_
 * superset_id FK、單向、不雙向同步」. Slice 9.8b grill flipped that decision:
 * to make per-(reusable_superset, position) memory work (so re-exploding the
 * same reusable superset hydrates from its own past sets — not bleeding into
 * solo "胸推" memory), we need an FK on each exploded row.
 *
 * Semantics:
 *   - rs_id IS NULL  → row is a solo exercise OR a hand-crafted superset
 *     (ADR-0016 manual cluster). Memory lookup falls back to per-exercise.
 *   - rs_id = S      → row was exploded from reusable_superset S. Memory
 *     lookup goes through rs_id-scoped cluster derive.
 *
 * The FK uses ON DELETE SET NULL (not CASCADE) so that deleting a reusable
 * superset from the library does not delete template clusters that were
 * previously exploded from it — only the FK is cleared, preserving the
 * "explode model 解耦" intent of ADR-0017 L155.
 *
 * Idempotency: PRAGMA table_info introspection check before ADD COLUMN, so
 * a re-run on an already-migrated DB is a no-op.
 */
export async function v013_template_exercise_reusable_superset_fk(
  db: Database
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(template_exercise)`
  );
  if (cols.some((c) => c.name === 'reusable_superset_id')) return;

  await db.execAsync(`
    ALTER TABLE template_exercise
      ADD COLUMN reusable_superset_id TEXT
      REFERENCES superset(id) ON DELETE SET NULL;
  `);
}
