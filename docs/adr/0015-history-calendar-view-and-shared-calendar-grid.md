# 0015 — 歷史月曆視圖 + 共用 CalendarGrid 元件 + Freestyle 在 Program 日曆顯示

> **2026-05-16 Terminology rename note** (ADR-0019 § Q9.2 / ADR-0003 amendment)：本 ADR 內所有「Program 副標」/「Program 主標 / 主標題」字眼皆 rename 為「**強度**」/「**週期**」；schema 欄位名不動，UI / 文案層改字串。為保留閱讀流暢，下文沿用既有「Program 副標」描述但讀者應理解為「強度」；canonical 對照表見 CONTEXT.md § Terminology rename 對照表。

歷史 sub-tab 從 list view 改為「月曆為主、list 為輔」（segmented control 切換，月曆預設）；月曆為傳統 calendar-month grid（跟 iOS Calendar / Program 日曆 ADR-0004 視覺一致），日格 = 三行 chip stack（容量 / `session.title` / **強度**（原 Program 副標））+ 右上「+N」微標記表多場同日。日格色 = per Template name palette 顏色（12-color iOS 系統色，建立 Template 時系統預設、使用者可改）；freestyle session 灰塊 + 「自由訓練」fallback，升級後 reactive 切換為新 Template 色。

新增共用 `CalendarGrid` 元件（calendar-month grid skeleton + 月份 navigation），供歷史月曆使用；Program 日曆維持 cycle-based 獨立 grid（ADR-0004 不動）；兩 view 共用 cell style atoms (chip / palette / 字型)。

本 ADR 整併 Q9.1–Q9.9 全鎖定（CONTEXT.md Q9 close-out 段）；close ADR-0014 留尾「Freestyle session 在 Program 日曆顯示行為」；對 ADR-0009 歷史頁三 sub-tab 一處視覺擴充（歷史 sub-tab 預設為月曆視圖）。

## 設計哲學 anchor

**「歷史是按日索引、按色節奏、按主場切入」**——三個直覺對應三層 affordance：

- **按日索引**：月曆 grid 是「我這個月做了什麼」的天然 mental model（vs list 是「按時序連續」）
- **按色節奏**：日格色 = per Template name 顏色 → 整月一眼看出訓練類型節奏（胸/腿/背輪替、休息日空白）
- **按主場切入**：多場同日進主場（容量最高）+ ←/→ 切換 → 「我那天做了什麼」的最有代表性表達

跟 Q5.4-A「collapsed 卡極簡」哲學整合：collapsed 卡訊息（Template / Program / 容量 / 動作數）直接展開為日格三行 chip，不再需要「tap 彈出 collapsed 卡」中介。

## 月曆主視圖

### Sub-tab toggle

歷史 sub-tab 內加 segmented control `[月曆 | 表列]`：
- **月曆**（預設）：本 ADR 主要內容
- **表列**（escape hatch）：原 ADR-0009 list view 設計擴展。空間限制少於月曆 chip stack，每列可顯示更多欄位：
  - 日期 (M-DD) + 年（小）
  - 12 色 side bar (per Template name)
  - session.title（freestyle 加 ⚠️）+ 多場同日 inline `+N`
  - **週期 + 強度**（原 Program 主標題 + 副標；合併一行）
  - 動作數量 + 訓練時間（分鐘）+ Watch 標記 ⌚（如有）
  - 容量 (kg 整數) 右對齊

ADR-0009 三 sub-tab 結構（歷史 / 統計 / 獎章）不動（Q8.1 鎖定）；統計 + 獎章 sub-tab 內容不動（Q9.9 鎖定）。

### Grid 規格

- **粒度**：月（calendar-month）
- **Layout**：7 cols (一/二/三/四/五/六/日) × 4-6 rows
- **跨月顯示**：上月末 / 下月初灰色填補（傳統月曆風格）
- **today highlight**：當日格圓圈底色 (systemGreen) + 白字
- **無 session 日**：日期數字保留、chip stack 留白

### Cell layout (50pt × 90pt)

