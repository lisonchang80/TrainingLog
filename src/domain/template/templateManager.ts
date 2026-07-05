/**
 * Module #5 — Template Manager (pure logic, no DB).
 *
 * A Template is a named, ordered list of exercises with default sets/reps/weight
 * per exercise. It plays the role of a workout plan that the user reaches for
 * over and over.
 *
 * The cornerstone of slice 3 is **snapshot isolation**: when a Session is
 * started from a Template, the Session captures a frozen copy of the Template's
 * exercises so subsequent Template edits don't retroactively alter past
 * Sessions. `snapshotForSession` is the pure transformation that produces the
 * snapshot rows; the SQLite adapter just persists them.
 *
 * Pure functions only. No side effects, no DB, no React. Unit-tested in
 * isolation.
 */

export interface TemplateExerciseSpec {
  exercise_id: string;
  ordering: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
  /**
   * 1 = 常設 (evergreen, can't be removed via Save-back) / 0 = 一般 (general).
   * Slice 4 only enforces per-Template semantics; sibling-Template propagation
   * lands with Program / 強度 in a later slice (per ADR-0005).
   */
  is_evergreen: 0 | 1;
  /**
   * template_exercise.id — required when the spec carries cluster identity
   * (`parent_id` references this id on the cluster child). Optional so older
   * test fixtures that don't model cluster structure stay valid.
   */
  id?: string;
  /**
   * Cluster linkage (ADR-0016 manual cluster + ADR-0017 Q10 RS-explode). Points
   * to another `TemplateExerciseSpec.id` in the same template. NULL = solo /
   * cluster parent. Must be remapped to session-side se.id by
   * `snapshotForSession`.
   */
  parent_id?: string | null;
  /**
   * Reusable Superset identity (ADR-0017 Q10 v013 amendment). NULL = solo or
   * manual cluster; NOT NULL = exploded from this reusable_superset_id. Passed
   * through verbatim into the session snapshot — not remapped (foreign id
   * pointing to superset.id).
   */
  reusable_superset_id?: string | null;
  /**
   * Per-exercise rest seconds between sets (ADR-0019 Q2 + slice 10b bridge).
   *
   * NULL = inherit hardcoded 60s system default. Coalesce happens at UI / timer
   * layer, NOT here — snapshot copies NULL verbatim into the session so a later
   * Save-back can distinguish "user set NULL" from "user set 60".
   *
   * **Schema bridge note**: the DB column on `template_exercise` is
   * `rest_seconds` (v009 / ADR-0016 — pre-dates ADR-0019 which used the name
   * `rest_sec`). v016 added a separate `template_exercise.rest_sec` column by
   * mistake — it stays NULL and is treated as an orphan (future v018 may
   * DROP). This `rest_sec` field on the domain spec is the canonical name; the
   * adapter (`templateRepository.getTemplate`) maps the legacy `rest_seconds`
   * column into this field.
   */
  rest_sec?: number | null;
}

export interface TemplateData {
  id: string;
  name: string;
  exercises: TemplateExerciseSpec[];
}

/**
 * Validates a template before persistence. Returns null on success, or a
 * human-readable error string. Empty exercises array is allowed — a user can
 * save a template stub and add exercises later.
 */
export function validateTemplate(t: TemplateData): string | null {
  if (!t.id) return 'Template id is required';
  if (!t.name || !t.name.trim()) return 'Template name cannot be empty';
  for (const ex of t.exercises) {
    if (!ex.exercise_id) return 'Exercise id is required for each row';
    if (!Number.isFinite(ex.default_sets) || ex.default_sets < 0) {
      return 'default_sets must be a non-negative number';
    }
    if (
      ex.default_reps != null &&
      (!Number.isFinite(ex.default_reps) || ex.default_reps < 0)
    ) {
      return 'default_reps must be non-negative when set';
    }
    if (
      ex.default_weight_kg != null &&
      (!Number.isFinite(ex.default_weight_kg) || ex.default_weight_kg < 0)
    ) {
      return 'default_weight_kg must be non-negative when set';
    }
  }
  return null;
}

interface SessionExerciseSnapshot {
  id: string;
  session_id: string;
  exercise_id: string;
  ordering: number;
  planned_sets: number;
  planned_reps: number | null;
  planned_weight_kg: number | null;
  template_id: string;
  /** Frozen copy of the source TemplateExerciseSpec.is_evergreen at snapshot time. */
  is_evergreen: 0 | 1;
  /**
   * Cluster linkage on the session side (ADR-0018, v014). Points to another
   * session_exercise.id IN THE SAME SESSION. NULL = solo / cluster parent.
   * `snapshotForSession` remaps `TemplateExerciseSpec.parent_id` (which points
   * to a template_exercise.id) onto the new session-side id via a 2-pass
   * idMap.
   */
  parent_id: string | null;
  /**
   * Reusable Superset identity on the session side (ADR-0018, v014). NULL =
   * solo / manual cluster / ad-hoc cluster (no RS); NOT NULL = templated
   * RS-explode cluster. Copied verbatim from `TemplateExerciseSpec.reusable_
   * superset_id` (foreign id pointing to superset.id — no remap).
   */
  reusable_superset_id: string | null;
  /**
   * Per-exercise rest seconds (ADR-0019 Q2 + slice 10b bridge). Copied
   * verbatim from `TemplateExerciseSpec.rest_sec` (which in turn was mapped
   * from the legacy `template_exercise.rest_seconds` column by the adapter).
   * NULL = inherit hardcoded 60s system default; coalesce at UI layer only.
   */
  rest_sec: number | null;
}

