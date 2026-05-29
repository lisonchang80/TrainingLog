---
name: migration-new
description: Scaffold a new SQLite schema migration with the TrainingLog 4-part template — forward DDL, backfill from existing data, idempotency check, and CASCADE behavior tests. Use when adding a new schema version (v023+) such as new tables, new columns on existing tables, or new indexes/constraints.
---

# Migration New — TrainingLog Schema 4-part template

ADR-0001 ~ ADR-0022 累積 22 個 schema version、寫法漸趨穩定。新 migration 該照同個 4 segment template、不再從零摸索。

## When to use

- 新 schema version（v023, v024, ...）— 加 table / 加 column / 加 index / 改 CASCADE 行為
- 重 rename 或 drop column（先 deprecate + 雙寫、後遷移、再 drop）
- 想新增 reference data（如新 muscle group seed、新 program template seed）

## When NOT to use

- 純 query 改動（不動 schema）— 改 repo 函式就好、不需 migration
- App-level state migration（AsyncStorage / Settings）— 走 settings repo 模式、不走 SQL migration

## 4-part template

新 migration 一律 4 個 segment、依序：

### 1. Forward DDL

`src/db/migrations/vNNN.sql` — 純 DDL、`CREATE TABLE` / `ALTER TABLE ADD COLUMN` / `CREATE INDEX`：

```sql
-- v023 — <one-line summary>
-- ADR-NNNN
-- Created 2026-MM-DD

CREATE TABLE IF NOT EXISTS new_table (
  id TEXT PRIMARY KEY,
  fk_id INTEGER NOT NULL REFERENCES other_table(id) ON DELETE CASCADE,
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_new_table_fk ON new_table(fk_id);
```

Rules:
- 一律 `IF NOT EXISTS`（idempotent）
- FK 一律明寫 `ON DELETE ...`（CASCADE / SET NULL / RESTRICT 三選一、不要 default）
- index 明寫名稱（自動生成名稱跨 sqlite 版本不一致）

### 2. Backfill from existing data

在 `migrations.ts::runMigration_vNNN` 函式內、跑 DDL 後立刻做 backfill：

```typescript
async function runMigration_v023(db: Database) {
  await db.exec(v023_SQL); // forward DDL
  
  // Backfill: 從既有 table 拉資料填新 table / 新欄位
  const existingRows = await db.all('SELECT id, ... FROM old_table');
  for (const row of existingRows) {
    await db.run(
      'INSERT OR IGNORE INTO new_table (id, fk_id, payload, created_at) VALUES (?, ?, ?, ?)',
      [generateUUID(), row.id, derivedPayload(row), now()]
    );
  }
}
```

Rules:
- `INSERT OR IGNORE` — backfill 必須 idempotent（migration 跑兩次不該 crash）
- 不要在 backfill 寫 INSERT 進 backed-up data（只跑一次即可）
- 大表 backfill 用 transaction wrap

### 3. Idempotency test

`tests/db/migrations/vNNN.test.ts`：

```typescript
describe('v023 migration', () => {
  it('forward DDL is idempotent', async () => {
    const db = await openInMemory();
    await runMigration_v023(db);
    await runMigration_v023(db); // 跑第二次不該 crash
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.find(t => t.name === 'new_table')).toBeDefined();
  });

  it('backfill creates correct rows', async () => {
    const db = await openInMemory();
    await runMigration_v019(db); // ... 之前的 migration
    await seedOldTableData(db); // 注入舊資料
    await runMigration_v023(db); // 跑 v023
    const newRows = await db.all('SELECT * FROM new_table');
    expect(newRows.length).toBe(expectedBackfillCount);
  });

  it('CASCADE works correctly', async () => {
    const db = await openInMemory();
    await runAllMigrations(db);
    await seedOldTableData(db);
    await runMigration_v023(db);
    // 刪 parent row、verify child rows 跟著消
    await db.run('DELETE FROM other_table WHERE id = ?', [parentId]);
    const remaining = await db.all('SELECT * FROM new_table WHERE fk_id = ?', [parentId]);
    expect(remaining.length).toBe(0);
  });
});
```

### 4. Repo helper（讀寫 wrapper）

`src/adapters/sqlite/newTableRepository.ts`：

```typescript
export async function listNewTableByX(db: Database, x: string): Promise<Row[]> {
  return db.all('SELECT ... FROM new_table WHERE x = ? ORDER BY created_at DESC', [x]);
}

export async function insertNewTableRow(
  db: Database,
  { x, payload, now }: { x: string; payload: string; now?: number }
): Promise<string> {
  const id = generateUUID();
  await db.run(
    'INSERT INTO new_table (id, fk_id, payload, created_at) VALUES (?, ?, ?, ?)',
    [id, x, payload, now ?? Date.now()]
  );
  return id;
}
```

`tests/db/newTableRepository.test.ts` — 至少 6 test：
- happy path insert + read
- 跨 fk_id isolation（A 的 row 不會被 B 撈到）
- 排序符合預期
- INSERT 後 read 看得到（同 transaction）
- CASCADE：刪 fk parent 後 child 也消
- update_at（如有）順 INSERT 後跟 read 一致

## Anti-pattern

- ❌ Backfill 在 forward DDL 內（`INSERT INTO ... VALUES ...` 在 .sql 檔）— 應在 migrations.ts 程式邏輯內、可重跑
- ❌ Migration 加新 NOT NULL column 不給 default + 沒 backfill — 既有 row 沒值會 crash
- ❌ Forget `IF NOT EXISTS` — migration 重跑 crash
- ❌ FK without `ON DELETE` — 預設行為跨 sqlite 版本不一致、產生孤兒 row
- ❌ Test 用真 simulator DB（在 `/tmp` 留檔）— 一律 `:memory:` 用 better-sqlite3
- ❌ **新加 child table 帶 FK → parent 但沒 audit parent 的既有 `delete*` repo 函式** — 本 migration 跑完後，未來刪 parent row 會在 commit 時 trip `SQLite error 19: FOREIGN KEY constraint failed`。Checklist：grep `src/adapters/sqlite/*Repository.ts` 找 `DELETE FROM <parent>`，每個都要在同一 transaction 內補 `UPDATE <child> SET <fk_col> = NULL WHERE <fk_col> = ?`（如要保留 child row）或 `DELETE FROM <child> WHERE <fk_col> = ?`（如 cascade 刪）。實例：v005 加 `program_cell.template_id` 但漏補 `deleteTemplate`，2026-05-29 user 從 program 上套了 template 後刪 template 就炸（see tests/db/deleteTemplate.test.ts 的 program_cell case）。

## 歷史 baseline

v019 ~ v022 都遵循這 4 segment template：
- **v019** `set.session_exercise_id` — 加 column + backfill from `ORDER BY ordering` + index + 7 test
- **v020** `program.start_date` — 加 column + backfill from `MIN(created_at)`
- **v021** drop orphan `template_exercise.rest_sec` — 砍 column 走 table-rebuild + 6 test
- **v022** `program_sub_tag` 字典表 — 新 table + backfill from `template.sub_tag` + `program_cell.sub_tag` + CASCADE + 19 test

下一個 v023 套這 template、約 1-2 hr 完成（包含 test）。

## 相關 skill

- `extract-pure-logic` — migration 程式邏輯的可測單元拆出
- `simulator-db-query` — migration 上線後驗 user 真 DB 狀態
- `feature-decision-sweep` — schema 變更若觸發 ADR/PRD update、用此 skill 整理
