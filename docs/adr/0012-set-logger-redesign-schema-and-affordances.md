# 0012 — Set logger UI redesign：schema model 重寫 + 全 gesture-driven affordance + dropset cluster

Set logger（in-session 編組頁）從原先「⋯ menu 驅動 + 二態 row + flat dropset」全面重寫為：(1) **schema model**：單組 `reps/weight` 欄位（不分 planned vs actual）+ `set_kind` enum（warmup/working/dropset）+ `is_logged` 兩態 + dropset cluster B3 (parent_set_id 連結)；(2) **affordance**：per-row 5 gesture + per-cluster 3 gesture，全砍 ⋯ icon、全 gesture-driven；(3) **計算規則**：row 級 reactive 分母 + filter-based 分子分母分離，chip 範圍恆 0-100%。底層哲學 anchor：**「Session 在運動中編輯，要快速、即時」**——所有摩擦（二次確認、多 tap、autosave 之外的明示存檔）一律消除。

本 ADR 整併 Q15.1–Q15.5b 六輪 grill 拍板（CONTEXT.md L487–609）；對 ADR-0007 (load_type) / ADR-0009 (PR bucket + 容量) / 既有 slice 4 (saveBackDiff) / slice 8 (PR engine + volumeEngine + e1RM) 都有引擎過濾條件或聚合單位變動，本 ADR 一併固化。

## 設計哲學 anchor

**「Session 在運動中編輯，要快速、即時」**——這是所有 set logger 設計子題的最終裁判：

- 任何二次確認 → 砍（左滑刪除無確認、✓ toggle 無 menu）
- 任何 modal / sheet → 砍（inline edit 取代）
- 任何冗餘狀態 → 砍（is_skipped ⊘ 跳過態剔除，要撤銷直接刪 row）
- 任何視覺降噪未盡之處 → 砍（per-row ⋯ icon 全拿掉）
- 動作記憶 / 預建 row / 分母 reactive 都對齊「user 一進 session 就看到 N 組空格等填」的 reference UI flow

例外只有一個：**inline edit 過程中**鍵盤要把編輯 row scroll 到上半屏避免被軟鍵盤蓋住（KeyboardAvoidingView，技術需求不是 UX 摩擦）。

## Schema model（最關鍵）

set 表只有**一組** `reps INTEGER` + `weight REAL` 欄位。**不分 planned vs actual**。

預建 `◯` row 時欄位填 Template snapshot / 動作記憶 / fallback 值；user inline edit 改的就是同一組欄位。沒有「planned 欄位 vs actual 欄位」的雙軌——之前 Q15.2 / Q15.4 草拍寫的 `planned_reps × planned_weight` 是 sloppy notation，跟實際 schema 不符。

```sql
-- v008 累加變動
ALTER TABLE set ADD COLUMN set_kind TEXT
  CHECK (set_kind IN ('warmup','working','dropset'))
  NOT NULL DEFAULT 'working';
ALTER TABLE set ADD COLUMN is_logged BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE set ADD COLUMN notes TEXT NULL;
ALTER TABLE set ADD COLUMN position INTEGER NOT NULL;  -- migration 依 created_at 補值
ALTER TABLE set ADD COLUMN parent_set_id TEXT NULL
  REFERENCES set(id) ON DELETE CASCADE;

-- 既有 set.is_warmup BOOLEAN deprecate（資料 migrate 到 set_kind）
-- 既有 set.is_skipped 若有則 deprecate（v008 不再 reference）
```

「為何 chip 永遠不會超 100%」：分子和分母**同欄位 + 過濾條件 superset**：

- 分母 = `Σ (reps × weight) WHERE set_kind != 'warmup'`（row 上當下值，**不過濾 is_logged**）
- 分子 = `Σ (reps × weight) WHERE is_logged=T AND set_kind != 'warmup'`

分子的過濾條件嚴格 superset 分母 → 分子 ≤ 分母恆成立 → chip 範圍恆 0-100%。inline edit 動數字時，user 改的同時動分子（若 logged）+ 分母（永遠動），同步前進，分子永不超過分母。**這是 reactive 分母，不是 Template snapshot 凍結值。**

## Per-row affordance map（5 gesture，無 ⋯ icon）

Row 結構（從左到右）：

```
[熱 / #N / D#]   reps   weight   📝(備註預覽)   ★(破PR)   ✓
```

