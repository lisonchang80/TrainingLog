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
   * lands with Program / 副標籤 in a later slice (per ADR-0005).
   */
  is_evergreen: 0 | 1;
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

export interface SessionExerciseSnapshot {
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
 */
export function snapshotForSession(args: {
  template: TemplateData;
  session_id: string;
  uuid: () => string;
}): SessionExerciseSnapshot[] {
  const sorted = [...args.template.exercises].sort(
    (a, b) => a.ordering - b.ordering
  );
  return sorted.map((ex, i) => ({
    id: args.uuid(),
    session_id: args.session_id,
    exercise_id: ex.exercise_id,
    ordering: i + 1,
    planned_sets: ex.default_sets,
    planned_reps: ex.default_reps,
    planned_weight_kg: ex.default_weight_kg,
    template_id: args.template.id,
    is_evergreen: ex.is_evergreen,
  }));
}
