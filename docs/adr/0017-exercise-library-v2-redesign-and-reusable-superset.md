# 0017 — Exercise Library v2 redesign + Reusable Superset entity

動作庫從 slice 6 既有「chip filter + list」全面 redesign 為 **iOS 風格**：左 vertical sidebar (11 MG + 「超級組」獨立 tab) + 頂 horizontal Equipment sub-tab + 動作 grid (圓圖 + 動作名 + 「N 次」徽章)。引入新概念 **Reusable Superset** = 固定 2 動作的命名組合 entity，從動作庫創建、加進 Template「+ 動作」時 explode 成既有 ADR-0016 superset pair。

Custom Exercise form 4-row 重構（名稱 / 大分類 / 用具 / 訓練部位），刪除「動作類型」欄位（對齊 CONTEXT「重訓 only」Scope）。Equipment 從 CONTEXT 概念升 schema 欄位（enum TEXT 8 類）。動作詳情頁三層（主頁 = 標題+動圖+訓練部位 / 歷史頁 / 圖表頁），主頁 footer 4-action 切換。Per-Exercise 動圖 = user 上傳 mp4 ≤ 5 秒 + autoplay loop 模擬 GIF。圖表頁 metrics = 3 條折線 (容量/最大重量/1RM 預測) + rep bucket filter chip (1RM 線不受 filter)。

本 ADR 對 ADR-0009 / 0010 / 0013 / 0016 共 4 份既有 ADR 觸發 amendment — Reusable Superset 跟既有 in-session SetGroup superset 是**不同層級**的兩個概念（前者是 reusable entity、後者是 execution pattern）。

## 設計哲學 anchor

**「動作庫是組合工具，動作詳情是分析單位」**：
- **動作庫**（list view）= 「我要把什麼加進 Template / Session」的選擇工具 → 多選 + 「N 次」徽章 + grid 視覺強的呈現
- **動作詳情**（detail view）= 「這個動作我練得怎樣」的分析窗口 → 歷史 / 圖表 / 部位視覺
- **Reusable Superset** 是動作庫層級的快捷組合，不是分析單位 → explode model（加進 Template 後跟 reusable 解耦）

## Q1-Q17 Decision Rundown

### Q1：Sidebar scope (A — 守 v1 Scope)

**拍板**：sidebar 左 vertical list =
- **11 MG**（既有 ADR-0010：胸/背/腿/臀/肩/斜方肌/二頭/三頭/小腿/小臂/核心）
- **「超級組」獨立 tab**（reusable superset entity view，跟 11 MG 並列當第 12 entry）

**拒絕**：
- ❌「熱身動作 / 拉伸 / 有氧 / HIIT / 計時動作 / Tabata」— 與 CONTEXT「重訓 only」Scope 衝突
- ❌「全身 / 功能性 / 頸部」— 既有 MG 已 cover（複合動作走 primary MG 分類）

### Q2：「置頂」概念 (deleted)

**拍板**：刪除「置頂」概念
- ❌ horizontal sub-tab 第一格「置頂」
- ❌ 動作卡 4-action 之 📌 icon
- ❌ `exercise.is_pinned` 欄位（不存在）

**理由**：與既有 ADR-0016「常設動作」概念衝突（兩個都跟「常駐」相關，但層級不同 — 常設 = Template 內分區，置頂 = 動作庫 view filter），與其雙詞並存徒增混淆，user 決定砍 v1 pin。

### Q3：動作要點 v1 延後 + 主頁簡化

**拍板**：
- 動作要點（cues 教學內容）v1 不上線；schema 預留 `exercise.cues_text TEXT NULL`（v1 NULL，v1.5+ 補 65 個 built-in 內容 + 「講解」badge）
- 動作詳情主頁簡化：標題 + 圖片（或動圖）+ 訓練部位三塊
- ❌「自定義視頻」row
- ❌「置頂備注」row
- v1 不顯示「要點 icon」+「置頂 icon」（4-action → footer 4-action）

