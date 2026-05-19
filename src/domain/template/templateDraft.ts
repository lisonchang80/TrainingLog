/**
 * Slice 9.5 Template draft state — pure logic, no DB, no React.
 *
 * Template 編輯走「儲存/取消」雙 button 顯式 commit pattern (ADR-0016
 * §設計哲學)：進入頁面時把 committed Template 載入 in-memory draft，所有
 * 改動寫 draft；儲存才落 DB、取消直接丟。為了讓 UI 知道 disabled state，
 * 我們提供：
 *
 *   - `cloneTemplate` — deep clone the committed Template for the editor
 *     to mutate without aliasing.
 *   - `templatesEqual` — structural equality used to drive 「儲存」 disabled
 *     state + 「取消」 confirm dialog gating.
 *   - `computeTemplateDiff` — produce the batch UPSERT-DELETE plan (lists
 *     of inserts/updates/deletes per entity) the repository applies on
 *     commit. Plain pure logic; repo wraps it in a transaction.
 */

import type { Template, TemplateExercise, TemplateSet } from './types';

// ---------------------------------------------------------------------------
// Clone + structural equality
// ---------------------------------------------------------------------------

export function cloneTemplate(t: Template): Template {
  return {
    id: t.id,
    name: t.name,
    color_hex: t.color_hex,
    program_id: t.program_id ?? null,
    sub_tag: t.sub_tag ?? null,
    exercises: t.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => ({ ...s })),
    })),
  };
}

