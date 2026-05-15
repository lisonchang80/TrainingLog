import type { Database } from '../types';
import { EXERCISE_EQUIPMENT_SEED } from '../seed/v010ExerciseLibraryEquipment';

/**
 * v010 — Exercise Library v2 columns + muscle naming revise + per-Exercise notes
 * (ADR-0017 + ADR-0010 amendment + ADR-0013 amendment).
 *
 * Changes:
 *   1. ALTER exercise ADD equipment TEXT NOT NULL DEFAULT '其他' (Q6, 8-enum CHECK)
 *   2. ALTER exercise ADD notes TEXT NULL (Q5, ADR-0013 amendment — per-Exercise global)
 *   3. ALTER exercise ADD media_path TEXT NULL (Q8, mp4 loop)
 *   4. ALTER exercise ADD cues_text TEXT NULL (Q3, v1.5+ placeholder)
 *   5. UPDATE muscle / muscle_group naming (Q9, ADR-0010 amendment)
 *        - 二頭長頭 → 外側二頭
 *        - 二頭短頭 → 內側二頭
 *        - 前臂 → 小臂 (both muscle and muscle_group rows)
 *      ID consts (M_BICEP_LONG / M_FOREARM / etc) untouched per ADR-0010 amendment.
 *   6. Equipment backfill: 66 built-in exercises mapped per
 *      `src/db/seed/v010ExerciseLibraryEquipment.ts` (note: ADR-0017 said "65"
 *      but actual v006 seed count is 66 — issue #30 wording off-by-one).
 *   7. per-template notes 升 global (Q5, ADR-0013 amendment):
 *      best-effort merge — take the most-recently-updated template_exercise.notes
 *      for each exercise and write into exercise.notes. **PHASED**: the legacy
 *      column `template_exercise.notes` is NOT dropped in v010. Production
 *      `templateRepository` still reads/writes it during the slice. A later
 *      migration (after UI + repository migrate to `exercise.notes` everywhere)
 *      will DROP COLUMN. Rationale: DROP at v010 cascade-breaks `getTemplateFull`,
 *      `commitTemplateDraft`, and 8 templateRepositoryV2 tests in one shot —
 *      too much surface to roll back atomically.
 *
 * Idempotency: PRAGMA user_version guard ensures single-run. CHECK constraint
 * on equipment column applies to all new INSERTs after migration; backfill loop
 * uses UPDATE which doesn't trigger DEFAULT, so explicit values are written.
 *
 * Why no `INSERT OR IGNORE` pattern: existing rows are guaranteed unique by id
 * (built-in seed UUIDs are stable). UPDATE-by-id covers all 66.
 *
 * Cross-ADR:
 *   - ADR-0010 (anatomical muscle layer) — 2026-05-13 amendment
 *   - ADR-0013 (per-exercise notes persistence) — 2026-05-13 amendment
 *   - ADR-0017 (Exercise Library v2 + Reusable Superset entity)
 */
export async function v010_exercise_library_v2(db: Database): Promise<void> {
  // 1-4: ALTER exercise schema (add 4 columns).
  // CHECK constraint on equipment enforces 8-enum at DB layer.
  await db.execAsync(`
    ALTER TABLE exercise ADD COLUMN equipment TEXT NOT NULL DEFAULT '其他'
      CHECK (equipment IN ('槓鈴','啞鈴','史密斯機','滑輪','固定機械','自重','壺鈴','其他'));
    ALTER TABLE exercise ADD COLUMN notes TEXT;
    ALTER TABLE exercise ADD COLUMN media_path TEXT;
    ALTER TABLE exercise ADD COLUMN cues_text TEXT;
  `);

  // 5: Muscle naming revise (ADR-0010 amendment).
  await db.execAsync(`
    UPDATE muscle SET name = '外側二頭' WHERE id = 'm-bicep-long';
    UPDATE muscle SET name = '內側二頭' WHERE id = 'm-bicep-short';
    UPDATE muscle SET name = '小臂' WHERE id = 'm-forearm';
    UPDATE muscle_group SET name = '小臂' WHERE id = 'mg-forearm';
  `);

  // 6: Equipment backfill for 66 built-in exercises.
  for (const [exerciseId, equipment] of EXERCISE_EQUIPMENT_SEED) {
    await db.runAsync(
      'UPDATE exercise SET equipment = ? WHERE id = ?',
      equipment,
      exerciseId
    );
  }

  // 7: per-template notes → global. Best-effort merge: pick the most-recent
  // template_exercise.notes per exercise. NULL stays NULL (no template_exercise
  // row, or all rows have NULL notes).
  await db.execAsync(`
    UPDATE exercise SET notes = (
      SELECT te.notes
      FROM template_exercise te
      WHERE te.exercise_id = exercise.id
        AND te.notes IS NOT NULL
      ORDER BY te.updated_at DESC
      LIMIT 1
    );
  `);

  // 8: PHASED — DROP COLUMN template_exercise.notes deferred to a later migration
  // once production templateRepository + Template editor UI switch to reading /
  // writing exercise.notes instead.
}
