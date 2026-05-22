# 0021 — Persistent per-Program 強度 dictionary (`program_sub_tag` 表 + 三 write path 註冊)

Status: accepted (2026-05-22 catch-up; landed in code 2026-05-21 wave 16 commit `485e9bc`)

把每個 Program 底下「強度」(sub_tag) label 集合從**transient**（從 `template.sub_tag` + `program_cell.sub_tag` 兩源即時撈）升級成**persistent dictionary entity**（新表 `program_sub_tag`）。所有 SQL 寫入「強度」label 的路徑統一呼叫 `recordProgramSubTag(...)` (INSERT OR IGNORE) 註冊到字典；UI picker 改讀字典 union template list。修「覆寫最後一格 → label 從 picker 消失」這個 wave 15 起就一直被報的 UX bug。

## Context

Wave 15 (2026-05-21) Programs tab grid-on-tab + 編輯模式 ▶ apply 兩條 affordance 上線後，「強度」label 的生命週期跟著轉移到 `program_cell.sub_tag` 直寫。`distinctSubTagsInProgram` (domain helper) + `listDistinctSubTagsByProgram` (repo helper) 兩條 read 路徑都用 query 從**當下還在使用**這個 label 的 cell / template 反推 chip 列。

問題在「覆寫」的場景下浮上來：

1. user 在 row picker 加新 chip `II-2`、apply 到唯一一格
2. user 後悔，把那格的 sub_tag 改回 `II-1`
3. **`II-2` 從此 picker 永遠看不到** — 沒任何 cell 或 template 還在用 `II-2`

User 報告「我打的『強度』不見了」三次後拍板：強度 label 一旦在某個 program 出現過，就必須永久記得。**Picker 必須跨 cell 覆寫週期持久（persist across overwrite cycles）**。

短期繃帶（wave 15-16 早期）試過 read 路徑取 UNION（include template list + cell list + dropdown 既有 chip 清單），但只要 user 重 reload Programs tab、in-memory chip state 沒了，仍然回 query — 還是看不到。

## Decision

引入 schema v022 新表 `program_sub_tag`，記錄每個 (program, sub_tag) ever-introduced 的二元組合：

```sql
CREATE TABLE program_sub_tag (
  program_id TEXT NOT NULL,
  sub_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (program_id, sub_tag),
  FOREIGN KEY (program_id) REFERENCES program(id) ON DELETE CASCADE
);
CREATE INDEX idx_program_sub_tag_program ON program_sub_tag (program_id);
```

- **PRIMARY KEY (program_id, sub_tag)** — 同一 (program, sub_tag) 自然只能有 1 row，INSERT OR IGNORE 自動 dedup。
- **FOREIGN KEY ... ON DELETE CASCADE** — 刪 program 時字典 row 自動清乾淨；不會出現 orphan 字典污染（前提：PRAGMA foreign_keys = ON，已 enabled）。
- **created_at** — INTEGER ms epoch；helper 接受注入 `now()` 函式供測試。

### Write paths（三條 SQL）

所有 sub_tag 寫入 `program_cell` 的 SQL 路徑都呼叫 `recordProgramSubTag(db, program_id, sub_tag, now?)`：

1. **`upsertCell`** — 單格 edit（cell tap preset、wizard 拍板）— line 395 在 UPDATE / INSERT 之後 register。
2. **`applyTemplateToColumn` (`sub_tag_override` 分支)** — column ▶ apply 帶 override（`+建立新模板 → 建立並導入` flow，wave 16 `485e9bc`）— line 494 在 transaction 末尾 register。注意這個分支用 `hasOwnProperty('sub_tag_override')` 偵測 key-present，所以 `null` (清空) 跟 absent (preserve per-row) 是不同 semantic；register 只在 `args.sub_tag_override != null` 時觸發。
3. **`applyTagToRow`** — row ▶ apply（**即使 0 cells touched** 仍 register，因為「user 在全休息 row 上想留標籤備用」是有效 UX intent）— line 540 一律在 transaction 內 register。

`swapProgramCells` (wave 17) 也呼叫 `recordProgramSubTag` 作為 defensive re-registration（理論上字典已有，stale label 防禦）。

### Null / 空字串 guard

`recordProgramSubTag(db, pid, sub_tag, now?)` 第一行：

```ts
if (sub_tag == null || sub_tag.length === 0) return;
```

`null` / `''` 都是 no-op — 字典只記**有意義 label**。`applyTagToRow(..., sub_tag: null)` 清空一整 row 不會把空 row 寫進字典；`applyTemplateToColumn(..., sub_tag_override: null)` 清空整 column 不會註冊 null。

### Read path

`listProgramSubTags(db, program_id)` 回字典所有 sub_tag，`ORDER BY sub_tag ASC` alphabetical。UI picker chip 列改用 union (template list + 字典)，dedupe 後渲染。空 program 回 `[]`。

### Backfill

v022 migration 從兩個現有 source backfill 到 `program_sub_tag`，避免既有用戶升級後字典空白：

