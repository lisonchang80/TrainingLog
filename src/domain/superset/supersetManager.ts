/**
 * Reusable Superset pure domain logic (ADR-0017 Q10).
 *
 * All ops are referentially transparent: dependencies on uuid and the
 * current timestamp are injected so tests can pin both. The repository
 * layer (src/adapters/sqlite/supersetRepository.ts) wraps these and
 * persists the resulting rows in transactions.
 *
 * Conventions match `src/domain/exercise/exerciseLibrary.ts` — validation
 * returns `ValidationError[]`; create/update return the new shape rather
 * than mutating in place.
 */

import type { Exercise } from '../exercise/types';
import type { TemplateExercise } from '../template/types';
import type {
  ReusableSuperset,
  SupersetExerciseSlot,
} from './types';

export interface ReusableSupersetDraft {
  name: string;
  color_hex: string | null;
  /** Exactly 2 distinct exercise ids; [0] = parent, [1] = child. */
  exercise_ids: [string, string];
}

export interface ValidationError {
  field: keyof ReusableSupersetDraft | 'general';
  message: string;
}

/**
 * Default name produced when the user has not typed one yet —
 * "<exA.name> + <exB.name>" per ADR-0017 Q10. UI may still let the user
 * override before saving.
 */
export function defaultSupersetName(exA: Exercise, exB: Exercise): string {
  return `${exA.name} + ${exB.name}`;
}

/**
 * Validate a Reusable Superset draft:
 *   - name required, ≤ 60 chars after trim (matches Custom Exercise rule)
 *   - color_hex may be null; if provided, must be 7-char "#rrggbb"
 *   - exactly 2 exercise_ids, both non-empty, and DISTINCT (no superset
 *     with the same exercise twice — UI prevents this; repo rejects via
 *     PRIMARY KEY collision but earlier feedback is nicer)
 */
export function validateReusableSupersetDraft(
  draft: ReusableSupersetDraft
): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = draft.name.trim();
  if (!name) {
    errors.push({ field: 'name', message: '請輸入超級組名稱' });
  } else if (name.length > 60) {
    errors.push({ field: 'name', message: '超級組名稱請少於 60 字元' });
  }

  if (draft.color_hex !== null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.color_hex)) {
      errors.push({
        field: 'color_hex',
        message: 'color_hex 必須是 #rrggbb 6 位 hex 或 null',
      });
    }
  }

  if (!Array.isArray(draft.exercise_ids) || draft.exercise_ids.length !== 2) {
    errors.push({
      field: 'exercise_ids',
      message: '超級組需要剛好 2 個動作',
    });
  } else {
    const [a, b] = draft.exercise_ids;
    if (!a || !b) {
      errors.push({ field: 'exercise_ids', message: 'exercise_ids 不可有空值' });
    } else if (a === b) {
      errors.push({
        field: 'exercise_ids',
        message: '超級組的兩個動作不可重複',
      });
    }
  }

  return errors;
}

export interface CreateReusableSupersetArgs {
  draft: ReusableSupersetDraft;
  idGen: () => string;
  now: () => number;
}

/**
 * Build a fresh `ReusableSuperset` row + its 2 `SupersetExerciseSlot`
 * link rows. Caller MUST `validateReusableSupersetDraft` first; this
 * function trusts the draft.
 *
 * `use_count` starts at 0 — bumped only when the superset is actually
 * exploded into a Template / used in a Session (see `bumpUseCount`).
 */
export function createReusableSuperset(
  args: CreateReusableSupersetArgs
): { superset: ReusableSuperset; links: SupersetExerciseSlot[] } {
  const { draft, idGen, now } = args;
  const t = now();
  const id = idGen();
  const superset: ReusableSuperset = {
    id,
    name: draft.name.trim(),
    color_hex: draft.color_hex,
    use_count: 0,
    created_at: t,
    updated_at: t,
  };
  const links: SupersetExerciseSlot[] = [
    { superset_id: id, position: 0, exercise_id: draft.exercise_ids[0] },
    { superset_id: id, position: 1, exercise_id: draft.exercise_ids[1] },
  ];
  return { superset, links };
}

/**
 * Rename a superset. Pair lock means exercises are NOT mutable here
 * (ADR-0017 Q10 「動作組合鎖死」— to change exercises, delete + recreate).
 */
export function renameReusableSuperset(
  s: ReusableSuperset,
  name: string,
  now: () => number
): ReusableSuperset {
  return { ...s, name: name.trim(), updated_at: now() };
}

export function recolorReusableSuperset(
  s: ReusableSuperset,
  color_hex: string | null,
  now: () => number
): ReusableSuperset {
  return { ...s, color_hex, updated_at: now() };
}

/**
 * Increment `use_count` by 1 (called when explode-into-Template /
 * add-to-Session succeeds). `updated_at` bumps so the library grid sort
 * by "recently used" stays meaningful.
 */
export function bumpUseCount(
  s: ReusableSuperset,
  now: () => number
): ReusableSuperset {
  return { ...s, use_count: s.use_count + 1, updated_at: now() };
}

export interface ExplodeSupersetArgs {
  /** Reusable superset entity (only `id` consulted; rest is for caller readability). */
  superset: ReusableSuperset;
  /**
   * Exercises in position order — `[exercises[0]]` becomes the superset
   * parent, `[exercises[1]]` becomes the child.
   */
  exercises: [Exercise, Exercise];
  template_id: string;
  /**
   * Where to drop the pair in the target template's exercises list. The
   * parent goes at `ordering_start`, the child at `ordering_start + 1`.
   * Caller is responsible for ensuring this slot is free / shifting other
   * rows as needed.
   */
  ordering_start: number;
  idGen: () => string;
}

/**
 * Convert a Reusable Superset into 2 fresh `TemplateExercise` rows ready
 * to be inserted into a Template draft. Pure transform — no DB I/O.
 *
 * Output: `[parent, child]`. Parent has `parent_id = null`; child has
 * `parent_id = parent.id`. Both start with empty `sets`, `rest_seconds`
 * = null, `notes` = null, and `section = 'general'` — exactly the same
 * shape the Template editor produces when the user picks 2 plain exercises
 * + manually groups them, so the downstream per-row-index pairing / cluster
 * B3 rules from ADR-0016 apply unchanged.
 *
 * The library entity (use_count etc.) is NOT touched here. Caller should
 * separately `bumpUseCount(superset, now)` + persist on a successful add.
 */
export function explodeSupersetForTemplate(
  args: ExplodeSupersetArgs
): TemplateExercise[] {
  const { exercises, template_id, ordering_start, idGen } = args;
  const [parentEx, childEx] = exercises;
  const parentId = idGen();
  const childId = idGen();
  const parent: TemplateExercise = {
    id: parentId,
    template_id,
    exercise_id: parentEx.id,
    name: parentEx.name,
    ordering: ordering_start,
    section: 'general',
    parent_id: null,
    notes: null,
    rest_seconds: null,
    sets: [],
  };
  const child: TemplateExercise = {
    id: childId,
    template_id,
    exercise_id: childEx.id,
    name: childEx.name,
    ordering: ordering_start + 1,
    section: 'general',
    parent_id: parentId,
    notes: null,
    rest_seconds: null,
    sets: [],
  };
  return [parent, child];
}
