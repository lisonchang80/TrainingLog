---
name: migration-new
description: Scaffold a new SQLite schema migration with the TrainingLog 4-part template — forward DDL, backfill from existing data, idempotency check, and CASCADE behavior tests. Use when adding a new schema version (v025+) such as new tables, new columns on existing tables, or new indexes/constraints. Files — src/db/schema/vNNN_<name>.ts, src/db/migrate.ts, tests/db/vNNN_<name>.test.ts, src/adapters/sqlite/<entity>Repository.ts.
---

# Migration New — TrainingLog Schema 4-part template

ADR-0001 起累積至 v024、寫法漸趨穩定。新 migration 該照同個 4 segment template、不再從零摸索。

## 實際結構（先記這個，別寫成 .sql）

- **Migration 檔**：`src/db/schema/vNNN_<name>.ts` — 一個 `export async function vNNN_<name>(db: Database): Promise<void>`，DDL 以 inline template string 走 `db.execAsync(...)`。**沒有獨立 `.sql` 檔、沒有 `migrations.ts`**。
- **註冊**：在 `src/db/migrate.ts` `import { vNNN_name } from './schema/vNNN_name'`，加進 `migrations: Record<number, MigrationFn>` map（key = 版號整數）。runner 用 `PRAGMA user_version` 逐版跑，**每個 migration 已被 runner 包在 `withTransactionAsync` 內並自動 bump user_version** → migration 函式自己**不要**再開 transaction。
- **Database 介面**（`src/db/types.ts`，prod=expo-sqlite / test=better-sqlite3 in-memory，repo 一律依賴它不直接碰 expo-sqlite）：
  - `execAsync(sql): Promise<void>` — DDL / 多語句
  - `runAsync(sql, ...params): Promise<RunResult>` — INSERT/UPDATE/DELETE（回 `{ changes, lastInsertRowId }`）
  - `getAllAsync<T>(sql, ...params): Promise<T[]>` / `getFirstAsync<T>(sql, ...params): Promise<T | null>`
  - `withTransactionAsync(fn): Promise<void>`
- **Test**：`tests/db/vNNN_<name>.test.ts`（**flat、不是 `tests/db/migrations/`**），用 better-sqlite3 in-memory。
- **Repo helper**：`src/adapters/sqlite/<entity>Repository.ts`。

## When to use

- 新 schema version（v025, v026, ...）— 加 table / 加 column / 加 index / 改 CASCADE 行為
- 重 rename 或 drop column（先 deprecate + 雙寫、後遷移、再 drop）
- 想新增 reference data（如新 muscle group seed、新 program template seed）

## When NOT to use

- 純 query 改動（不動 schema）— 改 repo 函式就好、不需 migration
- App-level state migration（AsyncStorage / Settings）— 走 settings repo 模式、不走 SQL migration

## 4-part template

新 migration 一律 4 個 segment、依序。Segment 1 + 2 同住在 `vNNN_<name>.ts` 那個函式裡。

### 1. Forward DDL（migration 函式前半）

`src/db/schema/vNNN_<name>.ts`：

```typescript
import type { Database } from '../types';

/**
 * vNNN — <one-line summary> (ADR-NNNN).
 * Background / Backfill / Idempotency 註解（照 v023 風格寫清楚）。
 */
export async function vNNN_name(db: Database): Promise<void> {
  // 新 table → CREATE TABLE IF NOT EXISTS（idempotent）
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS new_table (
      id TEXT PRIMARY KEY,
      fk_id INTEGER NOT NULL REFERENCES other_table(id) ON DELETE CASCADE,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_new_table_fk ON new_table(fk_id);
  `);

  // 加 column → sqlite ALTER 沒有 IF NOT EXISTS，用 PRAGMA table_info guard（見 v023）
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(session)`);
  if (!cols.some((c) => c.name === 'title')) {
    await db.execAsync(`ALTER TABLE session ADD COLUMN title TEXT NOT NULL DEFAULT '';`);
  }

  // ... segment 2 backfill 接在這後面（同一函式）
}
```