```sql
INSERT OR IGNORE INTO program_sub_tag (program_id, sub_tag, created_at)
  SELECT DISTINCT program_id, sub_tag, ?
    FROM template
   WHERE program_id IS NOT NULL AND sub_tag IS NOT NULL AND sub_tag != '';

INSERT OR IGNORE INTO program_sub_tag (program_id, sub_tag, created_at)
  SELECT DISTINCT program_id, sub_tag, ?
    FROM program_cell
   WHERE sub_tag IS NOT NULL AND sub_tag != '';
```

兩個 source 都用 `INSERT OR IGNORE` 所以 (program, sub_tag) 重複 collapse 成單 row；`!= ''` filter 排除舊資料的空字串值。

## Alternatives considered

- **(a) 不做、繼續用 `distinctSubTagsInProgram`** — 覆寫 bug 不解、user 仍報「強度消失」 — REJECT
- **(b) 在 `program` 表加 `sub_tag_list` JSON column 存 string[]** — JSON 操作 SQLite SQL 不便（需 `json_each` extension + 手動 array merge / dedupe）、沒 CASCADE 語意、無索引、單 cell update 等於整列改寫 — REJECT
- **(c) 用 single global setting 表 `app_settings` 存共享 sub_tag list** — 跨 program 共享、不符 ADR-0004 per-program 強度 + ADR-0003 三元組 identity 概念（兩個不同 program 同名 strength label 不同含義）— REJECT
- **(d) 應急 UNION read path（template + cell + in-memory chip state）** — 已試過、reload 後 in-memory state lost、根本問題在 persistence 不在 read — REJECT
- **(e) 弱版 backfill — 只從 `template.sub_tag` 拉** — 漏掉「user 透過 row-apply ▶ 加 cell label 但還沒建 template」的 label（wave 15 + ADR-0004 允許這種使用模式）— REJECT，需要兩 source

## Consequences

- **Schema +1 表 + 1 index** — `program_sub_tag` + `idx_program_sub_tag_program`；migration `v022_program_sub_tag` 在 migrate.ts 排序為 22；test 覆蓋 forward / backfill / idempotency / CASCADE / runner integration (見 `tests/db/v022ProgramSubTag.test.ts`)。
- **三 write path 略複雜** — 每個 SQL 寫 path 多一個 `recordProgramSubTag` 呼叫；helper 自身的 null / 空字串 guard 確保調用方不必前置檢查。`INSERT OR IGNORE` idempotency 必要（同 (program, sub_tag) 多次 register 仍 1 row）。
- **CASCADE 風險低** — `program_sub_tag.program_id` FK ON DELETE CASCADE；刪 program 同步清掉字典 row，避免 orphan。`deleteProgram` 沒有顯式 DELETE `program_sub_tag` — 完全靠 FK CASCADE（前提 `PRAGMA foreign_keys = ON`，better-sqlite3 預設 OFF — 測試與 production 都已開啟）。
- **UX picker 持久化** — chip 列從此記得 user typed 過所有 label，即使 cell 全被覆寫到 II-1 也仍能在 picker 看到 II-2 chip swap 回去。**沒有「忘記 label」UX** — 解 wave 15-16 連報 3 次的覆寫消失 bug。
- **無 cleanup UX (out of scope)** — 「user 想刪某個 label」目前要靠刪整個 program 才會 CASCADE 清掉；若日後需要 per-label delete 入口，再開新 ADR 補 `deleteProgramSubTag(db, pid, sub_tag)` repo helper + UI 入口（不在本 ADR 範圍）。

## References

- **Wave 16 commit** `485e9bc` (2026-05-21) — v022 migration + `recordProgramSubTag` / `listProgramSubTags` helper + 3 write path 接線 + picker UI union 讀取
- **Source code** —
  - `src/db/schema/v022_program_sub_tag.ts` (78 行，含 backfill 兩段)
  - `src/adapters/sqlite/programRepository.ts:310-343` (`recordProgramSubTag` + `listProgramSubTags`)
  - `src/adapters/sqlite/programRepository.ts:395` (`upsertCell` 接線)
  - `src/adapters/sqlite/programRepository.ts:494` (`applyTemplateToColumn::sub_tag_override` 分支接線)
  - `src/adapters/sqlite/programRepository.ts:540` (`applyTagToRow` 接線)
- **Tests** —
  - `tests/db/v022ProgramSubTag.test.ts` (7 case — forward / backfill / idempotency / CASCADE / runner integration)
  - `tests/db/recordProgramSubTag.test.ts` (5 case — null/empty guard + idempotency + clock injection)
  - `tests/db/listProgramSubTags.test.ts` (3 case — empty / 排序 / cross-program isolation)
  - `tests/db/programApply.test.ts` (extended — `sub_tag_override` 3 case + `applyTagToRow` all-rest dict side-effect 1 case)
- **Related ADRs** —
  - ADR-0003 §「強度」(原副標籤) 概念 — 三元組 identity 仍 anchor，本 ADR 把 label 集合本身升 entity
  - ADR-0004 § Cycle-based grid — wave 15-17 編輯模式 ▶ apply 場景是本 ADR motivation
  - ADR-0022 (proposed) Programs tab grid-on-tab UX — write path 在那條 UI flow 上下文 ship
