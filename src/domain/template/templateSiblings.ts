/**
 * Slice 9.5 sibling 連動 — pure logic, no DB.
 *
 * 三元組 (name, program, 副標) 允許 sibling Templates 共享 `name`. ADR-0015
 * (per-Template-name 顏色 group-wide write) + ADR-0014 (sibling rename
 * propagation) 已鎖定：改 name / color → 整 sibling group 連動。ADR-0016
 * 2026-05-12 amendment §3 補上 superset parent 的「設為常設/一般」也對所有
 * 同 name siblings cascade。
 *
 * 本檔提供 in-memory transform：apply the action to the matching siblings.
 * Repo 層 wraps it with `WHERE name = ?` on the actual SQLite table. 因為
 * Template 編輯 UI 在 draft 階段就需要 live preview sibling state，純 logic
 * 把 transform 抽出來、不依賴 DB。
 *
 * Note: section flip cascade 只在「superset parent + children」場景需要
 * within-template cascade（per amendment §3 superset 視為 section unit）；
 * 同 name sibling templates 是否也跟著 flip 的問題目前 spec 未明，留給 v1
 * 實作期釘。本檔目前提供：
 *   - renameSiblings: rename group-wide (cross-template, same old name)
 *   - recolorSiblings: recolor group-wide (cross-template, same name)
 *   - flipExerciseSectionInTemplate: within one template, cascade
 *     parent_id linkage so superset parent + children flip together
 */

import type { ExerciseSection, Template } from './types';

/**
 * Rename every Template whose current `name === oldName` to `newName`.
 * Group key is the **current** name, so cross-sibling identity is by
 * shared name (the 三元組 model's natural grouping).
 */
export function renameSiblings(args: {
  templates: Template[];
  oldName: string;
  newName: string;
}): Template[] {
  const { templates, oldName, newName } = args;
  if (oldName === newName) return templates;
  return templates.map((t) =>
    t.name === oldName ? { ...t, name: newName } : t
  );
}

/**
 * Recolor every Template whose `name === name` to `color_hex`. Empty string
 * is a valid color (= unset / hash-derived fallback in the renderer).
 */
export function recolorSiblings(args: {
  templates: Template[];
  name: string;
  color_hex: string;
}): Template[] {
  const { templates, name, color_hex } = args;
  return templates.map((t) =>
    t.name === name ? { ...t, color_hex } : t
  );
}

/**
 * Within a single Template, flip `section` on the exercise `exercise_id`.
 * If the exercise is a superset **parent** (id matches `parent_id` on
 * other rows), all its children flip with it (cascade). If the exercise
 * is a superset **child** (`parent_id !== null`), we additionally flip
 * the parent + all its siblings — keeping the rule "superset = one
 * section unit" symmetric regardless of which row the user touched.
 *
 * Plain rows (parent_id === null AND no children) flip in isolation.
 *
 * Returns the original template unchanged if `exercise_id` is not found.
 */
export function flipExerciseSectionInTemplate(args: {
  template: Template;
  exercise_id: string;
  section: ExerciseSection;
}): Template {
  const { template, exercise_id, section } = args;
  const target = template.exercises.find((e) => e.id === exercise_id);
  if (!target) return template;

  // Resolve the superset group key: if target is a child, use its parent_id;
  // otherwise the target's own id is the group key (it may have children).
  const groupHeadId = target.parent_id ?? target.id;
  const affectedIds = new Set<string>([groupHeadId]);
  for (const ex of template.exercises) {
    if (ex.parent_id === groupHeadId) affectedIds.add(ex.id);
  }

  let dirty = false;
  const next = template.exercises.map((ex) => {
    if (!affectedIds.has(ex.id)) return ex;
    if (ex.section === section) return ex;
    dirty = true;
    return { ...ex, section };
  });
  return dirty ? { ...template, exercises: next } : template;
}
