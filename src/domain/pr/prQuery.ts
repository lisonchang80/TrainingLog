/**
 * All-time PR query for a single exercise (ADR-0019 Q5, slice 10c Phase 3
 * commit 15). Reduces a list of historical sets into the "PR display" lines
 * the session card shows below its header:
 *
 *   - `weightPRs`: rows of (weight_kg, reps) that are non-dominated by any
 *     other historical set. A set X is dominated by Y if Y.weight >= X.weight
 *     AND Y.reps >= X.reps AND (Y > X on at least one axis). The result is
 *     the "Pareto frontier" of the (weight, reps) plane.
 *   - `volumePR`: max single-set volume (weight_kg × reps) across all sets,
 *     null if no qualifying sets.
 *
 * Why Pareto frontier: ADR-0019 Q5 拍板 wants e.g. `100 × 8` AND `85 × 12`
 * both visible — neither dominates the other (one has more weight, the
 * other more reps), so both are PRs at the (weight, reps) plane level.
 * Filtering down to the frontier keeps the line short while preserving the
 * "best at each rep range" semantic without re-introducing the 5-bucket
 * splitting from the existing prEngine (which is per-bucket, not overall).
 *
 * Pure-bodyweight set exclusion is the caller's responsibility (since this
 * doesn't know load_type) — pass only sets that have meaningful weight×reps
 * volume. Same convention as detectPRBreaks.
 */

export interface PRQueryInput {
  weight_kg: number | null;
  reps: number | null;
}

interface WeightRepsPR {
  weight_kg: number;
  reps: number;
}

export interface PRSnapshot {
  /** Pareto frontier of (weight, reps). Sorted by weight DESC then reps DESC. */
  weightPRs: WeightRepsPR[];
  /** Max single-set volume (weight_kg × reps), or null if no qualifying sets. */
  volumePR: number | null;
  /**
   * **Single-set 重量 PR**: the set with the heaviest weight ever logged.
   * Tie-break (same weight, different reps): pick the row with max reps so
   * we surface the most impressive single rep×weight combo on the card.
   * Null if no qualifying sets. ADR-0019 Q5 amend (2026-05-16 ultra-late):
   * card collapses Pareto frontier into single top-weight + top-volume.
   */
  topWeightSet: WeightRepsPR | null;
  /**
   * **Single-set 容量 PR**: the set with max (weight × reps). Tie-break:
   * max weight then max reps. Null if no qualifying sets. ADR-0019 Q5 amend.
   */
  topVolumeSet: WeightRepsPR | null;
}

export function computePRSnapshot(sets: PRQueryInput[]): PRSnapshot {
  // Filter out null/zero rows up front — they can't dominate anything.
  const valid = sets.filter(
    (s): s is { weight_kg: number; reps: number } =>
      s.weight_kg != null &&
      s.reps != null &&
      Number.isFinite(s.weight_kg) &&
      Number.isFinite(s.reps) &&
      s.weight_kg > 0 &&
      s.reps > 0,
  );

  // De-dupe exact (weight, reps) pairs so the frontier doesn't list the
  // same point twice.
  const seen = new Set<string>();
  const unique: WeightRepsPR[] = [];
  for (const s of valid) {
    const key = `${s.weight_kg}x${s.reps}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ weight_kg: s.weight_kg, reps: s.reps });
    }
  }

  // Pareto: keep only points not dominated by any other.
  const frontier = unique.filter(
    (a) =>
      !unique.some(
        (b) =>
          (b.weight_kg > a.weight_kg && b.reps >= a.reps) ||
          (b.weight_kg >= a.weight_kg && b.reps > a.reps),
      ),
  );

  // Sort frontier weight DESC, then reps DESC for stable display.
  frontier.sort(
    (a, b) => b.weight_kg - a.weight_kg || b.reps - a.reps,
  );

  // Max volume + top-weight set + top-volume set (single-set views per Q5 amend).
  let volumePR: number | null = null;
  let topWeightSet: WeightRepsPR | null = null;
  let topVolumeSet: WeightRepsPR | null = null;
  for (const s of valid) {
    const v = s.weight_kg * s.reps;
    if (volumePR === null || v > volumePR) volumePR = v;

    // Top-weight set: max weight, tie-break max reps.
    if (
      topWeightSet === null ||
      s.weight_kg > topWeightSet.weight_kg ||
      (s.weight_kg === topWeightSet.weight_kg && s.reps > topWeightSet.reps)
    ) {
      topWeightSet = { weight_kg: s.weight_kg, reps: s.reps };
    }

    // Top-volume set: max w×r, tie-break max weight then max reps.
    const cur = topVolumeSet;
    const curVol = cur === null ? -Infinity : cur.weight_kg * cur.reps;
    if (
      cur === null ||
      v > curVol ||
      (v === curVol && s.weight_kg > cur.weight_kg) ||
      (v === curVol &&
        s.weight_kg === cur.weight_kg &&
        s.reps > cur.reps)
    ) {
      topVolumeSet = { weight_kg: s.weight_kg, reps: s.reps };
    }
  }

  return { weightPRs: frontier, volumePR, topWeightSet, topVolumeSet };
}
