/**
 * Pure view-model for the achievements panel (ADR-0009 Amendment — Slice 17).
 *
 * The old panel rendered 255 flat definition cards (locked/unlocked). The new
 * panel COLLAPSES each (group × type) threshold ladder into ONE tier card with
 * a progress bar, and only shows cards for groups the user has "碰過"
 * (≥1 working set logged). `session_count` (milestone) is global and always
 * shown.
 *
 * This file is PURE — no DB, no React. The .tsx adapter loads raw inputs
 * (definition rows + replay cumulative counts + touched signal + total session
 * count) and hands them in; we return the card view-models per filter.
 *
 * WHY thresholds are derived from the definition rows (not hardcoded): the
 * ladders are seeded in `v008Achievements.ts` and the engine reads them from
 * the DB. Deriving the ladder from the same rows keeps this model in lock-step
 * with whatever was seeded — no second source of truth to drift.
 */

import type { BucketKey } from '../pr/types';
import type { AchievementDefinitionRow } from './types';

export type PanelFilter = 'all' | 'mg' | 'bucket' | 'milestone';
export type PRType = 'weight' | 'volume';

/**
 * Tier index is 0-based:
 *   0 = no threshold reached yet (below the first rung), OR — for bucket cards —
 *       the level-0「入門」badge state.
 *   1..N = highest reached rung (1 = first threshold met, N = top rung).
 * `tierIndex` drives the accent colour; `currentTier` is the human "Lv N".
 */
export type CardKind = 'mg' | 'bucket' | 'milestone';

export interface TierCardVM {
  /** Stable key for list rendering. */
  key: string;
  kind: CardKind;
  /** mg_id for mg cards / BucketKey for bucket cards / null for milestone. */
  groupId: string | null;
  /** weight | volume for mg+bucket cards; null for milestone. */
  prType: PRType | null;
  /**
   * Localised label is resolved in the .tsx (needs locale + mg name lookup).
   * Here we expose the raw pieces so the renderer can build the title.
   */
  groupLabelKey: string | null; // mg_id or BucketKey (renderer localises) ; null for milestone
  /** Current achieved count (PR count for ladders, session count for milestone). */
  currentCount: number;
  /** Highest threshold the user has reached (0 = none yet). */
  reachedThreshold: number;
  /** Human tier number = number of rungs cleared (0..N). */
  currentTier: number;
  /** Total rungs in this ladder. */
  totalTiers: number;
  /**
   * tierIndex into the accent palette. 0 = "no tier yet / entry". When a tier
   * is reached, tierIndex === currentTier (clamped to palette length in UI).
   */
  tierIndex: number;
  /** Next threshold to reach, or null at top tier. */
  nextThreshold: number | null;
  /** True when the top rung is cleared (no next threshold). */
  maxed: boolean;
  /**
   * Bucket cards only: the level-0「入門」badge lit iff the bucket is 碰過.
   * (mg cards & milestone leave this false — the renderer ignores it.)
   */
  entryBadge: boolean;
}

export interface PanelModelInput {
  /** All achievement_definition rows (any category). */
  defs: readonly AchievementDefinitionRow[];
  /** Already-unlocked definition ids (drives first_combo level-0 fallback). */
  unlockedIds: ReadonlySet<number>;
  /** Cumulative PR counts per mg (from prReplay). */
  perMg: ReadonlyMap<string, { weight: number; volume: number }>;
  /** Cumulative PR counts per bucket (from prReplay). */
  perBucket: ReadonlyMap<BucketKey, { weight: number; volume: number }>;
  /** mg_ids the user has 碰過 (≥1 working set). */
  touchedMgs: ReadonlySet<string>;
  /** bucket keys the user has 碰過 (≥1 working set). */
  touchedBuckets: ReadonlySet<string>;
  /** All-time logged session count (drives the milestone ladder). */
  totalSessionCount: number;
}

const PR_TYPES: readonly PRType[] = ['weight', 'volume'];

/**
 * Sorted, de-duped threshold ladder for a set of definition rows.
 * Rows carry `threshold` (the rung) + `tier` (1-based index) from the seed;
 * we sort by threshold ascending and drop nulls.
 */
function ladderThresholds(rows: readonly AchievementDefinitionRow[]): number[] {
  const set = new Set<number>();
  for (const r of rows) if (r.threshold != null) set.add(r.threshold);
  return [...set].sort((a, b) => a - b);
}

/**
 * Given a cumulative count and a sorted ascending ladder, compute tier state.
 * - reachedThreshold: highest ladder value ≤ count (0 if none).
 * - currentTier: how many rungs cleared (0..N).
 * - nextThreshold: first ladder value > count, or null if maxed.
 * - maxed: every rung cleared.
 */
function tierState(count: number, ladder: readonly number[]) {
  let currentTier = 0;
  let reachedThreshold = 0;
  for (const th of ladder) {
    if (count >= th) {
      currentTier += 1;
      reachedThreshold = th;
    } else {
      break;
    }
  }
  const nextThreshold = currentTier < ladder.length ? ladder[currentTier] : null;
  return {
    currentTier,
    reachedThreshold,
    nextThreshold,
    maxed: ladder.length > 0 && currentTier === ladder.length,
  };
}

