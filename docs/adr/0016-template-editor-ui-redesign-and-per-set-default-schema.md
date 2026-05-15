# 0016 — Template 編輯流程 UI redesign + per-set 預設值 schema

Template 編輯頁從既有 PRD story #18「分區 + 動作右上設為常設按鈕 + Set ordering」基本架構 redesign 為**三段式 layout**：top metadata header (含 Template name / Program / 副標 / 模版配色) + 中間動作列表 (collapsed/expanded 卡 + per-exercise ⚙ menu) + 底部 **4-action bar** ([+ 新增動作] [↕ 移動動作] [配色] [⋯ 更多])。模版配色透過 bottom sheet 12-color iOS palette grid 選擇（跟 ADR-0015 per Template name 顏色 group-wide write 一致）。

引入新 `template_set` 表（per-template_exercise per-set 預設值），動作記憶 read pattern 從「summary 4 值」改為「per-set list」。Template 編輯走**「儲存/取消」雙 button** 顯式 commit pattern（跟 set logger / notes / session.title 的「即時 UPDATE」哲學分流，因為 Template 性質是 plan 而非 audit log）。

本 ADR 整併 Q11.1–Q11.9 全鎖定（CONTEXT.md Q11 close-out 段），並 close Q10 deflationary 決策（訓練類型 label = Template name 本身，不另立 system）。對 ADR-0012 動作記憶 read pattern 一處微 amendment（從 summary 改 list）。

## 設計哲學 anchor

**「Template 是計劃、Session 是事件 — 兩種編輯哲學不同」**：
- **Session in-progress 編輯**（ADR-0012/0013/0014）：「即時 UPDATE 無 draft」— 因為這是「實際發生」audit log，不可 undo
- **Template 編輯**（本 ADR）：「儲存/取消雙 button」— 因為 Template 是「規劃下次做什麼」plan，可反覆試錯

兩個哲學分流不是 inconsistency，而是反映 entity 性質根本不同。Template 編輯走 iOS 系統 form pattern（設定編輯、聯絡人編輯、行事曆事件編輯都是儲存/取消雙態），跟使用者既有心智模型對齊。

## 整體 Layout（Q11.1-A 三段式）

```
┌──────────────────────────────────────┐
│ [取消]    Template name        [儲存] │  ← top: 取消 (left) + 儲存 (right, disabled when no changes)
│           Program · 副標 · ●色         │     模版配色 indicator + tap inline 編輯 metadata
├──────────────────────────────────────┤
│  ─── 一般動作 ────────────────────── │  ← Section header (Q11.8-a)
│  ┌────────────────────────────────┐ │
│  │ 動作卡 1 (collapsed)            │ │  ← 中間: scrollable 動作列表
│  │ 動作卡 2 (expanded)             │ │     (Q11.3 collapsed/expanded multi-allowed)
│  │   熱  10 reps · 60 kg            │ │
│  │   工1  8 reps · 80 kg             │ │
│  │   工2  6 reps · 85 kg             │ │  ← per-set 獨立可不同 (Q11.9-β)
│  │   工3  4 reps · 90 kg             │ │
│  └────────────────────────────────┘ │
│  ─── 常設動作 ────────────────────── │  ← Section header
│  ┌────────────────────────────────┐ │
│  │ 動作卡 3 (collapsed)            │ │
│  └────────────────────────────────┘ │
├──────────────────────────────────────┤
│ [+ 新增動作] [↕ 移動] [配色] [⋯]      │  ← 底部: 4-action bar (Q11.2-X)
└──────────────────────────────────────┘
```

### Top metadata header

- left: 「取消」button (有 changes 跳 confirm dialog「捨棄變更？」)
- center: Template name (tap → inline 編輯 name / Program / 副標)
- right: 「儲存」button (disabled when no changes)
- 第二行: Program · 副標 · 色塊 indicator (跟 ADR-0015 顏色一致)

### 動作列表 (中間 scrollable)

**Section header pattern** (Q11.8-a)：一個 list 兩個 section，「一般動作」+「常設動作」分隔。**跨區拖動可改類型**（拖過 section 邊界 = 自動 UPDATE template_exercise.section）— 跟 ⚙ menu「設為常設/一般」二重入口。

**動作卡 collapsed (Q11.3-α)**：
```
┌────────────────────────────────────┐
│ 🏋 [動作圖]  臥推                    │
│             1 暖身 + 3 工作組          │
│                              [⚙]    │
└────────────────────────────────────┘
```
- 只顯示 N 暖身 + N 工作組 summary
- **不顯示具體 reps × weight**（因每組可能不同，β 格式 `3×8 @ 80kg` 失準）

**動作卡 expanded (Q11.3-α)**：點擊 collapsed 卡展開
```
┌────────────────────────────────────┐
│ 🏋 [動作圖]  臥推                    │
│             1 暖身 + 3 工作組          │
│ ─────────────────────────────────── │
│ 熱   │  10 reps  │  60 kg            │  ← 每組獨立 inputs
│ 1   │   8 reps  │  80 kg            │
│ 2   │   6 reps  │  85 kg            │  ← 可不同（pyramid set）
│ 3   │   4 reps  │  90 kg            │
│                              [⚙]    │
└────────────────────────────────────┘
```
- 每組獨立 reps/weight inputs
- 多 expand 允許（accordion ❌、可同時多卡 expand 對比）

