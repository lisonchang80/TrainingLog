/**
 * Achievement system seed — 255 rows total (ADR-0009).
 *
 * Categories:
 *   first_combo:    11 MG × 5 bucket            = 55
 *   pr_per_mg:      11 MG × 6 thresholds × 2    = 132
 *   pr_per_bucket:   5 bucket × 6 thresholds × 2 = 60
 *   session_count:   8 thresholds                = 8
 *
 * `code` is stable + idempotent (INSERT OR IGNORE keys off it).
 * `tier` is the within-ladder index (1..N) used for sort order in UI.
 */

import { MUSCLE_GROUP_SEEDS } from './v006ExerciseLibrary';
import { BUCKETS } from '../../domain/pr/buckets';
import type { BucketKey } from '../../domain/pr/types';

export type AchievementCategory =
  | 'first_combo'
  | 'pr_per_mg'
  | 'pr_per_bucket'
  | 'session_count';

export type AchievementPRType = 'weight' | 'volume';

interface AchievementDefinitionSeed {
  code: string;
  category: AchievementCategory;
  display_name: string;
  description: string | null;
  mg_id: string | null;
  bucket_id: string | null; // bucket key for v1 (no separate bucket_constants table — see ADR-0009 note)
  pr_type: AchievementPRType | null;
  threshold: number | null;
  tier: number;
}

const PR_TIER_THRESHOLDS = [1, 10, 20, 30, 40, 50] as const;
const SESSION_TIER_THRESHOLDS = [1, 5, 10, 25, 50, 100, 250, 500] as const;

function prTypeLabel(t: AchievementPRType): string {
  return t === 'weight' ? '重量' : '容量';
}

function bucketLabelOf(k: BucketKey): string {
  return BUCKETS.find((b) => b.key === k)!.label;
}

function buildFirstCombo(): AchievementDefinitionSeed[] {
  const rows: AchievementDefinitionSeed[] = [];
  for (const mg of MUSCLE_GROUP_SEEDS) {
    for (const b of BUCKETS) {
      rows.push({
        code: `first_${mg.id}__${b.key}`,
        category: 'first_combo',
        display_name: `首次 ${mg.name} · ${b.label}`,
        description: `第一次完成 ${mg.name} 部位 · ${b.label} (${b.min}${b.max == null ? '+' : `~${b.max}`}RM) 訓練`,
        mg_id: mg.id,
        bucket_id: b.key,
        pr_type: null,
        threshold: null,
        tier: 1,
      });
    }
  }
  return rows;
}

function buildPRPerMg(): AchievementDefinitionSeed[] {
  const rows: AchievementDefinitionSeed[] = [];
  for (const mg of MUSCLE_GROUP_SEEDS) {
    for (const t of (['weight', 'volume'] as const)) {
      PR_TIER_THRESHOLDS.forEach((threshold, idx) => {
        rows.push({
          code: `pr_mg_${mg.id}__${t}__${threshold}`,
          category: 'pr_per_mg',
          display_name: `${mg.name} · ${prTypeLabel(t)} PR ×${threshold}`,
          description: `${mg.name} 部位累計 ${threshold} 次${prTypeLabel(t)} PR`,
          mg_id: mg.id,
          bucket_id: null,
          pr_type: t,
          threshold,
          tier: idx + 1,
        });
      });
    }
  }
  return rows;
}

function buildPRPerBucket(): AchievementDefinitionSeed[] {
  const rows: AchievementDefinitionSeed[] = [];
  for (const b of BUCKETS) {
    for (const t of (['weight', 'volume'] as const)) {
      PR_TIER_THRESHOLDS.forEach((threshold, idx) => {
        rows.push({
          code: `pr_bucket_${b.key}__${t}__${threshold}`,
          category: 'pr_per_bucket',
          display_name: `${bucketLabelOf(b.key)} · ${prTypeLabel(t)} PR ×${threshold}`,
          description: `${bucketLabelOf(b.key)} 累計 ${threshold} 次${prTypeLabel(t)} PR`,
          mg_id: null,
          bucket_id: b.key,
          pr_type: t,
          threshold,
          tier: idx + 1,
        });
      });
    }
  }
  return rows;
}

function buildSessionCount(): AchievementDefinitionSeed[] {
  return SESSION_TIER_THRESHOLDS.map((threshold, idx) => ({
    code: `session_count__${threshold}`,
    category: 'session_count' as const,
    display_name: `重訓 ${threshold} 次`,
    description: `累計完成 ${threshold} 次有效訓練 Session`,
    mg_id: null,
    bucket_id: null,
    pr_type: null,
    threshold,
    tier: idx + 1,
  }));
}

export const ACHIEVEMENT_DEFINITION_SEEDS: AchievementDefinitionSeed[] = [
  ...buildFirstCombo(),
  ...buildPRPerMg(),
  ...buildPRPerBucket(),
  ...buildSessionCount(),
];
