import type { Database } from '../../db/types';
import type {
  TemplateData,
  TemplateExerciseSpec,
} from '../../domain/template/templateManager';
import type {
  Template,
  TemplateExercise,
  TemplateSet,
} from '../../domain/template/types';
import type { MemoryCandidate } from '../../domain/template/templateMemory';

/**
 * Persistence layer for Templates and their exercise rows.
 *
 * Same pattern as `sessionRepository` and `setRepository`: pure functions
 * over the `Database` interface. No `expo-sqlite` import — production wires
 * up `expoDatabase`, tests use `betterSqliteDatabase` :memory:.
 */

export interface TemplateRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  /** ADR-0003: nullable. NULL = 自由 (free) template; non-null = attached to a Program. */
  program_id: string | null;
  /** ADR-0003: nullable per-Template 副標籤; together with `(name, program_id)` forms the identity triple. */
  sub_tag: string | null;
}

export interface TemplateSummary extends TemplateRow {
  exerciseCount: number;
}

/** Classification derived from (program_id, sub_tag), per ADR-0003. */
export type TemplateKind = 'main' | 'sub' | 'free';

export interface TemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  ordering: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
  /** 1 = 常設 zone (no Save-back removal), 0 = 一般 zone. */
  is_evergreen: 0 | 1;
}

/** All templates with a count of how many exercises each holds; newest-edited first. */
export async function listTemplates(db: Database): Promise<TemplateSummary[]> {
  return db.getAllAsync<TemplateSummary>(
    `SELECT t.id, t.name, t.created_at, t.updated_at,
            t.program_id, t.sub_tag,
            COUNT(te.id) AS exerciseCount
       FROM template t
       LEFT JOIN template_exercise te ON te.template_id = t.id
      GROUP BY t.id
      ORDER BY t.updated_at DESC`
  );
}

/**
 * Attach a Template to a Program with a given sub_tag. Per ADR-0003 the
 * (name, program_id, sub_tag) triple becomes the Template's new identity.
 * Caller should ensure (name, program_id, sub_tag) is unique within the DB.
 */
export async function attachTemplateToProgram(
  db: Database,
  args: {
    template_id: string;
    program_id: string | null;
    sub_tag: string | null;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.runAsync(
    `UPDATE template SET program_id = ?, sub_tag = ?, updated_at = ? WHERE id = ?`,
    args.program_id,
    args.sub_tag,
    ts,
    args.template_id
  );
}

/**
 * Classify a template as main / sub / free.
 *   - free: no program_id
 *   - sub:  program_id set AND another template in the same program shares this name
 *   - main: program_id set AND it's the only template with this name in the program
 *           (or the canonical "primary" — for slice 5 we treat the first attached as main)
 *
 * Slice 5 keeps this simple: any Template with program_id set is "main" for its
 * (name, program_id, sub_tag) tuple unless a sibling with the same name shares
 * the program — then ALL siblings (including this one) are "sub" except the
 * one matching its program's "primary cell" (the first cell using this name).
 * For now, the simpler heuristic: free vs (main + sub) — UI can refine later.
 */
export function classifyTemplate(args: {
  program_id: string | null;
  sameNameSiblingCount: number;
}): TemplateKind {
  if (args.program_id == null) return 'free';
  return args.sameNameSiblingCount > 1 ? 'sub' : 'main';
}

/**
 * Hydrate a full Template (header + ordered exercises) for the editor / for
 * snapshot at Session start. Returns null when the id doesn't exist.
 */
export async function getTemplate(
  db: Database,
  id: string
): Promise<TemplateData | null> {
  const tpl = await db.getFirstAsync<TemplateRow>(
    `SELECT id, name, created_at, updated_at FROM template WHERE id = ?`,
    id
  );
  if (!tpl) return null;
  const exercises = await db.getAllAsync<TemplateExerciseSpec>(
    `SELECT exercise_id, ordering, default_sets, default_reps, default_weight_kg, is_evergreen
       FROM template_exercise
      WHERE template_id = ?
      ORDER BY ordering ASC`,
    id
  );
  return { id: tpl.id, name: tpl.name, exercises };
}

export async function createTemplate(
  db: Database,
  args: { id: string; name: string; now?: () => number }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.runAsync(
    `INSERT INTO template (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    args.id,
    args.name,
    ts,
    ts
  );
}

export async function updateTemplateName(
  db: Database,
  args: { id: string; name: string; now?: () => number }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.runAsync(
    `UPDATE template SET name = ?, updated_at = ? WHERE id = ?`,
    args.name,
    ts,
    args.id
  );
}

/**
 * Permanently remove a Template and all its exercise rows. Past Sessions
 * snapshotted from this template are NOT touched (their `session_exercise`
 * rows still hold a stale `template_id` reference; we never join back from
 * Session → Template, so a dangling pointer is harmless).
 */
export async function deleteTemplate(db: Database, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM template_exercise WHERE template_id = ?`, id);
    await db.runAsync(`DELETE FROM template WHERE id = ?`, id);
  });
}