### per-exercise ⚙ menu (Q11.4-A) — 4 項

| 項目 | 行為 |
|---|---|
| 新增/編輯備註 | 動態文案（空 → 「新增備註」/ 非空 → 「編輯備註」，ADR-0013 一致）→ 開 bottom sheet 編輯 → 即時 UPDATE template_exercise.notes |
| 移動動作 | 進 ADR-0013 重排列表畫面 |
| 設為常設運動 / 設為一般運動 | UPDATE template_exercise.section (group-wide 連動 sibling? — 跟 ADR-0014 sibling rename 連動哲學一致；如不一致則需 sibling 衝突偵測，留 v1 實作時釘) |
| 刪除 | 跳 confirm dialog「確認刪除？」→ DELETE template_exercise + CASCADE template_set rows |

**剔除的 menu 項**：動作歷史（既有 in-session 入口 + Exercise library 入口 三入口已足）/ 替換動作（v1 罕用，刪+加替代）/ 複製動作（「設為常設」邏輯 cover）/ 編輯預設 sets（走 expand 卡直接編）

### 底部 4-action bar (Q11.2-X)

| 按鈕 | 行為 |
|---|---|
| + 新增動作 | 進動作選擇器 → 選後 INSERT template_exercise + 預設 template_set rows (依動作記憶 derive) |
| ↕ 移動動作 | 進 ADR-0013 重排列表畫面（整 Template exercises 排序；跨區拖動可改類型） |
| 配色 | 開 bottom sheet 12-color palette grid（見下） |
| ⋯ 更多 | ActionSheet 3 項 [開始訓練] [另存模板] [刪除模板]（Q11.6-A） |

### 模版配色 picker (Q11.5-β)

Bottom sheet 12-color iOS palette grid (3×4)：
```
┌──────────────────────────────┐
│  選擇配色          [完成]      │
├──────────────────────────────┤
│   🔴   🟠   🟡   🟢            │
│  Red  Orange Yellow Green     │
│                                │
│   🌿   💧   🔵   🟦            │
│  Mint  Teal  Cyan  Blue       │
│                                │
│   🟣   🟪   🩷   🤎            │
│ Indigo Purple Pink Brown      │
│                                │
│   ──────────────────────       │
│   ✓ 目前: 🔴 Red               │
└──────────────────────────────┘
```
- 連動 sibling rename 邏輯：選色 → group-wide UPDATE WHERE name=? → 立刻整 sibling 同步（ADR-0015）
- bottom sheet 半遮畫面，動作列表仍可見 → 即時看到動作卡色變化（live preview）

### ⋯ 更多 menu (Q11.6-A)

ActionSheet 3 項 + 取消：
| 項目 | 行為 |
|---|---|
| 開始訓練 | 從本 Template 啟動 session（store 暫存改動先 commit → atomic op 啟動 session） |
| 另存模板 | 補齊三元組 UI → 新建 Template entity (cross-link ADR-0014 邏輯) |
| 刪除模板 | 跳 confirm dialog → DELETE template + CASCADE (template_exercise + template_set) |

**剔除**：編輯資訊（top header inline 編輯）/ 預覽（v1 過度設計）/ 分享 export（ADR-0011 backup cover）/ 動作歷史一覽（歷史 sub-tab by Template name 篩選自然 cover）

## per-set 預設值 schema (Q11.9-β)

### Schema 累加 (v012)

```sql
-- v012 累加變動（接續 ADR-0015 v011）
CREATE TABLE template_set (
  id TEXT PRIMARY KEY,                       -- UUID v4
  template_exercise_id TEXT NOT NULL REFERENCES template_exercise(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                 -- 顯式排序，0-indexed
  set_kind TEXT CHECK IN ('warmup','working','dropset') NOT NULL DEFAULT 'working',
  reps INTEGER NOT NULL,
  weight REAL NOT NULL,
  parent_set_id TEXT NULL REFERENCES template_set(id) ON DELETE CASCADE,
  -- ↑ dropset cluster B3 連結（跟 ADR-0012 set 表 parent_set_id 邏輯一致）
  
  UNIQUE (template_exercise_id, position)
);

CREATE INDEX idx_template_set_by_exercise ON template_set(template_exercise_id, position);
```

### Migration transform

v012 是**含 transform 的 migration**（跟 v009/v010/v011 純加欄位不同）：

```sql
-- Transform: template_exercise summary → template_set rows
-- 對每個 template_exercise 創建 N rows:
--   warmup_set_count 個 warmup row (reps = template_exercise.warmup_reps, weight = warmup_weight)
--   working_set_count 個 working row (reps = template_exercise.working_reps, weight = working_weight)
-- (具體 SQL 待 v1 實作時釘，可能用 app-side migration runner 跑)
```

### template_exercise 欄位變化

- **保留**: `warmup_set_count` / `working_set_count`（cache，UI 顯示 collapsed 卡 summary 用；可選 derive from COUNT(template_set)，但保 cache 較 UI 高效）
- **廢除**: 既有 `warmup_reps` / `warmup_weight` / `working_reps` / `working_weight`（如有；改由 template_set rows derive）
- **動作記憶 source 改**：從讀 template_exercise summary 4 值 → 讀 template_set list

## 動作記憶 read pattern 改（ADR-0012 微 amendment）

**原 pattern**（CONTEXT.md L501）：
> Template 編輯新增動作 row → query 該 exercise 跨表 updated_at 最新的 template_exercise → 帶 (warmup, working, reps, weight) 預填

