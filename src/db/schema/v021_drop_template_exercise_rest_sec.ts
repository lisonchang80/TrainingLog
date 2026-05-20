import type { Database } from '../types';

/**
 * v021 — DROP orphan `template_exercise.rest_sec` column (ADR-0019 § Slice 10b
 * follow-up; overnight C 2026-05-21).
 *
 * Background — two columns same purpose:
 *   - **v009** added `template_exercise.rest_seconds INTEGER NULL` (ADR-0016).
 *     This is the canonical column read/written by `templateRepository.ts`
 *     (`getTemplate`, `saveTemplateDraft`, `convertSessionToTemplate`, etc.)
 *     and surfaced on the domain spec as `TemplateExerciseSpec.rest_sec`
 *     (the field name ADR-0019 settled on; mapped at read time).
 *   - **v016** mistakenly added a second column with the new spec name —
 *     `template_exercise.rest_sec INTEGER NULL` — when wiring slice 10a's
 *     rest-timer schema. Slice 10b realized the conflict, declared
 *     `rest_seconds` (v009) the canonical column, and left `rest_sec` (v016)
 *     unread. The v016 migration has been writing NULL into the orphan for
 *     every fresh DB since; production has no readers.
 *
 * Note: this only drops the **template_exercise** orphan. The sibling column
 * `session_exercise.rest_sec` (also added by v016) IS the canonical
 * session-side store — it is widely read across `app/(tabs)/index.tsx`,
 * `app/session/[id].tsx`, `sessionRepository.ts`, `computeSessionDiff.ts`,
 * `sessionSnapshotDirty.ts`, etc. — and is intentionally untouched here.
 *
 * Why phased now (slice 10c follow-up): the orphan caused readability noise
 * (multiple JSDoc disclaimers in templateRepository.ts + templateManager.ts
 * telling future readers "ignore this column"). Dropping it removes the
 * confusion and keeps the schema honest about its single source of truth.
 *
 * SQLite's `ALTER TABLE ... DROP COLUMN` is supported from SQLite 3.35
 * (2021). `better-sqlite3@^12.9.0` (tests) bundles 3.49+, and `expo-sqlite
 * ~16.0` (production) ships 3.45+ — both well above the floor. Same approach
 * as v012 (`drop template_exercise.notes`).
 *
 * Idempotency: PRAGMA table_info introspection before the DROP, mirroring
 * v012's pattern. A re-run on an already-migrated DB is a no-op.
 */
export async function v021_drop_template_exercise_rest_sec(
  db: Database,
): Promise<void> {
  // Defensive: verify the column still exists before attempting DROP. If a
  // future code path lands a manual DROP, this becomes a no-op rather than
  // crashing the migration.
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(template_exercise)`,
  );
  const hasRestSec = cols.some((c) => c.name === 'rest_sec');
  if (!hasRestSec) return;

  await db.execAsync(`ALTER TABLE template_exercise DROP COLUMN rest_sec;`);
}
