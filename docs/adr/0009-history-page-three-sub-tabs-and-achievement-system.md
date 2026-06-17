# 0009 — 歷史頁三 sub-tab + 成就系統 + 統計頁

歷史頁從單一視圖升級為**三 sub-tab 結構**：「歷史」（既有 Session list）、「統計」（人體圖 + 容量 + 時長）、「獎章」（成就系統）。同時鎖定 PR bucket 命名修正、運動時長資料來源、人體圖顏色規則、成就系統 schema 與引擎邏輯。

## PR bucket 命名修正

舊 v1 命名：`1-3 純力量 / 4-6 力量 / 7-10 增肌 / 11-15 增肌耐力 / 16+ 純耐力`

新 v1 命名：

| reps | 名稱 | 訓練科學意義 |
|---|---|---|
| 1-3 | **最大力量** | 神經力量主導 |
| 4-6 | **力量** | 力量 + 些許增肌 crossover |
| 7-10 | **增肌** | 純增肌效果最大化 |
| 11-15 | **肌耐力** | 局部肌肉抗疲勞（仍有增肌殘餘） |
| 16+ | **耐力** | 偏代謝 / 心肺耐力 |

理由：「純力量 / 純耐力」中的「純」字奇怪不直覺；「增肌耐力」實為「增肌 + 耐力 crossover zone」但使用者直問詞義 = 命名失敗（好命名不用解釋）。新命名 5 個都自我解釋、語意梯度自然（力量光譜 → 中間 → 耐力光譜）、移除「純」字。

「肌耐力」（局部肌肉抗疲勞）vs「耐力」（全身代謝耐力）刻意區分以保 5 桶各自獨立語意。

bucket schema 影響 = 0（CONTEXT.md 一行字改、`bucket_constants` 表的 display_name 欄位值改 5 行）。

## 歷史頁三 sub-tab 結構

| sub-tab | 內容 | 來源 |
|---|---|---|
| **歷史** | 既有 Session list（按日期倒序） | ADR-0006 / Q6.3 |
| **統計** | 訓練部位概況（人體圖）+ 各部位容量 + 運動時長；頂部時間選擇器（年/月/日/自選） | 本 ADR |
| **獎章** | 已解鎖獎章 grid + 未解鎖灰階預告 + 進度條 | 本 ADR |

進入路徑沿用既有歷史 tab；sub-tab 切換以頂部 segmented control 呈現。

## 統計頁設計

### 時間選擇器

頂部 segmented control：`[年] [月] [日] [自選]`。**自選**展開 date range picker。所有統計區段的數值依當前選擇期間動態重算。

### 訓練部位概況（人體部位圖）

**指標 = per-Session 次數**（不是容量）。理由：容量會讓腿 / 背天然壓垮所有部位（深蹲 100×5 = 500 vs 彎舉 15×12 = 180），無法回答「balance check」這個本意問題。

**計算規則**：
- Session 內若有任何一個 Exercise 屬於 MG_X，且至少 1 set `is_done = true` → 該 Session 對 MG_X 計 +1
- 期間總計 = `COUNT(DISTINCT session_id) WHERE mg_id = MG_X AND date ∈ range`
- 11 個 MG 各自有獨立計數

**顏色規則**（冷熱色 gradient）：
- 期間內 11 MG 次數分布算 **5 階分位數**（Q20 / Q40 / Q60 / Q80 / Q100）
- 0 次 = 灰
- Q1 (最低 20%) = 冷藍
- Q2 / Q3 = 中藍綠 / 黃綠
- Q4 / Q5 (最高 20%) = 暖橙 / 暖紅
- 互動：tap MG path → highlight + 顯示「胸 · 5 次」氣泡

**實作策略**：
- v1 自畫 SVG（前後身兩張，11 個 MG path 各自獨立 fill 屬性）
- 不引入 lib（react-native 部位圖 lib 多半醜或半棄維護）
- v1 男女不分（neutral / male body asset 即可）
- v1.5+ 加性別切換 + 動畫過渡（tap MG path 時 ripple）

