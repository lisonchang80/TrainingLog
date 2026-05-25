import type { Database } from '../types';
import { colorForTemplateName } from '../../domain/template/templateColor';

/**
 * v020 — Backfill `template.color_hex` for rows that still hold the v009
 * `DEFAULT ''` sentinel.
 *
 * Background: v009 added `color_hex TEXT NOT NULL DEFAULT ''` to the
 * template table but never filled it in. ADR-0015 § Storage 設計 specifies
 * "建 Template 時系統預設一色 (hash by name)" with a hash-derived default;
 * v009 left that for a later migration. v020 closes that gap so the new
 * history calendar view (ADR-0015) has a deterministic per-template color
 * to render for every existing row.
 *
 * Implementation: SQLite has no built-in hash UDF, so we read the empty
 * rows in JS, compute `colorForTemplateName(name)`, and UPDATE one row at a
 * time. Same pattern as v009's `default_sets → template_set` transform.
 *
 * Idempotency: the `WHERE color_hex = ''` filter means re-running the
 * migration (e.g. after a manual color edit and a fresh checkout) only
 * touches rows that are still on the v009 default. Any color the user has
 * explicitly set survives untouched.
 *
 * Cross-reference: `createTemplate` in `templateRepository.ts` applies the
 * same fallback so newly-minted templates also get a deterministic color
 * even when callers don't pass `color_hex` — v020 is the one-shot catch-up
 * for pre-existing rows.
 */
export async function v020_template_color_backfill(db: Database): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM template WHERE color_hex = ''`
  );
  for (const row of rows) {
    const color = colorForTemplateName(row.name);
    await db.runAsync(
      `UPDATE template SET color_hex = ? WHERE id = ?`,
      color,
      row.id
    );
  }
}