### Q4：動作詳情主頁 footer (D)

**拍板**：主頁底部 sticky 4-action bar
```
[歷史] [圖表] [編輯動作] [關閉]
```
- 「歷史」「圖表」按了 push 新頁，左上「< 返回」回主頁
- 「編輯動作」進入 Custom form（built-in 動作 readonly + 只能改動圖；custom 動作全可編輯）
- 「關閉」dismiss 詳情頁

### Q5：備註模型 (A — 全局取代 per-template)

**拍板**：per-Exercise 全局單層備註
- 新增 `exercise.notes TEXT NULL`（per-Exercise 全局一份）
- ❌ 砍 `template_exercise.notes`（既有 ADR-0013）
- ✓ 保留 `session_exercise.notes_snapshot TEXT NULL`（歷史保鮮、ADR-0013 哲學保留）
- 動作詳情主頁的「備註」欄 / Template editor 內動作備註 / in-session 編輯 → **同一份全局 notes**
- 任一處改 = 全局立刻反映

**ADR-0013 amendment 觸發**：per-template-exercise notes 模型撤銷，notes 升為 per-Exercise scope。

**Migration v010 邏輯**：
- ADD COLUMN `exercise.notes TEXT NULL`
- 對每 exercise: 取最近 updated_at 對應 template_exercise.notes 寫進 exercise.notes（best-effort merge）
- DROP COLUMN template_exercise.notes（或保留為 deprecated NULL；推薦 DROP 乾淨）

### Q6：Equipment 進 schema (8 類 enum TEXT)

**拍板**：
- Storage: `exercise.equipment TEXT NOT NULL DEFAULT '其他' CHECK(equipment IN (...))` (對齊既有 `load_type` 風格)
- 分類 8 類：**槓鈴 / 啞鈴 / 史密斯機 / 滑輪 / 固定機械 / 自重 / 壺鈴 / 其他**
  - 「徒手 → 自重」改名（對齊 lifting 圈口語）
- Per-Exercise 單一 FK（ADR-0001 精神：器械變體即獨立 Exercise）
- 必填、default「其他」（既有 65 個 built-in seed 要人工填值 in v010 migration）

### Q7：「N 次」徽章 = Session 數 derived

**拍板**：
- 語意 = `COUNT(DISTINCT session_id) FROM "set" WHERE exercise_id = ? AND is_done = 1`
- **Derived** (不 cache、不存 `session_count` column)
- 0 次時**不顯示**徽章（視覺乾淨）
- 對 Reusable Superset：另計（見 Q10「N 次」處理）

### Q8：動圖 (mp4 loop autoplay)

**拍板**：
- **格式**：mp4 (低解析、loop autoplay muted) 模擬 GIF；也允許 jpg/png 靜態圖
- **上限**：5 秒 / 低解析（`videoQuality: 'low'` 240p）
- **Built-in 預設**：placeholder（首字 + hashColor 背景；對齊 ADR-0015 12-color palette）
- **Built-in 可被替換**：user 上傳 override，**砍既有「built-in 不可改」精神**（因為 v1 内建是 placeholder 太素，個性化彈性高）
  - v1.5+ 美術 rollout 時：若 user 有 override → 保留；否則自動套新內建美術
- **Schema**：`exercise.media_path TEXT NULL`（無 media_type 欄；副檔名判斷）
- **儲存**：`Documents/exercise_media/{exercise_id}.{mp4|jpg}`（expo-file-system）
- **動作卡 grid**：顯示第 1 frame thumbnail（poster，靜止）；點進詳情頁才 autoplay
- **iCloud backup 整合**：flagged（後續 grill；本 slice scope 暫不含 mp4 進 ubiquity container）

### Q9：Muscle naming revise — ADR-0010 amendment