### 各部位容量

底部加段落：each MG → 期間內容量加總（`SUM(capacity_of_set) GROUP BY mg_id`）。

容量公式沿用 ADR-0007 load_type 三類非對稱規則：
- A. loaded: `weight × reps`
- B. bodyweight: `weight × reps`
- C. assisted: `(bw_snapshot − weight) × reps`

排序 desc，旁邊顯示 bar chart（max width = 該期間最高容量 MG）。

### 運動時長

**資料來源優先序**：
1. **iPhone 自家** `session.ended_at - session.started_at`（主來源）
2. **HKWorkout.duration**（fallback，當 self-tracked 異常或缺失時）

理由：started_at 在 in-session 創建 Session row 時寫入；ended_at 結束時寫入；皆在 iPhone SQLite 即時可用。HKWorkout 由 Watch 端寫，iPhone 不在範圍時 transferUserInfo cache 直到 reachable，可能延遲到帳，自家 schema 不能依賴。

**Schema 影響**：新增 `session.ended_at TIMESTAMP NULL`。in-session pause 不算結束（pause 期間仍累計時長）；`HKWorkoutSession.end()` 同步寫 ended_at。

**期間視圖**：總時長 + 平均單次時長 + 最長單次時長三個指標。

## 成就系統設計

### 範圍與類別

四類獎章，總計 **255 個 achievement_definition**：

| 類別 | 維度 | 階梯 | 數量 |
|---|---|---|---|
| **第一次 (部位, 訓練目的)** | 笛卡爾積：11 MG × 5 bucket | n/a (1 次性) | 55 |
| **各部位 N 次 PR** | 11 MG × 6 階段 × 2 PR 類型 | 等差 1, 10, 20, 30, 40, 50 | 132 |
| **各訓練目的 N 次 PR** | 5 bucket × 6 階段 × 2 PR 類型 | 等差 1, 10, 20, 30, 40, 50 | 60 |
| **N 次重訓**（全 app Session 計數） | 1 條 progression | 等比 1, 5, 10, 25, 50, 100, 250, 500 | 8 |

### 計數規則細節

**「第一次 (部位, 訓練目的)」**：
- 觸發條件 = Session 中至少 1 個 set `is_done = true`、且該 set 的 (MG, bucket) tuple 之前從未組合解鎖過
- 一個 Session 可解鎖多個（例如「胸日 / 8-10RM」做 3 個胸動作 + 2 個三頭動作 → 解鎖「胸 + 增肌」、「三頭 + 增肌」兩個）
- bucket 由 set 的 reps 推算（依 PR Engine 的 bucket lookup 規則）；warmup set 的 bucket 也算

**「各部位 / 各訓練目的 N 次 PR」**：
- 重量 PR 與容量 PR **分開計數**（一個 set 同時破雙 PR → 對該 MG / bucket 兩條 progression 各 +1）
- 純徒手 (weight=0) set 跳過 PR check（沿用 ADR-0006 規則）
- 維度獨立：同一個 PR 同時推進「該 MG 的 PR 計數」+「該 bucket 的 PR 計數」兩條（v1 兩維度互補設計，不笛卡爾積）

**「N 次重訓」**：
- 全 app Session 計數，不分 MG / bucket
- 條件 = Session 結束（ended_at 寫入）+ 至少 1 set `is_done = true`（純空 Session 不算）

### 觸發時機

**Session 結束 summary 計算時統一檢查**（不在 in-session 即時觸發）。

理由：
- in-session 即時觸發會打斷 set 之間的呼吸節奏
- Session 結束時批次計算允許跨 set 的累積（例：本 session 第 3 個重量 PR 才推進階段）
- Watch v1 結束 summary 卡片不顯示獎章（避免 Watch 端要 query achievement state；獎章 unlock 計算與顯示**只在 iPhone**）；使用者結束訓練後拿手機看歷史 / 獎章 sub-tab 會看到本次解鎖

