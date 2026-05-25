/**
 * Module #8 — Body Metric Manager (pure logic, no DB).
 *
 * Owns the rules for body data:
 *   - validate a new BodyMetric draft (at least one metric, plausible ranges)
 *   - sort recorded measurements by time (chart order)
 *   - latest non-null reading per metric (for input pre-fill)
 *   - bodyweight snapshot lock at session start (cannot drift after session
 *     transitions to in_progress)
 *
 * Pure functions only. No side effects, no DB, no React.
 */

import type {
  BodyChartVisibility,
  BodyMetric,
  BodyMetricDraft,
} from './types';

export type ValidationError =
  | 'EMPTY'
  | 'BODYWEIGHT_OUT_OF_RANGE'
  | 'PBF_OUT_OF_RANGE'
  | 'SMM_OUT_OF_RANGE'
  | 'RECORDED_AT_INVALID';

/**
 * Validate a body metric draft. Returns null when valid, else the first error.
 *
 * Ranges:
 *   - bodyweight: (0, 500] kg — 500kg is the all-time human record + buffer
 *   - PBF: [0, 100] %
 *   - SMM: (0, 200] kg — SMM is always less than total bw, 200 is conservative
 */
export function validateBodyMetric(draft: BodyMetricDraft): ValidationError | null {
  if (!Number.isFinite(draft.recorded_at)) return 'RECORDED_AT_INVALID';

  const allNull =
    draft.bodyweight_kg == null && draft.pbf == null && draft.smm_kg == null;
  if (allNull) return 'EMPTY';

  if (draft.bodyweight_kg != null) {
    if (
      !Number.isFinite(draft.bodyweight_kg) ||
      draft.bodyweight_kg <= 0 ||
      draft.bodyweight_kg > 500
    ) {
      return 'BODYWEIGHT_OUT_OF_RANGE';
    }
  }
  if (draft.pbf != null) {
    if (!Number.isFinite(draft.pbf) || draft.pbf < 0 || draft.pbf > 100) {
      return 'PBF_OUT_OF_RANGE';
    }
  }
  if (draft.smm_kg != null) {
    if (!Number.isFinite(draft.smm_kg) || draft.smm_kg <= 0 || draft.smm_kg > 200) {
      return 'SMM_OUT_OF_RANGE';
    }
  }
  return null;
}

/**
 * Sort body metrics by recorded_at. Stable on equal timestamps (preserves
 * insertion order — important for "multiple readings on the same day").
 *
 * Returns a new array; does not mutate the input.
 */
export function sortByRecordedAt(
  metrics: BodyMetric[],
  direction: 'asc' | 'desc' = 'asc'
): BodyMetric[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...metrics]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const diff = a.m.recorded_at - b.m.recorded_at;
      if (diff !== 0) return diff * dir;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

/**
 * Returns the most recent non-null reading per metric. Useful for pre-filling
 * the body data input form so the user only enters what changed.
 *
 * If no readings exist, returns all nulls. Each field is independent — e.g. a
 * row that has only bodyweight contributes only to that field.
 */
export function latestPerMetric(metrics: BodyMetric[]): {
  bodyweight_kg: number | null;
  pbf: number | null;
  smm_kg: number | null;
} {
  const sorted = sortByRecordedAt(metrics, 'desc');
  let bw: number | null = null;
  let pbf: number | null = null;
  let smm: number | null = null;
  for (const m of sorted) {
    if (bw == null && m.bodyweight_kg != null) bw = m.bodyweight_kg;
    if (pbf == null && m.pbf != null) pbf = m.pbf;
    if (smm == null && m.smm_kg != null) smm = m.smm_kg;
    if (bw != null && pbf != null && smm != null) break;
  }
  return { bodyweight_kg: bw, pbf, smm_kg: smm };
}


/**
 * Default chart visibility — all three series shown on first load.
 */
export const DEFAULT_VISIBILITY: BodyChartVisibility = {
  bodyweight: true,
  pbf: true,
  smm: true,
};

/**
 * Toggle one series in the chart visibility map.
 *
 * Refuses to leave all three series hidden — at least one must remain on so
 * the chart never renders blank. Returns the same input if the toggle would
 * hide everything.
 */
export function toggleVisibility(
  visibility: BodyChartVisibility,
  series: keyof BodyChartVisibility
): BodyChartVisibility {
  const next = { ...visibility, [series]: !visibility[series] };
  if (!next.bodyweight && !next.pbf && !next.smm) {
    return visibility;
  }
  return next;
}

/**
 * Bodyweight snapshot lock: once a session is in_progress its
 * bodyweight_snapshot_kg is frozen. Pre-session callers may set the snapshot
 * (idle → in_progress) but not change it after.
 *
 * Returns true if the requested write is allowed.
 *
 *   pre-session (no session yet, OR session has null snapshot)
 *      ⇒ allowed (covers "user confirms current bw before tapping Start")
 *   in-progress with existing snapshot
 *      ⇒ rejected — caller must log a separate body_metric instead
 */
export function canWriteBwSnapshot(args: {
  sessionStatus: 'idle' | 'in_progress' | 'ended';
  existingSnapshot: number | null;
}): boolean {
  if (args.sessionStatus === 'idle') return true;
  if (args.sessionStatus === 'ended') return false;
  // in_progress: allow only if snapshot is still null (defensive — UI should
  // not call this once snapshot is set, but the rule is encoded here too).
  return args.existingSnapshot == null;
}