| Gesture | 行為 | 對應 schema 動作 |
|---|---|---|
| **tap label** | cycle 單向：熱 → #N → D# → 熱（3 tap 回原態）；切完整列編號 derived 重算 | UPDATE set_kind |
| **tap ✓** | toggle `is_logged`（一鍵翻 ✓↔空白，無 menu 無確認） | UPDATE is_logged |
| **右滑** | 出現 [新增] + [📝 備註] 兩 button | 新增 = 在當前 row 後 INSERT 新 row（planned 從當前 row 複製）；備註 = 編 set.notes |
| **左滑** | 出現 [刪除] 紅 button，點即 DELETE，**無二次確認** | DELETE row |
| **長按** | 進 drag-reorder mode | UPDATE position |

「📝 (備註預覽)」存在 `set.notes` 才顯，row 下方一行 inline 淡灰小字。「★」破 PR row（slice 8 PR engine 偵測），多重 PR 顯示細節（一顆 vs 多顆 / 顏色分桶）leftover 不在本 ADR 範圍。✓ 在最右（高頻 + 大拇指 reach）。

**inline edit**：tap reps / weight 方格 → 方格變可編輯狀態（outline / 變色）+ 鍵盤滑上來；Done 直接寫回，方格收回非編輯狀態；已 ✓ 的 set 改數字時 ✓ 維持（語意 = 「✓ = 這組存在 / 完成」，修正 typo / 微調非反悔）。

## Dropset cluster B3（parent_set_id 連結）

Dropset 重新建模為 **cluster**（多 step 單一 set，step 間無休息），不是 individual rows。Schema 走 B3 路徑：`parent_set_id TEXT NULL REFERENCES set(id) ON DELETE CASCADE`。

- **cluster 首 step**：`parent_set_id=NULL` + `set_kind='dropset'` + 有 D# label + ✓ button
- **後續 step**：`parent_set_id=<root.id>` + `set_kind='dropset'` + 無 label，行為純 button-driven
- **後續 step 右側 button**：中間 step 顯 `[−]`（刪該 step）/ 最末 step 顯 `[− +]`（− 刪該 step / + append next step）
- **cluster 內 step 不接受 gesture**：左滑 / 右滑 / 長按 對 cluster 內 step 失效，避免跟 row 級語意衝突
- **`is_logged` 只在 cluster 首 step 有意義**：cluster 完成狀態 = `root.is_logged`
- **SQL 聚合**：`GROUP BY COALESCE(parent_set_id, id)` 取得 cluster grouping

### Cluster 首 step 三 gesture（cluster 級）

> **2026-05-16 ADR-0019 Q5 amendment**：cluster row 加 ⚙️ menu 6 槽 (3 主項 + 2 history shortcut + 1 utility)。詳見 ADR-0019 § Q5 (b)。

| Gesture | 行為 |
|---|---|
| **左滑** | [刪除整 cluster] 紅 button：一鍵砍首 step + 所有 children（DELETE CASCADE）；**無二次確認** |
| **長按** | 整 cluster 浮起拖移，children 跟 root 一起移動；cluster 是 reorder 單位（parent_set_id 不變、只 position 重編） |
| **右滑** | [新增] + [📝 備註] 兩 button：新增 = 在當前 cluster 後 append **新 cluster**（D# derived；planned 從當前 cluster 首 step 複製）；備註 = 編 `root.notes`（cluster 級備註存 root row） |

子 step 雖 schema 允許 `notes` 但 UI 不暴露編輯入口（dead field for cluster steps；保留欄位是為了將來「per-step 備註」如果決定打開不用 schema migration）。

## 計算規則矩陣（warmup / working / dropset cluster）

| 規則 | warmup | working | dropset cluster |
|---|---|---|---|
| 容量（slice 8 volumeEngine） | ✗ | ✓ | ✓ (cluster ✓ → Σ all steps) |
| 分母 A1 chip | ✗ | ✓ | ✓ (Σ planned all steps) |
| 分子 A1 chip | ✗ | ✓ (is_logged=T) | ✓ (cluster is_logged=T → Σ all steps) |
| PR engine（slice 8） | ✗ | ✓ | ✗ (整 cluster 跳過) |
| e1RM 顯示 | ✗ | (動作歷史 modal 才顯) | ✗ |

關鍵：**整 cluster 跳過 PR engine**——dropset 的 backoff step weight 不算 PR；訓練學語意是「同一組」而非多個 working set。

## 編號規則

- **row 1**（若有熱身）= 熱身（顯「熱」徽章不顯數字）
- **working rows** 從 1 起獨立編號（1/2/3/4...），跳過 dropset cluster
- **dropset rows** 顯 D1 / D2 / D3...，獨立編號（不跟 working 連號）