### 觸發點 architecture

```
Session.end() (iPhone)
  → AchievementEngine.evaluate(session, current_unlocks)
      → returns [newly_unlocked: AchievementDefinition[]]
  → for each newly_unlocked:
      INSERT INTO achievement_unlock (achievement_definition_id, unlocked_at, session_id, set_id?)
  → Session summary UI: 顯示 "本次解鎖" 段
```

Watch 結束 session 時透過 `transferUserInfo` 把 session payload 推給 iPhone；iPhone 收到後寫 SQLite + 跑 AchievementEngine。

### Schema

```sql
CREATE TABLE achievement_definition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- 'first_chest_increase', 'pr_count_chest_weight_10', 'session_count_25'
  category TEXT NOT NULL,              -- 'first_combo' | 'pr_per_mg' | 'pr_per_bucket' | 'session_count'
  display_name TEXT NOT NULL,
  description TEXT,
  mg_id INTEGER,                       -- nullable; only for first_combo, pr_per_mg
  bucket_id INTEGER,                   -- nullable; only for first_combo, pr_per_bucket
  pr_type TEXT,                        -- nullable; 'weight' | 'volume' for pr_per_*
  threshold INTEGER,                   -- nullable; for pr_per_*, session_count
  tier INTEGER                         -- 1..N (within ladder), for sorting display
);

CREATE TABLE achievement_unlock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achievement_definition_id INTEGER NOT NULL UNIQUE REFERENCES achievement_definition(id),
  unlocked_at TIMESTAMP NOT NULL,
  session_id TEXT NOT NULL,            -- UUID, FK session(id)
  set_id TEXT                          -- UUID nullable; populated for PR achievements
);
```

`achievement_definition` v1 系統 seed 255 rows（在第一次 app 啟動 / DB migration 時寫入）；不允許使用者刪減；v1.5+ 評估「自訂獎章」（不在 v1 範疇）。

`achievement_unlock` 主鍵用 INTEGER autoincrement（純 iPhone 端寫，Watch 不寫，不需 UUID）。

### 獎章頁 UI

- **Grid layout**：解鎖中 = 全彩 icon + 名稱 + 解鎖日期；未解鎖 = 灰階 icon + 進度條（例「胸 / 重量 PR 7 / 10」）
- **分類 tab**（第二層）：`[全部] [部位] [訓練目的] [里程碑]`
- **icon design**：v1 用 SF Symbols + 部位 / 訓練目的代表色（例：胸 = 紅、腿 = 黃、最大力量 = 鐵灰、耐力 = 藍綠等）；v1.5+ 評估自訂插畫
- **空狀態**：「完成第 1 次訓練後就會解鎖第一個獎章」

### Engine 邏輯

**Achievement Engine 是純 logic 模組**（無 IO，輸入 = (Session, current_unlocks, all_definitions)，輸出 = [newly_unlocked]）。詳細測試對應 PRD module #9。

```
function evaluate(session, current_unlocks, defs):
  newly = []
  
  # 1. first_combo
  for each (mg, bucket) tuple touched by session.sets where is_done = true:
    def = defs.find(category='first_combo', mg_id=mg, bucket_id=bucket)
    if def and def.id not in current_unlocks:
      newly.push(def, session.id, first_set_in_tuple.id)

  # 2. pr_per_mg
  for each PR triggered in session (per (set, type='weight'|'volume')):
    mg = set.exercise.mg
    cumulative_count = count_prs_through_now(mg=mg, type=type)
    for threshold in [1, 10, 20, 30, 40, 50]:
      def = defs.find(category='pr_per_mg', mg_id=mg, pr_type=type, threshold=threshold)
      if cumulative_count >= threshold and def.id not in current_unlocks:
        newly.push(def, session.id, set.id)

  # 3. pr_per_bucket — 同 #2 邏輯，分組 by bucket_id
  ...

  # 4. session_count
  total_sessions = count_sessions_through_now()
  for threshold in [1, 5, 10, 25, 50, 100, 250, 500]:
    def = defs.find(category='session_count', threshold=threshold)
    if total_sessions >= threshold and def.id not in current_unlocks:
      newly.push(def, session.id, NULL)

  return newly
```

