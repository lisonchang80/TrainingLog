import type { Database } from '../../db/types';
import type {
  TemplateData,
  TemplateExerciseSpec,
} from '../../domain/template/templateManager';

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
