import type { Database } from '../../db/types';
import { snapshotForSession } from '../../domain/template/templateManager';
import {
  createSession,
  insertSessionExercise,
  getActiveSession,
} from './sessionRepository';
import { insertSessionSet } from './setRepository';
import { getTemplateFull } from './templateRepository';

/**
 * Start a new Session whose plan is a frozen copy of `template_id`'s exercises
 * AND sets.
 *
 * Workflow:
 *   1. Load Template via `getTemplateFull` (hydrates `exercises[].sets`)
 *   2. Run the pure `snapshotForSession` projection to produce session_exercise rows
 *      (Note: this projection only handles exercise-level data; set copy is below.)
 *   3. Persist Session header + planned-exercise rows + planned set rows in one
 *      transaction:
 *        - For each newly-inserted session_exercise, INSERT its template's
 *          set rows directly into the session set table (kind / reps / weight
 *          copied as-is, parent_set_id remapped from template_set.id space to
 *          the new session set.id space). All sets land with `is_logged = 0`.
 *
 * **#51 (2026-05-19 evening)** — direct copy from `template_set`. Pre-#51 the
 * post-insert phase ran `prefillSetsForNewSessionExercise` which walked a
 * (program, sub_tag, exercise) historical session resolver. Per user spec:
 * "+動作 才優先使用『歷史優先』、模板已有動作當然是直接用模板." 所以從
 * template 開 session 一律直接 copy template_set; 歷史 resolver 只在 session
 * 內按「+動作」path (`prefillSessionExerciseFromLastSession`) 使用.
 *
 * Refuses to run if a Session is already in progress — the UI should never
 * call this with an open Session, but defending here protects the invariant
 * "at most one active Session at a time".
 *
 * `uuid` is REQUIRED — no default. Hermes lacks `crypto.randomUUID`; production
 * passes `randomUUID` from `expo-crypto`, tests pass a deterministic stub.
 *
 * `program_id` / `sub_tag` are now decorative (forwarded to caller's session
 * record only via sticky settings, NOT consulted for set copy). Kept in the
 * signature for backward compat with the templates tab → start-template-sheet
 * → onStart path; pre-#51 they triggered the historical prefill phase.
 */
