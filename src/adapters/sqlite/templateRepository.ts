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
  /** ADR-0003: nullable per-Template 強度; together with `(name, program_id)` forms the identity triple. */
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
 * Templates list view — dedupes by `name`, keeping the most-recent-edited
 * variant as the representative. Mirrors `listTemplates` shape but groups
 * by ADR-0003 three-tuple identity's name component. Used by Templates tab
 * UI (一個 name 一條 row); other callers (today / program / wizard) still
 * use `listTemplates` to see every variant.
 *
 * Rationale (round 41 polish, Q1 = B): ADR-0003 三元組 identity 保留現況 —
 * same name + different (program, sub_tag) IS a distinct template row. But
 * the Templates tab's list view was getting visually swamped (e.g. 4 same-
 * named clones after picking 4 different sub_tags). Dedupe collapses each
 * name to ONE row; the user re-picks the (計劃, 強度) inside the start sheet
 * via `findTemplateByTriple` lookup-or-spawn. The non-list callers (today
 * panel / program editor / wizard) keep using `listTemplates` because they
 * legitimately need every variant.
 *
 * Representative selection (Q1 = B): the sibling with the highest
 * `updated_at`. SQL pattern: correlated subquery `t.updated_at = (SELECT
 * MAX(t2.updated_at) FROM template t2 WHERE t2.name = t.name)`. Stable
 * across re-renders because edits bump `updated_at` and the latest edit
 * naturally wins. No variant-count badge (Q2 = B).
 */
export async function listTemplateGroupsByName(
  db: Database
): Promise<TemplateSummary[]> {
  return db.getAllAsync<TemplateSummary>(
    `SELECT t.id, t.name, t.created_at, t.updated_at,
            t.program_id, t.sub_tag,
            COUNT(te.id) AS exerciseCount
       FROM template t
       LEFT JOIN template_exercise te ON te.template_id = t.id
      WHERE t.updated_at = (
        SELECT MAX(t2.updated_at) FROM template t2 WHERE t2.name = t.name
      )
      GROUP BY t.id
      ORDER BY t.updated_at DESC`
  );
}

/**
 * Slice 10c overnight #54 — list every same-name template variant (every
 * ADR-0003 三元組 sibling sharing `name`). Used by the Templates tab list
 * swipe-to-delete entry: the list is dedupe-by-name (`listTemplateGroupsByName`)
 * so a single row represents a whole name group, but the actual delete must
 * cascade across every variant under that name. The confirm Alert also
 * enumerates each variant's triple so the user sees what they're nuking.
 *
 * Returned rows mirror `TemplateRow` (id + name + timestamps + program_id +
 * sub_tag) — no `exerciseCount` since the caller doesn't need per-variant
 * counts, just the triple identity for the Alert + the id to feed `deleteTemplate`.
 *
 * Ordered by `updated_at DESC` so the most-recent-edited variant lists first
 * in the Alert body (matches `listTemplateGroupsByName`'s representative-
 * picking — the user sees the same row they swiped first).
 */
export async function listTemplateVariantsByName(
  db: Database,
  name: string
): Promise<TemplateRow[]> {
  return db.getAllAsync<TemplateRow>(
    `SELECT id, name, created_at, updated_at, program_id, sub_tag
       FROM template
      WHERE name = ?
      ORDER BY updated_at DESC`,
    name
  );
}

/**
 * Distinct non-null `template.sub_tag` values across all templates, sorted
 * ascending. Feeds the 強度 picker in the start-template bottom sheet
 * (ADR-0019 §Q9.1a). Empty list when no template has a sub_tag yet — the
 * caller renders an empty intensity list + 「+ 新增強度」 affordance.
 */
export async function listDistinctSubTags(db: Database): Promise<string[]> {
  const rows = await db.getAllAsync<{ sub_tag: string }>(
    `SELECT DISTINCT sub_tag FROM template
      WHERE sub_tag IS NOT NULL AND sub_tag != ''
      ORDER BY sub_tag ASC`
  );
  return rows.map((r) => r.sub_tag);
}

/**
 * Per-program distinct sub_tags. Similar to listDistinctSubTags but scoped
 * to a single program_id. Returns empty array when no template under that
 * program has a sub_tag yet — caller renders the intensity chip row with
 * only the「通用」(null) chip + 「+ 新增強度」 affordance.
 *
 * Used by 另存模板 TemplateMetaSheet (5/18 polish): when the user selects
 * a specific program, the 強度標籤 chip list should only surface sub_tags
 * already used within THAT program — not the cross-program union. Picking
 * 「通用」(program_id = null) hides the whole 強度標籤 section per the
 * sheet's UI spec, so this helper is not called for the null case.
 */