**新 pattern**：
> Template 編輯新增動作 row → query 該 exercise 跨表 updated_at 最新的 template_exercise → 帶**對應 template_set list** (per-set kind + reps + weight) 預填

**寫記憶情境** 不變（template_exercise.updated_at = now() 觸發時機相同），但寫入時連 template_set rows 也要寫（Template 編輯 save / Save-back Apply / freestyle 另存 三條路徑）。

### Slice 9.8b amendment (2026-05-14) — 記憶分流：solo vs reusable cluster

Reusable Superset (ADR-0017) 進 Template 後爆開成 2 個 `template_exercise` rows，stamp `reusable_superset_id = S` FK。記憶查詢分流：

- **Solo lookup**（row.reusable_superset_id IS NULL）：原 pattern + WHERE 子句加 `AND reusable_superset_id IS NULL` 隔離。**Reusable cluster 內的 row 不會出現在 solo 結果中**（即使 exercise_id 相同），避免 cluster 配速量級污染 solo memory。
- **Reusable cluster lookup**（row.reusable_superset_id = S）：新 query `queryReusableSupersetMemory(S)` — 找最新 cluster（parent_id IS NULL AND rs_id = S, max updated_at）配對它的 child row，返回 2 個 `MemoryCandidate`；`deriveLatestSetsForExercise` 對 parent / child 各跑一次拿出預填 sets。
- **首次 explode 無歷史 cluster** → fallback 系統 default (1 working set @ 8 reps × 20 kg)，跟 solo-without-memory 一致。

效果：同一個「胸推」在 (a) solo / (b) 「胸+深」reusable cluster / (c) 「胸+硬」reusable cluster 各自 3 套互不污染的記憶單位。實作於 `queryMemoryCandidates` + `queryReusableSupersetMemory` (src/adapters/sqlite/templateRepository.ts)。

## Reusable cluster lock rules (ADR-0017 引入，Slice 9.8b)

當 `template_exercise.reusable_superset_id != NULL`，cluster 被視為**鎖死的二人組**（per ADR-0017 grill Q5 / 動作組合鎖死哲學）。Template editor 對該 cluster 的操作集：

| 操作 | 鎖死 cluster (rs_id NOT NULL) | 手拼 cluster (rs_id IS NULL) |
|---|---|---|
| 改個別 set reps/weight | ✅ | ✅ |
| 「新增 1 組」(row-pair add) | ✅ | ✅ |
| per-set kind 切換 warmup ↔ working | ✅ (row-pair 同步) | ✅ |
| per-set dropset 切換 | ❌ (sets 列同步衝突) | ✅ |
| ⚙ menu「設為常設/一般」(整 cluster 同搬) | ✅ | ✅ |
| ⚙ menu「刪除」(兩 row 同時刪) | ✅ | ✅ |
| ⚙ menu「編輯/新增備註」 | ❌ (hidden) | ✅ |
| ⚙ menu「休息時間」 | ❌ (hidden) | ✅ |
| ⚙ menu「移動動作」 | (尚未實作) | (尚未實作) |
| 拖 child 拖出 cluster | ❌ | ✅ |
| 拖 parent 改變結構 | ❌ | ✅ |
| 個別 row 單獨刪除 | ❌ | ✅ |
| 個別 set 單獨增刪 | ❌ (parent/child sets 長度必須對齊) | ✅ |
| Cluster 內換 exercise_id | ❌ | ✅ |
| 拼接成 superset 巢狀 | ❌ | ❌ (既有 ADR-0016 規則) |

實作於 `openGearMenu(ex)`：rs_id NOT NULL 早返回，只 surface 設為常設/一般 + 刪除 兩項。其他鎖死規則由 cluster 結構 + 既有 ADR-0016 superset pair 行為天然處理（parent_id linkage 不可改、children 沒有獨立 ⚙ 入口、sets 加減走 cluster pair-level API）。

砍 reusable superset 後 (ON DELETE SET NULL) → rs_id 變 NULL → cluster 自動解鎖回手拼 cluster 行為。記憶歸入 solo per-exercise memory（cluster 仍存活，但 rs_id-scoped memory identity 丟失）。

## 儲存 / 取消雙 button 行為 (Q11.7-β)

### Storage 模式

- **In-memory draft state**：進入 Template 編輯頁時，把 template_exercise + template_set 完整 list 載入 in-memory; 所有改動 (新增動作 / 改 reps/weight / 改色 / 移動 / 刪除 etc) 寫 in-memory state，**不**寫 DB
- **「儲存」按 (right-top)**：將 in-memory state diff → DB（batch UPSERT/DELETE）；若 sibling rename / recolor 也 trigger group-wide UPDATE
- **「取消」按 (left-top)**：discard in-memory state（無 DB 寫入）
- **「儲存」disabled** when in-memory state == DB state (no changes)
- **「取消」有 changes** → 跳 confirm dialog「捨棄變更？」(SF Symbol `xmark.bin`)

### 例外：模版配色 即時寫?

- bottom sheet 配色 picker 改色 → 是改 in-memory draft (跟其他改動一致)，「儲存」才真正寫 DB
- 但 bottom sheet live preview 顯示動作列表色塊變化（draft state 直接 reflect 到 UI）

### 例外：動作 ⚙ menu 「新增/編輯備註」

