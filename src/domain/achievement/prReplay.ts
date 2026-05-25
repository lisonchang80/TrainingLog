/**
 * Pure-logic PR replay used by the achievement evaluation pipeline.
 *
 * Given the full set history (chronologically sorted, joined with exercise +
 * mg + load_type + per-session bw snapshot), replay PR detection per
 * (exercise, bucket) and produce:
 *
 *   1. Cumulative all-time PR counts per (mg, type) + per (bucket, type).
 *   2. Per-set flags `weight_pr_broken` / `volume_pr_broken` aligned with the
 *      input order — these feed straight into `evaluate()` for the
 *      currently-ending session's sets.
 *
 * Skip rules mirror prEngine.detectPRBreaks:
 *   - bodyweight + weight=0 → skip
 *   - assisted + no snapshot → skip
 *   - reps not in any bucket → skip
 *   - load_type='assisted' with non-positive effective load → skip
 *
 * The function is pure so it can be tested without SQLite. Caller (adapter)
 * loads rows from DB in the right order and hands them in.
 */

import type { LoadType } from '../exercise/types';
import type { BucketKey } from '../pr/types';
import { classifyBucket } from '../pr/buckets';
import { effectiveLoad } from '../pr/e1rmEngine';
import { setVolume } from '../pr/volumeEngine';

export interface ReplaySetRecord {
  set_id: string;
  session_id: string;
  exercise_id: string;
  /** Primary muscle group of the exercise, or null if unmapped. */
  mg_id: string | null;
  load_type: LoadType;
  weight_kg: number | null;
  reps: number | null;
  bw_snapshot_kg: number | null;
  /** is_skipped = 0 (only logged sets count toward PR / cumulative counts). */
  is_logged: boolean;
  /** Sort key — sets are processed in ascending order of this value. */
  created_at: number;
}

interface ReplaySetFlags {
  set_id: string;
  bucket: BucketKey | null;
  weight_pr_broken: boolean;
  volume_pr_broken: boolean;
  /** True iff this set was qualified for PR check at all (not skipped). */
  qualified: boolean;
}

interface CumulativeCounts {
  per_mg: Map<string, { weight: number; volume: number }>;
  per_bucket: Map<BucketKey, { weight: number; volume: number }>;
}

interface ReplayResult {
  flagsBySetId: Map<string, ReplaySetFlags>;
  cumulative: CumulativeCounts;
}

interface BucketBest {
  weight: number | null;
  volume: number | null;
}

/**
 * Replays the input set history. Input MUST be pre-sorted by `created_at`
 * ascending; ordering ties are broken by `set_id` to keep replay deterministic.
 */
export function replayPRs(records: readonly ReplaySetRecord[]): ReplayResult {
  const flags = new Map<string, ReplaySetFlags>();
  const perMg = new Map<string, { weight: number; volume: number }>();
  const perBucket = new Map<BucketKey, { weight: number; volume: number }>();
  // (exercise_id, bucket) → BucketBest
  const bestPerExerciseBucket = new Map<string, BucketBest>();

  const incPerMg = (mg: string, kind: 'weight' | 'volume') => {
    const c = perMg.get(mg) ?? { weight: 0, volume: 0 };
    c[kind] += 1;
    perMg.set(mg, c);
  };
  const incPerBucket = (bucket: BucketKey, kind: 'weight' | 'volume') => {
    const c = perBucket.get(bucket) ?? { weight: 0, volume: 0 };
    c[kind] += 1;
    perBucket.set(bucket, c);
  };

  // Stable replay order
  const sorted = [...records].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return a.set_id < b.set_id ? -1 : a.set_id > b.set_id ? 1 : 0;
  });

  for (const r of sorted) {
    const bucket = classifyBucket(r.reps);
    const reps = r.reps;
    const w = r.weight_kg;
    const qualified = (() => {
      if (!r.is_logged) return false;
      if (bucket == null) return false;
      if (w == null || !Number.isFinite(w) || reps == null) return false;
      if (r.load_type === 'bodyweight' && w === 0) return false;
      if (r.load_type === 'assisted' && r.bw_snapshot_kg == null) return false;
      const eff = effectiveLoad(w, r.load_type, r.bw_snapshot_kg);
      if (eff == null) return false;
      if (r.load_type === 'assisted' && eff <= 0) return false;
      const v = setVolume({
        weight_kg: w,
        reps,
        load_type: r.load_type,
        bw_snapshot_kg: r.bw_snapshot_kg,
      });
      return v != null;
    })();

    const f: ReplaySetFlags = {
      set_id: r.set_id,
      bucket,
      weight_pr_broken: false,
      volume_pr_broken: false,
      qualified,
    };

    if (qualified && bucket != null) {
      const eff = effectiveLoad(w!, r.load_type, r.bw_snapshot_kg)!;
      const vol = setVolume({
        weight_kg: w!,
        reps: reps!,
        load_type: r.load_type,
        bw_snapshot_kg: r.bw_snapshot_kg,
      })!;
      const key = `${r.exercise_id}__${bucket}`;
      const best = bestPerExerciseBucket.get(key) ?? { weight: null, volume: null };

      if (best.weight == null || eff > best.weight) {
        f.weight_pr_broken = true;
        if (r.mg_id != null) incPerMg(r.mg_id, 'weight');
        incPerBucket(bucket, 'weight');
        best.weight = eff;
      }
      if (best.volume == null || vol > best.volume) {
        f.volume_pr_broken = true;
        if (r.mg_id != null) incPerMg(r.mg_id, 'volume');
        incPerBucket(bucket, 'volume');
        best.volume = vol;
      }
      bestPerExerciseBucket.set(key, best);
    }

    flags.set(r.set_id, f);
  }

  return {
    flagsBySetId: flags,
    cumulative: { per_mg: perMg, per_bucket: perBucket },
  };
}
