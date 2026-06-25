/**
 * Template list dedupe + grouping helpers for the 訓練 tab → 模板訓練 section
 * (per ADR-0024 § 2.c).
 *
 * Per ADR-0003 the Template identity is the triple `(name, program_id, sub_tag)`,
 * which means multiple rows can share a `name` (e.g. the same logical
 * "Pull Day" template attached to 3 different programs with different sub_tags).
 *
 * The 模板訓練 section wants ONE row per name — tapping that row opens the
 * start-template flow (`StartTemplateSheet`); this helper just owns the
 * visible list shape.
 *
 * Sticky keys: `start_dialog_last_program_id` / `start_dialog_last_sub_tag`
 * are the BASE names for the start sheet's last-used (program, sub_tag) memory.
 * Originally global (ADR-0024 § 2.c), they were re-scoped PER-TEMPLATE on
 * 2026-06-04 (task #324) — the call sites in app/(tabs)/index.tsx suffix them
 * with `:${template_id}`, so each template remembers its own last selection.
 * The `STICKY_KEY_GLOBAL_LAST_*` pair below is the SEPARATE, genuinely-global
 * last-used memory (no id suffix) — read by a fresh template's 開始訓練 to
 * auto-adopt the user's most recent 計劃·強度. The helpers below stay PURE.
 */

import type { TemplateSummary } from '../../adapters/sqlite/templateRepository';

/**
 * Group templates by `name`, keeping ONE representative row per name (the
 * newest-edited one — i.e. the one with the largest `updated_at`).
 *
 * Stable ordering: input rows are assumed sorted newest-edited-first
 * (`listTemplates` does `ORDER BY updated_at DESC`); we preserve that order.
 *
 * Pure — no DB, no React, no router.
 */
export function listTemplateGroupsByName(
  rows: TemplateSummary[]
): TemplateSummary[] {
  const seen = new Set<string>();
  const out: TemplateSummary[] = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push(r);
  }
  return out;
}

/**
 * Sticky-key BASE names for the start sheet's last-used (program, sub_tag).
 * Re-scoped PER-TEMPLATE on 2026-06-04 (task #324): the call sites suffix these
 * with `:${template_id}`, so the actual stored keys are
 * `start_dialog_last_program_id:<id>` — NOT global. Exposed as constants so the
 * call sites + tests share one string.
 */
export const STICKY_KEY_LAST_PROGRAM_ID = 'start_dialog_last_program_id';
export const STICKY_KEY_LAST_SUB_TAG = 'start_dialog_last_sub_tag';

/**
 * Genuinely-GLOBAL last-used (program, sub_tag) keys — no `:id` suffix, one row
 * each in the settings KV. Written whenever a session starts via an explicit
 * 計劃·強度 selection (the 計劃-mode start sheet `onSheetStart` + the template
 * editor's `onStartSession`); NOT written by 極簡/空白 starts (no 計劃 concept).
 * Read by a fresh (unclassified) template's 開始訓練 to auto-adopt the user's
 * most-recently-used 計劃·強度 (Phase A of the autostart-prefill spec). Program
 * is stored in `period_id` space (通用 → the reserved 「無」 sentinel).
 */
export const STICKY_KEY_GLOBAL_LAST_PROGRAM_ID = 'global_last_program_id';
export const STICKY_KEY_GLOBAL_LAST_SUB_TAG = 'global_last_sub_tag';