- ADR-0013 鎖定「即時 UPDATE template_exercise.notes」無 draft
- 跟本 ADR draft state 衝突 — 解決：本 ADR 範圍**僅限 template_exercise + template_set 的 set 數據**走 draft; **notes 欄位仍即時 UPDATE**（兩個概念分流）
- 理由: notes 是「累積 cue 庫」性質，跟 sets 數據編輯邏輯不同；ADR-0013 哲學保留

## Q10 deflationary close-out

**Backlog #10 「訓練類型 label 系統」整題 collapsed**：

使用者 grill 時釐清「胸/肩 / 腿(蹲) / 腿(垂直)/肩 / 胸/背(水平) / 腿(拉)」**就是 Template name 本身**，不是新獨立 label layer。
- ✅ 既有 Template name (字串 label) 已 cover
- ✅ ADR-0015 per Template name 顏色已 cover「顏色 mapping」
- ✅ 三元組唯一性允許同 name sibling，自然支援「不同 Program/副標下的同類訓練」
- ✅ Q7.3-A sibling rename 連動哲學自然 align

**結論**：無新 schema / 無新 module / 無新 ADR for Backlog #10；純 deflationary close-out。

## 拒絕的替代方案

- **Q11.1=B**（全頁滾動 metadata scroll-up 消失）：改 metadata 要 scroll 到頂；reduce affordance
- **Q11.1=C**（segmented 雙頁 [Metadata | 動作]）：改 metadata 要切 tab 編動作 friction 高
- **Q11.1=D**（master-detail）：iPhone 螢幕不夠
- **Q11.2=Y**（訓練啟動為主 [+ 新增] [↕ 移動] [配色] [▶ 開始]）：「開始訓練」first-class 但編輯場景下次要
- **Q11.2=Z**（編輯儲存導向 [+ 新增] [↕ 移動] [儲存] [取消]）：「儲存/取消」放底部 + 4-action bar 同處導致重複；本 ADR 改放 top corner 跟 iOS Modal 一致
- **Q11.3=β/γ/δ/ε**（collapsed 中度 / 極簡 / 永遠 expanded / accordion）：collapsed 中度 `3×8 @ 80kg` 在 per-set 可變場景失準（user 明指）/ 極簡訊息不足 / 永遠 expanded 動作多時 scroll 死 / accordion 同時對比不便
- **Q11.4=B/C/D**（中等集 / 完整集 / 含補充）：動作歷史已有三入口、替換動作 v1 罕用、複製動作 「設為常設」cover、編輯預設 sets 走 expand
- **Q11.5=α/γ/δ/ε**（ActionSheet list / popover / full-page / inline cycle）：list 視覺單調 / popover 遮 action bar / full-page over-engineered / cycle 12 色煩
- **Q11.6=B/C/D**（含編輯資訊 / 含預覽 / 完整集）：top header inline 已 cover 編輯資訊 / 預覽 v1 過度 / 全功能過設計
- **Q11.7=α**（即時 UPDATE 無 draft）：Template = plan 性質、試錯場景明確
- **Q11.7=γ**（undo button）：undo stack 實作 + 「最近」邊界不清
- **Q11.7=δ**（複製 escape hatch）：試錯路徑迂迴
- **Q11.8=b**（segmented control 兩 sub-tab）：失去 overview + 「跨區拖動」需切 tab
- **Q11.8=c**（視覺色塊區分）：訊息弱、容易誤判
- **Q11.8=d**（一條 list + 常設 chip）：常設動作 scatter、不利 mental model
- **Q11.8=e**（折疊 section 不平等對待）：不平等對待兩區
- **Q11.9=α**（summary 級 schema）：「每組獨立預設」場景不能 (pyramid set 80→70→60)
- **Q11.9=γ**（Hybrid summary + override JSON）：兩態邏輯複雜

## 跨 Backlog / ADR 影響

- **ADR-0012**：動作記憶 read pattern 微 amendment（summary 改 list）；set logger 邏輯不變（set 表仍是 per-session 實打值）
- **ADR-0013**：⚙ menu 「新增/編輯備註」即時 UPDATE 哲學保留（不走本 ADR draft state）；「移動動作」重排列表元件本 ADR 沿用
- **ADR-0014**：「另存模板」進 ⋯ menu；補齊三元組 UI 沿用 ADR-0014 衝突偵測流程
- **ADR-0015**：模版配色 bottom sheet 12-color palette 沿用；group-wide UPDATE WHERE name=? 沿用

## v1 slice 影響

- **Slice 3 (templateManager)**：大改 — per-set CRUD + 動作記憶 list read pattern + sibling 連動 (rename / recolor) + draft state 管理 + bulk save diff
- **Slice 4 (saveBackDiff)**：對 template_set list 比對 (不是 summary)；diff 邏輯改寫
- **Slice 5 (Save-back Engine)**：actuals 寫回 template_set list (不是 summary)；Snapshot 從 template + template_exercise + template_set 整套 derive
- **Slice 6 (Session Lifecycle)**：from template 啟動 session 邏輯改 (從 template_set rows 創 session set rows)
- **Slice 8/10/15**：視 ADR-0012 cluster aggregate 算法改（template_set 跟 set 結構對齊後，aggregate 邏輯共用）
- **v012 migration**：transform-heavy (template_exercise summary 攤平成 template_set rows)；vs v009-v011 純加欄位差異
- 估 **+2-3 週工作量**（UI redesign + schema migration + 動作記憶 read 改 + templateManager 整改）

