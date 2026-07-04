import type { Database } from '../../db/types';
import { snapshotForSession } from '../../domain/template/templateManager';
import {
  createSession,
  insertSessionExercise,
  getActiveSession,
  endSession,
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
 *          set rows directly into the session set table (kind / reps / weight /
 *          per-set notes copied as-is, parent_set_id remapped from
 *          template_set.id space to the new session set.id space). All sets land
 *          with `is_logged = 0`.
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
    /**
     * NEW-Q50 (2026-05-29) — Optional override for the session.id PK.
     * Pre-NEW-Q50: this function always minted its own UUID via
     * `args.uuid()`. Now the Watch-initiated path (onStartFromWatch)
     * needs to use the Watch-supplied sessionId (NEW-Q50 Q5 first-write-
     * wins keyed on sessionId), so callers can override.
     *
     * Defaults to `args.uuid()` when omitted (preserves all existing
     * call-site behaviour). Session_exercise / session_set IDs are
     * still generated via `args.uuid()` regardless — only the session
     * header row's PK changes.
     */
    session_id?: string;
    /**
     * 補訓練 (backfill, 2026-06-26). When true, skip the single-active-session
     * guard. The backfill flow creates an ALREADY-FINISHED session (it pairs
     * this with `ended_at`), so it never occupies the "active" slot — but the
     * guard would still throw if a real live session is in progress. Defaults
     * to false → every existing live-start call site keeps the guard.
     */
    skip_active_guard?: boolean;
    /**
     * 補訓練. When set, the session is finalized (ended_at written) inside the
     * same transaction, so it is born as a completed history record rather
     * than an active session. `endSession` floors it to > started_at. Omit
     * for the normal live-start path (session stays in progress).
     */
    ended_at?: number;
    /**
     * Phase C-id (set-level id-adoption, 2026-07-05). Watch-supplied
     * session_exercise / session_set ids so the iPhone adopts them verbatim
     * — both devices share ids from the first frame (see
     * `StartFromWatchPayload.idTree`). Position-aligned: `seIds[i]` maps to
     * the i-th template exercise (`ordering ASC`), `setIds[i][j]` to its
     * j-th set (`position ASC`) — the same order this function walks.
     * OPTIONAL — omitted → all ids minted via `args.uuid()` (legacy). A
     * position without a supplied (or with an empty) id falls back to
     * `uuid()`, so extra / missing entries never throw. The Watch-initiated
     * template path (`onStartFromWatch`) is the only supplier today.
     */
    supplied_id_tree?: {
      seIds: readonly string[];
      setIds: readonly (readonly string[])[];
    };
  }
): Promise<{ session_id: string; planned_count: number }> {
  if (!args.skip_active_guard) {
    const active = await getActiveSession(db);
    if (active) {
      throw new Error(
        `Cannot start a new session — session ${active.id} is already in progress`
      );
    }
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

  // NEW-Q50 — caller-supplied session_id takes precedence over the
  // auto-minted UUID. The Watch-initiated path uses this to honour
  // its already-minted sessionId (first-write-wins semantics).
  const session_id = args.session_id ?? args.uuid();
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
    // Phase C-id — adopt the Watch's session_exercise ids (position-aligned
    // to `ordering ASC`, the order snapshotForSession also sorts by) so both
    // devices share exercise identity. Absent → mint per exercise (legacy).
    suppliedIds: args.supplied_id_tree?.seIds,
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
    // Per-set note authored in the template editor (template_set.notes, v009).
    // Copied verbatim so it carries over into the new session's set rows. NULL
    // when the template set had no note.
    notes: string | null;
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
    // Phase C-id — adopt the Watch's session_set ids for this exercise
    // (position-aligned); a position without a supplied (or empty) id falls
    // back to `uuid()` so extra / missing entries never throw.
    const suppliedSetIds = args.supplied_id_tree?.setIds[i];
    const setIdMap = new Map<string, string>();
    sortedTSets.forEach((tsRow, j) => {
      setIdMap.set(tsRow.id, suppliedSetIds?.[j] || args.uuid());
    });
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
        notes: tset.notes ?? null,
      });
    }
  }

  await db.withTransactionAsync(async () => {
    // ADR-0024 § 4 — `createSession` auto-pulls the latest body_metric for
    // the snapshot column when no explicit value is supplied. Keep the
    // omission deliberate; passing `bodyweight_snapshot_kg: undefined` here
    // routes through the same auto-pull path.
    //
    // Card 11 / ADR-0014 — pre-seed session.title with the template name so
    // the in-session header reads sensibly from the first frame (vs. having
    // to ALTER it later via updateSessionTitle).
    await createSession(db, {
      id: session_id,
      started_at,
      title: template.name,
    });
    for (const row of snapshots) {
      await insertSessionExercise(db, { ...row });
    }
    for (const s of plannedSets) {
      await insertSessionSet(db, s);
    }
    // 補訓練 — when an `ended_at` is supplied the session is born as a
    // completed history record (never holds the active slot). endSession
    // floors it to > started_at. Omitted on the normal live-start path.
    if (args.ended_at != null) {
      await endSession(db, { id: session_id, ended_at: args.ended_at });
    }
  });

  return { session_id, planned_count: snapshots.length };
}