export async function listDistinctSubTagsByProgram(
  db: Database,
  program_id: string
): Promise<string[]> {
  const rows = await db.getAllAsync<{ sub_tag: string }>(
    `SELECT DISTINCT sub_tag FROM template
      WHERE program_id = ?
        AND sub_tag IS NOT NULL
        AND sub_tag != ''
      ORDER BY sub_tag ASC`,
    program_id
  );
  return rows.map((r) => r.sub_tag);
}

/**
 * NULL-safe lookup of a template by its (name, program_id, sub_tag) identity
 * triple (ADR-0003). Returns the matching row's `{ id }` or `null` when no
 * match exists.
 *
 * Used by round 38 polish — `templates.tsx::onStart` lookup-or-spawn rule:
 * when the user picks a (program, sub_tag) that doesn't match the sheet
 * template's own triple, we first probe for an existing sibling under that
 * triple (e.g. the clone #37 spawned earlier) before falling back to a fresh
 * `cloneTemplateWithSubTag`. Without this lookup, picking an EXISTING
 * sub_tag chip would still send `startSessionFromTemplate` at the source
 * row and a later「儲存模板」 would silently overwrite the source.
 *
 * NULL handling: both `program_id` and `sub_tag` are nullable per schema; the
 * SQL applies the standard `(col IS NULL AND ? IS NULL) OR col = ?` idiom to
 * each so binding NULL on either column matches an actual NULL row (SQL `=`
 * never matches NULL otherwise).
 */
