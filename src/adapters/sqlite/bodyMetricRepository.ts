import type { Database } from '../../db/types';
import type { BodyMetric, BodyMetricDraft } from '../../domain/body/types';
import { validateBodyMetric } from '../../domain/body/bodyMetricManager';

/**
 * Body metric persistence layer (slice 7).
 *
 * All weights stored in kg, PBF in %. UI converts on display via
 * `unitConversion`.
 */

export async function insertBodyMetric(
  db: Database,
  draft: BodyMetricDraft,
  uuid: () => string
): Promise<BodyMetric> {
  const err = validateBodyMetric(draft);
  if (err) throw new Error(`Invalid body metric: ${err}`);

  const id = uuid();
  await db.runAsync(
    `INSERT INTO body_metric (id, recorded_at, bodyweight_kg, pbf, smm_kg)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    draft.recorded_at,
    draft.bodyweight_kg,
    draft.pbf,
    draft.smm_kg
  );
  return {
    id,
    recorded_at: draft.recorded_at,
    bodyweight_kg: draft.bodyweight_kg,
    pbf: draft.pbf,
    smm_kg: draft.smm_kg,
  };
}

/** All body metrics, ordered by recorded_at ASC (chart consumption order). */
export async function listBodyMetrics(db: Database): Promise<BodyMetric[]> {
  return db.getAllAsync<BodyMetric>(
    `SELECT id, recorded_at, bodyweight_kg, pbf, smm_kg
       FROM body_metric
      ORDER BY recorded_at ASC, id ASC`
  );
}

export async function getBodyMetric(
  db: Database,
  id: string
): Promise<BodyMetric | null> {
  return db.getFirstAsync<BodyMetric>(
    `SELECT id, recorded_at, bodyweight_kg, pbf, smm_kg
       FROM body_metric WHERE id = ?`,
    id
  );
}

export async function deleteBodyMetric(db: Database, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM body_metric WHERE id = ?`, id);
}