```
┌─────────────────┐
│   日期  +N      │  ← top row: 日期數字 (17pt) + 右上 +N (9-10pt secondary)
│ ┌─────────────┐ │     +N: 多場時顯示 (N = 額外場數)，單場時隱藏
│ │    12127    │ │  ← 第一行: 容量合計 (systemGreen chip)
│ └─────────────┘ │     所有日格同色，量化單位 kg、四捨五入到整數（不顯示小數）
│ ┌─────────────┐ │  ← 第二行: 主場 session.title (per Template name 色)
│ │    胸/肩     │ │     主場規則 = 容量最高那場 (b1)
│ └─────────────┘ │     freestyle 灰塊 + UI fallback「自由訓練」
│ ┌─────────────┐ │  ← 第三行: 主場的 Program 副標
│ │   10-12RM   │ │     freestyle 該行留白
│ └─────────────┘ │     色塊 = neutral 淡灰
└─────────────────┘
```

**Conditional logic**：
```
if (sessionCount == 0):
    # 無 session 日，留白
elif (sessionCount == 1 && template_id != NULL):
    # 單場 Template-based
    row1 = capacity
    row2 = session.title (per Template name color)
    row3 = Program 副標
elif (sessionCount == 1 && template_id == NULL):
    # 單場 freestyle
    row1 = capacity
    row2 = session.title or 「自由訓練」 (灰色塊)
    row3 = (空)
elif (sessionCount >= 2):
    # 多場
    row1 = sum(capacity)  # 合計
    row2 = mainSession.title  # 主場 = 容量最高
    row3 = mainSession.Program 副標 or (空 if 主場 freestyle)
    + 右上「+N」 (N = sessionCount - 1)
```

## Tap 日格行為

- **永遠直進詳情頁**（不彈 ActionSheet）
- 多場時：進**主場**（容量最高）詳情頁
- 詳情頁 header 加 `← N/M →` 顯示「本日第 N 場、共 M 場」，**單場時隱藏**
- 切換方式：`←` `→` 按鈕 + 水平 swipe gesture 並行
- 切換**範圍 = 僅同日 N 場**（不跨日；想看跨日場景 → 返回月曆 tap）

## 月份 navigation

三種入口並存：
- **← →** 按鈕（上方 month label 兩側）
- **月份 label tap** → 跳出 iOS wheel picker，快選任意 year / month
- **左右 swipe** gesture（手勢直覺）

跨年場景：tap label picker 直跳，比連點 12 次 ← 高效。

## 顏色系統（per Template name）

### Palette 來源

12-color iOS 系統 palette：
```
red / orange / yellow / green / mint / teal / 
cyan / blue / indigo / purple / pink / brown
```

每色由系統 token 統一 saturation / brightness（dark mode 自動切深淺），確保對比與可讀。

### Storage 設計

| 候選 | 說明 |
|---|---|
| **A. `template.color_hex TEXT NULL` per entity + group-wide write** | 欄位 per Template entity；UI 改色操作走 group rename 連動（跟 Q7.3-A sibling 連動哲學一致），所有同 name sibling 一起 UPDATE |
| B. `template_name_color (template_name TEXT PK, color_hex TEXT)` 表 | 顏色 per name group，sibling 自然共享；schema 更乾淨但要 JOIN |
| C. derive from name hash + user override in app_settings | 預設由 name hash 算、override 存 key-value；無需新欄位 |

**選 A**（per entity store + group-wide write）：
- ✅ 沿用 Q7.3-A「name = group identity, 改 name 連動 sibling」既有 pattern
- ✅ 不引入新表（vs B）
- ✅ schema 簡單 + reactive lookup 不必 JOIN（vs B）
- ✅ 跟 ADR-0014 group rename connect 邏輯整合
- ⚠️ trade-off：sibling rename / recolor 都要 group-wide UPDATE（已有 templateManager 邏輯）

### 預設策略

建 Template 時系統預設一色（從 palette 取下一個未使用色 / 或 hash by name），使用者可在 Template 編輯頁改色（Backlog #11 一併處理 UI entry）。

### Schema 累加 (v011)

> **2026-05-20 wave 56 訂正**：實際落點為 v020 migration (`v020_template_color_backfill.ts`)，非 v011 (v011 已被 reusable_superset 佔用)。

```sql
-- v011 累加變動（接續 ADR-0014 v010）
ALTER TABLE template ADD COLUMN color_hex TEXT NOT NULL DEFAULT '';

-- Backfill: 既有 Templates 按 name hash 從 palette 取色
-- (具體 backfill SQL 實作時釘，可能用 app start 一次性 migration runner)
```

跟 sibling rename 連動邏輯一致：UPDATE color_hex 時 WHERE template.name = ?（group-wide）。

