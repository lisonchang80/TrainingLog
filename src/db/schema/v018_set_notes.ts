import type { Database } from '../types';

/**
 * v018 — Add `notes TEXT NULL` to the runtime `set` table (slice 10c
 * Phase 2 commit 7c).
 *
 * ADR-0019 Q9 拍板「右滑備註 → 開 set-level 備註 sheet」假設 per-set notes
 * 已在 schema — 但 v015 加 set_kind/parent_set_id/is_logged 時並沒順手
 * 加 notes 欄。template_set 從 v009 就有 notes，runtime set 則沒有；本
 * migration 補齊這個 drift。
 *
 * Existing rows get NULL by default — fine semantically (notes are
 * inherently optional). Downstream readers that don't care about notes
 * (PR engine, achievements, exercise history) continue to work without
 * change.
 *
 * Idempotency: PRAGMA table_info introspection before ADD COLUMN, so a
 * re-run on an already-migrated DB is a no-op (sibling pattern: v014 /
 * v015).
 */
export async function v018_set_notes(db: Database): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("set")`);
  const have = new Set(cols.map((c) => c.name));

  if (!have.has('notes')) {
    await db.execAsync(`ALTER TABLE "set" ADD COLUMN notes TEXT;`);
  }
}