/**
 * Pure projection: turn a Template's `exercises` list into the rows that will
 * be persisted as `session_exercise` for the new Session.
 *
 * Re-indexes ordering 1..N so the Session's plan list always counts from 1
 * regardless of the Template's internal ordering values (useful if the user
 * later reorders / deletes within a Template — past Session ordering stays
 * compact).
 *
 * Caller injects `uuid: () => string` (Hermes lacks global crypto; production
 * passes `randomUUID` from `expo-crypto`, tests pass deterministic stubs).
 *
 * ADR-0018, v014 — Cluster identity propagation:
 *   - `reusable_superset_id` is copied verbatim (no remap — foreign id).
 *   - `parent_id` references another template_exercise.id; it is remapped to
 *     the session-side session_exercise.id via a 2-pass idMap so cluster
 *     structure survives the snapshot.
 *   - Dangling `parent_id` (refers to an id not in the same template's
 *     exercise list) throws — data integrity violation rather than silent
 *     fallback. If specs do not carry `id`, parent_id refs cannot be resolved
 *     and are treated as missing-id refs (also throw); if no spec has any
 *     `parent_id` (older test fixtures, solo-only templates), nothing to
 *     remap and all snapshots get parent_id = null.
 */
export function snapshotForSession(args: {
  template: TemplateData;
  session_id: string;
  uuid: () => string;
  /**
   * Phase C-id (2026-07-05) — optional caller-supplied session_exercise
   * ids, position-aligned to `template.exercises` sorted by `ordering
   * ASC`. When index `i` is a non-empty string it is adopted verbatim;
   * when absent / null / undefined the id is minted via `uuid()` (legacy
   * behaviour). Lets the Watch-initiated start honour the ids the Watch
   * already minted so both devices share the session_exercise identity.
   * The pass-2 `parent_id` remap resolves against whichever id was used
   * (idMap is populated from `newId`), so superset linkage stays correct
   * regardless of source.
   */
  suppliedIds?: readonly (string | null | undefined)[];
}): SessionExerciseSnapshot[] {
  const sorted = [...args.template.exercises].sort(
    (a, b) => a.ordering - b.ordering
  );

  // Pass 1: allocate new ids, build oldId → newId map, copy non-self-referencing fields.
  const idMap = new Map<string, string>();
  const out: SessionExerciseSnapshot[] = sorted.map((ex, i) => {
    const newId = args.suppliedIds?.[i] || args.uuid();
    if (ex.id) idMap.set(ex.id, newId);
    return {
      id: newId,
      session_id: args.session_id,
      exercise_id: ex.exercise_id,
      ordering: i + 1,
      planned_sets: ex.default_sets,
      planned_reps: ex.default_reps,
      planned_weight_kg: ex.default_weight_kg,
      template_id: args.template.id,
      is_evergreen: ex.is_evergreen,
      parent_id: null,
      reusable_superset_id: ex.reusable_superset_id ?? null,
      rest_sec: ex.rest_sec ?? null,
    };
  });

  // Pass 2: resolve parent_id refs against the new id space.
  for (let i = 0; i < sorted.length; i++) {
    const oldParent = sorted[i].parent_id;
    if (oldParent === undefined || oldParent === null) continue;
    const newParent = idMap.get(oldParent);
    if (!newParent) {
      throw new Error(
        `snapshotForSession: dangling parent_id ${oldParent} in template ${args.template.id}`
      );
    }
    out[i].parent_id = newParent;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Display helper — triple identity (ADR-0003)
// ---------------------------------------------------------------------------

/**
 * Format the (program_name, sub_tag) pair for display in template UI
 * (editor header, list rows, etc). Triple identity per ADR-0003: two
 * templates can share the same `name` but differ in (program_id, sub_tag),
 * so the user needs to see the disambiguator inline.
 *
 * Format (拍板 = Format A):
 *   (null, null)        → '通用'
 *   ('推日訓練', null)   → '推日訓練'
 *   (null, 'TEST-1')    → '通用 · TEST-1'
 *   ('推日訓練', 'TEST-1') → '推日訓練 · TEST-1'
 *
 * Separator is U+00B7 (middle dot · ).
 */
export function formatTemplateTriple(
  program_name: string | null,
  sub_tag: string | null
): string {
  const p = program_name ?? '通用';
  if (!sub_tag) return p;
  return `${p} · ${sub_tag}`;
}

/**
 * Session header subtitle (line 2) — the immutable template-identity badge:
 * 「模板名 · 計劃 · 強度」(2026-06-26 拍板). Distinct from `formatTemplateTriple`
 * (which leads with 計劃/強度 only): this prefixes the originating template
 * name so the second line keeps showing the full origin even after the user
 * renames the editable title (line 1). The template name is sourced from the
 * LINKED template (stable), not session.title (mutable).
 *
 * Joins only the present parts with U+00B7 ( · ); degenerate parts drop out:
 *   ('胸推日', '推日訓練', '中度日') → '胸推日 · 推日訓練 · 中度日'
 *   ('胸推日', '推日訓練', null)    → '胸推日 · 推日訓練'
 *   ('胸推日', null, null)          → '胸推日'
 */
export function formatSessionSubtitle(
  template_name: string | null,
  program_name: string | null,
  sub_tag: string | null
): string {
  return [template_name, program_name, sub_tag]
    .filter((p): p is string => !!p && p.length > 0)
    .join(' · ');
}