## Freestyle 在歷史月曆顯示

- **未升級**（`session.template_id IS NULL`）：
  - 第二行 chip 顯示 `session.title` 或 fallback「自由訓練」（ADR-0014 Q7.4-e）
  - 色塊 = 灰色（Q9.3b-a）
  - 第三行空白
- **升級後**（按「另存模板」或「儲存模板」後 `session.template_id` UPDATE 為新 id）：
  - 日格 cell 由 `session.template_id` 動態 lookup 對應 Template 的 `color_hex`
  - 第二行色塊變新 Template 色（reactive）
  - 第三行顯示新 Template 的 Program 副標
  - session.title 仍 frozen（不回溯改），但**色 + 第三行**動態同步

注意：session.title 是 **frozen**（ADR-0014 Q7.2-α），但日格**色 + Program 副標**是 reactive 看 template_id。兩者 source 分開，不衝突。

## Freestyle 在 Program 日曆顯示（close ADR-0014 留尾）

**脈絡**：Program 日曆 (ADR-0004) 是 cycle-based schedule grid，cell 對應 by date（CONTEXT.md L344 / Q6.2.C）。Freestyle session 不對應 plan 的 Template → 屬「不匹配 ⚠️」category。

**視覺**（Q9.8-β）：
- 升級前: `⚠️ planned Template name (自由訓練)`（cell 內小字註記在底部行）
- 升級後 session.template_id 重綁:
  - 若新 Template = 該日 plan 的 Template → 變 ✅ 匹配
  - 若新 Template ≠ plan → 仍 ⚠️ 但「(自由訓練)」字樣改顯示新 Template name（例 `⚠️ 胸日 → 跑日`）
  - reactive 自動更新（看 session.template_id + plan 對比）

跟既有 Q6.2.C「不匹配 ⚠️」flow 一致，純擴展不改既有邏輯。

## 共用 CalendarGrid 元件策略 (Q9.4)

```
共用底層 CalendarGrid (calendar-month layout):
  - 7 cols × 4-6 rows month grid
  - 月份 navigation (← → / picker / swipe)  
  - today highlight
  - cell renderer plugin slot
  - cell tap callback

  ↓ 用於：HistoryCalendarView
        cell renderer = HistoryCellRenderer (容量 / session.title / 副標 / +N)

ProgramCalendarView (ADR-0004，不動)：
  - 維持 cycle-based grid（cycle 長度 × cycle 次數）
  - 自己一套 navigation (cycle ← → 切換，不是月份)
  - cell renderer = ProgramCellRenderer (planned Template name + ⚠️ deviation)

共用 cell style atoms (兩個 view 共用):
  - chip 視覺 atom (color / radius / padding)
  - palette token (12-color iOS)
  - 字型 (caption / body)
```

**不採完全共用** (Program 日曆改 calendar-month grid)：撞 ADR-0004 cycle-based 設計核心。

**不採完全獨立**：重複 grid layout / month navigation / cell base style 代碼。

## 多場 session 同日

- **物理上限**：cell 高度 ~90pt（單格設計打滿三行 chip + 日期），加塞第 2 套 chip = ~150pt+ 不可行
- **聚合表現**：合計容量第一行、主場 b1 第二三行、右上「+N」(N = 額外場數)
- **詳情頁切場**：tap 進主場 → ←/→ 同日切換（範圍 A）

## 跨 Backlog 影響

- **#10 訓練類型 label 系統**：本 ADR 鎖 per Template name 顏色，獨立於「訓練類型大類」label；Backlog #10 grill 後決定 label 是否與顏色 mapping 整合
- **#11 Template 編輯流程 UI redesign**：「改色」UI entry 在 Template 編輯頁；跟 Backlog #11 一起 grill UI 細節

## v1 slice 影響

- **Slice 9 (歷史 sub-tab)**：範圍進一步擴大（月曆 + segmented control + 三行 chip + Freestyle reactive + ←/→ 切場 + 月份 picker）
- **Slice 3 (templateManager)**：加 colorHex 管理（recolor = group-wide UPDATE WHERE name = ?）
- **Slice 4 (Program 日曆)**：cell renderer 補 freestyle ⚠️ planned (自由訓練)
- **v011 migration**：+1 欄位 + hash backfill；無 transform

v1 ship 26 週時程：估 +1–1.5 週工作量（UI 為主，多落在 slice 9），需評估是否擠入或延 slice 10+。