**拍板**：
- 二頭：**外側二頭 / 內側二頭**（舊：二頭長頭 / 二頭短頭）
- 前臂：**小臂**（舊：前臂）— MG「前臂」一併改名「小臂」

**理由**：對齊 ADR-0010 自己訂的「多字優先口語」原則（既有命名違反自己原則）。

**ADR-0010 amendment 觸發**：muscle 表 + muscle_group 表共 4 筆 UPDATE。

**Migration v010 內容**（一併在 Q5 migration 內）：
```sql
UPDATE muscle SET name = '外側二頭' WHERE id = 'm-bicep-long';
UPDATE muscle SET name = '內側二頭' WHERE id = 'm-bicep-short';
UPDATE muscle SET name = '小臂' WHERE id = 'm-forearm';
UPDATE muscle_group SET name = '小臂' WHERE id = 'mg-forearm';
```

**ID 不動**（M_BICEP_LONG / M_BICEP_SHORT / M_FOREARM / MG_FOREARM 等 const 名保留為 internal alias，避免 FK / code 大改）。

**Body diagram SVG**：components/body-heatmap.tsx + components/body-diagram.tsx 內的 label text 同步改。

### Q10：Reusable Superset entity (v1 進、fixed 2 動作)

**拍板**：

**Schema**（v011 migration，v010 後）：
```sql
CREATE TABLE superset (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,                       -- 預設「動作A + 動作B」，user 可改
  color_hex TEXT,                           -- ADR-0015 12-color；NULL fallback hashColor
  use_count INTEGER NOT NULL DEFAULT 0,     -- 被 add 進 Template/Session 累計次數
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE superset_exercise (
  superset_id TEXT NOT NULL REFERENCES superset(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                 -- 0 = parent, 1 = child
  exercise_id TEXT NOT NULL REFERENCES exercise(id),
  PRIMARY KEY (superset_id, position)
);
```

**動作數量**：固定 2（v1.5+ 評估 triset/quadset）
**動作組合鎖死**：建立後動作 pair 不能改，要改只能砍掉重建
**name / color 可改**：跟一般 Exercise 一樣可改
**整個 superset 可刪**：從 sidebar swipe 或詳情頁編輯內

**加進 Template 行為 — Explode model**：
- Add 一個 reusable superset → clone 成 2 個 `template_exercise` rows + parent_id linkage（per ADR-0016）
- **不存 `template_exercise.reusable_superset_id` FK**（單向、不雙向同步）
- 砍 reusable superset 不影響 Template 內已 explode 的 rows
- Template 內這 2 rows 走既有 ADR-0016 superset pair 行為（per-row-index pairing / 整對左右滑 / cluster B3 規則）
- 不能單獨 delete / 換 exercise（由 ADR-0016 既有 superset UX 限制天然處理）

**「N 次」徽章**：cached `superset.use_count` column；每次 add 進 Template/Session 時 +1。

**創建 path**：B-2 截圖
- 動作庫 sidebar「超級組」tab → 點「+ 添加自定義動作」
- 進入動作選擇頁（左 sidebar = 11 MG + 頂 horizontal Equipment + 動作 grid，**無「超級組」tab**避免遞迴）
- 多選 2 個動作（>2 時最近選的 2 個生效；<2 時「組合」button disabled）
- 「已選擇動作」chips 在頂部，可 ✗ 移除
- 「組合」button → INSERT superset + superset_exercise rows → 回 sidebar tab

### Q11：Custom Exercise form 4-row

**拍板**：
1. 動作名稱（text input）
2. 大分類（**11 MG**，單選；tap 開 bottom-sheet grid picker — Q13）
3. 用具分類（**8 Equipment**，單選；tap 開 bottom-sheet grid picker — Q13）
4. 訓練部位（**19 muscle**，主要 1-3 個 + 次要 0-N 個；含解剖圖；對齊 ADR-0010 既有 exercise_muscle m:n with role）

❌「動作類型」row（既有 v006 seed `exercise.load_type` 已 cover，UI 不顯示 type 選擇）

