# 0013 — Per-exercise notes 持久化：雙欄 schema (template-layer mutable + session-layer immutable snapshot) + freestyle hidden-template pattern

per-exercise notes（「左肩有點緊」/「下背貼椅、肘略前推」這類 cue 與臨場觀察）從原先未明確定義的「session 級可寫欄位」，重新建模為**雙欄 schema**：(1) `template_exercise.notes`（可編輯、主來源，給未來自己留 cue）；(2) `session_exercise.notes_snapshot`（不可變、歷史保鮮，每場 session 都會留）。Freestyle session（無 template）走 hidden template_exercise pattern：加動作時 silent-create `hidden=1` row；session 若存為 template 則升級（hidden=0 + 綁新 template_id），否則保留為 orphan，notes 在歷史上仍可從 snapshot 讀回。

本 ADR 整併 Q5.1–Q5.4 全鎖定（CONTEXT.md Q5 close-out 段）；對 ADR-0012 set logger redesign 有一處 affordance 補充（「移動動作」改成專屬重排列表模式 + 動作卡標題長按等價入口），一併固化於本 ADR。

## 設計哲學 anchor

**「notes 是 cue，給未來自己；snapshot 是時光膠囊，給歷史自己」**——這個 anchor 解釋了為何要分兩欄而不是一欄：

- `template_exercise.notes` = **動態進化的 cue 庫**：每次訓練都可修，目的是「下次相同 template 訓練時帶著進場」
- `session_exercise.notes_snapshot` = **凍結的歷史證據**：每場 session 一份，目的是「半年後回看當時帶著什麼 cue 訓練」

單欄方案（只放 template）→ 歷史失真：今天讀半年前的 session，看到的是今天版本的 notes，而非當時的版本。
單欄方案（只放 session 可寫）→ cue 不延續：每場都要重寫一次，違背 cue 的「持續累積」性質。
兩欄分工才同時滿足「cue 延續」+「歷史精確」兩個需求。

## Schema model（最關鍵）

```sql
-- v009 累加變動（接續 ADR-0012 v008）
ALTER TABLE template_exercise ADD COLUMN notes  TEXT NULL;
ALTER TABLE template_exercise ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE session_exercise  ADD COLUMN notes_snapshot TEXT NULL;
```

| 欄位 | 表 | 性質 | 寫入規則 |
|---|---|---|---|
| `notes` | `template_exercise` | 可編輯，主來源 | UI 編輯時即時 UPDATE；保存層級 = template entity（同 name 不同三元組獨立） |
| `notes_snapshot` | `session_exercise` | 不可變，歷史保鮮 | Session create / complete 時複製一次後永不再改 |
| `hidden` | `template_exercise` | flag，只 freestyle 用 | freestyle 加動作時 INSERT 為 `hidden=1`；session 存為 template 時 UPDATE 為 `hidden=0` |

`hidden=1` 的 row 不顯示在任何 template list / template editor / autocomplete UI；session_exercise FK 仍指向它（保 referential integrity）。

## Snapshot 寫入時機（按 session 類型分流）

| Session 類型 | snapshot 寫入時機 | 語意 |
|---|---|---|
| **Template-based**（從 template 派生） | **Session create 時** | 「我帶著什麼 cue 進場」 |
| **Freestyle**（無 template，動作中途加） | **Session complete 時** | 「我在這場寫了什麼 cue」 |

兩種時機差異**不是 inconsistency**，是因為 freestyle 在 session create 那一刻**還沒有任何 template_exercise**（動作要中途才加），所以 α（session create）規則無法套用。Freestyle 改成 complete 時冷凍，是「最具代表性的 notes 狀態」原則的延伸。

拒絕的替代時機（見「拒絕替代方案」段）：β lazy-on-first-edit / γ template-also-uses-complete。

## Edit 語意（in-session + template editor 雙入口，無 draft）