v1 ship 26 週時程：壓力大但仍可吸收；可能需重新評估 slice 10+ 範圍。

## 與既有 PRD User Story 的對應

**Refine 既有**：
- **#18** Template 編輯頁基本架構 → 本 ADR 整體 layout + 4-action bar + ⚙ menu + per-set 預設值
- **#106** 歷史頁 sub-tab → 本 ADR 不動 (cross-link ADR-0009/0015)
- **CONTEXT.md L501-502** 動作記憶 read pattern → 從 summary 改 list (本 ADR cross-amendment)

**新增 stories #224-#238 (15 條)**：
- Template 編輯頁三段式 layout (top metadata + 中間動作列表 scroll + 底部 4-action bar)
- top metadata header 含 取消 (left) + 儲存 (right disabled when no changes) + Template name inline 編輯
- in-memory draft state + 「儲存」commit batch UPSERT/DELETE
- 「取消」有 changes 跳 confirm dialog「捨棄變更？」
- 動作卡 collapsed = 動作名 + 圖 + N 暖身 + N 工作組 summary (Q11.3-α)
- 動作卡 expanded = 每組獨立 reps/weight inputs (multi-expand 允許)
- per-exercise ⚙ menu 4 項 (備註 / 移動 / 設為常設/一般 / 刪除)
- 底部 4-action bar [+ 新增動作] [↕ 移動動作] [配色] [⋯ 更多]
- 模版配色 bottom sheet 12-color grid (3×4) + live preview + group-wide sibling 連動
- ⋯ 更多 menu 3 項 [開始訓練] [另存模板] [刪除模板]
- 一般/常設 section header pattern + 跨區拖動可改類型
- 新增 template_set 表 (per-template_exercise per-set 預設值) + UNIQUE(template_exercise_id, position)
- v012 migration transform (template_exercise summary → template_set rows)
- 動作記憶 read pattern 改: 從 template_set list (不是 summary)
- Template 編輯 in-memory draft + ⚙ menu「新增/編輯備註」例外保留 ADR-0013 即時 UPDATE

## 2026-05-12 Amendment — Prototype-driven UX 收口 (Template + Session 跨頁對齊)

接著 ADR-0014/0015 prototype 模式，跑完 Template 編輯器原型迭代 + Session set logger 規格對齊。視覺 / 互動 / schema 多處與本 ADR 原始決定有偏差，且**跨頁影響 ADR-0012 set logger** — 全收進此 amendment（不另立 ADR，因屬同一 entity「Template + Session 編輯」family 內的 prototype-driven 收口）。

### 1. 動作卡 multi-expand → **accordion** (推翻 Q11.3-α)

原 Q11.3-α 鎖定「多 expand 允許（accordion ❌、可同時多卡 expand 對比）」。實作 prototype 後使用者改判：accordion 單卡展開更乾淨（list 太長、滑很遠、視覺干擾）。

**新規則**: state 改 `expanded_ex_id: string | null` (單一)；點未展開動作 → 該卡展開、其他展開的自動收合；超級組 parent + children 共用 `parent.id` 為 accordion key。

### 2. ⚙ menu 擴張 4 → 5 項（+「休息時間」）

新增「休息時間」per-exercise default rest seconds，bottom sheet stepper 編輯（−15s / 大數字 / +15s），預設 90s。

**新 schema 欄位**: `template_exercise.rest_seconds INTEGER NULL`（v012 累加；NULL = fall back 系統預設）。

**Session 端串接**: Set 被 ✓ (is_logged = true) 時，自動跳計時器分頁，倒數使用該動作的 `rest_seconds`。

### 3. ⚙ menu「設為常設/一般」cascade

原規範 sibling 連動 v1 釘但未具體。本次明定：
- ⚙ menu「設為常設/一般」on superset parent → cascade flip `section` 給 parent + 所有 children（superset 視為一個 section unit）
- ⚙ menu 在 session 也存在 → 寫回 underlying template（per Q11.4 sibling 連動哲學 group-wide UPDATE WHERE name=?）

### 4. 4-action bar 重組 + ⋯ menu 縮減

**Template 4-action bar 新**: `[+ 新增動作] [開始訓練] [配色] [⋯ 更多]`
- 拿掉「+ 常設」(改為從 ⚙ menu「設為常設」)
- 「開始訓練」從 ⋯ menu 提升至 first-class slot 2

**Template ⋯ menu 縮減 3 → 2 項**: `[另存模板] [刪除模板]`

**Session 4-action bar**: `[+ 動作] [儲存模板] [另存模板] [⌚ Watch sync]`
- 「儲存模板」freestyle session 虛化
- 無 ⋯ menu（4 slot 已覆蓋）

**Session top corners**: `[結束]` 右上 + `[刪除]` 左上（兩者都先跳 confirm dialog）。

### 5. Notes scope: per-set + per-exercise 雙層

原規範 notes 僅 `template_exercise.notes` (per-exercise)。本次擴張：

**新 schema 欄位**: `template_set.notes TEXT NULL`（v012 累加）

**雙層分工**:
- ⚙ menu「備註」 = exercise level → 寫 `template_exercise.notes`
- 右滑「📝 備註」 = set level → 寫 `template_set.notes`
- **Bottom sheet UI 一模一樣**，差別只在 target