**Slice 9.7 grill amendment (2026-05-14)** — Q11 原拍板沒寫 default / 必填 / 解剖圖 conditional render 規則，本 slice 實作前補拍板：

**Default 規則**：
- `load_type` 根據 equipment 推導：'自重' → 'bodyweight'；其他 → 'loaded'
- INSERT 與 UPDATE 都 watch equipment 自動推；user 看不到也不需要懂 load_type 概念
- `assisted` 不從表單建立（罕見，v006 seed 已 cover「Assisted Dip / Assisted Pull-up」）

**必填規則**：
- 名稱：必填（既有 dup-name + 空字串檢查）
- 大分類：必填 — 砍既有 chip row 的「未指定」option（避免 ghost exercise；ADR Q13 4×3 grid 第 12 空格不互動）
- 用具：必填 — default '其他' 當逃生口（既有，不變）
- 訓練部位：**選填**（primary + secondary 都可空）

**解剖圖 conditional render**（修訂 2026-05-14 — 套在動作詳情頁，不是表單）：
- **表單**：解剖圖**一直 render**（即使全灰）— user 在編輯時看到視覺即時 feedback；section label 加「（選填）」
- **動作詳情頁 (`app/exercise/[id].tsx`)**：primary.length === 0 AND secondary.length === 0 → `<View style={styles.diagramCard}>`（含 `<BodyDiagram>` + `<BodyDiagramLegend>`）整塊不 render
- 兩個 `MuscleSection`（主要 / 次要）仍顯示「無」標籤，讓 user 看到「沒設訓練部位」的事實
- 避免 user 跳過訓練部位後在動作詳情頁看到全灰人體圖的視覺尷尬

**muscle section 排版（Slice 9.7 grill Q4 拍板）**：
- 解剖圖 inline 頂端（既有 140×280 並排 layout）
- chip section 限高 ScrollView（約 6 muscle 高 ~200px），內部 scroll；MG header 保留以維持心智模型
- 整 muscle section 在 form outer ScrollView 內 ~480px 高度

**互動模型（Slice 9.7 grill Q3 拍板）**：
- chip row 為主要控制（既有 primary → secondary → off 三態 tap 切換保留）
- 解剖圖 read-only sync — 不接 `onMusclePress` callback（避免 200×400 viewBox 小 muscle path 誤觸；既有 `<BodyDiagram>` 已支援但本 slice 不啟用）

### Q12：多選回填 Template 順序 (a)

**拍板**：**選取順序**（user tap sequence）
- 動作庫 picker mode multi-select：tap 1, tap 2, tap 3 → 加進 Template 順序 = 1→2→3
- 排在 Template 內 user 可 drag-reorder（既有 ADR-0016 移動動作功能）

### Q13：兩個 picker = bottom-sheet grid (b)

**拍板**：
- 大分類 picker：4×3 grid（11 MG 占 11 格、最後一格空）+ 底部「保存」button（**Slice 9.7 修訂**：砍底部「保存」button，tap 即選即 commit；見下方修訂段）
- 用具分類 picker：4×2 grid（8 Equipment 占滿 8 格）+ 底部「保存」button（**Slice 9.7 修訂**：同上，砍「保存」button）
- 視覺：圓角矩形 radius 12 / 深灰底 rgba(127,127,127,0.15) / active 填綠 #34C759 / grid gap 12 (對齊 ADR-0016 12-color picker)
- Drag handle + 頂部標題 + 右上 ✕（**Slice 9.7 修訂**：對齊既有 12-color picker idiom — 砍 drag handle，右上 ✕ 改為「完成」button；見下方修訂段）

**Slice 9.7 grill amendment (2026-05-14)** — chrome 對齊既有 12-color picker idiom：

