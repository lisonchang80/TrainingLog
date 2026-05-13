import type { Database } from '../types';

/**
 * v009 — Template editor UI redesign + per-set 預設值 schema (ADR-0016).
 *
 * Note: ADR-0016 內文把這版叫「v012」(planning name 假設 ADR-0014 v010 +
 * ADR-0015 v011 已先 ship)；實際上 ADR-0014/0015 schema 未實作，slice 9.5
 * 是 v008 之後第一個 schema migration，所以照 ship-slice 慣例編 v009。
 * 順手把 ADR-0015 `template.color_hex` 一併帶進來（12-color picker UI 在
 * slice 9.5 scope 內、要寫得到欄位才能 wire）。`session.title` (ADR-0014)
 * 不在本 slice 範圍，留給後續 Session redesign slice。
 *
 * Changes:
 *   1. ALTER template ADD color_hex TEXT NOT NULL DEFAULT '' (ADR-0015)
 *   2. ALTER template_exercise ADD rest_seconds INTEGER NULL (ADR-0016)
 *   3. ALTER template_exercise ADD parent_id TEXT NULL — superset linkage
 *      (ADR-0016 amendment §7). NULL = plain row or superset parent;
 *      non-NULL = child pointing at parent's id.
 *   4. ALTER template_exercise ADD notes TEXT NULL — per-exercise notes
 *      (ADR-0013). UI 即時 UPDATE pattern; not draft state.
 *   5. ALTER template_exercise ADD updated_at INTEGER NOT NULL DEFAULT 0 —
 *      bumped on every write so 動作記憶 read pattern (ADR-0016 §動作記憶)
 *      can pick the most recently edited row for a given exercise_id.
 *      DEFAULT 0 lets ALTER apply to existing rows; repo writes bump on
 *      every INSERT/UPDATE.
 *   6. CREATE TABLE template_set: per-template_exercise per-set 預設值
 *      (含 cluster B3 `parent_set_id` 自參照 + per-set `notes`)
 *   7. CREATE INDEX idx_template_set_by_exercise
 *   8. Transform: 把既有 template_exercise summary (default_sets / default_reps /
 *      default_weight_kg) 攤平成 N 個 working template_set rows，per ADR-0016
 *      §migration transform。原 summary 欄位**保留** (SQLite 不易 DROP COLUMN)
 *      但 production code 後續一律走 template_set，原欄位視為 deprecated。
 *
 * Idempotency: PRAGMA user_version 由 migrate runner 守門，本 fn 只會在
 * current < 9 時跑一次。Transform INSERT 直接寫不需 OR IGNORE（template_set
 * 是新表，跑之前 row count = 0）。
 */
export async function v009_template_set(db: Database): Promise<void> {
  await db.execAsync(`
    ALTER TABLE template ADD COLUMN color_hex TEXT NOT NULL DEFAULT '';

    ALTER TABLE template_exercise ADD COLUMN rest_seconds INTEGER;
    ALTER TABLE template_exercise ADD COLUMN parent_id TEXT;
    ALTER TABLE template_exercise ADD COLUMN notes TEXT;
    ALTER TABLE template_exercise ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE template_set (
      id TEXT PRIMARY KEY NOT NULL,
      template_exercise_id TEXT NOT NULL REFERENCES template_exercise(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      set_kind TEXT NOT NULL CHECK (set_kind IN ('warmup','working','dropset')) DEFAULT 'working',
      reps INTEGER NOT NULL,
      weight REAL NOT NULL,
      parent_set_id TEXT REFERENCES template_set(id) ON DELETE CASCADE,
      notes TEXT,
      UNIQUE (template_exercise_id, position)
    );

    CREATE INDEX idx_template_set_by_exercise
      ON template_set(template_exercise_id, position);
  `);

  // Transform existing template_exercise rows into template_set rows.
  // 每個 template_exercise → default_sets 個 working set rows，
  // reps = default_reps (NULL → 0)、weight = default_weight_kg (NULL → 0)。
  // position 從 0 起跳。id 用簡單拼接（template_exercise_id + idx），不撞 UNIQUE。
  const rows = await db.getAllAsync<{
    id: string;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
  }>(
    `SELECT id, default_sets, default_reps, default_weight_kg FROM template_exercise`
  );

  for (const row of rows) {
    const sets = Math.max(0, row.default_sets ?? 0);
    const reps = row.default_reps ?? 0;
    const weight = row.default_weight_kg ?? 0;
    for (let i = 0; i < sets; i++) {
      await db.runAsync(
        `INSERT INTO template_set
           (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id, notes)
         VALUES (?, ?, ?, 'working', ?, ?, NULL, NULL)`,
        `${row.id}-s${i}`,
        row.id,
        i,
        reps,
        weight
      );
    }
  }
}