**Dropset cluster「cluster head 級 visible」規則**: schema 允許每 set row 都有 notes（含 cluster followers），但 UI 只在 cluster head (parent_set_id = null) 暴露 📝 affordance；followers 是 dead field（保留欄位無 schema migration cost）。

跟 ADR-0012 set logger 對齊 — 該 ADR 早有此設計，本 amendment 把 template editor 也納入同一規則。

### 6. Section grouping 跨頁（一般 / 常設動作）

原 A 類「本質不同」中曾把 section 列為 template-only。本次更正：**Session 也有 section grouping** — 從 template snapshot 取 section 顯示分組 header。Freestyle session edge case 留待 grill。

### 7. Superset 視覺重構（兩頁對齊）

**新規則** (取代原 `⚭ 超級組` badge + 各自 ⚙):

```
┌─────────────────────────────────────┐
│ [超級組] 動作A + 動作B    ▼      ⚙  │  ← 合併標題 + 單一 ⚙ (整 superset 共用)
├─────────────────────────────────────┤
│ 動作A             │ 動作B             │  ← col 名 label
│ 1  reps × kg      │ 1  reps × kg      │  ← side-by-side set rows
│ 2  reps × kg      │ 2  reps × kg      │
├─────────────────────────────────────┤
│ [新增 1 組]    [動作歷史]              │  ← 共用 footer (整 superset 一輪)
└─────────────────────────────────────┘
```

- 單一 ⚙ targets parent，cascade 對 children（section flip、delete、notes/rest 都以 parent 為主）
- 「新增 1 組」 = 每邊各加 1 set（一輪）；若某邊最末是 dropset cluster 則 clone 該 cluster
- 「動作歷史」 = 顯合併名「動作A + 動作B · 動作歷史」
- Children notes / rest_seconds 為 dead field（superset 的 notes/rest 統一存 parent）
- **創建路徑**: superset 在動作庫 (exercise library) 製作 — 任選 2 個動作 cross-link，落 template 時整對拉入。動作庫 UI 流程留待後續 grill。

### 8. Dropset cluster rules

原 ADR-0016 schema 鎖定 `parent_set_id` cluster B3 連結（沿用 ADR-0012），但 UI 行為未具體。本次明定：

- **Cluster 最小 size = 2**（D1 head + ≥1 unlabeled follower）— 不得砍到剩 D1 alone（否則跟正式組無異）
- **編號**: 每個 cluster head 獨立 `D1` / `D2` / `D3`...（per-cluster head numbering，不是 row-level cumulative）；followers 無 label
- **Per-cluster `+/−` buttons**: 每 cluster 的 last follower inline trailing `[− +]`；中間 followers 只 `[−]`；`−` 在 cluster size ≤ 2 時 disabled（opacity 0.35 + grey 字）
- **新增 1 組**:
  - 最末是 working / warmup → clone 該 row（kind / reps / weight 完全照搬，**無** −2kg 自動調整）
  - 最末是 dropset → clone 整 trailing cluster（new head + new followers，parent_set_id 重 link 到 new head）

### 9. Set row gesture 規格（C2 拍板，prototype 未實作）

跨 Template / Session 兩頁的 set row 全 gesture-driven（Template 走 draft、Session 即時 UPDATE，input mechanism 一致）：

| Gesture | 行為 |
|---|---|
| tap label | cycle kind 熱 → #N → D# → 熱 |
| 右滑 | reveal `[新增]` + `[📝 備註]` 兩 button |
| 左滑 | reveal `[刪除]` 紅 button |
| 長按 | drag-reorder mode |

**Cluster head 3 gesture (cluster 級)**:
| Gesture | 行為 |
|---|---|
| 左滑 | `[刪除整 cluster]` + DELETE CASCADE |
| 長按 | 整 cluster reorder unit |
| 右滑 | `[新增]` 在當前 cluster 後 append 新 cluster + `[📝 備註]` 編 root.notes |

**Cluster follower 不接受 gesture** — 純 button-driven（trailing `[−]` / `[− +]`）。

⚠️ **Prototype 未實作 gesture**（need react-native-gesture-handler 接 Swipeable）— 視覺鎖定，行為層 v1 ship 階段補。

### 10. 「熱」/「暖」用字統一

Set row label 跟 collapsed summary 用字統一為「熱」（單字、空間經濟）。原本 collapsed summary `1暖+3組` → `1熱+3組`。

### 跨 ADR cross-amendment

- **ADR-0012 set logger** 影響面已就位（per-set notes cluster head 級 visible、cluster B3、編號規則、gesture set）；session 端 4-action bar / top corners / timer trigger 為**新增**規格、ADR-0012 本身不需另寫 amendment（本 amendment 同時 cover）
- **ADR-0013 in-session ⚙ menu** 不動

### Prototype 落點

對應 commit（與本 amendment 合併 push）:
- `Prototype/TemplateEditorView.tsx` — accordion + ⚙ 5 項 + 4-action bar + ⋯ ActionSheet + dropset cluster +/- + superset 合併 header / col 名 / 共用 footer + notes 雙層 sheet
- `Prototype/HistoryDetailView.tsx` — superset 視覺對齊（合併標題 + col 名 + hideHeader）+ per-cluster head 編號
- `Prototype/MockTrainingStore.tsx` — TemplateSet.parent_set_id / TemplateSet.notes / TemplateExercise.rest_seconds + demo data 帶 cluster linkage

