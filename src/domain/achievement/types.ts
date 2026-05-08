/**
 * Module #9 — Achievement Engine — shared types.
 *
 * Pure logic. No DB, no React. Caller hands in pre-loaded session detail +
 * current unlock state + cumulative PR counts; engine returns the list of
 * newly-triggered unlocks. Caller persists them to `achievement_unlock`.
 */

import type { BucketKey } from '../pr/types';
import type {
  AchievementCategory,
  AchievementPRType,
} from '../../db/seed/v008Achievements';

/** One persisted achievement_definition row, used as engine input. */
export interface AchievementDefinitionRow {
  id: number;
  code: string;
  category: AchievementCategory;
  display_name: string;
  description: string | null;
  mg_id: string | null;
  bucket_id: string | null;
  pr_type: AchievementPRType | null;
  threshold: number | null;
  tier: number;
}

/** Per-set record fed into evaluate(). */
export interface SessionEvalSet {
  set_id: string;
  /** Primary muscle group of the exercise. Null if exercise has no MG. */
  mg_id: string | null;
  /** Rep bucket of this set. Null if reps invalid. */
  bucket: BucketKey | null;
  /** is_skipped = 0 AND valid weight/reps. */
  is_logged: boolean;
  /** Whether this set broke a weight PR in its bucket. */
  weight_pr_broken: boolean;
  /** Whether this set broke a volume PR in its bucket. */
  volume_pr_broken: boolean;
}

export interface SessionEval {
  session_id: string;
  sets: readonly SessionEvalSet[];
}

/** Cumulative PR counts INCLUDING the session being evaluated. */
export interface CumulativePRCounts {
  per_mg: Map<string, { weight: number; volume: number }>;
  per_bucket: Map<BucketKey, { weight: number; volume: number }>;
}

/** Output: one newly-triggered unlock to persist. */
export interface NewUnlock {
  definition_id: number;
  session_id: string;
  set_id: string | null;
}

export interface EvaluateInput {
  session: SessionEval;
  defs: readonly AchievementDefinitionRow[];
  /** Set of already-unlocked definition.id values BEFORE this evaluation. */
  unlockedIds: ReadonlySet<number>;
  /** Cumulative all-time PR counts (this session included). */
  cumulativePRCounts: CumulativePRCounts;
  /** Total all-time session_count INCLUDING this session if it's logged. */
  totalSessionCount: number;
}
