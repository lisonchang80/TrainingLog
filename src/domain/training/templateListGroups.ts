/**
 * Template list dedupe + grouping helpers for the 訓練 tab → 模板訓練 section
 * (per ADR-0024 § 2.c).
 *
 * Per ADR-0003 the Template identity is the triple `(name, program_id, sub_tag)`,
 * which means multiple rows can share a `name` (e.g. the same logical
 * "Pull Day" template attached to 3 different programs with different sub_tags).
 *
 * The 模板訓練 section wants ONE row per name — tapping that row should later
 * open the start-template flow (`StartTemplateSheet` — wired in a follow-up
 * slice; this helper just owns the visible list shape).
 *
 * Sticky GLOBAL keys (`start_dialog_last_program_id` / `start_dialog_last_sub_tag`)
 * are intentionally kept as single-key settings per ADR-0024 § 2.c — those
 * keys are written / read by the start sheet itself (not yet implemented) and
 * are not in scope of this dedupe helper. The helpers below stay PURE.
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
 * Sticky-key contract for the start sheet. These two settings keys are
 * exposed here as constants so the start sheet (when it lands) and any
 * future tests reference the same string. GLOBAL scope per ADR-0024 § 2.c
 * (not per-template — translates to one row in the settings KV per key,
 * not N).
 */
export const STICKY_KEY_LAST_PROGRAM_ID = 'start_dialog_last_program_id';
export const STICKY_KEY_LAST_SUB_TAG = 'start_dialog_last_sub_tag';
