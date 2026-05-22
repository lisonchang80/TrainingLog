# 0010 — Anatomical muscle layer + Exercise primary/secondary mapping

引入 19 個解剖學 muscle layer 取代既有 Sub-Group，提供 Exercise 詳情頁主要 / 次要部位視覺化能力。同時局部 reverse ADR-0002 — 背的 SG「水平/垂直」功能切改為「背部/下背」解剖切；其他 ADR-0002 結論（11 MG 列表、腹/核心 統一、臀 獨立、腿前後切分精神）**全部保留**。

## TL;DR

- Sub-Group 概念升級為 anatomical **muscle** layer，重命名 + 擴充
- muscle 列表 = **19 個**（每個 MG 拆 0-3 個 muscle，所有 MG 都至少對應 1 個 muscle）
- 新增 `exercise_muscle` m:n 表，含 `role ∈ {'primary', 'secondary'}` 欄位
- 二頭 muscle 命名修正：「內側頭 / 外側頭」→「二頭長頭 / 二頭短頭」
- 體圖 asset = CC0 / Wikimedia Commons 解剖圖 → 自製 SVG，統計頁 heatmap (by 11 MG aggregate) + Exercise 詳情頁 (by 19 muscle individual highlight) **雙用途**
- ADR-0002 局部 reverse：**僅**背的 SG 切法（水平/垂直 → 背部/下背）

## 19 muscle 列表

| MG | muscle (數) | muscle 列表 | 既有 SG 變動 |
|---|---|---|---|
| 胸 | 2 | 上胸 / 中下胸 | 不動 |
| 背 | 2 | **背部 / 下背** | 🔄 反轉 ADR-0002（水平/垂直 → 背部/下背） |
| 腿 | 2 | 股四 / 膕繩 | 改名（腿前 → 股四、腿後 → 膕繩，語意等價） |
| 臀 | 2 | 上臀部 / 下臀部 | 改名（上臀 / 下臀 → 上臀部 / 下臀部，微調對齊訓記語感） |
| 肩 | 3 | 前束 / 中束 / 後束 | 不動 |
| 斜方肌 | 1 | 斜方肌 | 新增 self-muscle（原 0 SG） |
| 二頭 | 2 | **二頭長頭 / 二頭短頭** | **改名**（內側頭/外側頭 → 二頭長頭/二頭短頭，解剖學標準） |
| 三頭 | 1 | 三頭 | 新增 self-muscle |
| 小腿 | 1 | 小腿 | 新增 self-muscle |
| 前臂 | 1 | 前臂 | 新增 self-muscle |
| 核心 | 2 | **側腹 / 腹肌** | 新增（核心拆 2 muscle，但 11 MG 仍維持「核心」單一 — 不違反 ADR-0002「腹部歸入核心」） |

**合計 19 muscle**。對齊訓記-style 19 個分類；命名採解剖學標準（二頭長頭/短頭）+ 訓練圈口語（上下胸、上下臀、股四、膕繩、側腹/腹肌）混搭，**單字優先標準、多字優先口語**。

## Schema 變更

```sql
-- 1. Drop existing sub_group layer (greenfield repo, 無 migration data)
DROP TABLE IF EXISTS sub_group;
ALTER TABLE exercise DROP COLUMN sub_group_id;

-- 2. Create anatomical muscle layer
CREATE TABLE muscle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,            -- '上胸', '二頭長頭', '側腹', etc.
  mg_id INTEGER NOT NULL REFERENCES muscle_group(id),
  display_order INTEGER NOT NULL
);

-- 3. Exercise → muscle m:n with role
CREATE TABLE exercise_muscle (
  exercise_id INTEGER NOT NULL REFERENCES exercise(id),
  muscle_id INTEGER NOT NULL REFERENCES muscle(id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
  PRIMARY KEY (exercise_id, muscle_id)
);

-- 4. exercise.muscle_group_id 保留（仍作為「主要 MG 分類」單一 FK，給 filter / 統計頁 各部位容量 / 獎章 first_combo / pr_per_mg 使用）
```

每個 muscle 屬於 exactly 1 MG（FK NOT NULL）。Exercise → muscle 是 m:n、有 role；Exercise → MG 仍是 single FK（categorize 用）。

## Exercise → muscle mapping rules

