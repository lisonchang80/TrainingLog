/**
 * Replay gate — 「↻ 再次訓練」per-row enable/disable logic
 * (slice 10c wave 14, 2026-05-21).
 *
 * Pre-this-wave: `canReplay` was computed once at HistoryPageContent level
 * from URL params (currentSeId vs currentSeIdA/B) and applied to every
 * SessionRow uniformly. That meant a cluster source row could be tapped
 * even when the target was a solo card, and a different-partner cluster
 * source row could be tapped even though the replay helper would fail to
 * find a matching B-side source row and surface `找不到該超級組 B 側來源卡`.
 *
 * New rule (user requirement):
 *   - target is solo (currentSeId set, no A/B):
 *       row is cluster → disable
 *       row is solo    → enable
 *   - target is cluster (currentSeIdA + currentSeIdB set, partner set):
 *       row is solo                        → disable
 *       row is cluster, different partner  → disable
 *       row is cluster, partner matches    → enable
 *       row is cluster, mixed partners     → disable (defensive)
 *   - no replay context (browse from library / RS detail / template editor):
 *       all rows disable
 *
 * Pure logic — no DB / React dependency. Caller passes the per-row sets
 * (already filtered by clusterMode) plus the replay target shape.
 */

/** Shape of the replay target (mirrors the URL params on /exercise-history). */
export type ReplayTarget =
  | { kind: 'none' }
  | { kind: 'solo'; currentSeId: string }
  | {
      kind: 'cluster';
      currentSeIdA: string;
      currentSeIdB: string;
      partnerExerciseId: string;
    };

/** Per-row classification of cluster shape. */
export type RowClusterShape =
  | { kind: 'solo' }
  | { kind: 'cluster'; partnerExerciseId: string }
  | { kind: 'cluster_mixed' };

/**
 * Classify a session row's cluster shape from its set rows.
 *
 * - All sets `is_in_cluster=false` → solo
 * - All cluster sets share the same partner → cluster (with that partner)
 * - Multiple distinct cluster partners in the same row → cluster_mixed
 *
 * Note: a row that mixes some solo + some cluster sets is treated as
 * cluster — the solo sets are ignored for shape classification (this is a
 * defensive corner case; in practice cluster-mode filtering means rows
 * are uniform in `is_in_cluster`).
 */
export function classifyRowClusterShape(
  sets: readonly { is_in_cluster: boolean; cluster_partner_exercise_id: string | null }[]
): RowClusterShape {
  const clusterSets = sets.filter((s) => s.is_in_cluster);
  if (clusterSets.length === 0) return { kind: 'solo' };
  const partners = new Set<string>();
  for (const s of clusterSets) {
    if (s.cluster_partner_exercise_id != null) {
      partners.add(s.cluster_partner_exercise_id);
    }
  }
  if (partners.size === 0) {
    // Defensive: is_in_cluster=true but no partner_exercise_id (legacy data?).
    // Treat as mixed (disable replay) rather than guess.
    return { kind: 'cluster_mixed' };
  }
  if (partners.size > 1) return { kind: 'cluster_mixed' };
  const [partnerExerciseId] = [...partners];
  return { kind: 'cluster', partnerExerciseId };
}

/**
 * Should the「↻ 再次訓練」button be enabled for this row?
 *
 * Returns true iff the row's cluster shape is compatible with the target.
 */
export function canReplayRow(
  rowShape: RowClusterShape,
  target: ReplayTarget
): boolean {
  if (target.kind === 'none') return false;
  if (target.kind === 'solo') {
    return rowShape.kind === 'solo';
  }
  // target.kind === 'cluster'
  if (rowShape.kind !== 'cluster') return false;
  return rowShape.partnerExerciseId === target.partnerExerciseId;
}