export async function findTemplateByTriple(
  db: Database,
  args: {
    name: string;
    program_id: string | null;
    sub_tag: string | null;
  }
): Promise<{ id: string } | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM template
      WHERE name = ?
        AND ((program_id IS NULL AND ? IS NULL) OR program_id = ?)
        AND ((sub_tag IS NULL AND ? IS NULL) OR sub_tag = ?)
      LIMIT 1`,
    args.name,
    args.program_id,
    args.program_id,
    args.sub_tag,
    args.sub_tag
  );
  return row ?? null;
}

/**
 * Resolve a session's "linked template" identity (name + program + sub_tag)
 * for the Today banner during an in-progress session (5/19 polish #43).
 *
 * "Linked template" = the most common non-null `session_exercise.template_id`
 * among the session's rows; tie-break by earliest `ordering` for determinism
 * (mirrors `convertSessionToTemplate`'s `linkedTemplateId` resolution, with
 * the tie-break tightened so the order of identically-counted templates is
 * stable). Returns `null` for a freestyle session (no row carries a non-null
 * template_id) — caller renders 「自由訓練」.
 *
 * The second SELECT joins `program` to resolve `program.name` (may be NULL
 * when the template lives under the「通用」program or none); `template.sub_tag`
 * is read directly.
 */
export async function getSessionLinkedTemplateTriple(
  db: Database,
  session_id: string
): Promise<{
  template_id: string;
  template_name: string;
  program_id: string | null;
  program_name: string | null;
  sub_tag: string | null;
} | null> {
  // Step 1: most-common non-null template_id; tie-break by earliest ordering
  // for deterministic ordering when two templates share the same row count.
  const head = await db.getFirstAsync<{ template_id: string }>(
    `SELECT template_id
       FROM session_exercise
      WHERE session_id = ? AND template_id IS NOT NULL
      GROUP BY template_id
      ORDER BY COUNT(*) DESC, MIN(ordering) ASC
      LIMIT 1`,
    session_id
  );
  if (!head) return null;

  // Step 2: hydrate (template_name, program_id, program_name, sub_tag).
  // 2026-05-20 overnight #55 (slice 10c 另存模板 prefill): include `program_id`
  // so callers building a sheet's program-picker initial state can match
  // against the existing programs list. The Today banner caller only uses
  // `program_name` for display; adding `program_id` is backwards-compatible.
  const row = await db.getFirstAsync<{
    template_name: string;
    program_id: string | null;
    program_name: string | null;
    sub_tag: string | null;
  }>(
    `SELECT t.name AS template_name,
            t.program_id AS program_id,
            p.name AS program_name,
            t.sub_tag AS sub_tag
       FROM template t
       LEFT JOIN program p ON p.id = t.program_id
      WHERE t.id = ?`,
    head.template_id
  );
  if (!row) return null;
  return {
    template_id: head.template_id,
    template_name: row.template_name,
    program_id: row.program_id ?? null,
    program_name: row.program_name ?? null,
    sub_tag: row.sub_tag ?? null,
  };
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
  // Slice 10b — schema bridge: read the legacy `rest_seconds` column (v009 /
  // ADR-0016) and surface it on the spec as the canonical `rest_sec` field
  // (the name ADR-0019 used). v016 added a separate `template_exercise.
  // rest_sec` column by mistake — that orphan stays NULL and is NOT read here.
  // See ADR-0019 § Schema bridge note + templateManager.TemplateExerciseSpec
  // JSDoc for the full rationale.
  type TemplateExerciseRow = Omit<TemplateExerciseSpec, 'rest_sec'> & {
    rest_seconds: number | null;
  };
  const rows = await db.getAllAsync<TemplateExerciseRow>(
    `SELECT id, exercise_id, ordering, default_sets, default_reps, default_weight_kg,
            is_evergreen, parent_id, reusable_superset_id, rest_seconds
       FROM template_exercise
      WHERE template_id = ?
      ORDER BY ordering ASC`,
    id
  );
  const exercises: TemplateExerciseSpec[] = rows.map(
    ({ rest_seconds, ...rest }) => ({
      ...rest,
      rest_sec: rest_seconds,
    })
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
 * Permanently remove a Template along with its full child cascade (per
 * simulator-db-query SKILL Step 4): template_set → template_exercise →
 * template. We also clean up `session_exercise.template_id` dangling
 * pointers so 5/19 morning wave's `lookup-or-spawn` flow (#38/#42) cannot
 * bite a ghost id — ENDED sessions get their pointer set to NULL while
 * ACTIVE sessions (`ended_at IS NULL`) are left untouched (an in-progress
 * session keeps its 'started from this template' link until it finishes).
 *
 * Session history is unaffected: `session_exercise` rows remain with their
 * full snapshot of name/ordering/sets so the session detail page still
 * renders as before; only the back-pointer to the now-deleted template is
 * cleared.
 *
 * Wrapped in a single transaction so a mid-cascade failure rolls back
 * cleanly and the three template tables stay consistent.
 */
export async function deleteTemplate(db: Database, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    // 1. Dangling pointer cleanup on session_exercise.template_id, excluding
    //    active sessions (ended_at IS NULL) per simulator-db-query SOP.
    await db.runAsync(
      `UPDATE session_exercise
          SET template_id = NULL
        WHERE template_id = ?
          AND session_id NOT IN (
            SELECT id FROM session WHERE ended_at IS NULL
          )`,
      id
    );
    // 2. template_set is referenced from template_exercise; drop it first so
    //    the cascade is explicit and tests don't have to rely on
    //    foreign_keys=ON ON DELETE CASCADE.
    await db.runAsync(
      `DELETE FROM template_set
        WHERE template_exercise_id IN (
          SELECT id FROM template_exercise WHERE template_id = ?
        )`,
      id
    );
    // 3. template_exercise.
    await db.runAsync(`DELETE FROM template_exercise WHERE template_id = ?`, id);
    // 4. template row itself.
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
    program_id: string | null;
    sub_tag: string | null;
  }>(
    `SELECT id, name, color_hex, program_id, sub_tag FROM template WHERE id = ?`,
    id
  );
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
    reusable_superset_id: string | null;
  }>(
    `SELECT te.id, te.template_id, te.exercise_id, e.name,
            te.ordering, te.is_evergreen, te.parent_id,
            e.notes AS notes,
            te.rest_seconds,
            te.reusable_superset_id
       FROM template_exercise te
       LEFT JOIN exercise e ON e.id = te.exercise_id
      WHERE te.template_id = ?
      ORDER BY te.ordering ASC`,
    id
  );

  if (exRows.length === 0) {
    return {
      id: tpl.id,
      name: tpl.name,
      color_hex: tpl.color_hex,
      program_id: tpl.program_id ?? null,
      sub_tag: tpl.sub_tag ?? null,
      exercises: [],
    };
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
    reusable_superset_id: r.reusable_superset_id,
    sets: setsByEx.get(r.id) ?? [],
  }));

  return {
    id: tpl.id,
    name: tpl.name,
    color_hex: tpl.color_hex,
    program_id: tpl.program_id ?? null,
    sub_tag: tpl.sub_tag ?? null,
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
    // reusable_superset_id propagated for defensive coverage even though the
    // normal flow keeps rs_id stable post-explode (ADR-0016 cluster lock
    // rules + ADR-0017 explode model).
    const setRewriteIds = new Set(plan.setRewrites.map((e) => e.id));
    for (const dex of plan.metaUpdates) {
      if (setRewriteIds.has(dex.id)) continue; // handled by set rewrite block
      await db.runAsync(
        `UPDATE template_exercise
            SET ordering = ?, is_evergreen = ?, parent_id = ?,
                rest_seconds = ?, reusable_superset_id = ?, updated_at = ?
          WHERE id = ?`,
        dex.ordering,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        dex.reusable_superset_id,
        ts,
        dex.id
      );
    }

    // 4. set-rewrite path: bump exercise row + wipe & reinsert sets
    for (const dex of plan.setRewrites) {
      await db.runAsync(
        `UPDATE template_exercise
            SET ordering = ?, is_evergreen = ?, parent_id = ?,
                rest_seconds = ?, reusable_superset_id = ?, updated_at = ?
          WHERE id = ?`,
        dex.ordering,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        dex.reusable_superset_id,
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

    // 5. INSERT new exercises + their sets. `template_exercise.notes` no
    // longer in the column list — v012 DROPped it; per-Exercise notes is
    // owned by `exercise.notes` (step 6).
    for (const dex of plan.inserts) {
      // default_sets/default_reps/default_weight_kg are deprecated since v009
      // (template_set list is the source of truth) but the column is NOT NULL
      // so we write a sensible default = sets.length / null / null.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, rest_seconds, reusable_superset_id, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        dex.id,
        dex.template_id,
        dex.exercise_id,
        dex.ordering,
        dex.sets.length,
        dex.section === 'evergreen' ? 1 : 0,
        dex.parent_id,
        dex.rest_seconds,
        dex.reusable_superset_id,
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

/** Internal helper — hydrate a list of template_exercise rows into MemoryCandidates. */
async function hydrateMemoryCandidates(
  db: Database,
  exRows: Array<{ id: string; exercise_id: string; updated_at: number }>
): Promise<MemoryCandidate[]> {
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

/**
 * 動作記憶 (ADR-0012/0016): query candidates for `exercise_id` across all
 * templates, ordered by `template_exercise.updated_at DESC`. The pure-logic
 * `deriveLatestSetsForExercise` picks the winner + remaps ids.
 *
 * **Solo memory isolation (ADR-0016 amendment / slice 9.8b grill Q4)**:
 * filters to rows with `reusable_superset_id IS NULL` so reusable-superset
 * clusters don't bleed into solo per-exercise memory. Reusable-superset
 * memory is fetched separately via `queryReusableSupersetMemory`.
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
      WHERE exercise_id = ? AND reusable_superset_id IS NULL
      ORDER BY updated_at DESC
      LIMIT ?`,
    args.exercise_id,
    limit
  );
  return hydrateMemoryCandidates(db, exRows);
}

// ===========================================================================
// Slice 10c — convertSessionToTemplate (ADR-0019 Q10 儲存模板 / 另存模板)
// ===========================================================================

/**
 * Persist a session's current exercise/set structure as a Template
 * (ADR-0019 Q10「儲存模板」/「另存模板」action bar buttons).
 *
 * Two modes:
 *  - **create** (另存模板) — INSERT a brand new template named `template_name`
 *    + INSERT one `template_exercise` per session_exercise row + INSERT one
 *    `template_set` row per `set` row. Does NOT touch any existing
 *    `session_exercise.template_id` link (the session stays bound to its
 *    original template, if any).
 *  - **update** (儲存模板) — overwrite the session's *linked* template with
 *    the session's current structure. "Linked template" = the most common
 *    non-null `session_exercise.template_id` among the session's rows; if
 *    none exists (freestyle session), this falls back to create-mode
 *    semantics AND links the session's rows to the new template by updating
 *    every `session_exercise.template_id = <new_id>` so future Save-back
 *    flows recognize the session as templated.
 *
 * Returns the resulting `template_id` either way. Caller is responsible
 * for prompting the user for `template_name` and for any UI feedback.
 *
 * Cluster / rest_sec / set_kind preservation:
 *  - `session_exercise.parent_id` is REMAPPED to the corresponding new
 *    `template_exercise.id` (two-pass remap, mirrors `snapshotForSession`).
 *  - `session_exercise.reusable_superset_id` is copied verbatim.
 *  - `session_exercise.rest_sec` is written to `template_exercise.rest_seconds`
 *    (the canonical v009 column; v016's orphan `template_exercise.rest_sec`
 *    column stays NULL per slice 10b bridge convention).
 *  - `set.set_kind` / `set.parent_set_id` / `set.notes` map to
 *    `template_set.set_kind` / `parent_set_id` / `notes`.
 *  - `set.is_skipped` rows are SKIPPED (an explicit user-skipped set should
 *    not become part of the template's prescribed structure).
 *
 * Ordering: session_exercise rows are taken in their existing `ordering`
 * sequence; template_exercise `ordering` is reset to a 1..N contiguous
 * sequence (same as new templates created elsewhere — e.g. the editor).
 *
 * `uuid` is REQUIRED — same convention as the rest of this repo (Hermes
 * lacks crypto.randomUUID). Pass a deterministic stub in tests.
 *
 * Single transaction: partial failure rolls back cleanly.
 *
 * Slice 10c Phase 7-detail-page commit.
 */
export async function convertSessionToTemplate(
  db: Database,
  args: {
    session_id: string;
    template_name: string;
    mode: 'update' | 'create';
    /**
     * Only used when a brand-new template row is INSERTed (mode='create'
     * or mode='update' falling back to create because session has no
     * linked template). When updating an existing template row, these are
     * ignored — the template inherits its prior program_id / sub_tag.
     *
     * 2026-05-18: 另存模板 bottom sheet 引導用戶填這 3 元組。
     */
    program_id?: string | null;
    sub_tag?: string | null;
    uuid: () => string;
    now?: () => number;
  },
): Promise<string> {
  const ts = (args.now ?? Date.now)();
  const createProgramId = args.program_id ?? null;
  const createSubTag = args.sub_tag ?? null;

  // Step 1: gather the session's exercise + set state.
  type SeRow = {
    id: string;
    exercise_id: string;
    ordering: number;
    planned_sets: number;
    is_evergreen: 0 | 1;
    parent_id: string | null;
    reusable_superset_id: string | null;
    rest_sec: number | null;
    template_id: string | null;
  };
  const seRows = await db.getAllAsync<SeRow>(
    `SELECT id, exercise_id, ordering, planned_sets, is_evergreen,
            parent_id, reusable_superset_id, rest_sec, template_id
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id,
  );

  type SetRow = {
    id: string;
    exercise_id: string;
    session_exercise_id: string | null;
    weight_kg: number | null;
    reps: number | null;
    ordering: number;
    is_skipped: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
    notes: string | null;
  };
  const setRows = await db.getAllAsync<SetRow>(
    `SELECT id, exercise_id, session_exercise_id, weight_kg, reps, ordering, is_skipped,
            set_kind, parent_set_id, notes
       FROM "set"
      WHERE session_id = ? AND is_skipped = 0
      ORDER BY exercise_id ASC, ordering ASC`,
    args.session_id,
  );

  // Step 2: determine target template_id.
  // "Linked template" = most common non-null template_id across se rows.
  // Tie-break: first encountered in `ordering` order.
  let linkedTemplateId: string | null = null;
  if (args.mode === 'update') {
    const counts = new Map<string, number>();
    for (const r of seRows) {
      if (r.template_id != null) {
        counts.set(r.template_id, (counts.get(r.template_id) ?? 0) + 1);
      }
    }
    if (counts.size > 0) {
      let bestId: string | null = null;
      let bestCount = 0;
      for (const [id, c] of counts) {
        if (c > bestCount) {
          bestCount = c;
          bestId = id;
        }
      }
      linkedTemplateId = bestId;
    }
  }

  const isUpdatingExisting = args.mode === 'update' && linkedTemplateId != null;
  const newTemplateId = isUpdatingExisting
    ? (linkedTemplateId as string)
    : args.uuid();

  // 2026-05-20 overnight #55 (slice 10c 另存模板): dup-triple guard for the
  // create path (and update-fallback-to-create when no linked template
  // existed). Mirrors `cloneTemplateWithSubTag`'s pattern — if a template row
  // already exists with the same (name, program_id, sub_tag) triple we throw
  // `DUPLICATE_TEMPLATE_TRIPLE` so the UI can surface an Alert and keep the
  // sheet open for inline rename + retry. Updating an existing template (when
  // `isUpdatingExisting` is true) skips this — we're overwriting the linked
  // row in place, so the dup check would falsely match the same row.
  if (!isUpdatingExisting) {
    const existing = await findTemplateByTriple(db, {
      name: args.template_name,
      program_id: createProgramId,
      sub_tag: createSubTag,
    });
    if (existing) {
      throw new Error('DUPLICATE_TEMPLATE_TRIPLE');
    }
  }

  // Step 3: pre-compute new template_exercise ids + parent_id remap.
  const idByOldSe = new Map<string, string>(); // old session_exercise.id → new template_exercise.id
  for (const se of seRows) {
    idByOldSe.set(se.id, args.uuid());
  }

  // Step 4: run the conversion in one transaction.
  await db.withTransactionAsync(async () => {
    if (isUpdatingExisting) {
      // Wipe the old template's exercises (cascades to template_set via v009 FK).
      await db.runAsync(
        `DELETE FROM template_exercise WHERE template_id = ?`,
        newTemplateId,
      );
      // Rename + bump updated_at on the existing template row.
      await db.runAsync(
        `UPDATE template SET name = ?, updated_at = ? WHERE id = ?`,
        args.template_name,
        ts,
        newTemplateId,
      );
    } else {
      // Create-mode (or update-mode-fallback-to-create when no linked
      // template existed). INSERT a new template row.
      //
      // program_id / sub_tag 由 caller 透過 args 帶入 (TemplateMetaSheet 引導
      // 用戶填的「歸屬計畫」/「強度標籤」)。NULL 表示「不指定」 — 對應 ADR-0003
      // 的 free template。
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newTemplateId,
        args.template_name,
        ts,
        ts,
        createProgramId,
        createSubTag,
      );
    }

    // INSERT one template_exercise row per session_exercise + its sets.
    let exOrdering = 1;
    for (const se of seRows) {
      const newExId = idByOldSe.get(se.id)!;
      const remappedParentId =
        se.parent_id != null ? idByOldSe.get(se.parent_id) ?? null : null;

      // Materialise this exercise's sets from set rows. v019 schema (slice
      // 10c #17) adds `set.session_exercise_id` for 精準的 per-card isolation;
      // we prefer that when available and fall back to `exercise_id` match
      // only for pre-v019 untagged rows. This is essential for RS pairs that
      // share an exercise (e.g. RS1=Bench+Chest + RS2=Cable+Chest both
      // contain Chest Dip — without session_exercise_id isolation each card
      // sees the other RS's Chest Dip sets and the resulting template ends
      // up with both cards holding the merged set list).
      // Pattern mirrors #17 / #23 / #24 / #27 wave fixes.
      const exSets = setRows.filter(
        (s) =>
          s.session_exercise_id === se.id ||
          (s.session_exercise_id == null && s.exercise_id === se.exercise_id),
      );

      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, rest_seconds, reusable_superset_id, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        newExId,
        newTemplateId,
        se.exercise_id,
        exOrdering,
        Math.max(exSets.length, se.planned_sets),
        se.is_evergreen,
        remappedParentId,
        se.rest_sec,
        se.reusable_superset_id,
        ts,
      );

      // INSERT template_set rows for this exercise's recorded sets.
      // Two-pass: first pass with parent_set_id = NULL to satisfy the FK
      // (the row a parent_set_id points to must already exist; in
      // practice dropset heads are always at position N-1 of their cluster
      // and followers point UP, but we don't want to rely on that — easier
      // to map ids and rewrite in a second pass).
      const setIdRemap = new Map<string, string>(); // old set.id → new template_set.id
      for (let i = 0; i < exSets.length; i++) {
        const oldSet = exSets[i];
        const newSetId = args.uuid();
        setIdRemap.set(oldSet.id, newSetId);
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight,
              parent_set_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
          newSetId,
          newExId,
          i,
          oldSet.set_kind,
          oldSet.reps ?? 0,
          oldSet.weight_kg ?? 0,
          oldSet.notes,
        );
      }
      // Second pass: rewrite parent_set_id for any dropset followers.
      for (const oldSet of exSets) {
        if (oldSet.parent_set_id == null) continue;
        const newId = setIdRemap.get(oldSet.id);
        const newParentId = setIdRemap.get(oldSet.parent_set_id);
        if (!newId || !newParentId) continue;
        await db.runAsync(
          `UPDATE template_set SET parent_set_id = ? WHERE id = ?`,
          newParentId,
          newId,
        );
      }

      exOrdering++;
    }

    // Update-mode-fallback-to-create: link the session's rows to the new
    // template so future Save-back flows recognize it as templated.
    if (args.mode === 'update' && !isUpdatingExisting) {
      await db.runAsync(
        `UPDATE session_exercise SET template_id = ? WHERE session_id = ?`,
        newTemplateId,
        args.session_id,
      );
    }
  });

  return newTemplateId;
}

/**
 * Clone an existing Template into a new row under a new (program_id, sub_tag)
 * pair. The new template's `name` is inherited from the source — ADR-0003 三
 *元組 (name, program_id, sub_tag) provides identity, so the same display name
 * across different (program, sub_tag) cells is intentional.
 *
 * Used by the start-template-sheet「新增強度」inline flow (round 37 polish):
 * tapping「建立」spawns a clone bound to the chosen program + new sub_tag so
 * the upcoming session links to the clone — overwrites land on the new row,
 * the source template stays untouched.
 *
 * Dup guard: SELECT-then-throw against the (name, program_id, sub_tag)
 * triple — `Error('DUPLICATE_TEMPLATE_TRIPLE')`. Mirrors createProgram /
 * insertReusableSuperset patterns. UI surfaces this as an Alert so the user
 * can rename the sub_tag and retry inline.
 *
 * Copies (full deep clone):
 *   - template_exercise rows: ordering, default_sets/reps/weight_kg,
 *     is_evergreen, parent_id (REMAPPED via old→new id Map),
 *     reusable_superset_id (verbatim), rest_seconds, updated_at.
 *   - template_set rows: position, set_kind, reps, weight,
 *     parent_set_id (REMAPPED via old→new id Map), notes.
 *
 * Single transaction: partial failure rolls back cleanly. Returns the new
 * template id.
 *
 * Note: source `template.color_hex` is NOT cloned — the new row's color_hex
 * uses the schema default ('') so the renderer falls back to hash-of-name,
 * keeping the visual coupling to the name (siblings share color). Caller can
 * recolor via applyRecolorSiblings if needed.
 */
export async function cloneTemplateWithSubTag(
  db: Database,
  args: {
    source_template_id: string;
    new_program_id: string;
    /**
     * Target sub_tag for the new clone. May be `null` to spawn a 通用-sub_tag
     * variant under a specific program (round 38 polish — `onStart`
     * lookup-or-spawn invokes this when the user picks (some program, 通用)
     * and no existing sibling has that triple yet).
     */
    new_sub_tag: string | null;
    uuid: () => string;
    now?: () => number;
  }
): Promise<string> {
  const ts = (args.now ?? Date.now)();

  // Step 1: load source template header.
  const source = await db.getFirstAsync<{
    id: string;
    name: string;
  }>(`SELECT id, name FROM template WHERE id = ?`, args.source_template_id);
  if (!source) {
    throw new Error('SOURCE_TEMPLATE_NOT_FOUND');
  }

  // Step 2: dup guard against (name, program_id, sub_tag) triple. `program_id`
  // is required non-null per signature, but `new_sub_tag` may be null (round
  // 38 polish — 通用-sub_tag spawn) so the sub_tag predicate uses the
  // IS-NULL-safe idiom; otherwise SQL `=` would never match an actual NULL
  // row and the dup guard would silently leak past a NULL/NULL collision.
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM template
      WHERE name = ?
        AND program_id = ?
        AND ((sub_tag IS NULL AND ? IS NULL) OR sub_tag = ?)
      LIMIT 1`,
    source.name,
    args.new_program_id,
    args.new_sub_tag,
    args.new_sub_tag
  );
  if (existing) {
    throw new Error('DUPLICATE_TEMPLATE_TRIPLE');
  }

  // Step 3: load source template_exercise + template_set rows.
  type SrcExRow = {
    id: string;
    exercise_id: string;
    ordering: number;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
    is_evergreen: 0 | 1;
    parent_id: string | null;
    rest_seconds: number | null;
    reusable_superset_id: string | null;
  };
  const exRows = await db.getAllAsync<SrcExRow>(
    `SELECT id, exercise_id, ordering, default_sets, default_reps,
            default_weight_kg, is_evergreen, parent_id, rest_seconds,
            reusable_superset_id
       FROM template_exercise
      WHERE template_id = ?
      ORDER BY ordering ASC`,
    args.source_template_id
  );

  type SrcSetRow = {
    id: string;
    template_exercise_id: string;
    position: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    reps: number;
    weight: number;
    parent_set_id: string | null;
    notes: string | null;
  };
  const setRows =
    exRows.length === 0
      ? []
      : await db.getAllAsync<SrcSetRow>(
          `SELECT ts.id, ts.template_exercise_id, ts.position, ts.set_kind,
                  ts.reps, ts.weight, ts.parent_set_id, ts.notes
             FROM template_set ts
             JOIN template_exercise te ON te.id = ts.template_exercise_id
            WHERE te.template_id = ?
            ORDER BY ts.template_exercise_id, ts.position ASC`,
          args.source_template_id
        );

  // Step 4: pre-compute id remaps (old → new).
  const newTemplateId = args.uuid();
  const exIdRemap = new Map<string, string>();
  for (const r of exRows) {
    exIdRemap.set(r.id, args.uuid());
  }
  const setIdRemap = new Map<string, string>();
  for (const r of setRows) {
    setIdRemap.set(r.id, args.uuid());
  }

  // Step 5: run the clone in one transaction.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      newTemplateId,
      source.name,
      ts,
      ts,
      args.new_program_id,
      args.new_sub_tag
    );

    // template_exercise rows — remap id + parent_id.
    for (const r of exRows) {
      const newExId = exIdRemap.get(r.id)!;
      const remappedParentId =
        r.parent_id != null ? exIdRemap.get(r.parent_id) ?? null : null;
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, rest_seconds, reusable_superset_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newExId,
        newTemplateId,
        r.exercise_id,
        r.ordering,
        r.default_sets,
        r.default_reps,
        r.default_weight_kg,
        r.is_evergreen,
        remappedParentId,
        r.rest_seconds,
        r.reusable_superset_id,
        ts
      );
    }

    // template_set rows — two-pass to satisfy FK on parent_set_id (some
    // dropset followers may point to a set inserted later in the loop).
    // Pass 1: insert with parent_set_id = NULL.
    for (const r of setRows) {
      const newSetId = setIdRemap.get(r.id)!;
      const newExId = exIdRemap.get(r.template_exercise_id);
      if (!newExId) continue; // dangling — shouldn't happen, defensive.
      await db.runAsync(
        `INSERT INTO template_set
           (id, template_exercise_id, position, set_kind, reps, weight,
            parent_set_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        newSetId,
        newExId,
        r.position,
        r.set_kind,
        r.reps,
        r.weight,
        r.notes
      );
    }
    // Pass 2: rewrite parent_set_id for dropset followers.
    for (const r of setRows) {
      if (r.parent_set_id == null) continue;
      const newSetId = setIdRemap.get(r.id);
      const newParentId = setIdRemap.get(r.parent_set_id);
      if (!newSetId || !newParentId) continue;
      await db.runAsync(
        `UPDATE template_set SET parent_set_id = ? WHERE id = ?`,
        newParentId,
        newSetId
      );
    }
  });

  return newTemplateId;
}

/**
 * Reusable-superset 動作記憶 (ADR-0017 L154 amendment / slice 9.8b grill Q4).
 *
 * Looks up the most-recently-edited cluster where both rows are stamped
 * `reusable_superset_id = S` and returns 2 `MemoryCandidate`s — one for the
 * parent row's exercise, one for the child row's. Callers feed each into
 * `deriveLatestSetsForExercise(exercise_id = <parent or child ex_id>, …)`
 * to hydrate fresh `TemplateSet` lists for the new explode.
 *
 * Returns `[]` when no prior cluster exists (first-ever explode of `S`) —
 * caller falls back to system default seed (1 working set @ 8 reps × 20 kg,
 * matching the solo-without-memory branch).
 *
 * "Latest cluster" = the parent row (parent_id IS NULL, rs_id = S) with the
 * highest `updated_at`, paired with whichever child row points at it.
 */
export async function queryReusableSupersetMemory(
  db: Database,
  args: { reusable_superset_id: string }
): Promise<MemoryCandidate[]> {
  // 1. Find the latest parent row for this rs_id.
  const parentRow = await db.getFirstAsync<{
    id: string;
    exercise_id: string;
    updated_at: number;
  }>(
    `SELECT id, exercise_id, updated_at
       FROM template_exercise
      WHERE reusable_superset_id = ? AND parent_id IS NULL
      ORDER BY updated_at DESC
      LIMIT 1`,
    args.reusable_superset_id
  );
  if (!parentRow) return [];

  // 2. Find the child row of THIS parent (not just any child with same rs_id —
  //    user might have multiple clusters in different templates).
  const childRow = await db.getFirstAsync<{
    id: string;
    exercise_id: string;
    updated_at: number;
  }>(
    `SELECT id, exercise_id, updated_at
       FROM template_exercise
      WHERE parent_id = ? AND reusable_superset_id = ?
      LIMIT 1`,
    parentRow.id,
    args.reusable_superset_id
  );
  if (!childRow) return [];

  return hydrateMemoryCandidates(db, [parentRow, childRow]);
}