## Schema 影響總覽

| 變更 | 表 | 影響 |
|---|---|---|
| 新增 | `achievement_definition` | 系統 seed 255 rows |
| 新增 | `achievement_unlock` | 使用者解鎖紀錄 |
| 新增欄位 | `session.ended_at TIMESTAMP NULL` | 運動時長計算 |
| 改值 | `bucket_constants.display_name` | 5 行 update |

## Module 影響

PRD 原本 8 個 pure domain logic modules → 升級為 **10 個**：

| # | 模組 | 新增 / 既有 | 接口形狀 |
|---|---|---|---|
| 9 | **Achievement Engine** | 新增 | `evaluate(session, current_unlocks, defs) → newly_unlocked[]` |
| 10 | **Stats Engine** | 新增 | `mgFrequencyOverPeriod(period)`、`mgCapacityOverPeriod(period)`、`durationStatsOverPeriod(period)`、`percentileBucketize(values, n=5)` |

兩個都走 PRD 既定方針：寫 unit test。

## 拒絕的替代方案

1. **人體圖用容量上色**：腿 / 背永遠最深，無法 balance check（user 一眼指出問題）。
2. **per-Set 或 per-Exercise 計數**：仍偏向腿 / 背等動作數天的部位；per-Session 的「練了 N 次胸」最對齊 balance check 的本意。
3. **獎章 schema 動態 derive**：解鎖時間 = first triggering event timestamp，但 derive 時拿不到精確時間戳；故事性（「2026-08-12 解鎖增肌新手」）會丟失。
4. **獎章 in-session 即時觸發**：打斷組間呼吸節奏；批次計算允許跨 set 的累積判定。
5. **Watch 端顯示獎章慶祝**：Watch 端要 query achievement state 增複雜度；Watch 17 條功能未列獎章慶祝。v1 接受「結束訓練後拿手機看」延遲。
6. **N 次 PR 笛卡爾積維度** (11×5 = 55 條 progression × 6 × 2 = 660 獎章)：總量爆炸；v1 兩維度獨立 (per MG + per bucket 互補) = 192 獎章已夠。
7. **N 次 PR 全 app 一條計數線**（v3, 12 獎章）：過於扁平、失去細節成就感；v1 維度獨立提供「練胸多」+「8-10RM 練得多」互補。
8. **獎章 v1 自訂編輯**：v1 系統 seed only；v1.5+ 評估。
9. **HKWorkout.duration 為主**：Watch 端寫、可能延遲到帳；自家 schema 不能依賴。
10. **訓記式階梯 (7/30/100/365)**：等比 (1/5/10/25/50/100/250/500) 前期密集鼓勵新手、後期維持稀缺感，更符合 12 個月以上的長期使用節奏。
11. **bucket 簡化命名 (C 案：力量 / 力量 / 增肌 / 增肌 / 耐力)**：5 桶映射 3 字眼、duplicate 強制 UI 用 reps disambiguate（「力量 (4-6)」），等於沒命名。
12. **bucket 訓記/Strong 命名 (B 案：神經力量 / 力量 / 增肌 / 增肌耐力 / 耐力)**：「神經力量」術語化；「增肌耐力」user 直問詞義 = 命名失敗。

## v1 ship 時程影響

26 週時程**不變**：
- 統計頁 / 獎章頁屬於歷史頁 sub-tab，不增主要 tab
- 人體圖 SVG asset = 1 週工作量（含設計 + 切 path）
- Achievement Engine 純 logic = 2 週（含測試）
- Stats Engine = 1 週（query 為主）
- bucket 改名 = 1 天
- `session.ended_at` schema 加欄位 = 0.5 天
- 共增 ~5 週工作量；v1 26 週原預留 polish buffer 可吸收

---