- **primary** = 1-3 個 muscle（核心活化、訓練動量主要承擔）
- **secondary** = 0-N 個 muscle（協同 / 穩定參與，但不是訓練重點）
- 一個 exercise 最少有 1 個 primary muscle；secondary 可空
- `exercise.muscle_group_id` ≈ primary muscles 多數歸屬的 MG（v1 手動指定，不自動推算；v1.5+ 評估自動 derive）

例：
- **平板槓鈴臥推** primary = 中下胸、三頭、前束；secondary = 上胸、前臂、核心 → `exercise.muscle_group_id = 胸`
- **T-bar row** primary = 背部、下背、二頭長頭、二頭短頭；secondary = 後束、前臂、核心 → `exercise.muscle_group_id = 背`
- **深蹲** primary = 股四、上臀部、下臀部；secondary = 膕繩、下背、核心、小腿 → `exercise.muscle_group_id = 腿`

60-80 內建 exercise 的 muscle mapping 在 v1 schema seed 階段填入。

## ADR-0002 reverse 範圍

**僅**反轉「**背的 SG = 水平/垂直**」這一條。其他全部保留：
- ✅ 11 MG 列表（胸、背、腿、臀、肩、斜方肌、二頭、三頭、小腿、前臂、核心）
- ✅ 不設「腹部」MG，所有腹部相關訓練歸入核心（腹部 split 是 muscle layer 內的事，11 MG 層級依舊沒「腹部」）
- ✅ 「臀」獨立 MG（含上臀部 / 下臀部 muscle）
- ✅ 「腿」只切前後（股四/膕繩，從 腿前/腿後 改名而已）
- ✅ 「斜方肌」獨立 MG
- ✅ 「小腿」獨立 MG（不在腿之下）

ADR-0002 reverse 理由：
1. ADR-0002 純 schema 視角，沒考慮人體圖視覺化需求
2. 加 Exercise 詳情頁標主 / 次部位後，**功能切「水平/垂直」沒有解剖位置可標示** — 視覺化必須走解剖切
3. 解剖切允許 Exercise → multiple muscle (primary + secondary) m:n mapping。同一個動作（例：T-bar row）可同時 primary = 背部 + 下背、secondary = 二頭 — **多 muscle 跨 SG 是 m:n 的本意**，不是 ADR-0002 擔心的「乾淨 tag 失敗」
4. lifting 動作本就不是單一 muscle 活化；ADR-0002 的「乾淨 tag」前提其實在 m:n 模型下不成立

## 二頭命名修正

| 舊（內/外側）| 新（解剖學）| 對應關係 |
|---|---|---|
| 內側頭 | **二頭短頭** | 解剖學 `short head` |
| 外側頭 | **二頭長頭** | 解剖學 `long head`（外側頭 = 長頭） |

理由：
- 命名 pattern 一致：bucket 改名（ADR-0009）已選訓練科學標準（最大力量 / 肌耐力）over 訓記非標準；此處也選解剖學標準
- 訓練圈深度使用者（會在意「寬握刺激長頭、窄握刺激短頭」）習慣長/短
- 「內/外側」對解剖學體位有歧義（手心朝前 vs 標準解剖體位描述方向不同）；長/短無歧義
- CONTEXT.md「Flagged ambiguities」段原本記錄「決定不採解剖名」這條 → 反轉

UI display：muscle.name 全名「二頭長頭 / 二頭短頭」（在 19 muscle list、filter chip、role chip 不依賴上下文時用）；UI 在已知 group=二頭 的 context 可選擇 abbreviate 為「長頭/短頭」（顯示層決定）。

## 體圖 asset 策略

**來源 = CC0 / Wikimedia Commons 解剖圖 → 自製 SVG**

工作流程：
1. 找 CC0 / public domain 人體解剖圖作參考（Wikimedia Commons `Anatomy` / `Muscle`/ `Human anatomy` category）
2. 自畫**前後身兩張 SVG**（neutral / male body silhouette + 19 muscle 各自獨立 fill path）
3. 每個 muscle path 有 unique `id` 屬性（`<path id="muscle-shang-xiong" d="..." />`）讓 React Native + SwiftUI 都能編程式 fill 顏色

**雙用途**：
- **統計頁 heatmap** (by 11 MG)：把同一 MG 下的多個 muscle path 視為同一 group，依 MG 容量 / 次數計算 fill 顏色（5 階分位數冷藍 → 暖紅）
- **Exercise 詳情頁** (by 19 muscle individual)：依 `exercise_muscle.role` 個別 fill 顏色 — primary 用暖色（淺紫/橘）、secondary 用冷色（淺藍/淺綠）、未活化保留灰底

