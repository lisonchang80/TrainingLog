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