function setsEqual(a: TemplateSet[], b: TemplateSet[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.position !== y.position ||
      x.kind !== y.kind ||
      x.reps !== y.reps ||
      x.weight !== y.weight ||
      (x.parent_set_id ?? null) !== (y.parent_set_id ?? null) ||
      (x.notes ?? null) !== (y.notes ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function exercisesEqual(a: TemplateExercise[], b: TemplateExercise[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.template_id !== y.template_id ||
      x.exercise_id !== y.exercise_id ||
      x.ordering !== y.ordering ||
      x.section !== y.section ||
      (x.parent_id ?? null) !== (y.parent_id ?? null) ||
      (x.notes ?? null) !== (y.notes ?? null) ||
      (x.rest_seconds ?? null) !== (y.rest_seconds ?? null) ||
      !setsEqual(x.sets, y.sets)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Deep structural equality used to drive 「儲存」 disabled state. Returns
 * true iff committed == draft on every persisted field. `name` (the
 * resolved display name on `TemplateExercise`) is treated as non-persisted
 * and skipped, since two equal-id rows from the DB should compare equal
 * regardless of whether the join happened.
 */
export function templatesEqual(a: Template, b: Template): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color_hex === b.color_hex &&
    exercisesEqual(a.exercises, b.exercises)
  );
}

// ---------------------------------------------------------------------------
// Diff: produce batch UPSERT-DELETE plan
// ---------------------------------------------------------------------------

export interface TemplatePatch {
  name?: string;
  color_hex?: string;
}

export interface TemplateExerciseInsert {
  id: string;
  template_id: string;
  exercise_id: string;
  ordering: number;
  section: TemplateExercise['section'];
  parent_id: string | null;
  notes: string | null;
  rest_seconds: number | null;
  /** Reusable-superset FK (ADR-0017 L154 amendment / slice 9.8b). NULL = solo / manual cluster. */
  reusable_superset_id: string | null;
}

export interface TemplateExerciseUpdate {
  id: string;
  ordering?: number;
  section?: TemplateExercise['section'];
  parent_id?: string | null;
  notes?: string | null;
  rest_seconds?: number | null;
  /** Reusable-superset FK (defensive — normal flow keeps this stable post-explode). */
  reusable_superset_id?: string | null;
}

export interface TemplateSetInsert {
  id: string;
  template_exercise_id: string;
  position: number;
  kind: TemplateSet['kind'];
  reps: number;
  weight: number;
  parent_set_id: string | null;
  notes: string | null;
}

export interface TemplateSetUpdate {
  id: string;
  position?: number;
  kind?: TemplateSet['kind'];
  reps?: number;
  weight?: number;
  parent_set_id?: string | null;
  notes?: string | null;
}

export interface TemplateDiff {
  /** template-level fields that changed (name / color_hex). undefined = no change. */
  templatePatch: TemplatePatch | null;
  exerciseInserts: TemplateExerciseInsert[];
  exerciseUpdates: TemplateExerciseUpdate[];
  exerciseDeletes: string[];
  setInserts: TemplateSetInsert[];
  setUpdates: TemplateSetUpdate[];
  setDeletes: string[];
}

function diffExerciseFields(
  committed: TemplateExercise,
  draft: TemplateExercise
): TemplateExerciseUpdate | null {
  const patch: TemplateExerciseUpdate = { id: draft.id };
  let dirty = false;
  if (committed.ordering !== draft.ordering) {
    patch.ordering = draft.ordering;
    dirty = true;
  }
  if (committed.section !== draft.section) {
    patch.section = draft.section;
    dirty = true;
  }
  if ((committed.parent_id ?? null) !== (draft.parent_id ?? null)) {
    patch.parent_id = draft.parent_id;
    dirty = true;
  }
  if ((committed.notes ?? null) !== (draft.notes ?? null)) {
    patch.notes = draft.notes;
    dirty = true;
  }
  if ((committed.rest_seconds ?? null) !== (draft.rest_seconds ?? null)) {
    patch.rest_seconds = draft.rest_seconds;
    dirty = true;
  }
  if (
    (committed.reusable_superset_id ?? null) !==
    (draft.reusable_superset_id ?? null)
  ) {
    patch.reusable_superset_id = draft.reusable_superset_id;
    dirty = true;
  }
  return dirty ? patch : null;
}

function diffSetFields(
  committed: TemplateSet,
  draft: TemplateSet
): TemplateSetUpdate | null {
  const patch: TemplateSetUpdate = { id: draft.id };
  let dirty = false;
  if (committed.position !== draft.position) {
    patch.position = draft.position;
    dirty = true;
  }
  if (committed.kind !== draft.kind) {
    patch.kind = draft.kind;
    dirty = true;
  }
  if (committed.reps !== draft.reps) {
    patch.reps = draft.reps;
    dirty = true;
  }
  if (committed.weight !== draft.weight) {
    patch.weight = draft.weight;
    dirty = true;
  }
  if ((committed.parent_set_id ?? null) !== (draft.parent_set_id ?? null)) {
    patch.parent_set_id = draft.parent_set_id;
    dirty = true;
  }
  if ((committed.notes ?? null) !== (draft.notes ?? null)) {
    patch.notes = draft.notes;
    dirty = true;
  }
  return dirty ? patch : null;
}

/**
 * Compare `committed` vs `draft` and produce a batch plan the repository
 * can apply in a single transaction. Entity matching is **by id only** —
 * structural ordering changes show up as `update.position` / `ordering`,
 * not as delete + reinsert.
 *
 * Inserts are emitted in draft order so the repo can preserve human-meaningful
 * insertion order on persist.
 */
export function computeTemplateDiff(args: {
  committed: Template;
  draft: Template;
}): TemplateDiff {
  const { committed, draft } = args;

  const templatePatch: TemplatePatch = {};
  let templateDirty = false;
  if (committed.name !== draft.name) {
    templatePatch.name = draft.name;
    templateDirty = true;
  }
  if (committed.color_hex !== draft.color_hex) {
    templatePatch.color_hex = draft.color_hex;
    templateDirty = true;
  }

  const committedExById = new Map(committed.exercises.map((e) => [e.id, e]));
  const draftExIds = new Set(draft.exercises.map((e) => e.id));

  const exerciseInserts: TemplateExerciseInsert[] = [];
  const exerciseUpdates: TemplateExerciseUpdate[] = [];
  const exerciseDeletes: string[] = [];

  for (const cex of committed.exercises) {
    if (!draftExIds.has(cex.id)) exerciseDeletes.push(cex.id);
  }

  for (const dex of draft.exercises) {
    const cex = committedExById.get(dex.id);
    if (!cex) {
      exerciseInserts.push({
        id: dex.id,
        template_id: dex.template_id,
        exercise_id: dex.exercise_id,
        ordering: dex.ordering,
        section: dex.section,
        parent_id: dex.parent_id,
        notes: dex.notes,
        rest_seconds: dex.rest_seconds,
        reusable_superset_id: dex.reusable_superset_id,
      });
    } else {
      const upd = diffExerciseFields(cex, dex);
      if (upd) exerciseUpdates.push(upd);
    }
  }

  const setInserts: TemplateSetInsert[] = [];
  const setUpdates: TemplateSetUpdate[] = [];
  const setDeletes: string[] = [];

  // Build per-exercise set maps for fast id lookup.
  for (const dex of draft.exercises) {
    const cex = committedExById.get(dex.id);
    const committedSetsById = new Map(
      (cex?.sets ?? []).map((s) => [s.id, s])
    );
    const draftSetIds = new Set(dex.sets.map((s) => s.id));

    if (cex) {
      for (const cs of cex.sets) {
        if (!draftSetIds.has(cs.id)) setDeletes.push(cs.id);
      }
    }
    for (const ds of dex.sets) {
      const cs = committedSetsById.get(ds.id);
      if (!cs) {
        setInserts.push({
          id: ds.id,
          template_exercise_id: dex.id,
          position: ds.position,
          kind: ds.kind,
          reps: ds.reps,
          weight: ds.weight,
          parent_set_id: ds.parent_set_id,
          notes: ds.notes,
        });
      } else {
        const upd = diffSetFields(cs, ds);
        if (upd) setUpdates.push(upd);
      }
    }
  }

  // Sets belonging to deleted exercises will CASCADE in the DB — no need
  // to emit explicit set deletes for those.
  for (const exId of exerciseDeletes) {
    const cex = committedExById.get(exId);
    if (!cex) continue;
    for (const cs of cex.sets) {
      // Drop any setDeletes already added (defensive); the per-exercise
      // loop above wouldn't have, but keep it tight either way.
      const idx = setDeletes.indexOf(cs.id);
      if (idx !== -1) setDeletes.splice(idx, 1);
    }
  }

  return {
    templatePatch: templateDirty ? templatePatch : null,
    exerciseInserts,
    exerciseUpdates,
    exerciseDeletes,
    setInserts,
    setUpdates,
    setDeletes,
  };
}

/**
 * True iff `diff` would result in zero DB writes. Equivalent to
 * `templatesEqual(committed, draft)` but faster on small diffs.
 */
export function diffIsEmpty(d: TemplateDiff): boolean {
  return (
    d.templatePatch === null &&
    d.exerciseInserts.length === 0 &&
    d.exerciseUpdates.length === 0 &&
    d.exerciseDeletes.length === 0 &&
    d.setInserts.length === 0 &&
    d.setUpdates.length === 0 &&
    d.setDeletes.length === 0
  );
}