切換 label（tap label cycle）後整列編號 derived 重算。

## C3.2 Freestyle 加動作預建 row（α 路徑）

Freestyle 場景：(i) Today 直接 Start Session 沒選 Template / (ii) Template-based session 中底部 ➕「加動作」plan 外加。

加動作後**立刻**依 Q15.3 動作記憶 / fallback batch insert `(warmup_set_count + working_set_count)` 組 `◯` row：

- 有動作記憶（臥推 1+4×10@60）→ 預建 5 row
- 首次接觸 fallback `(warmup=1, working=1, reps=10, weight=0)` → 預建 2 row
- 徒手動作 fallback `(warmup=0, working=1)` → 預建 1 row（ADR-0007 load_type='bodyweight' 預設）

跟 Template-based session 預建邏輯**同 code path**（Q15.2 既拍）——freestyle 不另開分支。

### Freestyle chip 首次接觸 → α (顯 0/0)

因分母 reactive 規則，首次接觸 fallback `(reps=10, weight=0)` 的 `0/0` 只在 add exercise → user 動 planned 前的瞬態存在；user 一動 planned（例如 inline edit weight=12.5）立刻變 `0/125` → 正常。**這個瞬態可接受**，比「分母=0 隱藏 chip → 動 planned 後 chip 突現」的視覺跳動更平穩。

## F 歷史頁查看舊 Session chip（α 路徑：顯示）

chip 在 session ended 後仍顯示，分子 / 分母用 immutable 狀態算（row 上當下 reps/weight）。

- **用途**：訓練復盤（看哪些 session 沒做完）+ 跨 session 進步對比
- **適用面**：slice 9 歷史 sub-tab → session detail view + slice 8 動作歷史 modal（cluster 內 step 仍 fold under root）
- **format 同 session 進行中**：`已完成 / 計劃` 容量（例 `2400.5/3080.0`）

## G 視覺細節

| 子題 | 拍板 | 細節 |
|---|---|---|
| G.1 進度條 | **β（文字 + bar）** | chip 數字 `0.0/3080.0` 下方一條**系統主色細 bar** 填充 0-100%；**不顯百分比數字**（chip 數字已能心算 78%）；bar 純色不 by set_kind 著色 |
| G.2 超 100% | **N/A** | schema model 下分子 ≤ 分母恆成立，chip 範圍恆 0-100%；**無「超 100% 視覺處理」需求** |
| G.3 數字精度 | **α（統一 1 位小數）** | `0.0/3080.0`、`2400.5/3080.0`；對齊 reference UI 風格 + inline edit reactive 變動平滑（避免「0 位 ↔ 1 位」視覺跳動） |

## per-exercise card 結構

- **頂部右上**：容量目標 chip `已完成 / 計劃`（A1 案，純存在於 per-exercise card；session 頂層**無 chip / 無 stats / 無 AI**）（**2026-05-16 Q6 修訂**：in-session 加 4-tile/5-tile stats panel（3-tile 非 Watch / 5-tile Watch-tracked）；「無 chip / 無 AI」維持。見 ADR-0019 § Q6）
- **動作圖正下方、第一 set 上方**：per-exercise 備註欄，placeholder「點擊輸入備註」（持久化機制 = backlog #5，待 grill）
- **set rows**：依 position ASC
- **card 底部 action 列**：`新增一組` + `動作歷史`（slice 8 既有 modal）
- **list view 卡片下方圓點**：總 set 數 = warmup + working（含熱身計入「5 組」）；圓點視覺後續決定（已 ✓ → 實心）

## session 底部 bar

只剩 `加動作` ➕（plan 外加新動作）。原 reference UI 上的 stats / 容量 / AI 按鈕全砍。

## Schema 影響總覽