/** Build one tier card for a (group × type) ladder. */
function makeLadderCard(args: {
  kind: CardKind;
  key: string;
  groupId: string;
  prType: PRType;
  count: number;
  ladderRows: readonly AchievementDefinitionRow[];
  entryBadge: boolean;
}): TierCardVM {
  const ladder = ladderThresholds(args.ladderRows);
  const st = tierState(args.count, ladder);
  return {
    key: args.key,
    kind: args.kind,
    groupId: args.groupId,
    prType: args.prType,
    groupLabelKey: args.groupId,
    currentCount: args.count,
    reachedThreshold: st.reachedThreshold,
    currentTier: st.currentTier,
    totalTiers: ladder.length,
    tierIndex: st.currentTier,
    nextThreshold: st.nextThreshold,
    maxed: st.maxed,
    entryBadge: args.entryBadge,
  };
}

/**
 * Build the mg cards: one per (mg × weight) and (mg × volume), only for
 * 碰過 muscle groups. Ordered by the order mg ids appear in `defs` (which is
 * the seed/display order from the repo's ORDER BY), then weight before volume.
 */
function buildMgCards(input: PanelModelInput): TierCardVM[] {
  const { defs, perMg, touchedMgs } = input;
  // Preserve definition order for mg ids.
  const mgOrder: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (d.category === 'pr_per_mg' && d.mg_id != null && !seen.has(d.mg_id)) {
      seen.add(d.mg_id);
      mgOrder.push(d.mg_id);
    }
  }
  const cards: TierCardVM[] = [];
  for (const mg of mgOrder) {
    if (!touchedMgs.has(mg)) continue;
    const counts = perMg.get(mg) ?? { weight: 0, volume: 0 };
    for (const type of PR_TYPES) {
      const ladderRows = defs.filter(
        (d) => d.category === 'pr_per_mg' && d.mg_id === mg && d.pr_type === type
      );
      if (ladderRows.length === 0) continue;
      cards.push(
        makeLadderCard({
          kind: 'mg',
          key: `mg-${mg}-${type}`,
          groupId: mg,
          prType: type,
          count: counts[type],
          ladderRows,
          entryBadge: false,
        })
      );
    }
  }
  return cards;
}

/**
 * Build the bucket cards: one per (bucket × weight) and (bucket × volume),
 * only for 碰過 buckets. The `first_combo`「入門」badge lights when the bucket
 * is 碰過 OR ≥1 of its mg×bucket first_combo rows is unlocked.
 */
function buildBucketCards(input: PanelModelInput): TierCardVM[] {
  const { defs, perBucket, touchedBuckets, unlockedIds } = input;
  const bucketOrder: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (d.category === 'pr_per_bucket' && d.bucket_id != null && !seen.has(d.bucket_id)) {
      seen.add(d.bucket_id);
      bucketOrder.push(d.bucket_id);
    }
  }
  // Pre-index first_combo unlocked-by-bucket for the entry badge.
  const firstComboUnlockedBuckets = new Set<string>();
  for (const d of defs) {
    if (d.category === 'first_combo' && d.bucket_id != null && unlockedIds.has(d.id)) {
      firstComboUnlockedBuckets.add(d.bucket_id);
    }
  }
  const cards: TierCardVM[] = [];
  for (const bk of bucketOrder) {
    const touched = touchedBuckets.has(bk);
    const entry = touched || firstComboUnlockedBuckets.has(bk);
    // Show the bucket card only if 碰過 (entry badge alone — i.e. only a
    // stale first_combo unlock with no working set — still shows, since
    // first_combo unlocking implies a logged set existed historically).
    if (!entry) continue;
    const counts = perBucket.get(bk as BucketKey) ?? { weight: 0, volume: 0 };
    for (const type of PR_TYPES) {
      const ladderRows = defs.filter(
        (d) => d.category === 'pr_per_bucket' && d.bucket_id === bk && d.pr_type === type
      );
      if (ladderRows.length === 0) continue;
      cards.push(
        makeLadderCard({
          kind: 'bucket',
          key: `bucket-${bk}-${type}`,
          groupId: bk,
          prType: type,
          count: counts[type],
          ladderRows,
          entryBadge: entry,
        })
      );
    }
  }
  return cards;
}

/** The single, always-shown global milestone card (session_count ladder). */
function buildMilestoneCard(input: PanelModelInput): TierCardVM {
  const ladderRows = input.defs.filter((d) => d.category === 'session_count');
  const ladder = ladderThresholds(ladderRows);
  const st = tierState(input.totalSessionCount, ladder);
  return {
    key: 'milestone-session',
    kind: 'milestone',
    groupId: null,
    prType: null,
    groupLabelKey: null,
    currentCount: input.totalSessionCount,
    reachedThreshold: st.reachedThreshold,
    currentTier: st.currentTier,
    totalTiers: ladder.length,
    tierIndex: st.currentTier,
    nextThreshold: st.nextThreshold,
    maxed: st.maxed,
    entryBadge: false,
  };
}

/**
 * Compute the cards for a given filter.
 *   all       → mg cards + bucket cards + milestone
 *   mg        → mg cards
 *   bucket    → bucket cards
 *   milestone → milestone only
 */
export function buildAchievementPanelCards(
  input: PanelModelInput,
  filter: PanelFilter
): TierCardVM[] {
  switch (filter) {
    case 'mg':
      return buildMgCards(input);
    case 'bucket':
      return buildBucketCards(input);
    case 'milestone':
      return [buildMilestoneCard(input)];
    case 'all':
    default:
      return [...buildMgCards(input), ...buildBucketCards(input), buildMilestoneCard(input)];
  }
}
