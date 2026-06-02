import type { ExerciseHistorySession } from '../../adapters/sqlite/exerciseHistoryRepository';
import type { LoadType } from '../exercise/types';
import type { BucketKey } from './types';
import { classifyBucket } from './buckets';
import { effectiveLoad } from './e1rmEngine';
import { setVolume } from './volumeEngine';

/**
 * Per-exercise history PR aggregation (extracted from app/exercise-history/[id].tsx
 * 2026-06-02, big-file health #8). Pure: walks all historical sessions' sets and
 * folds the best weight-PR and best volume-PR per rep bucket + an `all` bucket.
 *
 * ADR-0012: PR snapshot only considers WORKING sets — warmup + dropset cluster
 * (incl. parent root) never count. effectiveLoad / setVolume / classifyBucket are
 * the same domain primitives the live PR engine uses, so history + live agree.
 */

export type PRKey = 'all' | BucketKey;

export interface PRSnapshotWithDate {
  key: PRKey;
  weight_best: number | null;
  /** Raw input weight (in kg) for the weight-PR set. For load_type='assisted'
   *  this is the assistance amount (machine help); for 'loaded' / 'bodyweight'
   *  this equals weight_best. Threaded so the UI can show both effective +
   *  raw in the assisted case (user reload 2026-05-20: 「60 X 12 怎麼在歷史
   *  變成 3 X 12」— answer: 63 − 60 = 3 effective; show both for clarity). */
  weight_best_raw: number | null;
  weight_best_reps: number | null;
  weight_best_at: number | null;
  volume_best: number | null;
  volume_best_weight: number | null;
  /** Raw input weight for the volume-PR set (assisted-only meaningful). */
  volume_best_raw_weight: number | null;
  volume_best_reps: number | null;
  volume_best_at: number | null;
}

const PR_ORDER: PRKey[] = [
  'all',
  'max_strength',
  'strength',
  'hypertrophy',
  'muscle_endurance',
  'endurance',
];

export function computePRs(
  sessions: ExerciseHistorySession[],
  loadType: LoadType
): PRSnapshotWithDate[] {
  const empty = (key: PRKey): PRSnapshotWithDate => ({
    key,
    weight_best: null,
    weight_best_raw: null,
    weight_best_reps: null,
    weight_best_at: null,
    volume_best: null,
    volume_best_weight: null,
    volume_best_raw_weight: null,
    volume_best_reps: null,
    volume_best_at: null,
  });
  const acc: Record<PRKey, PRSnapshotWithDate> = {
    all: empty('all'),
    max_strength: empty('max_strength'),
    strength: empty('strength'),
    hypertrophy: empty('hypertrophy'),
    muscle_endurance: empty('muscle_endurance'),
    endurance: empty('endurance'),
  };

  // 2026-05-20: track raw alongside eff so assisted display can render
  //「<eff> kg（助力 <raw> kg）」(user reload feedback).
  const update = (
    key: PRKey,
    eff: number,
    raw: number,
    reps: number,
    v: number,
    at: number,
  ) => {
    const snap = acc[key];
    if (snap.weight_best == null || eff > snap.weight_best) {
      snap.weight_best = eff;
      snap.weight_best_raw = raw;
      snap.weight_best_reps = reps;
      snap.weight_best_at = at;
    }
    if (snap.volume_best == null || v > snap.volume_best) {
      snap.volume_best = v;
      snap.volume_best_weight = eff;
      snap.volume_best_raw_weight = raw;
      snap.volume_best_reps = reps;
      snap.volume_best_at = at;
    }
  };

  for (const sess of sessions) {
    for (const s of sess.sets) {
      // ADR-0012 line 173 / line 100: PR snapshot 只看 working set；
      // warmup + dropset cluster (含 parent root) 一律不算 PR。
      if (s.set_kind !== 'working') continue;
      if (s.weight_kg == null || s.reps == null) continue;
      if (loadType === 'bodyweight' && s.weight_kg === 0) continue;
      if (loadType === 'assisted' && s.bw_snapshot_kg == null) continue;

      const eff = effectiveLoad(s.weight_kg, loadType, s.bw_snapshot_kg);
      if (eff == null) continue;
      if (loadType === 'assisted' && eff <= 0) continue;

      const v = setVolume({
        weight_kg: s.weight_kg,
        reps: s.reps,
        load_type: loadType,
        bw_snapshot_kg: s.bw_snapshot_kg,
      });
      if (v == null) continue;

      const bucket = classifyBucket(s.reps);
      const at = sess.session_started_at;

      update('all', eff, s.weight_kg, s.reps, v, at);
      if (bucket) update(bucket, eff, s.weight_kg, s.reps, v, at);
    }
  }

  return PR_ORDER.map((k) => acc[k]).filter((snap) => snap.weight_best != null);
}