| 變更 | 表 | 影響 |
|---|---|---|
| 新增欄位 | `set.set_kind TEXT NOT NULL DEFAULT 'working'` | 取代 `is_warmup BOOLEAN`；CHECK in (warmup, working, dropset) |
| 新增欄位 | `set.is_logged BOOLEAN NOT NULL DEFAULT 0` | 兩態 row（◯ / ✓） |
| 新增欄位 | `set.notes TEXT NULL` | per-set 備註（cluster 級存 root row） |
| 新增欄位 | `set.position INTEGER NOT NULL` | 顯式排序；migration 依 created_at 補值 |
| 新增欄位 | `set.parent_set_id TEXT NULL REFERENCES set(id) ON DELETE CASCADE` | dropset cluster B3 連結 |
| Deprecate | `set.is_warmup BOOLEAN` | 既有資料 migrate 到 set_kind；引擎 code 路徑切換 |
| Deprecate | `set.is_skipped`（若 v00x 已建） | v008 不再 reference；引擎過濾條件移除 |
| 新增 | （Q15.3 既拍）`template_exercise.warmup_set_count INTEGER NOT NULL DEFAULT 1` | 預建熱身 row 數 |
| RENAME | `template_exercise.planned_sets` → `working_set_count INTEGER NOT NULL` | 語意明確化 |
| 新增 | `template_exercise.updated_at INTEGER NOT NULL` | 動作記憶 derive 用（unix ms） |

## 影響的既有 slice / 引擎

| 模組 | 變動 |
|---|---|
| **slice 8 PR engine** | 過濾條件 `is_warmup=T` → `set_kind != 'working'`（同時排 warmup + dropset） |
| **slice 8 volumeEngine** | 過濾條件 `is_warmup=T` 排除 → `set_kind = 'warmup'` 排除（working + dropset 算容量） |
| **slice 8 動作歷史 modal** | cluster 渲染要 `GROUP BY parent_set_id`，UI 把 cluster step folded under root；e1RM 趨勢圖跳過 dropset cluster |
| **slice 4 saveBackDiff** | cluster aggregate 計算改成 **cluster 級**（不是 step 級）；diff 偵測對 cluster root 比對 |
| **slice 3 templateManager** | `TemplateExerciseSpec` 更新 `planned_sets → working_set_count + warmup_set_count + updated_at` |

## 拒絕的替代方案

### 編輯流程

1. **Modal sheet 編 set**：每組多 2 tap + 動畫，set edit 沒 cancel/discard 語意，inline edit 直接寫回更自然
2. **點方格自動取消 ✓**：95% 是微調而非反悔，每次都重 tap 過勞
3. **取消 ✓ 要走 menu**：多 2 tap，運動中不可接受
4. **已 ✓ 取消要長按確認**：運動中長按摩擦過大

### Row 級 affordance

5. **⋯ menu 驅動破壞性動作**（Q15.1 原案）：視覺噪訊 + 額外 tap；全 gesture-driven 取代
6. **刪除按鈕直接出在 row 上**：誤觸風險；左滑後出現 button 仍要刻意水平滑才見，平衡 affordance + 安全
7. **刪除前彈窗確認**：「再次操作確認」就是運動中最不想要的摩擦
8. **⋯ menu 切熱身/正式**（Q15.3 原案）：tap label cycle 單向三態取代

### Row 兩態 vs 三態

9. **A 二態（無 is_logged）**：失去「未完成佔位」狀態，進度 chip 0/4 沒法算
10. **B-2 lazy 建 row**：reference UI 強烈暗示預建，inline edit 第 2 組要先 +新增 多一步
11. **C 無 is_logged（reps/weight NULL 雙用）**：「未建」vs「已跳過」語義重疊
12. **三態 ⊘ 跳過保留**（Q15.2 原案）：保留 row 標記 audit trail 摩擦過大，要撤就直接刪

### Dropset 結構

13. **Path A: dropset 用 individual D# rows**：訓練學語意錯（dropset 是「同一組多 step」），破壞 PR engine 邏輯
14. **B1: 另開 set_step table**：schema 變動大，1:N 關係過度建模
15. **B2: JSON column 存 steps**：SQLite JSON1 雖可用但破壞「set 表是 set 真實事實」的 invariant
16. **B3 cluster 但允許 cluster 內 step 接受 gesture**：跟 row 級語意衝突（誰是 reorder 單位、刪除粒度模糊）

### Cluster 級 affordance

17. **左滑只刪首 step**：children parent_set_id dangling 不可行
18. **長按只移首 step**：schema 衝突（cluster 是不可拆分單位）
19. **右滑新增 step**：重複現有 cluster 內 `[+]` button
20. **不可長按 cluster**：失去 reorder 入口
21. **右滑隱藏新增**：user 無法 append 新 cluster

### 容量 chip 設計