## 拒絕的替代方案

- **Q9.1=A**（月曆完全取代 list）：失去 timeline 連續性 escape hatch
- **Q9.1=B**（list 為主、月曆為輔）：跟 user 意圖反向（「歷史 = 月曆視圖」字面）
- **Q9.1=D**（月曆 + detail pane 並列）：螢幕空間擠 + scroll 行為複雜
- **Q9.1=E**（scrollable 列表式月曆）：失去 traditional grid「整月 overview」感
- **Q9.2=b/c/d/e**（週/年/zoom/動態 cell 粒度）：跟 Program 日曆 + iOS Calendar 視覺不一致
- **Q9.3=α**（純色塊填底）：失去文字訊息，不夠詳盡
- **Q9.3=β/γ/δ/ε**（icon / 容量數字 / name 縮寫 / dot）：訊息密度過低或重複（容量已在 chip）
- **Q9.3a=α/γ/δ**（系統不可改 / 自由 hex / 延 Backlog #11）：α 太硬、γ 視覺失控、δ 等不到（v1 ship）
- **Q9.3b=b/c/d**（dashed / 不顯示 / 純文字）：視覺破碎 / 失去一致 affordance
- **Q9.3c=a/c/f**（多 chip 堆 / 多色塊縱列 / 禁多場）：物理空間不夠 / layout 破碎 / 過度限制 user
- **Q9.4=a/c/d**（完全獨立 / 完全共用 / abstraction 多層）：重複代碼 / 撞 ADR-0004 / over-engineered
- **Q9.6=a/c/d**（純按鈕 / swipe-only / 上下 swipe）：跨年慢 / 缺 fallback / 跟系統 idiom 不一致
- **Q9.7=a/c/d/e**（永遠進詳情無切場 / 永遠彈 collapsed 卡 / detail pane / 動態 cell 展開）：多場時無 escape / 多層中介 / 破 grid
- **Q9.7 範圍 B/C/D**（全時序 / 同 Template name / Hybrid）：跟同日多場 1:1 對應弱 / 跟動作歷史頁重疊 / UI 複雜
- **Q9.8=α/γ/δ/ε/ζ**（純 ⚠️ / 完全 reactive / 不顯示 / 雙訊息 + dot / 兩月曆統一）：訊息不全 / 失 plan / 撞 Q6.2.C / 元素增多 / 性質混淆
- **Q9.9=b/c/d**（全 redesign / 含統計 / 含獎章）：scope 爆 / 撞 ADR-0010 anatomical / 獎章 grid 已對齊
- **Color storage B/C**（separate 表 / hash + override）：JOIN 成本 / hash 撞色控制弱

## 與既有 PRD User Story 的對應

**Refine 既有**：
- **#106 (歷史頁三 sub-tab segmented)** → 歷史 sub-tab 加內層 [月曆 | List] segmented (本 ADR 補充)
- **#191** 歷史 collapsed 卡 → 直接展開為日格三行 chip (cross-link 本 ADR)
- **#207** Freestyle 升級後 Program 日曆 reactive → 本 ADR close 具體視覺

**新增 stories #208-#223（16 條）**：
- 歷史 sub-tab 月曆/List segmented control + 月曆為預設
- 月曆 month grid (7 col × 4-6 row) + 跨月灰填補 + today highlight
- 日格三行 chip stack (容量 / session.title / Program 副標)
- 日格色 per Template name (12-color iOS palette) + Template 改色 entry
- Freestyle 日格 = 灰塊 + UI fallback「自由訓練」
- Freestyle 升級後 reactive 變新 Template 色 + Program 副標
- 多場同日 = 合計容量 + 主場 b1 容量最高 + 右上「+N」微標記
- 容量第一行統一綠色 (systemGreen)
- tap 日格永遠直進詳情頁（多場進主場）
- 詳情頁 ←/→ 按鈕 + swipe gesture 同日切場（範圍僅同日）
- 月份 ← → 按鈕 + 月份 label tap picker + 左右 swipe
- 共用 CalendarGrid 元件 (cell renderer plugin pattern)
- Program 日曆 freestyle = ⚠️ planned (自由訓練) 小註
- Program 日曆 freestyle 升級後 reactive 變 ✅ / 顯示新 Template name
- v011 migration: template.color_hex + hash backfill
- Template colorHex group-wide UPDATE (recolor = sibling 連動)