## 2026-05-13 Amendment — Gesture 行為層落地 + 視覺收口 (prototype iteration round 2)

緊接著 2026-05-12 amendment（視覺鎖定 + gesture 行為層留 v1）：本次 prototype 加入 `react-native-gesture-handler` 接 `Swipeable` 真正把 set row gesture **行為層** 接上，並在 Simulator 反覆迭代視覺細節。多項規格相對 2026-05-12 amendment 有調整或補充——全收進本 amendment（不另立 ADR，仍屬 ADR-0016 family 內 prototype-driven 收口）。

### A. Label cycle 順序改 `n → 熱 → Dn`（推翻 2026-05-12 Section 9）

原 2026-05-12 Section 9 表格：`tap label | cycle kind 熱 → #N → D# → 熱`。實作後使用者改判：訓練實境**從 working 起跳**（多數動作不熱身）、需要再加熱身才往「熱」、再加 dropset 才往「D」更合邏輯。

**新規則**: `working (n)` → `warmup (熱)` → `dropset head (Dn)` → `working` 循環。
- working → warmup：直接翻 kind
- warmup → dropset head：翻 kind 為 `dropset` 並 **auto-add 1 follower**（cluster min size = 2 自動滿足）
- dropset head → working：翻 kind 為 `working` 並 **CASCADE 刪掉所有 followers**
- follower (parent_set_id ≠ null)：tap **no-op**（純 button-driven，sync 2026-05-12 Section 9 follower 規則）

### B. Cluster swipe = 整 cluster 視為單一 row unit（補 2026-05-12 Section 9）

2026-05-12 Section 9 雖鎖 cluster head 3 gesture，但**視覺層**未具體：實作後決定 cluster head 的 swipe 必須 **drag entire cluster as one unit** — head + 所有 followers 一起位移、action button 高度涵蓋整 cluster、放手回彈也同步。

**Prototype 實作**: 把 cluster head + followers 包進**同一個** `SwipeableSetRow` 包裹（內層 `View` 用 `clusterStack` 直排），followers **不另起** `SwipeableSetRow`。

### C. Follower 不接受 swipe — 再次確認（推翻 overnight agent 誤判）

Overnight gesture wiring agent 把 follower 也接 `SwipeableSetRow` 並提供 gesture，使用者明確推翻：**Cluster follower 屬於 cluster head 的 row 層級之下，不應有獨立 gesture**。已 revert，與 2026-05-12 Section 9 follower 規則一致。

`SwipeableSetRow` API 加 `enabled` prop：`enabled={false}` 直接 fallthrough 渲染 children，不掛 `Swipeable`，避免 gesture-handler overhead 與意外觸發。

### D. Superset 整列 swipe 語義鎖定（補 2026-05-12 Section 7）

2026-05-12 Section 7 鎖 superset 視覺（合併標題 / col 名 / 共用 footer / 單 ⚙），但 **row 級 gesture** 未具體。本次明定：superset row（parent col + child col **同一 row index**）視為**整列單一單位**接 gesture。

| Gesture | 行為 |
|---|---|
| 左滑 | `[刪除]` 紅 button — 刪父 row + 對應子 row 整行（同 row index 兩邊都掉） |
| 右滑 | `[新增 1 組]` + `[📝 備註]` — 新增＝兩邊 col 各 clone 對應 row（整行一輪）；備註寫 parent 的 `template_set.notes`（子 row 為 dead field，與 2026-05-12 Section 5「followers dead field」同哲學） |
| 長按 | drag-reorder placeholder — 行為留 v1 ship 補（reorder pairing 邏輯複雜，需另設計） |

**實作落點**: `TemplateEditorView.tsx` 加 `deleteSupersetRowAt(ex_id, row_index)` / `cloneSupersetRowAt(ex_id, row_index)` handlers，superset render 改 per-row-index pairing 路徑（單一 `SwipeableSetRow` 包同 row index 兩邊 col 內容）。

### E. Notes 三層 📝 icon 位置規則（補 2026-05-12 Section 5）

2026-05-12 Section 5 鎖 notes per-set + per-exercise 雙層 + cluster head 級 visible，但**📝 indicator 顯示位置**未具體。本次明定三層 icon placement：