- **In-session edit**：動作卡 ⚙ menu →「新增備註 / 編輯備註」（文案依 notes 空非空動態切換）→ 開 bottom sheet → 寫完點「完成」→ **立即 UPDATE template_exercise.notes**（無 draft staging，無 commit/cancel 雙態）
- **Template editor edit**：同欄位、同 UPDATE 邏輯（template 編輯頁的 notes 欄位）
- **同一 template entity 的多個並行 session**：v1 不會發生（一次只能有一場 session in-progress），不必處理 conflict

「立即寫入」的副作用：訓練中改 notes → 本次 session 的 snapshot **已是 session create 時的舊值**（α 規則），不會跟著更新。下次相同 template 訓練時才看到新 notes。

## Freestyle special case — Hidden template-exercise pattern

```
Freestyle session flow：
  T0  使用者按「開始訓練」（freestyle 模式，無 template）
       └─ session created；無 template_exercise 派生
  T1  使用者加動作「肩推」
       └─ INSERT template_exercise (id=X, template_id=NULL, exercise_id=肩推, hidden=1)
       └─ INSERT session_exercise (template_exercise_id=X, notes_snapshot=NULL)
  T2  使用者寫 notes「下背貼椅」
       └─ UPDATE template_exercise SET notes='下背貼椅' WHERE id=X
  T3  使用者按「結束訓練」
       └─ UPDATE session_exercise SET notes_snapshot=(SELECT notes FROM template_exercise WHERE id=X)
       │  ↑ Freestyle snapshot 在 session complete 時冷凍
       │
       ├─ Path A：使用者選擇「存為 template」
       │   └─ UPDATE template_exercise SET hidden=0, template_id=<新 template_id> WHERE id=X
       │   └─ 未來新 session 從此 template 派生時，肩推帶 notes='下背貼椅'
       │
       └─ Path B：使用者不存
           └─ template_exercise (id=X) 保留為 orphan：hidden=1, template_id=NULL
           └─ 不顯示在 template list；FK 不破；session_exercise.notes_snapshot 保留
           └─ 歷史頁看本場 session 仍能看到 notes（從 snapshot 讀）
           └─ 但未來新 session 不會再選到這個動作+cue 組合
```

**Orphan accumulation**：Path B 每次 freestyle 都會留 N 個 `hidden=1` row。v1 不做 GC，v1.5+ 可加「清理無 session 引用的 hidden template_exercise」routine（簡單 join query）。

## UI affordances

### 動作卡 — Notes 顯示（Q5.3）

```
動作卡 collapsed：
  notes 完全不顯示（卡片乾淨）

動作卡 expanded（notes 為空）：
┌─────────────────────────────────┐
│  肩推                           │
│  60kg × 8                       │
│ ─────────────────────────────── │
│  Set 1   60 × 8    ✓            │
│  Set 2   62 × 6    ✓            │
└─────────────────────────────────┘

動作卡 expanded（notes 非空）：
┌─────────────────────────────────┐
│  肩推                           │
│  60kg × 8                       │
│ ─────────────────────────────── │
│  💬                              │  ← SF Symbol text.bubble
│  下背貼椅、肘略前推、頂端不鎖死    │  ← 直行顯示、無標題、secondary 色
│ ─────────────────────────────── │
│  Set 1   60 × 8    ✓            │
└─────────────────────────────────┘
```

- 圖標：**SF Symbol `text.bubble`**（一致 iconography），非 emoji（**2026-05-25 G2 修訂**：實裝採 `💬` emoji，與全 app affordance icon 路線一致 (`⚙️ 🗑️ 📖 ⏱️`)；無 `expo-symbols` 依賴）
- 顯示位置：動作圖正下方、Set rows 上方
- 為空 → 不顯示區塊（不佔垂直空間）
- 非空 → 直行純文字、secondary 字色、無「備註：」標題前綴

### Cluster card per-side notes preview（2026-05-25 G2 amendment）

Cluster card 代表 2 個 exercises（A + B），各自有獨立 `exercise.notes`。本 ADR 原圖示只畫 solo card；G2 grill 拍板 cluster case 規則：