/**
 * Append a new exercise row to a Template. Ordering is auto-assigned as
 * `(MAX(ordering) for this template) + 1` so rows append to the end.
 *
 * `uuid` is REQUIRED — Hermes lacks `crypto.randomUUID`, so callers must
 * inject (`expo-crypto.randomUUID` in production, deterministic stub in tests).
 */
export async function addTemplateExercise(
  db: Database,
  args: {
    template_id: string;
    exercise_id: string;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
    is_evergreen?: 0 | 1;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ id: string; ordering: number }> {
  const id = args.uuid();
  const ts = (args.now ?? Date.now)();
  const row = await db.getFirstAsync<{ max_ordering: number | null }>(
    `SELECT MAX(ordering) AS max_ordering FROM template_exercise WHERE template_id = ?`,
    args.template_id
  );
  const ordering = (row?.max_ordering ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO template_exercise
       (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg, is_evergreen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    args.template_id,
    args.exercise_id,
    ordering,
    args.default_sets,
    args.default_reps,
    args.default_weight_kg,
    args.is_evergreen ?? 0
  );
  await db.runAsync(
    `UPDATE template SET updated_at = ? WHERE id = ?`,
    ts,
    args.template_id
  );
  return { id, ordering };
}

/**
 * Toggle the evergreen flag on a single template_exercise row. Used by the
 * editor's star/zone toggle. No-op when the row is already in the requested
 * state. Bumps the parent template's `updated_at`.
 */
export async function setTemplateExerciseEvergreen(
  db: Database,
  args: {
    template_exercise_id: string;
    is_evergreen: 0 | 1;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  const row = await db.getFirstAsync<{ template_id: string }>(
    `SELECT template_id FROM template_exercise WHERE id = ?`,
    args.template_exercise_id
  );
  if (!row) return;
  await db.runAsync(
    `UPDATE template_exercise SET is_evergreen = ? WHERE id = ?`,
    args.is_evergreen,
    args.template_exercise_id
  );
  await db.runAsync(
    `UPDATE template SET updated_at = ? WHERE id = ?`,
    ts,
    row.template_id
  );
}

/** Remove one exercise row from a Template by its row id. No-op if missing. */
export async function removeTemplateExercise(
  db: Database,
  args: { template_exercise_id: string; now?: () => number }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  const row = await db.getFirstAsync<{ template_id: string }>(
    `SELECT template_id FROM template_exercise WHERE id = ?`,
    args.template_exercise_id
  );
  if (!row) return;
  await db.runAsync(
    `DELETE FROM template_exercise WHERE id = ?`,
    args.template_exercise_id
  );
  await db.runAsync(
    `UPDATE template SET updated_at = ? WHERE id = ?`,
    ts,
    row.template_id
  );
}

/**
 * Read raw template_exercise rows including the row id (which `getTemplate`
 * doesn't expose since the snapshot transform doesn't need it). The editor UI
 * needs the row id to call `removeTemplateExercise`.
 */
export async function listTemplateExerciseRows(
  db: Database,
  template_id: string
): Promise<TemplateExerciseRow[]> {
  return db.getAllAsync<TemplateExerciseRow>(
    `SELECT id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg, is_evergreen
       FROM template_exercise
      WHERE template_id = ?
      ORDER BY ordering ASC`,
    template_id
  );
}

// ===========================================================================
// Slice 9.5 — per-set template editor (ADR-0016)
// ===========================================================================

/**
 * Hydrate the slice-9.5 per-set view of a template:
 *   Template { exercises[].sets[] }
 *
 * Joins `template_exercise.exercise_id → exercise.name` so the UI doesn't
 * need a second query. Re-keys `ordering` / `position` to 0..N contiguous
 * to match the domain invariant — the editor mutates by id, not index, so
 * re-keying on read is safe.
 *
 * Returns null when `id` doesn't exist. Uses the v009 schema (color_hex on
 * template, parent_id/notes/rest_seconds/updated_at on template_exercise,
 * template_set table for sets).
 */
export async function getTemplateFull(
  db: Database,
  id: string
): Promise<Template | null> {
  const tpl = await db.getFirstAsync<{
    id: string;
    name: string;
    color_hex: string;
  }>(`SELECT id, name, color_hex FROM template WHERE id = ?`, id);
  if (!tpl) return null;

  // Notes is sourced from `exercise.notes` (per-Exercise global) per
  // ADR-0017 amendment to ADR-0013. The legacy `template_exercise.notes`
  // column is dead — v010 merged the most-recent per-template note into
  // exercise.notes, and v012 drops the column. Reads JOIN exercise.notes
  // directly so the editor sees the latest global value.
  const exRows = await db.getAllAsync<{
    id: string;
    template_id: string;
    exercise_id: string;
    name: string | null;
    ordering: number;
    is_evergreen: 0 | 1;
    parent_id: string | null;
    notes: string | null;
    rest_seconds: number | null;
  }>(
    `SELECT te.id, te.template_id, te.exercise_id, e.name,
            te.ordering, te.is_evergreen, te.parent_id,
            e.notes AS notes,
            te.rest_seconds
       FROM template_exercise te
       LEFT JOIN exercise e ON e.id = te.exercise_id
      WHERE te.template_id = ?
      ORDER BY te.ordering ASC`,
    id
  );

  if (exRows.length === 0) {
    return { id: tpl.id, name: tpl.name, color_hex: tpl.color_hex, exercises: [] };
  }

  const setRows = await db.getAllAsync<{
    id: string;
    template_exercise_id: string;
    position: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    reps: number;
    weight: number;
    parent_set_id: string | null;
    notes: string | null;
  }>(
    `SELECT ts.id, ts.template_exercise_id, ts.position, ts.set_kind,
            ts.reps, ts.weight, ts.parent_set_id, ts.notes
       FROM template_set ts
       JOIN template_exercise te ON te.id = ts.template_exercise_id
      WHERE te.template_id = ?
      ORDER BY ts.template_exercise_id, ts.position ASC`,
    id
  );

  const setsByEx = new Map<string, TemplateSet[]>();
  for (const row of setRows) {
    const list = setsByEx.get(row.template_exercise_id) ?? [];
    list.push({
      id: row.id,
      position: list.length, // re-key 0..N
      kind: row.set_kind,
      reps: row.reps,
      weight: row.weight,
      parent_set_id: row.parent_set_id,
      notes: row.notes,
    });
    setsByEx.set(row.template_exercise_id, list);
  }

  const exercises: TemplateExercise[] = exRows.map((r, i) => ({
    id: r.id,
    template_id: r.template_id,
    exercise_id: r.exercise_id,
    name: r.name ?? undefined,
    ordering: i, // re-key 0..N
    section: r.is_evergreen === 1 ? 'evergreen' : 'general',
    parent_id: r.parent_id,
    notes: r.notes,
    rest_seconds: r.rest_seconds,
    sets: setsByEx.get(r.id) ?? [],
  }));

  return {
    id: tpl.id,
    name: tpl.name,
    color_hex: tpl.color_hex,
    exercises,
  };
}

function setsArraysEqual(a: TemplateSet[], b: TemplateSet[]): boolean {
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

function exMetadataChanged(a: TemplateExercise, b: TemplateExercise): boolean {
  // `notes` is per-Exercise global now (ADR-0017 amendment to ADR-0013):
  // it lives on `exercise.notes` and is written via a separate UPDATE in
  // commitTemplateDraft. Template-exercise metadata diff therefore EXCLUDES
  // notes — a notes-only edit doesn't dirty the template_exercise row.
  return (
    a.ordering !== b.ordering ||
    a.section !== b.section ||
    (a.parent_id ?? null) !== (b.parent_id ?? null) ||
    (a.rest_seconds ?? null) !== (b.rest_seconds ?? null)
  );
}

/**
 * Commit a Template editor draft to DB in one atomic transaction (儲存 button
 * path). Compares `committed` (last-known DB state) against `draft` and
 * applies the diff:
 *
 *   - template-level name / color_hex differences → UPDATE template
 *   - removed exercises → DELETE FROM template_exercise (CASCADE on sets)
 *   - kept exercises with metadata changes → UPDATE template_exercise
 *   - kept exercises with set-list changes → DELETE all sets + INSERT all
 *     draft sets (avoids UNIQUE(position) two-phase dance for small N)
 *   - new exercises → INSERT template_exercise + INSERT all sets
 *
 * Every touched template_exercise bumps its `updated_at` so 動作記憶 picks
 * the right candidate later. The parent template's `updated_at` is bumped
 * iff any change happened.
 *
 * Idempotency: re-applying an unchanged draft is a no-op (no diff = no
 * writes). Caller passes `now` for deterministic timestamps in tests.
 */
export async function commitTemplateDraft(
  db: Database,
  args: { committed: Template; draft: Template; now?: () => number }
): Promise<void> {
  const { committed, draft } = args;
  const now = args.now ?? Date.now;
  const ts = now();

  const committedById = new Map(committed.exercises.map((e) => [e.id, e]));
  const draftIds = new Set(draft.exercises.map((e) => e.id));
  const removedExIds = committed.exercises
    .filter((e) => !draftIds.has(e.id))
    .map((e) => e.id);

  let anyChange =
    committed.name !== draft.name ||
    committed.color_hex !== draft.color_hex ||
    removedExIds.length > 0;

  // Pre-compute kept-exercise work so we know if anyChange before opening tx.
  type Plan = {
    inserts: TemplateExercise[];
    metaUpdates: TemplateExercise[];
    setRewrites: TemplateExercise[];
  };
  const plan: Plan = { inserts: [], metaUpdates: [], setRewrites: [] };
  for (const dex of draft.exercises) {
    const cex = committedById.get(dex.id);
    if (!cex) {
      plan.inserts.push(dex);
      anyChange = true;
      continue;
    }
    if (exMetadataChanged(cex, dex)) {
      plan.metaUpdates.push(dex);
      anyChange = true;
    }
    if (!setsArraysEqual(cex.sets, dex.sets)) {
      plan.setRewrites.push(dex);
      anyChange = true;
    }
  }

  // ADR-0017 amendment to ADR-0013: notes is per-Exercise global. Compare
  // each draft.exercise.notes to the current DB value on `exercise.notes`
  // (one SELECT IN-list); UPDATE per unique exercise_id where different.
  // If two draft rows share the same exercise_id with different notes
  // values, the LAST iteration wins (last-write-wins; UI should prevent).
  const draftExerciseIds = Array.from(
    new Set(draft.exercises.map((e) => e.exercise_id))
  );
  const exerciseNotesUpdates = new Map<string, string | null>();
  if (draftExerciseIds.length > 0) {
    const placeholders = draftExerciseIds.map(() => '?').join(',');
    const currentRows = await db.getAllAsync<{ id: string; notes: string | null }>(
      `SELECT id, notes FROM exercise WHERE id IN (${placeholders})`,
      ...draftExerciseIds
    );
    const currentNotes = new Map(currentRows.map((r) => [r.id, r.notes ?? null]));
    for (const dex of draft.exercises) {
      const cur = currentNotes.get(dex.exercise_id) ?? null;
      const desired = dex.notes ?? null;
      if (cur !== desired) {
        exerciseNotesUpdates.set(dex.exercise_id, desired);
      }
    }
    if (exerciseNotesUpdates.size > 0) anyChange = true;
  }

  if (!anyChange) return;

  await db.withTransactionAsync(async () => {
    // 1. UPDATE template-level fields
    if (committed.name !== draft.name || committed.color_hex !== draft.color_hex) {
      await db.runAsync(
        `UPDATE template SET name = ?, color_hex = ?, updated_at = ? WHERE id = ?`,
        draft.name,
        draft.color_hex,
        ts,
        draft.id
      );
    } else {
      await db.runAsync(
        `UPDATE template SET updated_at = ? WHERE id = ?`,
        ts,
        draft.id
      );
    }

    // 2. DELETE removed exercises (CASCADE handles their sets via v009 FK)
    for (const exId of removedExIds) {
      await db.runAsync(`DELETE FROM template_exercise WHERE id = ?`, exId);
    }

    // 3. metadata-only UPDATEs (no set changes). `notes` removed — see step 6.
    const setRewriteIds = new Set(plan.setRewrites.map((e) => e.id));
    for (const dex of plan.metaUpdates) {
      if (setRewriteIds.has(dex.id)) continue; // handled by set rewrite block
      await db.runAsync(
        `UPDATE template_exercise
            SET ordering = ?, is_evergreen = ?, parent_id = ?,
                rest_seconds = ?, updated_at = ?
          WHERE id = ?`,
        dex.ordering,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        ts,
        dex.id
      );
    }

    // 4. set-rewrite path: bump exercise row + wipe & reinsert sets
    for (const dex of plan.setRewrites) {
      await db.runAsync(
        `UPDATE template_exercise
            SET ordering = ?, is_evergreen = ?, parent_id = ?,
                rest_seconds = ?, updated_at = ?
          WHERE id = ?`,
        dex.ordering,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        ts,
        dex.id
      );
      await db.runAsync(
        `DELETE FROM template_set WHERE template_exercise_id = ?`,
        dex.id
      );
      for (let i = 0; i < dex.sets.length; i++) {
        const s = dex.sets[i];
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          s.id,
          dex.id,
          i,
          s.kind,
          s.reps,
          s.weight,
          s.parent_set_id,
          s.notes
        );
      }
    }

    // 5. INSERT new exercises + their sets. `template_exercise.notes` is
    // written as NULL — the column is legacy (v012 drops it); per-Exercise
    // notes is owned by `exercise.notes` (step 6).
    for (const dex of plan.inserts) {
      // default_sets/default_reps/default_weight_kg are deprecated since v009
      // (template_set list is the source of truth) but the column is NOT NULL
      // so we write a sensible default = sets.length / null / null.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, notes, rest_seconds, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?)`,
        dex.id,
        dex.template_id,
        dex.exercise_id,
        dex.ordering,
        dex.sets.length,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        ts
      );
      for (let i = 0; i < dex.sets.length; i++) {
        const s = dex.sets[i];
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          s.id,
          dex.id,
          i,
          s.kind,
          s.reps,
          s.weight,
          s.parent_set_id,
          s.notes
        );
      }
    }

    // 6. Per-Exercise global notes — write through to exercise.notes for any
    // exercise_id whose draft value differs from the current DB value.
    // Deduped earlier (one UPDATE per exercise_id, last-write-wins).
    for (const [exerciseId, notesValue] of exerciseNotesUpdates) {
      await db.runAsync(
        `UPDATE exercise SET notes = ? WHERE id = ?`,
        notesValue,
        exerciseId
      );
    }
  });
}

/**
 * Group-wide rename: every template whose `name = oldName` becomes `newName`.
 * Bumps `updated_at` on each touched row. No-op when `oldName === newName`.
 * Per ADR-0015/0016 the sibling group key is the template name.
 */
export async function applyRenameSiblings(
  db: Database,
  args: { oldName: string; newName: string; now?: () => number }
): Promise<void> {
  if (args.oldName === args.newName) return;
  const ts = (args.now ?? Date.now)();
  await db.runAsync(
    `UPDATE template SET name = ?, updated_at = ? WHERE name = ?`,
    args.newName,
    ts,
    args.oldName
  );
}

/**
 * Group-wide recolor: every template with the given `name` gets `color_hex`.
 * Bumps `updated_at`. Empty string is accepted (= unset / hash fallback in
 * the renderer).
 */
export async function applyRecolorSiblings(
  db: Database,
  args: { name: string; color_hex: string; now?: () => number }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.runAsync(
    `UPDATE template SET color_hex = ?, updated_at = ? WHERE name = ?`,
    args.color_hex,
    ts,
    args.name
  );
}

/**
 * 動作記憶 (ADR-0012/0016): query candidates for `exercise_id` across all
 * templates, ordered by `template_exercise.updated_at DESC`. The pure-logic
 * `deriveLatestSetsForExercise` picks the winner + remaps ids.
 *
 * Limits to the top `limit` (default 8) candidates to bound the join cost.
 */
export async function queryMemoryCandidates(
  db: Database,
  args: { exercise_id: string; limit?: number }
): Promise<MemoryCandidate[]> {
  const limit = args.limit ?? 8;
  const exRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    updated_at: number;
  }>(
    `SELECT id, exercise_id, updated_at
       FROM template_exercise
      WHERE exercise_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    args.exercise_id,
    limit
  );
  if (exRows.length === 0) return [];

  const placeholders = exRows.map(() => '?').join(',');
  const setRows = await db.getAllAsync<{
    id: string;
    template_exercise_id: string;
    position: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    reps: number;
    weight: number;
    parent_set_id: string | null;
    notes: string | null;
  }>(
    `SELECT id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes
       FROM template_set
      WHERE template_exercise_id IN (${placeholders})
      ORDER BY template_exercise_id, position ASC`,
    ...exRows.map((r) => r.id)
  );

  const setsByEx = new Map<string, TemplateSet[]>();
  for (const r of setRows) {
    const list = setsByEx.get(r.template_exercise_id) ?? [];
    list.push({
      id: r.id,
      position: list.length,
      kind: r.set_kind,
      reps: r.reps,
      weight: r.weight,
      parent_set_id: r.parent_set_id,
      notes: r.notes,
    });
    setsByEx.set(r.template_exercise_id, list);
  }

  return exRows.map((r) => ({
    template_exercise_id: r.id,
    exercise_id: r.exercise_id,
    updated_at: r.updated_at,
    sets: setsByEx.get(r.id) ?? [],
  }));
}
