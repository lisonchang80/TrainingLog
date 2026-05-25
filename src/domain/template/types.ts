/**
 * Slice 9.5 per-set template types — pure domain model (ADR-0016).
 *
 * The pre-9.5 model lives in `templateManager.ts` as `TemplateData`/
 * `TemplateExerciseSpec` and stores "summary" defaults (default_sets/reps/
 * weight) per exercise. ADR-0016 replaces that with a per-set list so a
 * Template can encode pyramid sets, warmup/working/dropset kinds, and
 * dropset clusters explicitly.
 *
 * These types are persistence-agnostic — `TemplateExercise.notes` and
 * `TemplateExercise.parent_id` may not yet be present in the schema; the
 * repository layer adapts (adding columns or leaving NULL) and the pure
 * ops below operate on the in-memory shape regardless.
 */

export type SetKind = 'warmup' | 'working' | 'dropset';

/**
 * `section` maps 1:1 to the existing `template_exercise.is_evergreen`
 * column (0 = 'general' / 1 = 'evergreen'). The domain uses descriptive
 * strings so call sites read clearer; the repo layer does the mapping.
 */
export type ExerciseSection = 'general' | 'evergreen';

export interface TemplateSet {
  id: string;
  /**
   * 0-indexed contiguous position within the parent `TemplateExercise.sets`
   * array. Mirrored to the `template_set.position` column on persist; pure
   * ops re-normalize to 0..N after every structural mutation so the DB
   * UNIQUE(template_exercise_id, position) constraint never trips.
   */
  position: number;
  kind: SetKind;
  reps: number;
  weight: number;
  /**
   * Cluster B3 link (ADR-0016 §dropset cluster). null = standalone or
   * cluster head; non-null = follower pointing at its head's id. Followers
   * MUST share the head's `kind === 'dropset'` and sit contiguously after
   * the head in `position` order.
   */
  parent_set_id: string | null;
  /** Per-set notes (ADR-0016 2026-05-12 amendment §5). */
  notes: string | null;
}

export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  /**
   * Display name resolved from the exercise library at load time. Not
   * persisted on `template_exercise`; carried here so pure ops + UI can
   * stay decoupled from a join. Optional because callers building a draft
   * before a name is resolved are allowed.
   */
  name?: string;
  /** 0-indexed contiguous ordering within the parent `Template.exercises`. */
  ordering: number;
  section: ExerciseSection;
  /**
   * Superset linkage (ADR-0016 2026-05-12 amendment §7). null for plain
   * rows or superset parents; non-null on superset children pointing at
   * the parent's id. Children's `notes` / `rest_seconds` are dead fields
   * — superset stores them on the parent.
   */
  parent_id: string | null;
  /** Per-exercise notes (ADR-0013). UI 即時 UPDATE, not draft. */
  notes: string | null;
  /** Default rest seconds (ADR-0016 2026-05-12 amendment §2). NULL = system default. */
  rest_seconds: number | null;
  /**
   * Reusable-superset linkage (ADR-0017 L154 amendment, slice 9.8b grill Q4).
   *
   * NULL → row is a solo exercise OR a hand-crafted superset (ADR-0016 manual
   * cluster); memory lookup falls back to per-exercise solo derive.
   *
   * `S` → row was exploded from reusable superset `S`. Both parent and child
   * of a reusable-exploded cluster are stamped the same `S`. Memory derive
   * scopes to "latest cluster where rs_id = S" (per-(rs_id, position) memory
   * partition — solo and per-superset memories do not bleed).
   *
   * FK `ON DELETE SET NULL`: deleting the reusable superset in the library
   * clears this column on existing template rows but does not delete them
   * (preserves the explode model 解耦 intent of ADR-0017 L155). Cluster lock
   * rules (ADR-0016 amendment) also dissolve once `rs_id` is NULL.
   */
  reusable_superset_id: string | null;
  sets: TemplateSet[];
}

export interface Template {
  id: string;
  name: string;
  /** 12-color palette hex code (ADR-0015). Empty string = unset / hash-derived fallback. */
  color_hex: string;
  /**
   * Triple identity field (ADR-0003): the Program this template is assigned
   * to. NULL = 通用 (no program). Optional on the type so legacy callers
   * that build a Template draft without loading this field remain valid;
   * `getTemplateFull` always populates it (NULL → null).
   */
  program_id?: string | null;
  /**
   * Triple identity field (ADR-0003): sub-program intensity tag (e.g.
   * 'TEST-1'). NULL = no intensity. Optional on the type for the same
   * reason as `program_id`.
   */
  sub_tag?: string | null;
  exercises: TemplateExercise[];
}