## 2026-05-13 amendment（ADR-0017 觸發 — 動作歷史頁 / 圖表頁 filter chip 改 rep bucket）

> **Terminology note (2026-05-16, ADR-0019 § Q9.2)**：本 amendment 內所有「Program 副標籤」/「副標籤」字眼 = UI label「**強度**」（schema 欄位名不動）。為保留 amendment trail 描述原寫錯字眼，本段不替換原字串；canonical 對照表見 CONTEXT.md § Terminology rename 對照表 + ADR-0003 amendment。

ADR-0017 Q14 grill 期間發現本 ADR 既訂「動作歷史頁 Filter chip 列 = Program 副標籤」是**寫錯**，應為 **rep bucket**（CONTEXT L269 同步寫錯）。

### 翻盤的既有拍板

- ❌ **動作歷史頁 Filter chip = Program 副標籤**（CONTEXT L269「toggle 收斂到單一副標籤」）— 撤銷
- ✅ **動作歷史頁 Filter chip = rep bucket**（5 桶：1-3 / 4-6 / 7-10 / 11-15 / 16+，per 本 ADR PR identity 段）

### 新規則

**動作歷史頁** + **動作詳情頁的圖表頁**（ADR-0017 新增）兩處共用同一 chip 設計：

- chip 列：`[全部] [1-3] [4-6] [7-10] [11-15] [16+]`（**或可顯示 bucket label 名「最大力量 / 力量 / 增肌 / 肌耐力 / 耐力」— UI label 待 spec**）
- 預設「全部」on
- toggle 後 filter set by reps count 落點

**圖表頁特殊規則**（per ADR-0017 Q14）：
- 容量線 / 最大重量線 → 受 chip filter
- **1RM 預測線 → 不受 chip filter**（跨 rep range 比對才有意義）

### 理由

- rep bucket 是 PR identity 維度，跟「跨 rep range 比對」mental model 對齊
- Program 副標籤是 user free-form text，作為 filter 維度 chip 列會動態變化（user 改副標籤名 → chip 名也變）— 不穩定
- rep bucket 5 桶固定、來自 set reps 直接推算、跟 Program 副標籤命名解耦

### 影響

- CONTEXT.md L269「toggle 收斂到單一副標籤」改「toggle 收斂到單一 rep bucket」
- 動作歷史頁實作（若已 ship）chip query 邏輯改 reps-based filter
- ADR-0017 圖表頁 inherit 本規則

---

## 2026-06-17 Amendment — 回溯 backfill 改 O(N) 單趟 + PR 成就 progressive 歸屬

> **觸發**：上架前效能/規模稽核（report 08）。`backfillAchievementsIfNeeded`（`src/adapters/sqlite/achievementRepository.ts`）原本**每個已結束 session 呼叫一次** `evaluateAndPersistAchievements`，而那支內部又 `loadReplayRecords`（掃全歷史 working set）+ `replayPRs`（全量重放）→ **O(sessions²)**（實測二次曲線、2000 場 ≈ 50s）。它掛在 `database-provider.tsx` 開機 await（`setDb` 前）→ N 大時整片 spinner 凍結。

### 嚴重度定位（誠實）

不是上架 blocker：backfill 由 `app_settings` 的 `achievements_backfilled_at` sentinel 把關，只在 sentinel 缺席時跑。新 App Store 用戶從 0 場起步 → sentinel 在「幾乎空」就寫入 → O(N²) 對乾淨新裝**永不觸發**；iCloud 整檔還原帶著 sentinel → 正常備份還原也 no-op。真正殘餘觸發 = sentinel 缺席 + 大量歷史（一次性升級成本、或還原 sentinel 之前的舊備份）。仍值得為上架做防禦性硬化。

### D1 — 全歷史 load + replay 只跑一次（O(N)）

`loadReplayRecords` + `replayPRs` 移到 session 迴圈**外**，只執行一次；迴圈內逐 session 重用快取的 `replay.flagsBySetId`，並維護一個 session-by-session 推進的 running PR 累計，逐場呼 `evaluate()`。複雜度 O(N²) → O(sets + N·defs)。`evaluate()` / `replayPRs` / `insertUnlocks` 引擎**完全不動**（只改 backfill caller）。

