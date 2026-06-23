import type { Database } from './types';
import { v001_initial } from './schema/v001_initial';
import { v002_more_exercises } from './schema/v002_more_exercises';
import { v003_templates } from './schema/v003_templates';
import { v004_evergreen_zone } from './schema/v004_evergreen_zone';
import { v005_program } from './schema/v005_program';
import { v006_muscle_layer } from './schema/v006_muscle_layer';
import { v007_body_metric } from './schema/v007_body_metric';
import { v008_achievements } from './schema/v008_achievements';
import { v009_template_set } from './schema/v009_template_set';
import { v010_exercise_library_v2 } from './schema/v010_exercise_library_v2';
import { v011_reusable_superset } from './schema/v011_reusable_superset';
import { v012_drop_template_exercise_notes } from './schema/v012_drop_template_exercise_notes';
import { v013_template_exercise_reusable_superset_fk } from './schema/v013_template_exercise_reusable_superset_fk';
import { v014_session_exercise_cluster } from './schema/v014_session_exercise_cluster';
import { v015_set_kind_and_clusters } from './schema/v015_set_kind_and_clusters';
import { v016_session_runtime_data } from './schema/v016_session_runtime_data';
import { v017_program_none_seed } from './schema/v017_program_none_seed';
import { v018_set_notes } from './schema/v018_set_notes';
import { v019_set_session_exercise_id } from './schema/v019_set_session_exercise_id';
import { v020_template_color_backfill } from './schema/v020_template_color_backfill';
import { v021_drop_template_exercise_rest_sec } from './schema/v021_drop_template_exercise_rest_sec';
import { v022_program_sub_tag } from './schema/v022_program_sub_tag';
import { v023_session_title } from './schema/v023_session_title';
import { v024_session_is_watch_tracked } from './schema/v024_session_is_watch_tracked';
import { v025_set_display_rank } from './schema/v025_set_display_rank';
import { v026_session_started_at_index } from './schema/v026_session_started_at_index';
import { v027_session_exercise_parent_index } from './schema/v027_session_exercise_parent_index';
import { v028_exercise_media_library } from './schema/v028_exercise_media_library';

/**
 * Migration runner using PRAGMA user_version.
 *
 * Each migration is wrapped in a transaction so partial failure rolls back
 * cleanly. Add new migrations to the `migrations` map below.
 *
 * Convention: migration version numbers are 1-indexed. PRAGMA user_version
 * starts at 0 on fresh DBs.
 */

type MigrationFn = (db: Database) => Promise<void>;

const migrations: Record<number, MigrationFn> = {
  1: v001_initial,
  2: v002_more_exercises,
  3: v003_templates,
  4: v004_evergreen_zone,
  5: v005_program,
  6: v006_muscle_layer,
  7: v007_body_metric,
  8: v008_achievements,
  9: v009_template_set,
  10: v010_exercise_library_v2,
  11: v011_reusable_superset,
  12: v012_drop_template_exercise_notes,
  13: v013_template_exercise_reusable_superset_fk,
  14: v014_session_exercise_cluster,
  15: v015_set_kind_and_clusters,
  16: v016_session_runtime_data,
  17: v017_program_none_seed,
  18: v018_set_notes,
  19: v019_set_session_exercise_id,
  20: v020_template_color_backfill,
  21: v021_drop_template_exercise_rest_sec,
  22: v022_program_sub_tag,
  23: v023_session_title,
  24: v024_session_is_watch_tracked,
  25: v025_set_display_rank,
  26: v026_session_started_at_index,
  27: v027_session_exercise_parent_index,
  28: v028_exercise_media_library,
};

/**
 * Highest migration version this app build knows about — the restore
 * version gate (ADR-0011 amendment, grill Q10-A) compares a backup
 * candidate's `PRAGMA user_version` against this. Derived from the
 * `migrations` map so it can NEVER drift from what `migrate()` actually
 * runs; deliberately not a hardcoded constant.
 */
export function migrationsMaxVersion(): number {
  return Math.max(...Object.keys(migrations).map(Number));
}

/**
 * INVARIANT (report 09 #7a): each migration runs EXACTLY ONCE — the loop is
 * gated by `PRAGMA user_version` and every step runs inside its own
 * `withTransactionAsync`, so a given `v` can never re-execute. Therefore the
 * defensive `PRAGMA table_info` guards some schema files put before their
 * `ALTER TABLE ADD COLUMN` (v023/v024/v025) are belt-and-suspenders, NOT
 * required for correctness; the bare `ALTER` style (v004–v019) is equally
 * safe. Don't cargo-cult either style as "the one that's needed" — pick
 * whichever reads cleaner for a new vNNN.
 */
export async function migrate(db: Database): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const current = row?.user_version ?? 0;
  const target = migrationsMaxVersion();

  for (let v = current + 1; v <= target; v++) {
    const fn = migrations[v];
    if (!fn) {
      throw new Error(`Missing migration for version ${v}`);
    }
    await db.withTransactionAsync(async () => {
      await fn(db);
      // PRAGMA user_version doesn't accept bound params — interpolate safely
      // (v is a number from our own controlled map, not user input).
      await db.execAsync(`PRAGMA user_version = ${v}`);
    });
  }
}
