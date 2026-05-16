/**
 * Pure diff: did the in-session structure drift from the linked template's
 * snapshot? Used by the Today-tab finish flow (ADR-0019 Q9d) to gate the
 * 3-option vs. 2-option Save-back dialog.
 *
 * Scope (per ADR-0019 Q9 diff scope table, slice 10c Phase X):
 *   - 'add_exercise'    — user added an exercise mid-session that wasn't
 *                         in the template snapshot
 *   - 'delete_exercise' — user removed (via ⚙️ 🗑️) an exercise that WAS
 *                         in the template snapshot
 *   - 'sets'            — set count for an exercise differs (added /
 *                         deleted sets, counted within is_skipped=0 rows
 *                         since skipped sets behave like deletes in
 *                         template-save terms)
 *   - 'reps'            — any in-session reps differ from the planned
 *                         template reps for the matched exercise
 *   - 'weight'          — any in-session weight differs from the planned
 *                         template weight for the matched exercise
 *   - 'rest_sec'        — session_exercise.rest_sec differs from template
 *                         snapshot rest_sec (NULL vs NULL is equal; NULL
 *                         vs 60 counts as diff — user explicitly changed)
 *   - 'cluster'         — cluster structure changed (a previously-clustered
 *                         pair was un-clustered, OR a new cluster appeared,
 *                         OR pairing changed). Detected via parent_id /
 *                         reusable_superset_id on the session vs template
 *                         exercise rows.
 *
 * NOT in diff scope per ADR-0019 Q9 (not detected here):
 *   - exercise.notes (global, not session-bound)
 *   - session.title (identity dimension)
 *
 * Pure / synchronous: caller pre-loads the rows + sets via SQLite repos
 * then passes them in. No DB import here — keeps this trivially testable.
 *
 * Implementation choices:
 *   - Match session_exercise → template_exercise on `exercise_id` (the
 *     stable identifier). If the template had two rows for the same
 *     exercise (currently impossible by UI; defensively handled), we
 *     pair-up in order and count extras toward sets/cluster diffs.
 *   - Sets are compared by count + per-set (reps, weight) tuples. The
 *     diff is "any difference" — we surface the kind but not the
 *     per-set details (the Save-back review screen handles granular
 *     review for the 「儲存模板」 path).
 *   - Warmup / dropset rows count toward `sets` (any visible change to
 *     the visible set list is a diff). This is intentional — the user's
 *     mental model of "the plan changed" includes all set rows.
 */

export type DiffKind =
  | 'add_exercise'
  | 'delete_exercise'
  | 'sets'
  | 'reps'
  | 'weight'
  | 'rest_sec'
  | 'cluster';

export interface SessionExerciseLite {
  id: string;
  exercise_id: string;
  rest_sec: number | null;
  parent_id: string | null;
  reusable_superset_id: string | null;
}

export interface SessionSetLite {
  exercise_id: string;
  /** 0 = the set is in the user-visible list; 1 = skipped (don't count). */
  is_skipped: number;
  reps: number | null;
  weight_kg: number | null;
}

export interface TemplateExerciseLite {
  exercise_id: string;
  /** Planned set count (from default_sets / template_set rollup). */
  planned_sets: number;
  /** Planned reps per set — if a single number, applies to all sets. */
  planned_reps: number | null;
  /** Planned weight per set. */
  planned_weight_kg: number | null;
  rest_sec: number | null;
  parent_id: string | null;
  reusable_superset_id: string | null;
}

export interface TemplateSnapshotLite {
  exercises: TemplateExerciseLite[];
}

export interface ComputeSessionDiffArgs {
  sessionExercises: SessionExerciseLite[];
  sessionSets: SessionSetLite[];
  template: TemplateSnapshotLite;
}

export interface SessionDiffResult {
  has_diff: boolean;
  diff_kinds: DiffKind[];
}