一份 asset 雙用途，省一張 SVG 設計成本。

**性別**：v1 男女不分（neutral / male body 一張 SVG）；v1.5+ 加性別切換（女體 SVG + Settings toggle）。

**工作量估算**：~1-2 週一次性投資（含 SVG 設計 + 19 muscle path + RN 與 SwiftUI 各端 fill 程式接口）。

### 2026-05-23 amendment — 19-path 解剖 SVG 落地 + 雙層分流現況

**RN 端落地狀態**（commit `91e02ac` / `c694f6d` overnight wave 2026-05-23 Agent A）：

- `components/body-heatmap.tsx` 重繪為 anatomical-fidelity 兩視圖（front + back），含 18 M (M_*) muscle path + striation 內部紋理 + 20 條 leader-line label；M_TRAP 在前後身各畫一次（前身上斜方頸基 + 背身肩胛間菱形）→ **path count 達 19**，對齊本 ADR 原承諾。
- **雙用途實際分流**：
  - **統計頁 heatmap** ([by M layer](.) — 從 11 MG aggregate **升格** 至 18 M individual)：新 `mFrequencyOverPeriod(records)` (`src/domain/stats/statsEngine.ts`) + `StatsSetRecord.m_ids: string[]` 從 `exercise_muscle.role='primary'` JOIN 取主肌；`stats-panel.tsx` 餵 `<BodyHeatmap mQuintile={...} mCount={...} />`。Quintile 配色維持 5 階分位數（冷藍 → 暖紅 + 灰）。**注意：原 ADR 寫 by-11-MG aggregate，現在實際是 by-18-M individual** — 比原承諾更細，不退化。
  - **Exercise 詳情頁 by 19 muscle individual highlight**：**v1 仍未落地**（只有 heatmap 入口在 History → Stats subtab）。Exercise 詳情頁的「該動作主要活化」目前用文字 chip + 列表呈現，非 muscle path highlight。
- **SwiftUI Watch 端**：slice 11 watch scaffold 待開始；本 ADR 雙端 path 同步策略仍 valid，落地時走 ADR 既定路徑。

**Path/fill semantic 微調**：原 ADR 設想單一 muscle path 一個 fill 對應 muscle id；實作上 quad / glute / bicep / pec 等位置內**多 sub-path 視覺分隔（striation + 解剖分塊）但共用單一 fill semantic**（例如 quad 的 3 頭 — rectus femoris + vastus lateralis + vastus medialis — 都吃 `M_QUAD` 同一個 quintile 色）。這個簡化讓 fill 邏輯 1:1 對齊 muscle layer，視覺解剖細節純粹靠 SVG 繪製累積。

## Module 影響

PRD 既有 10 個 pure logic 模組**不變**（不新增模組）。muscle layer 主要是 schema + UI + 資料 mapping，不涉及純邏輯運算：
- 統計頁 heatmap 的 by-MG aggregate → Stats Engine（既有 #10）擴展，加 `mgFrequencyOverPeriod` 已涵蓋；新增 `muscleActivationForExercise(exercise_id) → Map<muscle_id, role>` query 屬於 SQLite Repository 層（platform adapter，#11，不寫 unit test）
- Exercise 詳情頁的「該動作主要活化 X / 次要活化 Y」純粹是 query 顯示，不需獨立 logic 模組

## 拒絕方案