Rules:
- 新 table 用 `CREATE TABLE IF NOT EXISTS`；加 column 用 `PRAGMA table_info(<table>)` guard（ALTER 無 IF NOT EXISTS）
- FK 一律明寫 `ON DELETE ...`（CASCADE / SET NULL / RESTRICT 三選一、不要 default）
- index 明寫名稱（自動生成名稱跨 sqlite 版本不一致）
- **不要**在函式內開 `withTransactionAsync` — runner 已包

### 2. Backfill from existing data（接在同一函式後半）

```typescript
  // Backfill：從既有資料填新欄位/新表。用 WHERE guard 保持 idempotent
  // （migration 中途中斷後重跑不會 clobber 使用者已輸入的值）。
  await db.execAsync(`
    UPDATE session
       SET title = COALESCE(
         (SELECT t.name FROM session_exercise se
            JOIN template t ON t.id = se.template_id
           WHERE se.session_id = session.id AND se.template_id IS NOT NULL
           LIMIT 1),
         ''
       )
     WHERE title = '';
  `);
```

逐列 backfill 進新表時：

```typescript
  const rows = await db.getAllAsync<{ id: number }>(`SELECT id FROM old_table`);
  for (const row of rows) {
    await db.runAsync(
      `INSERT OR IGNORE INTO new_table (id, fk_id, payload, created_at) VALUES (?, ?, ?, ?)`,
      generateUUID(), row.id, derivedPayload(row), Date.now()
    );
  }
```

Rules:
- `INSERT OR IGNORE` / `WHERE` guard — backfill 必須 idempotent（重跑不該 crash 或重複塞）
- 不要 backfill 既有 backed-up 資料兩次（只跑一次的語意靠 WHERE / OR IGNORE 保證）
- runner 已開 transaction，不用自己 wrap

### 3. 註冊 + Idempotency / CASCADE test

先在 `src/db/migrate.ts` 註冊：

```typescript
import { vNNN_name } from './schema/vNNN_name';
// migrations map：
const migrations: Record<number, MigrationFn> = { /* ... */, NNN: vNNN_name };
```

> **⚠️ bump head 版號要連 `tests/db/migrateChain.test.ts` 一起掃**（不只 migrate.ts）。每加一版，該檔有**多處硬編舊 head 版號**會 fail：① describe 標題 `(v001 → vNN)` ② 開頭 docblock 的 `user_version = NN` ③ fresh-chain 斷言 `it('migrates a fresh DB to user_version = NN')` + `expect(await userVersion()).toBe(NN)` ④ idempotent-snapshot 斷言 `expect(v?.user_version).toBe(NN)` ⑤ populated-remigrate 斷言（同 `.toBe(NN)`）+ 其 `v019..vNN` 範圍註解 + 標題「migrates up to NN」。recipe：`grep -n "<舊版號>" tests/db/migrateChain.test.ts` 把全部一次改完（`.toBe(NN)` 有多筆同字串、用 `replace_all` 要小心別誤蓋無關數字）。**index migration 另加一條存在性測試**（`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_...'`）+ 一條冪等測試（rewind `PRAGMA user_version = NN-1` → 再 `migrate(db)` → index 仍只 1 筆）——mirror v026/v027。`closeAndResetForRestore.test.ts` 的 `migrationsMaxVersion: mockReturnValue(NN)` 是**假值 mock、不需跟著 bump**（與真鏈無關）。

`tests/db/vNNN_name.test.ts`（用 in-memory Database；可直接呼叫 migration 函式，或用 `migrate(db)` 跑到目標版）：

```typescript
import { vNNN_name } from '../../src/db/schema/vNNN_name';
import { makeTestDb } from '<test db helper>'; // 既有 better-sqlite3 in-memory adapter

describe('vNNN migration', () => {
  it('forward DDL is idempotent', async () => {
    const db = await makeTestDb();
    await vNNN_name(db);
    await vNNN_name(db); // 跑第二次不該 crash
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table'`
    );
    expect(tables.some((t) => t.name === 'new_table')).toBe(true);
  });

  it('backfill creates correct rows', async () => {
    const db = await makeTestDb();
    // ... 注入舊資料、跑 migration、assert 新表/新欄位內容
    await vNNN_name(db);
    const rows = await db.getAllAsync(`SELECT * FROM new_table`);
    expect(rows.length).toBe(expectedBackfillCount);
  });

  it('CASCADE works correctly', async () => {
    const db = await makeTestDb();
    await vNNN_name(db);
    // 刪 parent row、verify child rows 跟著消
    await db.runAsync(`DELETE FROM other_table WHERE id = ?`, parentId);
    const remaining = await db.getAllAsync(`SELECT * FROM new_table WHERE fk_id = ?`, parentId);
    expect(remaining.length).toBe(0);
  });
});
```

> 既有 test 命名兩種並存：舊版 camelCase（`v022ProgramSubTag.test.ts`）、新版 snake（`v023_session_title.test.ts`）。新檔跟 schema 檔名走 snake：`vNNN_name.test.ts`。

### 4. Repo helper（讀寫 wrapper）

`src/adapters/sqlite/<entity>Repository.ts`（依賴 `Database` 介面）：

```typescript
import type { Database } from '../../db/types';