ADR Q13 line 189 自己寫「對齊 ADR-0016 12-color picker」，但拍板的 chrome（drag handle + 保存 button + 右上 ✕）跟既有 12-color picker (`components/template-editor/template-editor-view.tsx:1310`) 對不上。實作以既有 idiom 為準：

- Sheet 頂部：title「選擇大分類 / 選擇用具」+ 右上「完成」button
- ❌ 無 drag handle
- ❌ 無底部「保存」button — tap 格子立即 setState + 視覺 active；視覺對齊既有「色塊 tap 即選」UX
- tap「完成」或 backdrop 外點 → close sheet（已選值保留，tap 即 commit 語義）
- 既有 styles 可直接複用：`sheetBackdrop` / `sheet` / `sheetHeader` / `sheetTitle` / `sheetDone` — 只需新增 `mgGrid` / `mgCell` / `equipmentGrid` / `equipmentCell`

**翻盤的既有拍板**：
- ❌ Q13 line 187/188「+ 底部「保存」button」— 砍掉
- ❌ Q13 line 190「Drag handle」— 砍掉
- ⚠️ Q13 line 190「右上 ✕」→ 改「右上完成」(close + commit 語義一致)

### Q14：圖表頁 metrics + rep bucket filter

**拍板**：
- **3 條折線**（全 v1 做）：容量（紅）/ 最大重量（綠）/ 1RM 預測（藍）
- **1RM 公式**：Epley `weight × (1 + reps/30)`（對齊 CONTEXT 「E1RM」字眼）
- **X 軸 granularity**：per-Session date
- **不分 rep bucket** ✓ （revise：採 **rep bucket filter chip**）
- **Filter chip 列 = rep bucket**：`[全部] [1-3] [4-6] [7-10] [11-15] [16+]`（**非 Program 副標籤**，跟 PR identity 同維度，CONTEXT L205 5 buckets）
  - 容量線 / 最大重量線 → 受 chip filter
  - **1RM 預測線 → 不受 chip filter** 影響（跨 rep range 比對才有意義）
- **❌ 砍頂部 stats**（容量紀錄 / 重量紀錄 / 1RM 預測紀錄都不顯示）— 直接 3 張圖
- 底部切年 button：`[上一年] [下一年] [全部]`

**ADR-0009 amendment 觸發**：動作歷史頁 chip filter 既有寫的「Program 副標籤」(CONTEXT L269) 是寫錯，應改 **rep bucket**；本 ADR 一併修。

### Q15：動作庫頁 entry pattern — 同頁 + route param

**拍板**：
- `/library?mode=browse`（default、從 tab 進）— 純瀏覽，tap 卡進詳情頁
- `/library?mode=picker&targetTemplateId=xxx`（從 Template「+ 動作」進）— 多選模式
  - tap 卡 = toggle 選取（不進詳情頁）
  - 底部 sticky「完成 (N)」回填到 Template
  - 右上 ✕ = 取消、回 Template editor 不回填
- 共用同一 component（內部 `mode` state 切換 selection UX）

**Slice 9.5 既有 inline bottom-sheet picker → 砍**（issue #28 Out of Scope 對應）。

### Q16：Reusable Superset 圖表 — 疊圖 (b)

**拍板**：
- 3 張圖（容量 / 最大重量 / 1RM 預測）× **2 條線（動作 A / B）**
- 動作 A、B 用 reusable superset color + 對比色區分（legend 標 exercise name）
- rep bucket filter chip 套用同 Q14 邏輯（容量/最大重量 受 filter；1RM 不受）

### Q17：Reusable Superset 詳情頁 full spec

**拍板**：

**主頁**：
- 標題（superset name + 配色 indicator）
- 2 個動作橫排縮圖 + exercise name（tap → 進對應 exercise 詳情頁）
- ❌ 動圖（superset 本身不上傳；2 個動作各自有自己的動圖）
- ❌ 訓練部位（2 動作各有不同部位，不疊；想看 → 點進各 exercise）