- **A/B 各佔一行**：`💬 A: <notesA>` + `💬 B: <notesB>`，A 在上 B 在下（cluster pair 排序一致）
- **空側跳過該行**：若僅 A 有 notes，只顯示 A row（不留空白 B row）
- **雙空整區塊不顯**：含 divider；clusterBody 內無 notes 區塊也無下緣 gap
- **位置**：clusterBody 內、sideLabelRow 上方（mirror solo card「動作圖正下方、set rows 上方」相對位置）
- **樣式**：與 solo card `exerciseCardNotes` 一致（amber sticky-note callout：bg `#FEF3C7` / borderLeft `#F59E0B` / text `#78350F`）；warm-amber 跨 light/dark mode 保留為 ADR-0025 semantic callout 例外

實裝位置：`components/session/cluster-card.tsx` clusterBody 區塊內，`styles.clusterNotes` + `styles.clusterNotesText`。

### ⚙ menu entry（Q5.3a）

| notes 狀態 | menu 文案 |
|---|---|
| 空 | **「新增備註」** |
| 非空 | **「編輯備註」** |

動態切換降低使用者「點之前要先試試」的摩擦。i18n 多兩個 key 是合理代價。

### Edit sheet（Q5.3b）

iOS 原生 `.sheet(presentationDetents:)` **bottom sheet**，多 detent（medium / large）：

```
┌─────────────────────────────────┐
│  訓練中（動作卡仍可見）             │
├─────────────────────────────────┤
│        ━━━            ← drag handle
│                                 │
│  編輯備註                  完成 │
│ ─────────────────────────────── │
│  ┌─────────────────────────┐    │
│  │ 下背貼椅、肘略前推、       │    │
│  │ 頂端不鎖死                │    │  ← TextEditor 多行
│  └─────────────────────────┘    │
│  [鍵盤]                          │
└─────────────────────────────────┘
```

- 上滑 → 放大成 large
- 下滑 / 點外側 → 取消（提示有未存變更）
- 「完成」→ UPDATE `template_exercise.notes`、回主畫面
- **無「模板層級」警告副標**（Q5.3c 鎖 5c）— UI 最乾淨

### 內容格式（Q5.3d）

- **多行純文字、無字數上限**
- 不支援 markdown（v1 過度設計）
- 沒上限的失控風險低（訓練中時間壓力 → 使用者沒動機寫長文）；真有人寫長 → expanded 才展開、collapsed 不顯示

## 歷史頁顯示（Q5.4）

### Collapsed list（極簡，與 Backlog #9 月曆視圖共用）

```
歷史頁 / 月曆日格彈出卡：
┌─────────────────────────────────┐
│ 2026-05-09                      │
│ 推日                            │  ← Template name
│ PPL Week 3 · Day 1 (Push)      │  ← 週期 · 強度（原 Program 主+副標）
│ 12,340 kg · 5 動作              │  ← 容量總和 + 動作數量
└─────────────────────────────────┘
```

**不顯示**：動作明細、PR chip、notes preview。極簡卡片設計理由：(a) 月曆視圖一日格容納度小；(b) 詳情點開即可看細節，列表不必噪音。

### Session 詳情頁（含 notes_snapshot）

```
┌─────────────────────────────────┐
│ ← 2026-05-09 推日               │
│ PPL Week 3 · Day 1 (Push)      │
│ ═══════════════════════════════ │
│ 肩推                            │
│   Set 1   60 × 8                │
│   Set 2   62 × 6                │
│   Set 3   62 × 5  PR ↑          │
│ 💬 下背貼椅、肘略前推、頂端不鎖死  │  ← 本場 notes_snapshot 直接展開
│ ─────────────────────────────── │
│ 啞鈴側平舉                       │
│   10 × 12 × 3                  │
│   (無備註)                       │
│ ─────────────────────────────── │
│ 三頭繩索                         │
│   25 × 12 × 4                  │
│ 💬 注意肘部固定                  │
└─────────────────────────────────┘
```