export async function listNewTableByX(db: Database, x: string): Promise<Row[]> {
  return db.getAllAsync<Row>(
    `SELECT * FROM new_table WHERE fk_id = ? ORDER BY created_at DESC`, x
  );
}

export async function insertNewTableRow(
  db: Database,
  { fkId, payload, now }: { fkId: string; payload: string; now?: number }
): Promise<string> {
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO new_table (id, fk_id, payload, created_at) VALUES (?, ?, ?, ?)`,
    id, fkId, payload, now ?? Date.now()
  );
  return id;
}
```

`tests/db/<entity>Repository.test.ts` — 至少 6 test：happy path insert+read／跨 fk isolation／排序／INSERT 後同連線 read 看得到／CASCADE：刪 parent 後 child 消／updated_at（如有）一致。

## Anti-pattern

- ❌ 把 migration 寫成 `.sql` 檔或塞進不存在的 `migrations.ts` — 本 repo 是 `src/db/schema/vNNN_<name>.ts` TS 函式 + `migrate.ts` map
- ❌ 用 `db.exec` / `db.all` / `db.run` — 正確 API 是 `execAsync` / `getAllAsync` / `runAsync`（async 後綴）
- ❌ migration 函式內自己 `withTransactionAsync` — runner 已包、會 nested
- ❌ Migration 加新 NOT NULL column 不給 default + 沒 backfill — 既有 row 沒值會 crash
- ❌ 加 column 用 `ALTER ... IF NOT EXISTS`（sqlite 不支援）— 用 `PRAGMA table_info` guard
- ❌ Forget `IF NOT EXISTS`（建表**與建 index**：`CREATE TABLE` ＋ `CREATE INDEX` 皆要）/ WHERE guard（backfill）— migration 重跑 crash 或重複塞。⚠️ **只給 CREATE TABLE 加、漏掉同 migration 的 CREATE INDEX ＝半修**：重跑時 table 過了、`CREATE INDEX idx_x` 仍 throw「index already exists」→ brick 只是從表移到 index（2026-06-18 boot/restore 資料安全稽核實證：v003-v011 早期 migration 兩者都裸寫）。但「完全 re-runnable」對含 `ALTER TABLE ADD COLUMN` 的 migration **做不到**（sqlite 無 ADD COLUMN IF NOT EXISTS、見上一條）→ 那些只能 single-run；安全前提＝runner 只前進 `user_version`、整檔備份還原 shape==pointer 不 desync，故 IF-NOT-EXISTS 屬 v016+ 慣例對齊／防禦縱深、非「保證可重跑」。測 idempotency 只能斷言 create-only（無 ALTER）migration 重跑為 no-op
- ❌ FK without `ON DELETE` — 預設行為跨 sqlite 版本不一致、產生孤兒 row
- ❌ Test 用真 simulator DB（在 `/tmp` 留檔）— 一律 in-memory better-sqlite3
- ❌ **新加 child table 帶 FK → parent 但沒 audit parent 的既有 `delete*` repo 函式** — 本 migration 跑完後，未來刪 parent row 會在 commit 時 trip `SQLite error 19: FOREIGN KEY constraint failed`。Checklist：grep `src/adapters/sqlite/*Repository.ts` 找 `DELETE FROM <parent>`，每個都要在同一 transaction 內補 `UPDATE <child> SET <fk_col> = NULL WHERE <fk_col> = ?`（保留 child）或 `DELETE FROM <child> WHERE <fk_col> = ?`（cascade 刪）。實例：v005 加 `program_cell.template_id` 但漏補 `deleteTemplate`，2026-05-29 user 從 program 上套了 template 後刪 template 就炸（see `tests/db/deleteTemplate.test.ts` 的 program_cell case）。
- ❌ **Backfill 用 `INSERT … SELECT` 從「無自身 FK 的來源欄」灌進「帶真 FK 的目標表」without 守門 → brick 開機** — `INSERT OR IGNORE` 的 `IGNORE` **只吞 PK/UNIQUE 衝突、不吞 FK 違反**（FK 違反一律 throw）。prod migrate 跑在 `PRAGMA foreign_keys = ON`，所以來源欄一旦有懸空值 → `SQLite error 19: FOREIGN KEY constraint failed` → 整個 migration transaction rollback → `openDatabase()` reject → **app 開不了機、`user_version` 卡在前一版**（且後續 migration 永遠跑不到、無法補救，因為壞的這版 gate 住）。守門：backfill `SELECT` 一律加 `AND <src_col> IN (SELECT id FROM <parent>)`，或先 `UPDATE` NULL 掉懸空來源。**注意「無 FK 來源欄」很常見**：`ALTER TABLE ... ADD COLUMN` 加的 ref 欄（sqlite ALTER 無法加 FK）天生就無 DB 層 FK、可懸空。實例：v022 `program_sub_tag` backfill from `template.program_id`（v005 ALTER 加、無 FK）懸空時 brick（2026-06-05 fix-prep probe 重現）；**修舊 migration 一律 in-place**（FK throw 是 all-or-nothing、不留壞 row，被 brick 者卡舊版只能靠修好的同版重跑解套，新糾正 migration 跑不到所以無用）。⚠️ 別重蹈 ADR-0021 誤判「FK=ON 讓孤兒安全」——它漏想 backfill 自己會 throw。**reference impl（已 ship `2f28756`）**：v022 backfill 加 `AND program_id IN (SELECT id FROM program)` in-place；regression test 在 `tests/db/v022ProgramSubTag.test.ts`「skips a dangling template.program_id」——關鍵：測試**須先 `PRAGMA foreign_keys = ON`**（jest DB 預設 FK OFF、不開重現不出 brick），seed 懸空非空 `template_id` 後斷言 backfill 不 throw + 孤兒被跳過（revert guard 則測試 throw＝有鑑別力）。

## 歷史 baseline（皆 `src/db/schema/*.ts`）

- **v019** `set.session_exercise_id` — 加 column + backfill from `ORDER BY ordering` + index + 7 test
- **v020** `program.start_date` — 加 column + backfill from `MIN(created_at)`
- **v021** drop orphan `template_exercise.rest_sec` — 砍 column 走 table-rebuild + 6 test
- **v022** `program_sub_tag` 字典表 — 新 table + backfill from `template.sub_tag` + `program_cell.sub_tag` + CASCADE + 19 test
- **v023** `session.title` — 加 column（PRAGMA guard）+ backfill from linked template name
- **v024** `session.is_watch_tracked` — α-model 5-tile predicate 用
- **v025** `set.display_rank` — 加 column + backfill
- **v026** `idx_session_started_at` — 純 index（perf P2、history ORDER BY started_at）
- **v027** `idx_session_exercise_parent` — 純 index（perf P2、history cluster 相關子查詢 `se2.parent_id = se.id`；index migration 範本＝最小 4-part：DDL `CREATE INDEX IF NOT EXISTS` + 無 backfill + 無 CASCADE + migrateChain 存在性/冪等 test）

下一個 v028 套這 template、約 1-2 hr 完成（包含 test）。純 index migration（如 v026/v027）更輕、~15 分鐘。

## 相關 skill / agent

- `@sqlite-migration-reviewer`（subagent）— migration 寫完後丟給它審：版號單調性、forward-only 安全、FK/cascade、seed 相容、test 覆蓋。也是 `pre-ship-gate` workflow 的 sqlite lens。
- `extract-pure-logic` — migration 程式邏輯的可測單元拆出
- `simulator-db-query` / `simulator-db-seed-smoke` — migration 上線後驗 user 真 DB 狀態
- `feature-decision-sweep` — schema 變更若觸發 ADR/PRD update、用此 skill 整理