1. **完整解剖 muscle layer (30-40 個)**：細到肌頭（股四 4 頭、肱二頭兩頭等）；維護成本爆炸（60-80 動作 × 30+ muscle mapping），對使用者實用增量小。
2. **完整 reverse ADR-0002**（11 MG / 腹歸核心 / 臀獨立 全推翻）：影響範圍過大；既有 PR 統計、獎章 first_combo (11 × 5 = 55)、各部位 N 次 PR (11 × 6 × 2 = 132) 全部要重做；得不償失。
3. **Exercise → muscle 三級 (primary / synergist / stabilizer)**：訓練科學標準；但對 lifter 實用性低（兩級已能服務「主要 vs 配角」決策）；schema 與 UI 都複雜化。
4. **Exercise → muscle 連續強度 (0-100% activation)**：太精細；activation 數據需 EMG 文獻，個別動作可能不一致；過度建模。
5. **體圖請插畫家 / AI 生成 / 用 react-native-body-highlighter 等 lib**：成本高 / 不穩 / 通常醜；CC0 + DIY SVG 1-2 週投資最務實。
6. **保留 sub_group 表 + 新增獨立 muscle 表（雙層共存）**：三層階層（MG → SG → muscle）對 19 個 anatomical 部位來說多餘；單純改名 sub_group → muscle 並擴充更乾淨。
7. **Exercise 詳情頁不做人體圖、只列 muscle name list**：失去視覺化價值；訓記式人體圖是使用者明確要求的功能。
8. **二頭維持「內側頭 / 外側頭」(ADR-0002 原命名)**：違反 ADR-0009 命名 pattern (科學取向 over 訓記/口語)；長/短頭是 lifter 進階使用者熟悉度更高的命名。
9. **Custom Exercise 強制 muscle mapping**：v1 允許 Custom Exercise 的 muscle mapping 為空（UI 在 Exercise 詳情頁顯示「未指定主要/次要部位」），降低使用者建 Custom Exercise 摩擦；v1.5+ 加 UI 引導補完。

## v1 ship 影響

工作量增量 **~3 週**：
- Schema 變更 (muscle 表 + exercise_muscle m:n + drop sub_group) = 0.5 天
- 19 muscle seed data = 0.5 天
- 60-80 內建 exercise 的 muscle mapping 資料 = 1 週（手動列每個動作的 primary / secondary）
- 體圖 SVG asset (前後身兩張、19 path) = 1-2 週
- Exercise 詳情頁 UI（主/次部位 chip + 體圖渲染）= 0.5-1 週
- 統計頁 heatmap 改用同一 SVG（既有 11 MG 顯示邏輯升級為 muscle-grouped fill）= 0.5 天

可吃 v1 26 週原預留 polish buffer 吸收。

---

## 2026-05-13 amendment（ADR-0017 觸發 — muscle naming revise）

ADR-0017 Q9 grill 結果，二頭與前臂命名 revise。理由：對齊本 ADR 既訂「**單字優先標準、多字優先口語**」原則 — 既有命名違反自己原則。

### 改動清單

| muscle | 既有 | 新 | 理由 |
|---|---|---|---|
| 二頭 (m-bicep-long) | 二頭長頭 | **外側二頭** | 對齊訓練圈口語；多字採口語 |
| 二頭 (m-bicep-short) | 二頭短頭 | **內側二頭** | 對齊訓練圈口語；多字採口語 |
| 前臂 (m-forearm) | 前臂 | **小臂** | 對齊訓練圈口語 |
| MG 前臂 (mg-forearm) | 前臂 | **小臂** | MG 名同步 muscle 名 |

### 翻盤的既有拍板

- ❌ **拒絕方案 #8（保留長/短頭命名）翻盤**：原 reasoning「lifter 進階使用者熟悉度更高」現在認為錯了 — 多數中文 lifter 圈用「內外側」非「長/短頭」（後者解剖學界用法）
- ❌ **TL;DR L10「二頭 muscle 命名修正：內側頭/外側頭 → 二頭長頭/二頭短頭」** — 反向翻盤回「內側/外側」（但前綴改「外側二頭/內側二頭」對齊兩字後置 pattern）

### 不動

- **ID 不動**：`M_BICEP_LONG` / `M_BICEP_SHORT` / `M_FOREARM` / `MG_FOREARM` const 名 + DB ID value (`'m-bicep-long'` 等) 保留為 internal alias
- **anatomical 對應不變**：二頭短頭 = 內側、長頭 = 外側（兩種命名指同一肌肉）

### 影響

- v010 migration 4 筆 UPDATE（見 ADR-0017 § Schema migration plan v010）
- `src/db/seed/v006ExerciseLibrary.ts` L90,115,116,122 同步改 name (const 名保留)
- `components/body-heatmap.tsx` L59「前臂」label → 「小臂」
- ~~`components/body-diagram.tsx` SVG label text 同步~~（2026-05-22 wave-2 overnight `01ca9f5` 移除 — 該檔為 dead code，從未在 production import；唯一存活的 body 繪製 surface 是 `components/body-heatmap.tsx`）
- CONTEXT.md L116-128 muscle 表更新