每個動作下方直接顯示該場 `session_exercise.notes_snapshot`（NULL 時不顯示區塊）；不是 timeline、不是最近 N 次。

### 搜尋 / 動作時間線：v1 不做

- **全文搜尋 notes**：v1 不做，v1.5+ 候選（需 FTS5 索引 + 搜尋頁 UI）
- **單動作 notes 時間線**（從詳情頁某動作再點進去）：v1 不做，v1.5+ 候選（schema 已支持，純查詢渲染問題）

v1 範圍只到「Session 詳情頁顯示本場 notes」這層；再深入的 cross-session notes 分析全部 deferred。

## ADR-0012 補充 — 「移動動作」改用專屬重排列表

Q5 grill 過程中發現 ADR-0012 ⚙ menu 的「移動動作」entry **沒明確定義交互方式**，趁本 ADR 一併固化：

```
進入方式（兩個 gesture，等價）：
  入口 A：動作卡 ⚙ menu → 「↕ 移動動作」
  入口 B：動作卡標題 長按（long-press）
                ↓
┌──────────────────────────────────┐
│ 💡 提示：請長按每個動作條進行拖拽排序  │
├──────────────────────────────────┤
│ ⊕  深蹲                         ⋮⋮│
│ ⊕  架上深蹲                     ⋮⋮│
│ ⊕  SSB 深蹲                     ⋮⋮│
│ ⊕  ... (簡化列表：圖標 + 動作名)   │
├──────────────────────────────────┤
│ [ 保存當前排序 ]      [ 取消 ]    │
└──────────────────────────────────┘
              ↓
   保存 → 回主畫面（順序已更新）
   取消 → 回主畫面（順序不變）
```

理由：(a) 動作卡 expanded 狀態太重（含 sets、notes、cluster），無法在主畫面拖；(b) 簡化列表 = 一行一動作純拖拽，降低誤觸；(c) 明確 commit/cancel 按鈕避免「移動到一半離開頁面，順序到底有沒有變」的混淆；(d) 動作卡標題長按是「不必先打開卡」的等價入口。

此補充修訂 ADR-0012「per-row affordance map」的「長按 = drag-reorder mode」— 後者仍是 row 內 set 重排（schema：UPDATE set.position），但 **exercise 級的重排走獨立模式**，不在 set logger 主畫面 inline 進行。

## 跨 Backlog 影響

| Backlog 項目 | 本 ADR 對其影響 |
|---|---|
| **#9 歷史 = 月曆視圖** | 本 ADR 已鎖定 collapsed 卡結構（Template + Program + 容量 + 動作數）；月曆日格彈出可直接沿用，不必另設計。下次 Q9 grill 只需決定「日曆主視圖 + 日格彈出 vs 直接 navigate to detail」 |
| **#11 Template 編輯流程 UI redesign** | 移動動作列表畫面（本 ADR 新增）可能與 template 編輯頁的動作 reorder 共用元件 |

## 拒絕的替代方案

### Schema layer（Q5.1 系列）

- **Q5.1=A（只放 `session_exercise.notes`，session-level mutable）** ❌ 違反「cue 延續」需求 — 每場都要重寫，半年訓練累積的 cue 散落在各 session 找不回
- **Q5.1=A+B（雙層 mutable）** ❌ UX confusion — 改一個還是改兩個？同步策略？沒有清晰心智模型
- **Q5.1b=A（只 mutable template，無 snapshot）** ❌ 歷史失真 — 看半年前 session 看到的是今天版本的 notes，無法回溯當時的訓練思路

### Snapshot 寫入時機（Q5.1c）

- **β lazy-on-first-edit** ❌ 隱性副作用 — 「打開動作卡就觸發寫入」UX 不直覺；測試難寫
- **γ session-complete-for-template** ❌ 與 Q5.1a=A（編輯立即寫回 template）邏輯衝突 — 使用者改 template 是「為下次留」，但 γ 會把它當「本次 snapshot」；session 沒按結束就強退時 snapshot 永遠 NULL