22. **A2: Live Template chip**：chip 跟 row 來源不一致
23. **A3: 每次手填 chip 目標**：多餘摩擦
24. **A4: 歷史推目標**：跟 Template planned 衝突，類設置遞增規則 Q15 已剔除
25. **session 頂層 chip**：reference UI 明確叉掉（**2026-05-16 Q6 修訂**：「chip / AI」維持叉掉；但 4-tile/5-tile **stats panel**（容量 / 動作數 / 訓練時間 ± 心率 / 大卡）翻盤為加入。stats panel ≠ chip — 後者是嚴格目標進度，前者是 session-level aggregate。見 ADR-0019 § Q6 + 本文末 amendment）
26. **新增一組 planned=NULL**（A1.a-β）：chip 可超 100% 顯示 `4080/3080` 不直觀
27. **新增一組純 bonus**（A1.a-γ）：分子分母都不動，違反「新增一組就是計劃延伸」的直覺

### Freestyle

28. **C3.2-β Lazy 建 row**：多 tap + code path 分叉 + 分母 0/0 場景擴大
29. **C3.2-γ 混合（記憶帶 warmup + 1 working）**：無強理由折衷
30. **C3.1-β 分母=0 隱藏 chip**：動 planned 後 chip 突現的視覺跳動
31. **C3.1-γ 純累積（無分母）**：freestyle 不再「無目標」，此案 N/A

### 歷史頁 chip

32. **F-β 隱藏舊 session chip**：失去完成度資訊 + UI 不一致
33. **F-γ 只顯 actual 無分母**：失去計劃對比

### 視覺

34. **G.1 純 bar 無數字**：失去精確值；reference UI 數字優先
35. **G.1 純百分比**：心算門檻不必要（chip 數字已能算）
36. **G.1 bar 按 set_kind 著色**：噪訊（warmup 已排除、dropset 已併入 working 桶，無需區分）
37. **G.3 0 位小數**：inline edit reactive 變動會有「0 位 ↔ 1 位」視覺跳動

### 競品 reference UI 剔除清單

（2026-05-11 圖中紅 X 標註）⋯ icon / + − 加減重量按鈕 / 「記錄左右」toggle / 「每組計時」toggle / 「喵喵 AI」按鈕 / cluster 內 step 的「遞 N」label

## v1 ship 時程影響

26 週時程**不變**：

- v008 migration（set 表 5 欄位加減）= 1 天
- set logger redesign 主結構 reimplement = 3 週（per-row 5 gesture + cluster 3 gesture + label cycle + inline edit + ✓ toggle）
- PR engine / volumeEngine / saveBackDiff 過濾條件 + cluster aggregate 改寫 = 1 週（含測試）
- 動作歷史 modal cluster fold UI = 0.5 週
- chip + bar 視覺 = 0.5 週

共 ~5 週工作量，落在原 slice 10+ 範圍內；slice 11–15 (Watch / HealthKit / iCloud Backup) 不受影響。

---

## 2026-05-16 Amendment — in-session stats panel 翻盤 (ADR-0019 § Q6)

Session UI/UX integral redesign grill 拍板把「session 頂層**無 stats**」這條 retract — in-session 加回 stats panel，但仍維持「無 chip / 無 AI」原意。

### 翻盤的既有拍板

- ❌ **§ per-exercise card 結構（line 142）「session 頂層無 chip / 無 stats / 無 AI」中的「無 stats」部分** retract
- ❌ **§ session 底部 bar（line 150）「原 reference UI 上的 stats / 容量 / AI 按鈕全砍」中的 stats 部分** retract（chip / 容量 / AI 仍砍；只翻 stats panel）

### 新模型 — in-session stats panel

- **位置 P1**：timer header 正下方、動作卡列表正上方（跟 ADR-0014 歷史詳情頁同位置）
- **非 Watch-tracked session** = **3-tile 1 row**（容量 / 動作數 / 訓練時間）
- **Watch-tracked session** = **5-tile 2 row**：
  - Row 1: 容量 / 動作數 / 訓練時間
  - Row 2: 心率（當前 BPM 大字 + Z1-Z5 區間 color border）/ 大卡
- **歷史詳情頁** 維持 ADR-0014 既拍 4-tile + 心率 vs 時間折線圖（in-session 跟歷史頁 layout **內容不對稱**——歷史頁有獨立 chart）

### 不動

- **「無 chip / 無 AI」維持** — chip / 容量 / 喵喵 AI 仍不引回 session 頂層
- **per-exercise card 內** 的 chip + bar（A1 chip 0.0/3080.0 + 系統主色細 bar）維持 ADR-0012 G.1 既設計
- **session 底部 bar** 仍只剩 `[⊕ 加動作]`

詳細決策邏輯與拒絕的替代方案見 ADR-0019 § Q6。