/**
 * Compare in-session state against the linked template snapshot.
 *
 * Returns the union of detected diff kinds (no duplicates, stable order
 * matching the `DiffKind` type definition).
 */
export function computeSessionDiff(
  args: ComputeSessionDiffArgs,
): SessionDiffResult {
  const kinds = new Set<DiffKind>();

  // Index template exercises by exercise_id (multi-row defensive: keep
  // a queue per id so we pair sequentially with session rows).
  const tplByEx = new Map<string, TemplateExerciseLite[]>();
  for (const t of args.template.exercises) {
    const q = tplByEx.get(t.exercise_id);
    if (q) q.push(t);
    else tplByEx.set(t.exercise_id, [t]);
  }

  // Index session sets by exercise_id (skip is_skipped=1).
  const sessSetsByEx = new Map<string, SessionSetLite[]>();
  for (const s of args.sessionSets) {
    if (s.is_skipped === 1) continue;
    const arr = sessSetsByEx.get(s.exercise_id);
    if (arr) arr.push(s);
    else sessSetsByEx.set(s.exercise_id, [s]);
  }

  // Walk session exercises in order, peeling off matching template rows.
  const matchedTplRows = new Set<TemplateExerciseLite>();
  for (const se of args.sessionExercises) {
    const queue = tplByEx.get(se.exercise_id) ?? [];
    const tpl = queue.shift();
    if (!tpl) {
      kinds.add('add_exercise');
      continue;
    }
    matchedTplRows.add(tpl);

    // rest_sec diff (NULL vs NULL = equal; otherwise strict compare).
    const seRest = se.rest_sec ?? null;
    const tRest = tpl.rest_sec ?? null;
    if (seRest !== tRest) kinds.add('rest_sec');

    // cluster diff: parent_id is session-side (different id space) — we
    // can only detect "had parent vs no parent" and "had rs_id vs none".
    // A schema-grade test would track which session.parent_id resolves
    // to which template parent; for the "did cluster change?" signal,
    // the binary presence check is sufficient (per ADR-0019 Q9 cluster
    // 加入/刪 cluster scope).
    const seHadParent = se.parent_id != null;
    const tHadParent = tpl.parent_id != null;
    const seHadRs = se.reusable_superset_id != null;
    const tHadRs = tpl.reusable_superset_id != null;
    if (seHadParent !== tHadParent || seHadRs !== tHadRs) {
      kinds.add('cluster');
    } else if (
      seHadRs &&
      tHadRs &&
      se.reusable_superset_id !== tpl.reusable_superset_id
    ) {
      // Different reusable_superset_id → user replaced cluster.
      kinds.add('cluster');
    }

    // Set-level diffs.
    const sessSets = sessSetsByEx.get(se.exercise_id) ?? [];
    if (sessSets.length !== tpl.planned_sets) {
      kinds.add('sets');
    }
    for (const s of sessSets) {
      if (
        tpl.planned_reps != null &&
        s.reps != null &&
        s.reps !== tpl.planned_reps
      ) {
        kinds.add('reps');
      }
      if (
        tpl.planned_weight_kg != null &&
        s.weight_kg != null &&
        s.weight_kg !== tpl.planned_weight_kg
      ) {
        kinds.add('weight');
      }
    }
  }

  // Any template row never matched = user deleted it from the session.
  for (const t of args.template.exercises) {
    if (!matchedTplRows.has(t)) {
      // Could be a duplicate slot (same exercise_id, two rows, but
      // user only kept one). Still counts as a delete diff.
      kinds.add('delete_exercise');
    }
  }

  // Stable output order matching the DiffKind union declaration above.
  const order: DiffKind[] = [
    'add_exercise',
    'delete_exercise',
    'sets',
    'reps',
    'weight',
    'rest_sec',
    'cluster',
  ];
  const diff_kinds = order.filter((k) => kinds.has(k));
  return { has_diff: diff_kinds.length > 0, diff_kinds };
}
