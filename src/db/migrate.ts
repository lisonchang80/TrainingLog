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
};

export async function migrate(db: Database): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const current = row?.user_version ?? 0;
  const target = Math.max(...Object.keys(migrations).map(Number));

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