**歷史頁**（左上「< 返回」）：
- 同普通動作 layout + rep bucket chip filter
- 每 Session row 內，2 動作 sets 上下疊放，動作名 label 區隔：
  ```
  胸/肩 · 5月11
  ─ 動作 A：1 50×8 / 2 50×8 / 3 50×8
  ─ 動作 B：1 30×10 / 2 30×10 / 3 30×10
  ```

**圖表頁**（左上「< 返回」）：見 Q16

**Footer**：`[歷史] [圖表] [編輯] [刪除]`（**slice 9.8a 修訂**：對齊 slice 9.7 普通 Exercise 詳情頁實作 idiom，把 `[關閉]` 改成 `[刪除]`；push-stack 的「< 返回」已涵蓋關閉語意，destructive action 直接擺 footer 比 hidden 在編輯頁內更發現得到）
- 「編輯」**只改 name**；動作組合鎖死（per Q10）；color picker 不暴露（**slice 9.8a 增訂**：對齊 Custom Exercise idiom — color stays NULL，grid card 用 hashColor fallback；user 不必當下決定配色）
- 「刪除」一鍵到 destructive confirm Alert → DELETE → router.back()
- 9.8a scope 內「歷史」「圖表」disable（無 explode 整合 = 永遠無 session 資料 cluster 上 superset）；9.8c 啟用

**翻盤的既有拍板**：
- ❌ Q17 line 291「『刪除』放編輯頁內」— 改放 footer
- ❌ Q17 line 291「改 name + color」— color picker 砍掉，只改 name

## Slice 9.8 — 切分為 9.8a / 9.8b / 9.8c

ADR-0017 整包 3-4 週估時超過單 slice 風險閾值，slice 開工前再 grill 一輪切成三個獨立可 ship 的子 slice：

| Slice | Scope | Risk |
|---|---|---|
| **9.8a** | 純 Reusable Superset entity UI：超級組 tab list + grid、創建 flow（`/superset/new`）、詳情頁主頁 footer 4-action（歷史/圖表 disabled）、編輯頁（rename only）、刪除。不碰 Template editor。 | Low（純加法） |
| **9.8b** | explode-to-Template 整合 + Template editor「+ 動作」改 navigate `/library?mode=picker`（ADR-0017 Q15 / ADR-0016 amendment 落地）、use_count 自增、cross-route flow | High（改既有 Template editor swipe / cluster B3 行為） |
| **9.8c** | 詳情頁歷史頁 + 圖表頁（Q16 + Q17 完整）— 前提：9.8b 後有真實 session 資料 | Medium（純加法但依賴 9.8b 資料） |

理由：9.8a 不碰 Template editor，blast radius 小；9.8b 是改既有行為（風險集中於此）；9.8c 依賴實戰資料、不能跟 9.8b 平行。

**ADR-0016「+ 動作」inline picker 砍掉**（Q15 amendment）延後到 9.8b 處理（slice 9.8a 不影響 Template editor 既有 inline picker）。

## Schema migration plan

