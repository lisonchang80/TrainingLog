import type { Database } from '../types';

/**
 * v004 — Evergreen exercise zone (slice 4).
 *
 * Adds `is_evergreen` (0/1) to both `template_exercise` and `session_exercise`
 * so:
 *   1. The template editor can render two zones (常設動作區 vs 一般動作區).
 *   2. Save-back diff can refuse to "remove" an evergreen exercise when the
 *      user skipped it during a Session — only general-zone rows are eligible
 *      for save-back removal (per ADR-0005 + slice 4 acceptance criterion #4).
 *   3. The flag survives the snapshot taken at Session start so the diff at
 *      Session end can read it from `session_exercise` directly without
 *      having to re-join the (potentially-edited) Template.
 *
 * Existing rows default to 0 (一般 = general zone). Slice 5 (Program / 強度)
 * will add the name-level propagation rules from ADR-0005; slice 4 only sets
 * up the flag + per-template save-back semantics.
 */
export async function v004_evergreen_zone(db: Database): Promise<void> {
  await db.execAsync(`
    ALTER TABLE template_exercise ADD COLUMN is_evergreen INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE session_exercise ADD COLUMN is_evergreen INTEGER NOT NULL DEFAULT 0;
  `);
}