| Notes 層級 | 📝 indicator 位置 | 顯示條件 |
|---|---|---|
| **per-set** (`template_set.notes`) | 該 set row **內**（col 區附近、保留 28px slot） | `notes` 非空 |
| **per-exercise 一般動作** (`template_exercise.notes`) | exercise 卡**標題旁**（tap 區內，跟動作圖示同列） | `notes` 非空 |
| **per-exercise superset** (parent's `template_exercise.notes`) | superset row **最右**（**整列共用**，視 parent + child 為一體；不在 tap 區內，避免父/子歸屬模糊） | `notes` 非空 |

**Superset row 28px 保留 slot**: 即使該行無 📝，每邊 col 在右側永遠保留 28px 寬空 slot — 確保有無 notes 兩種 row state 在 col 間**水平對齊不偏移**（pyramid set 比較場景下視覺穩定）。col 名 header 列亦保留同寬空 slot。

### F. SwipeableSetRow 視覺打磨

接 `Swipeable` 後三項視覺細節，全在 `Prototype/SwipeableSetRow.tsx` 落地：

1. **Drag-driven row 高亮**：drag 位移 ≥ 4px 起即 row bg 變淡灰 (`rgba(0,0,0,0.12)`)，drag 結束回 0 自動褪回（透過 `Animated.AnimatedInterpolation<number>` 介接 row bg `interpolate`）。
2. **Touch 高亮 bridge**：手指剛碰到 row 瞬間（`onTouchStart`）就上淡灰，drag 過程繼續維持（與 1 形成 union 高亮 — `touching` state 與 drag-driven bg style array last-wins 同時生效），離開（`onTouchEnd` / `onTouchCancel`）才褪回。解決「碰瞬間有灰但 drag 中途又恢復」的 gesture-handler touch-cancel 副作用。
3. **無 wrapper 白底**：`rowSurface` 預設 `backgroundColor` 透明（**不**設白底），避免 drag 時白方塊浮在卡片灰底上形成「匡線」視覺異物。

### G. `#` label 按鈕化（3D 樣式）

原 2026-05-12 視覺鎖定為 plain text width 26。實作後使用者要求按鈕視覺更明顯：

- pill shape `32×24`（compact `26×20`）+ 圓角 6/5
- **3D 凸起感**：top/left border 淺灰、right/bottom border 深灰、bottom border 加粗 2px、加 iOS `shadow` + Android `elevation`
- **按下態**：邊框翻轉（top/left 深、bottom/right 淺）+ 整顆 `translateY: 1` 模擬「按進去」+ 去陰影
- **Follower 態**：所有 border + shadow 透明、text 灰，**維持同尺寸 slot 保 col 對齊**

### H. Cluster row 4px gap

Cluster head + followers 在同 `clusterStack` View 內直排原 gap = 0，導致 reps/weight 輸入框視覺貼合難辨。加 `gap: 4` 解。

### I. 12-color palette grid 顯示修正

原 `width: '22%' + aspectRatio: 1` flex 計算下實際只展示 4 色（剩 8 色被 clip）。改為 fixed `width: 64, height: 64` + `gap: 12`，正確展示 12 色。

### J. Section 9 警語移除

原 2026-05-12 Section 9 末警語：「⚠️ Prototype 未實作 gesture（need react-native-gesture-handler 接 Swipeable）— 視覺鎖定，行為層 v1 ship 階段補。」**本 amendment 已過時** — prototype 已透過 `react-native-gesture-handler` `Swipeable` 接上 gesture 行為層，視覺層也同步收口。`SwipeableSetRow.tsx` 即實作落點。

### Prototype 落點（本次 amendment）

- `Prototype/SwipeableSetRow.tsx` — 新增 component（`Swipeable` wrapper + `enabled` prop + drag-driven row 高亮 + touch bridge + Animated actions 跟手指 anchor 在邊緣）
- `Prototype/TemplateEditorView.tsx` — cluster grouping render path（head + followers 同一 `SwipeableSetRow`）/ superset per-row-index pairing render path / `deleteSupersetRowAt` + `cloneSupersetRowAt` / `cycleSetKind` (n→熱→Dn + auto-add follower + remove all followers) / `SetRowContent` + `computeExMeta` 抽 top-level / Notes 三層 📝 icon 位置 / # 按鈕化 styles / 28px supersetRowNoteSlot / `clusterStack { gap: 4 }` / palette grid fixed-size
- `Prototype/PrototypeRoot.tsx` — `GestureHandlerRootView` 根包裹

### 跨 ADR cross-amendment

- **ADR-0012 set logger**：B、C、D、E 規則同步影響 in-session set row — gesture 行為層、cluster-as-unit swipe、superset 整列 swipe、Notes 三層 📝 icon placement 全沿用。ADR-0012 本身不另寫 amendment（本 amendment 同時 cover）。
- **ADR-0013 in-session ⚙ menu**：不動。

---

## 2026-05-13 amendment（ADR-0017 觸發 — 「+ 動作」path 改跳動作庫頁）

ADR-0017 Q15 grill 結果，Template editor「+ 動作」既有 inline bottom-sheet picker 撤銷，改跳轉到動作庫頁面 `/library?mode=picker`（多選 + 「完成 (N)」回填）。

### 翻盤的既有拍板

- ❌ slice 9.5 ship 時的 **inline bottom-sheet exercise picker**（issue #28 Out of Scope 列為過渡方案）— 砍
- ✅ **跳轉到 `/library?mode=picker&targetTemplateId=xxx`**（per ADR-0017 Q15）

### 新行為

1. Template editor footer「+ 新增動作」tap → `router.push('/library?mode=picker&targetTemplateId=' + template.id)`
2. 動作庫頁進 picker mode：
   - tap 動作卡 = toggle 選取（不進詳情頁）
   - 底部 sticky「完成 (N)」回填到 Template
   - 右上 ✕ = 取消、回 Template editor 不回填
   - sidebar「超級組」tab 可進，內含「+ 添加自定義動作」進 reusable superset 創建 path
   - 選取的 reusable superset = explode 2 個 exercise 加進 Template + parent_id linkage
3. 多選順序 = user tap sequence（per ADR-0017 Q12）

### 不動

- Template editor 整體 layout / 4-action bar / 一般 vs 常設動作分區 / sibling 連動 — 不變
- 動作預填邏輯（queryMemoryCandidates + deriveLatestSetsForExercise）— 保留
- 既有 superset pair / cluster B3 / per-set CRUD — 保留