### v010 — Exercise Library v2 columns + muscle naming revise
```sql
-- Equipment
ALTER TABLE exercise ADD COLUMN equipment TEXT NOT NULL DEFAULT '其他'
  CHECK(equipment IN ('槓鈴','啞鈴','史密斯機','滑輪','固定機械','自重','壺鈴','其他'));

-- Global notes (Q5)
ALTER TABLE exercise ADD COLUMN notes TEXT NULL;

-- Media (Q8)
ALTER TABLE exercise ADD COLUMN media_path TEXT NULL;

-- Cues placeholder (Q3 — v1 NULL, v1.5+ 補)
ALTER TABLE exercise ADD COLUMN cues_text TEXT NULL;

-- Muscle naming revise (Q9 — ADR-0010 amendment)
UPDATE muscle SET name = '外側二頭' WHERE id = 'm-bicep-long';
UPDATE muscle SET name = '內側二頭' WHERE id = 'm-bicep-short';
UPDATE muscle SET name = '小臂' WHERE id = 'm-forearm';
UPDATE muscle_group SET name = '小臂' WHERE id = 'mg-forearm';

-- per-template notes 升 global (Q5 — ADR-0013 amendment)
-- best-effort merge: 取每 exercise 最近 updated_at 的 template_exercise.notes 寫進 exercise.notes
UPDATE exercise SET notes = (
  SELECT te.notes
  FROM template_exercise te
  WHERE te.exercise_id = exercise.id
    AND te.notes IS NOT NULL
  ORDER BY te.updated_at DESC
  LIMIT 1
);
-- PHASED: ALTER TABLE template_exercise DROP COLUMN notes 延後到後續 migration
--         （需先 migrate production templateRepository 與 Template editor UI
--           讀寫 exercise.notes — v010 一口氣 DROP 會 cascade 打掉 templateRepository
--           + 8 個 templateRepositoryV2 tests，不適合單一 commit 收尾）。

-- Equipment backfill: 66 built-in seeds 人工 map
-- (撰寫在 src/db/seed/v010ExerciseLibraryEquipment.ts；ADR 原文寫 65，實際 v006 seed 66 個)
```

### v011 — Reusable Superset entity
```sql
CREATE TABLE superset (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color_hex TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE superset_exercise (
  superset_id TEXT NOT NULL REFERENCES superset(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercise(id),
  PRIMARY KEY (superset_id, position)
);

CREATE INDEX idx_superset_exercise_exercise ON superset_exercise(exercise_id);
```

## Cross-ADR amendment 摘要

| ADR | Amendment 觸發點 | 處理 |
|---|---|---|
| **ADR-0009** 歷史頁三 sub-tab | 動作歷史頁 / 圖表頁 chip filter 既描述「Program 副標籤」是寫錯 → 改 **rep bucket** | 在 ADR-0009 加 amendment 段引用本 ADR Q14 |
| **ADR-0010** anatomical muscle layer | 二頭命名「長頭/短頭」→「外側/內側」、前臂→小臂 | 在 ADR-0010 加 amendment 段 + CONTEXT L116-128 同步 |
| **ADR-0013** per-exercise notes | per-template 獨立模型撤銷，notes 升 per-Exercise 全局 | 在 ADR-0013 加 amendment 段 + DROP COLUMN |
| **ADR-0016** Template editor | 「+ 動作」inline bottom-sheet picker → 砍，改跳 `/library?mode=picker` | 在 ADR-0016 加 amendment 段（指向本 ADR Q15） |

## Out of Scope (defer)

- **內建動作要點內容**（cues_text 填入 + 「講解」badge）→ v1.5+ 統一補 65 篇
- **內建動作美術圖**（v1 全 placeholder；v1.5+ 找美術做 65 張線條圖或 GIF）
- **超級組 ≥ 3 動作**（triset / quadset / giant set）→ v1.5+ 評估
- **動作要點 user 可編輯**（Q3 鎖 (a) read-only）
- **HKWorkout 刪除 superset 一致性 Flagged**（Watch v1 補）
- **iCloud backup 整合 mp4 files**（exercise_media folder 進 ubiquity container）→ 後續 grill
- **動作詳情頁 built-in display name 編輯解鎖**（仍鎖；只動圖可替換）

## 估時

3-4 週實作（吸收 17 題 grill + v010/v011 migration + 4 個 amendment + UI 全重寫）

## 參考

- 三組 grill 參考截圖（5/13 user 提供）：A 動作庫+「+動作」/ B 登錄新動作+新超級組 / C 動作卡
- ADR-0010 anatomical muscle layer
- ADR-0015 Template per-name color (12-color palette 對齊)
- ADR-0016 Template editor UI redesign + per-set schema (superset pair 既有行為)
- CONTEXT.md L106-148 (Muscle Group / Muscle / Equipment 既有定義)