export async function startSessionFromTemplate(
  db: Database,
  args: {
    template_id: string;
    uuid: () => string;
    now?: () => number;
    /**
     * (round 35 → #51) Picked program id from the start-template-sheet.
     * Pre-#51 gated the historical prefill phase; post-#51 unused inside this
     * function (caller may use it for sticky settings / session.linked_template
     * metadata before / after calling).
     */
    program_id?: string;
    /**
     * (round 35 → #51) Picked sub_tag from the start-template-sheet.
     * Pre-#51 gated the historical prefill phase; post-#51 unused.
     */
    sub_tag?: string | null;
  }
): Promise<{ session_id: string; planned_count: number }> {
  const active = await getActiveSession(db);
  if (active) {
    throw new Error(
      `Cannot start a new session — session ${active.id} is already in progress`
    );
  }

  // getTemplateFull (vs the older getTemplate) hydrates each exercise's sets[]
  // — needed for the #51 direct-copy phase. Throws via null-check if the
  // template was deleted between the user's sheet tap and now.
  const template = await getTemplateFull(db, args.template_id);
  if (!template) {
    throw new Error(`Template not found: ${args.template_id}`);
  }

  // getTemplateFull does NOT hydrate `template_exercise.default_sets / default_reps
  // / default_weight_kg` (those are exercise-level metadata, not the per-set
  // rows). snapshotForSession needs those defaults to populate session_exercise
  // metadata (snapshot isolation). Separate query keyed by template_exercise.id.
  const defaultsRows = await db.getAllAsync<{
    id: string;
    default_sets: number;
    default_reps: number;
    default_weight_kg: number;
  }>(
    `SELECT id, default_sets, default_reps, default_weight_kg
       FROM template_exercise
      WHERE template_id = ?`,
    args.template_id
  );
  const defaultsById = new Map(
    defaultsRows.map((r) => [
      r.id,
      {
        default_sets: r.default_sets,
        default_reps: r.default_reps,
        default_weight_kg: r.default_weight_kg,
      },
    ])
  );

  const session_id = args.uuid();
  const started_at = (args.now ?? Date.now)();
  const nowFn = args.now ?? Date.now;
  const snapshots = snapshotForSession({
    // snapshotForSession expects TemplateData shape (no sets field). Project
    // `getTemplateFull` rows into that shape; defaults come from the parallel
    // legacy query above (template_exercise.default_*).
    template: {
      id: template.id,
      name: template.name,
      exercises: template.exercises.map((e) => {
        const def = defaultsById.get(e.id) ?? {
          default_sets: 0,
          default_reps: 8,
          default_weight_kg: 20,
        };
        return {
          id: e.id,
          exercise_id: e.exercise_id,
          ordering: e.ordering,
          default_sets: def.default_sets,
          default_reps: def.default_reps,
          default_weight_kg: def.default_weight_kg,
          is_evergreen: e.section === 'evergreen' ? 1 : 0,
          parent_id: e.parent_id ?? null,
          reusable_superset_id: e.reusable_superset_id ?? null,
          rest_sec: e.rest_seconds ?? null,
        };
      }),
    },
    session_id,
    uuid: args.uuid,
  });

  // Pre-compute set rows to insert. Each snapshot.id maps back to a
  // template_exercise.id via the position in `snapshots` array (snapshotForSession
  // preserves the order from the sorted template.exercises).
  // For each template_exercise, generate new session set IDs and remap
  // parent_set_id (template_set.id → new session set.id).
  type PlannedSessionSet = {
    id: string;
    session_id: string;
    exercise_id: string;
    weight_kg: number;
    reps: number;
    is_skipped: 0;
    ordering: number;
    created_at: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
    session_exercise_id: string;
  };
  const plannedSets: PlannedSessionSet[] = [];
  const ts = nowFn();
  // Sort template.exercises the same way snapshotForSession does (by ordering
  // ASC) so the index-aligned mapping holds.
  const sortedTemplateExercises = [...template.exercises].sort(
    (a, b) => a.ordering - b.ordering
  );
  for (let i = 0; i < sortedTemplateExercises.length; i++) {
    const tex = sortedTemplateExercises[i];
    const newSeId = snapshots[i].id;
    // Sort template sets by position so ordering stays stable.
    const sortedTSets = [...tex.sets].sort((a, b) => a.position - b.position);
    // Allocate new ids first so parent_set_id remap can resolve forward refs.
    const setIdMap = new Map<string, string>();
    for (const ts of sortedTSets) {
      setIdMap.set(ts.id, args.uuid());
    }
    for (let j = 0; j < sortedTSets.length; j++) {
      const tset = sortedTSets[j];
      const newSetId = setIdMap.get(tset.id);
      if (!newSetId) continue;
      let remappedParent: string | null = null;
      if (tset.parent_set_id) {
        const mapped = setIdMap.get(tset.parent_set_id);
        // If parent_set_id points outside this template_exercise's sets (shouldn't
        // happen but defend), leave NULL rather than throw — dropset chain
        // remap is best-effort here, mirroring the prefill replay helpers.
        remappedParent = mapped ?? null;
      }
      plannedSets.push({
        id: newSetId,
        session_id,
        exercise_id: tex.exercise_id,
        weight_kg: tset.weight,
        reps: tset.reps,
        is_skipped: 0,
        ordering: j + 1,
        created_at: ts,
        set_kind: tset.kind,
        parent_set_id: remappedParent,
        session_exercise_id: newSeId,
      });
    }
  }

  await db.withTransactionAsync(async () => {
    // ADR-0024 § 4 — `createSession` auto-pulls the latest body_metric for
    // the snapshot column when no explicit value is supplied. Keep the
    // omission deliberate; passing `bodyweight_snapshot_kg: undefined` here
    // routes through the same auto-pull path.
    await createSession(db, { id: session_id, started_at });
    for (const row of snapshots) {
      await insertSessionExercise(db, { ...row });
    }
    for (const s of plannedSets) {
      await insertSessionSet(db, s);
    }
  });

  return { session_id, planned_count: snapshots.length };
}