**保留 boot await（不 de-block）**：重寫後 await <200ms 無感；保留 await 讓成就在首畫面前就緒（無 pop-in），且避免「只 de-block 不改演算法」會把 50s O(N²) 丟到背景與使用者搶 DB。

### D2 — PR 類成就 progressive 歸屬（grill Q2-B）

舊迴圈餵每個 session **最終**全歷史累計，所以 `pr_per_mg` / `pr_per_bucket` 成就的 `unlocked_at` 被壓縮到**第一個破 PR 的 session**、而非累計真正跨過門檻那場。改為逐場推進 running 累計後，這類成就落在**跨門檻那場**（歷史時間線更準）。

- **解鎖集合不變**：累計單調 → 解鎖 ⇔ 最終累計 ≥ 門檻，與舊迴圈完全相同；只有時間戳變準。
- 僅影響 backfill 那一次（live 逐場評估本就用「到當下」累計、歸屬正確）。

### D3 — `session_count` 刻意維持 final-count（**非** progressive；warmup-only 守門）

`session_count` 階梯仍餵**最終** `countLoggedSessions` 總數（不 progressive）。原因：`evaluate()` 的 session_count 分支以「本場有 logged **working** set」（`hasLogged`）把關，但 `countLoggedSessions` 連**只記熱身組的 session** 也算（謂詞無 `set_kind` 過濾），而 `loadReplayRecords` 只含 working set → 這類 session 在此處 evalSets 為空。若 session_count 改 progressive，門檻可能在一個 `evaluate()` 會 skip 的 warmup-only session 上跨過 → **漏一個舊迴圈會產生的解鎖**。餵最終總數則完全保留舊迴圈的集合與歸屬（第一個 working-set session）。

### D4 — v027 index（perf P2、同批 ship）

`CREATE INDEX idx_session_exercise_parent ON session_exercise(parent_id)`（`src/db/schema/v027_session_exercise_parent_index.ts`）。覆蓋 `exerciseHistoryRepository.ts` ~9 處 `WHERE se2.parent_id = se.id` cluster 相關子查詢的 `SCAN session_exercise`。純加 index、`IF NOT EXISTS` 冪等、無行為變更。

### 影響

- `src/adapters/sqlite/achievementRepository.ts`：`backfillAchievementsIfNeeded` 重寫（O(N) + progressive PR 累計 + final session_count）。
- `src/db/schema/v027_*` + `src/db/migrate.ts`：新 migration（user_version 26→27）。
- 測試：`achievementBackfill.test.ts` +2（progressive 歸屬 / session_count final-count 守門）、`migrateChain.test.ts` 更新 26→27 + v027 index 存在性 + 冪等。
- **行為相容**：所有 backfill 成就**集合**與舊版逐 byte 相同；只有 PR 類成就 `unlocked_at` 變準。

## 翻盤 ledger（greppable）

| 日期 | 翻盤項 | 原拍板 | 新拍板 | 觸發 | 關聯 commit |
|---|---|---|---|---|---|
| 2026-06-17 | backfill 複雜度 | 每 session 重放全歷史（O(N²)、boot await 凍結） | 全歷史 load+replay 只 1 次（O(N)、保留 await） | perf 稽核 report 08 + grill Q1 | 見本分支 perf(achievements) commit |
| 2026-06-17 | PR 類成就 backfill 歸屬 | 餵最終累計 → unlocked_at 壓縮到第一個破 PR 場 | 逐場 progressive 累計 → 落在跨門檻場 | grill Q2-B | 同上 |
| 2026-06-17 | session_count backfill 歸屬 | （grill Q2-B 原議「也 progressive」） | 維持 final-count（避免 warmup-only 漏解鎖） | 實作期發現 warmup-only SET-drop 風險 | 同上 |

