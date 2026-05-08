/**
 * Domain types for slice 7 — Body Data + Unit Conversion + bw_snapshot.
 *
 * Storage convention: weights are persisted in kg and PBF in %. UI toggles
 * display only via `unit_preference` (kg / lb).
 */

export interface BodyMetric {
  id: string;
  recorded_at: number; // unix epoch ms
  bodyweight_kg: number | null;
  pbf: number | null; // percent body fat (0..100)
  smm_kg: number | null; // skeletal muscle mass in kg
}

/** Input draft for a new body metric — at least one of three fields required. */
export interface BodyMetricDraft {
  recorded_at: number;
  bodyweight_kg: number | null;
  pbf: number | null;
  smm_kg: number | null;
}

export type UnitPreference = 'kg' | 'lb';

export interface UnitPreferenceState {
  unit: UnitPreference;
}

/** Which metric series is currently visible on the Body trend chart. */
export interface BodyChartVisibility {
  bodyweight: boolean;
  pbf: boolean;
  smm: boolean;
}

/** A single point on the trend chart. */
export interface BodyTrendPoint {
  recorded_at: number;
  bodyweight_kg: number | null;
  pbf: number | null;
  smm_kg: number | null;
}