### Freestyle 處理（Q5.1d）

- **1 v1 freestyle 不能寫 notes** ❌ UX inconsistency — 「為什麼 template 動作能寫 freestyle 動作不能寫」沒有合理解釋；discoverability 災難
- **3 用 `exercise.notes`（global）** ❌ 與 Q5.1=B 衝突 — 我們要的就是「同動作不同 template 不同 cue」，global 退化成單層（**2026-05-13 ADR-0017 Q5 翻盤**：本拒絕論述已被推翻，notes 升 per-Exercise 全局。詳見本檔末 amendment + ADR-0017 § Q5）
- **4 兩層 exercise + template override** ❌ 過度設計 — NULL coalesce 顯示優先順序複雜；snapshot 規則要決定抄哪一層；v1 不必要
- **Q5.1d-i=b（freestyle 編輯那一刻寫 snapshot）** ❌ 與 template session 的 α 規則不一致；隱性副作用
- **Q5.1d-ii=b（不存 template 時刪 hidden row + FK NULL）** ❌ FK 邏輯複雜（nullable + 兩種顯示路徑）
- **Q5.1d-ii=c（刪 hidden + 清 snapshot）** ❌ 違背 snapshot 設計初衷 — 歷史頁直接失去 notes 證據

### UI（Q5.3 系列）

- **Q5.3a=b（永遠「編輯備註」靜態文案）** ❌ Affordance 差 — 首次寫的使用者看到「編輯」會困惑「編輯什麼？」
- **Q5.3b=4b（full-screen modal）** ❌ 失去上下文（動作卡不可見）；單手操作不友善（cancel/完成在頂部）；訓練中場景切換重
- **Q5.3c=5a（一行副標永遠顯示「模板層級」警告）** ❌ 視覺疲勞、變背景音；使用者最終自學 dynamic 文案語意 → 副標冗餘
- **Q5.3c=5b（首次 modal 警告）** ❌ 攔截一次互動 + 需存「已看過」狀態（額外欄位 / UserDefaults）；訓練中浪費秒數
- **Q5.3d=d-2（單行）** ❌ 多行 cue 用逗號擠一行擁擠
- **Q5.3d=d-3（字數上限）** ❌ 空頭防護無實際收益；v1.5 真有失控再加
- **Q5.3d=d-4（Markdown）** ❌ 過度設計 — 編輯器 + 渲染 + 教學三層成本

### 歷史顯示（Q5.4 系列）

- **Q5.4-A a-2（list 顯示 💬 icon）** ❌ List 視覺噪音、與「極簡卡」目標衝突
- **Q5.4-A a-3（list 顯示 notes 第一行）** ❌ 卡片高度不穩、列表密度下降
- **Q5.4-B b-1（詳情頁不顯示 notes）** ❌ snapshot 存了卻不顯示，浪費資料
- **Q5.4-B b-3（詳情頁顯示「所有歷史 snapshot」）** ❌ 訓練多年資料量過大；最近 N 次已足夠看 cue 演化
- **Q5.4-B'=B'-1（v1 做動作時間線）** ❌ 怕資訊太亂、訊息層級不清；併入 v1.5 待 UX 更成熟再做
- **Q5.4-C=c-2（v1 加全文搜尋）** ❌ 過度設計 — v1 沒有「我以前寫過什麼」這類搜尋需求暫存場景

## v1 slice 影響

| Slice | 影響 |
|---|---|
| **Slice 4**（saveBackDiff） | 不影響 — notes 編輯是 immediate write，不走 save-back diff 路徑 |
| **Slice 8**（PR engine / volumeEngine） | 不影響 — notes 不參與計算 |
| **Slice 9**（歷史頁三 sub-tab） | **顯著重設**：collapsed 卡結構 + 詳情頁 notes 顯示新增；動作時間線 deferred |
| **Slice 10**（Backup / Sync） | 不影響 — notes 與 hidden 是 `template_exercise` / `session_exercise` 新欄位，整檔備份直接帶走 |
| **Slice ?**（Template 編輯頁 — Backlog #11 範圍） | template editor 需加 notes 欄位編輯 + 動作 reorder 模式 |

