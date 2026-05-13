/**
 * Reusable Superset entity (ADR-0017 Q10) — v1 fixed at 2 exercises.
 *
 * Distinct from ADR-0016 in-session SetGroup superset: Reusable Superset is
 * an entity living in the library, while SetGroup is an execution pattern
 * inside a single Template / Session. Adding a Reusable Superset to a
 * Template **explodes** into 2 `template_exercise` rows linked via
 * `parent_id` (per ADR-0016); the library entity and the exploded rows
 * are decoupled afterwards (砍 reusable superset 不影響 Template 內已 explode
 * 的 rows).
 */

import type { Exercise } from '../exercise/types';

export interface ReusableSuperset {
  id: string;
  name: string;
  /** ADR-0015 12-color palette hex code. null = unset / hash-derived fallback. */
  color_hex: string | null;
  /**
   * Cached counter (ADR-0017 Q10) — bumped by domain every time the superset
   * is exploded into a Template (or used directly in a Session). Persisted as
   * a column rather than computed via JOIN aggregate for read performance on
   * the library grid「N 次」badge.
   */
  use_count: number;
  created_at: number;
  updated_at: number;
}

/** Order-preserving link row: PRIMARY KEY (superset_id, position). */
export interface SupersetExerciseSlot {
  superset_id: string;
  /** 0 = parent, 1 = child (UI prevents creating size != 2). */
  position: number;
  exercise_id: string;
}

/**
 * Hydrated view used by the library grid / detail page — exercises are in
 * position order (index 0 = parent, index 1 = child).
 */
export interface ReusableSupersetWithExercises {
  superset: ReusableSuperset;
  exercises: Exercise[];
}
