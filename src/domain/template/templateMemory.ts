/**
 * Slice 9.5 動作記憶 read pattern — pure logic, no DB.
 *
 * ADR-0016 §動作記憶 read pattern: 原讀 `template_exercise` summary 4 值 →
 * 改讀對應 `template_set` list. 取「該 exercise 跨 templates 中 `updated_at`
 * 最新的那筆 `template_exercise`」的 `sets` list 當預填來源。
 *
 * 純 logic 不知道 DB；repo 層 query latest by updated_at + join `template_set`
 * → 拼成 `MemoryCandidate` rows → 呼叫 `deriveLatestSetsForExercise` 拿出
 * 預填 sets。記憶寫入時機 (template 編輯 save / Save-back Apply / freestyle
 * 另存) 不變，repo 直接寫 `template_set` rows + bump `template_exercise.updated_at`。
 */

import type { TemplateSet } from './types';

/**
 * Snapshot of one historical `template_exercise` row + its sets. Repo
 * builds this by joining `template_exercise` to `template_set` and
 * including the latest-updated row per (exercise_id, template_id).
 */
export interface MemoryCandidate {
  template_exercise_id: string;
  exercise_id: string;
  /** ms epoch; the higher value wins. */
  updated_at: number;
  sets: TemplateSet[];
}

/**
 * Pre-fill sets for a new template_exercise row from the most-recently-updated
 * historical row with the same `exercise_id`. Sets are returned with **fresh
 * ids** so the new template_exercise gets its own primary keys and any cluster
 * B3 linkage (`parent_set_id`) is rewritten through the same id remap (so
 * head→follower references stay valid).
 *
 * `position` is re-keyed to the candidate's input order (0..N).
 *
 * Returns `null` when no candidate matches `exercise_id`. UI then falls back
 * to "1 working set @ default reps/weight" or whatever the empty-state UX
 * decides.
 */
export function deriveLatestSetsForExercise(args: {
  exercise_id: string;
  candidates: MemoryCandidate[];
  uuid: () => string;
}): TemplateSet[] | null {
  const { exercise_id, candidates, uuid } = args;
  const matching = candidates.filter((c) => c.exercise_id === exercise_id);
  if (matching.length === 0) return null;

  let best = matching[0];
  for (let i = 1; i < matching.length; i++) {
    if (matching[i].updated_at > best.updated_at) best = matching[i];
  }
  if (best.sets.length === 0) return [];

  // Stable id remap so cluster parent_set_id links survive the copy.
  const idMap = new Map<string, string>();
  for (const s of best.sets) idMap.set(s.id, uuid());

  return best.sets.map((s, i) => ({
    id: idMap.get(s.id) as string,
    position: i,
    kind: s.kind,
    reps: s.reps,
    weight: s.weight,
    parent_set_id:
      s.parent_set_id === null ? null : (idMap.get(s.parent_set_id) ?? null),
    notes: null, // Memory copies structure only; notes are per-template.
  }));
}