`v008 → v009` migration 純加欄位、無資料 transform：

```sql
ALTER TABLE template_exercise ADD COLUMN notes  TEXT NULL;
ALTER TABLE template_exercise ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE session_exercise  ADD COLUMN notes_snapshot TEXT NULL;
```

v1 ship 26 週時程不變（notes UI + freestyle hidden pattern 工作量小，吸收在 slice 9 redesign 範圍內）。

## 與既有 PRD User Story 的對應

- **PRD #31** (per-Exercise 自由文字備註 textarea) — 持久化機制由本 ADR 釘定（從原先模糊的「session-level textarea」演進為雙欄 schema）
- **PRD #175** (per-exercise 備註欄 placeholder「點擊輸入備註」) — 本 ADR 改用 ⚙ menu「新增備註 / 編輯備註」entry + bottom sheet 編輯；空時不顯示 placeholder（動作卡乾淨）
- **PRD #32** (per-Set 選填欄位折疊機制) — 本 ADR 不影響（per-set notes 由 ADR-0012 走右滑 [📝 備註] 入口；per-exercise 與 per-set 是兩個獨立 notes 層）

---

## 2026-05-13 amendment（ADR-0017 觸發 — per-exercise notes 升 per-Exercise 全局）

ADR-0017 Q5 grill 結果，per-exercise notes 模型從**雙欄 per-template-exercise 獨立** revise 為**單欄 per-Exercise 全局**。

### 翻盤的既有拍板

- ❌ **`template_exercise.notes` per-template-exercise 獨立**（本 ADR 原核心決策）— 撤銷
- ❌ **「同 name 不同三元組各自一份 notes」彈性**（CONTEXT 原例「胸日 (10-12RM)」vs「胸日 (6-8RM)」蝴蝶機可有不同 cue）— 撤銷
- ✅ **`session_exercise.notes_snapshot` 不可變歷史保鮮**（保留，本 ADR 哲學不動）

### 新模型

| 表 | 既有 | 新 |
|---|---|---|
| `exercise.notes TEXT NULL` | 無 | **新增，per-Exercise 全局一份** |
| `template_exercise.notes` | 存在、per-template-exercise 獨立 | **DROP COLUMN** |
| `session_exercise.notes_snapshot` | 不可變歷史保鮮 | **不動** |

**編輯 UX**：
- 動作詳情主頁「備註」欄、Template editor 內動作備註、in-session 編輯三處 → **同一份全局 notes**
- 任一處改 = 全局立刻反映（無 propagation 邏輯，因為只有一份）
- session_exercise.notes_snapshot 在 session create / freestyle complete 時冷凍 exercise.notes 當下值

### Migration v010（best-effort merge）

```sql
ALTER TABLE exercise ADD COLUMN notes TEXT NULL;

-- 對每 exercise 取最近 updated_at 的 template_exercise.notes 寫進
UPDATE exercise SET notes = (
  SELECT te.notes
  FROM template_exercise te
  WHERE te.exercise_id = exercise.id
    AND te.notes IS NOT NULL
  ORDER BY te.updated_at DESC
  LIMIT 1
);

ALTER TABLE template_exercise DROP COLUMN notes;
```

### 理由

- 個人 user 使用 pattern：「動作有一份 cue 就好」（cross-Template 個性化 cue 對個人是 overkill）
- 雙層 UX（per-template override + 全局）對個人是 over-engineering
- 簡化模型、消除 propagation 邏輯
- 動作詳情主頁的「備註」欄是 natural single-source-of-truth

### 不動

- session_exercise.notes_snapshot 不可變歷史 — 保留 ADR 既有「歷史保鮮」哲學
- Freestyle hidden template_exercise pattern — 不影響（只 notes 欄位改動）

