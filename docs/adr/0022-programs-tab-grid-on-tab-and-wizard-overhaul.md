# 0022 — Programs tab 直接 grid + program-wizard 6-step UX overhaul（waves 15 / 17 / 18a-g 整合）

Status: accepted (2026-05-23 catch-up；landed 漸進於 2026-05-21 wave 15 `d79657e` → 2026-05-22 wave 18g `ee28997`)

把 Programs tab 從原本「list of programs → 點進一個看 grid」改成「tab 直接 land 計劃表 grid」，並把 program-wizard 從 ADR-0004 描述的「3 步」（名稱 → 維度 → 預覽）擴成 6 步以承載「載入計劃」與「每週期強度」這兩個 wave 18 加進來的新語意。

本 ADR 合併 wave 15 (`d79657e`) + wave 17 (`d667fca`) + wave 18 (a–g, `c725aa6..485d605`) 三段累積的 Programs tab + wizard UX 變動為單一拍板紀錄，並解 ADR-0021 § References 對「ADR-0022 (proposed)」的 dangling cross-ref。

## Context

ADR-0004 拍板 cycle-based grid 之後，Programs tab 一直停在「list of programs 卡片 → 點一個看 grid」的兩段式 navigation。隨著實際使用，三類 friction 累積：

1. **單一活躍 program 的點擊代價** — 大部分使用者只有 1-2 個 program、tab 第一層的 list 永遠只有 1-2 row、每次都要多一次 tap 才看到 grid。
2. **編輯模式不存在** — 動 grid 內容必須走 program-wizard 走完整 6 步；想換某個 cell 的 template 沒有 in-place 入口。
3. **強度 (sub_tag) UX 完全沒承載** — ADR-0003 的「強度」概念在 wave 11 之後成為 Template identity 的一環，但 wizard 沒有對應 step、Programs grid 也沒有 row-level 強度欄。

Wave 15 是第一次大動：tab 直接 grid + 編輯模式 + 三種 apply affordance（column ▶ / row ▶ / cell tap preset）。Wave 17 補了 row-level swap（長按拖曳）+ start_date dropdown。Wave 18 把 wizard 全重寫成 6 步、加「載入計劃」入口、加 per-cycle 強度 override，最後 wave 18g 加「覆蓋同名計劃」的 inline detect 與 `overwriteProgram` write path（後者已在 ADR-0021 amendment 紀錄）。

## Decision

### Programs tab 結構

- Tab land 第一畫面 = **active program 的 grid**（cycle_count × cycle_length 表格）。
- Tab 頂端有 program 切換 chip（若 ≥2 program）+ 編輯模式切換鈕（「編輯」⇄「完成」）。
- 每個 cell 顯示 3 sub-cell：日期 / template / 強度。Rest day 把 template + 強度兩格 merge 成單格「休」。
- 編輯模式打開：
  - 上方多 4 個 dropdown：**計劃 / 循環天數 / 週期數 / 起始日**（per wave 17）— 改循環維度走 `resizeProgram`、改起始日走 `updateProgramStartDate`、改計劃走切換 active program。
  - 每 column / row 多 ▶ 按鈕做 bulk apply（column → template + 保 sub_tag / 休息清空、row → sub_tag 避開休息 cell）。
  - Cell tap → 帶 preset 進就近 picker（Q5(a) 規格：往同 row 找最近 non-rest cell 的 template 當 preset）。
  - **長按拖曳 swap**（per wave 17）— 任意對任意（含休息/空白），原子化 swap (template_id, sub_tag) via `swapProgramCells`；目標格高亮、無 undo、無動畫（瞬間）。
- 「+ 新建計劃」永遠在 tab 頂端 entry → program-wizard。

### program-wizard 6 步式重寫

| Step | 標題 | 內容 | wave |
|---|---|---|---|
| 1 | 計劃名稱 + 強度組 | 計劃名 + 「↓ 載入計劃」按鈕 (≥1 program 才顯) + 強度 chip 列（多筆 + 自訂 + 「無強度」） | 18a + 18f |
| 2 | 週期設定 | 循環天數 + 週期數（既有 cycle 維度，改名） | 18a |
| 3 | 每訓練日 Template | per-day pick template；強度 UI 拿掉（不再 per-template）；slot 2 放「+ 新建」pill；template pill 用 `listTemplateGroupsByName` dedupe by name | 18b + 18g 8c32b04 |
| 4 | 每週期強度 | 每週期一個強度 chip（無強度 / Step1 強度 / 自訂）；pick 後內部展開 N 筆 override per day-with-template；data shape `overrides[]` 不變 | 18d |
| 5 | 預覽日曆 | layout：previewCycleLabel width 22 + previewCells flex:1 + gap:3（fix 7-day cycle 不換行）| 18e |
| 6 | 確認 + 儲存 | 名稱衝突偵測 → 「覆蓋」inline banner (`overwriteProgram`) 或 「建立」(`createProgram`)；按鈕 label 對應 | 18g 8b2075d |

**Step 1 ↔ Step 2 transition** 在 overwrite mode 即時 `recordProgramSubTag` loop（per ADR-0021 wave 18g `5ccc113`）— 確保 Step 1 強度進字典後立即可用於其他步驟。

**Header-mounted nav**（wave 18c）：取消 / 下一步從底部 navRow 搬到 `Stack.Screen` headerLeft/headerRight（text-button iOS modal convention、灰 secondary + 藍 primary、busy disable）。

**載入計劃 (Step 1)**（wave 18f）：bottom-sheet Modal 列既有 program (`listPrograms` + cycle dimensions + active marker)；pick → 名稱 + sub_tags 從 `listProgramSubTags(picked.id)` pre-fill。配合 client-side dup-guard `LOWER(TRIM(name))` 對齊 backend、input red border + ⚠️ inline + onNext Step1 Alert block。

### 覆蓋偵測（wave 18g, inline）

Step 6 偵測同名 program → render「將覆蓋既有計劃 X」紅底 hairline banner、按鈕 label `t('button','overwrite')`。
原本是 modal sheet two-stage state（overwriteTarget confirmed vs pendingOverwriteMatch tentative）；wave 18g `8b2075d` 改 inline detect（`useMemo` overwriteMatch from `[draft.name, programs]` + `useEffect` 抓 `listProgramSubTags(match.id)` 換 `draft.sub_tags`）— user feedback「附屬強度標籤直接出現不用跳方格」。砍 modal -117 LOC。

Trigger 後走 `overwriteProgram` write path（per ADR-0021 amendment）。

### Active session 守衛

`overwriteProgram` 在 transaction 開之前先 JOIN session ↔ session_exercise ↔ template.program_id 檢查 `ended_at IS NULL`；有就 throw `PROGRAM_HAS_ACTIVE_SESSION` 並 zero writes。

### Header 命名統一（wave 18a）

UI 上「Program 名稱」→「計劃名稱」、「Cycle 設定」→「週期設定」、「Cycle 長度」→「循環天數」、「Cycle 次數」→「週期數」、「Program 主」→「週期」、「Program 副」→「強度」。對齊 CONTEXT.md L405-410 terminology table（待 catch-up sweep；本 ADR 提筆鎖 wave 18a rename 結果）。

## Repository / domain helper 新增

per wave 15-18 的寫入路徑（已落地，本 ADR 鎖定 surface）：

- `swapProgramCells(db, {program_id, a, b, uuid, now})` — 原子化 swap (template_id, sub_tag)；sparse schema 4 情境（both / only A / only B / neither）；same-cell early return；sub_tag dictionary defensive re-register；7 case test。
- `updateProgramStartDate(db, {program_id, start_date, now})` — 3 case test（改 / 不存在 no-op / cells 不動）。
- `resizeProgram(db, {program_id, cycle_length, cycle_count, ...})` — 維度改變 + `countFilledCellsOutsideBounds` 警告 + 7 case test。
- `upsertCell` / `applyTemplateToColumn` / `applyTagToRow` — 三條 cell-level write path（per ADR-0021 已紀錄）。
- `overwriteProgram` — 第 4 條 bulk write path（per ADR-0021 wave 18g amendment）。
- Domain `programGridLayout.ts`（`cellDate` / `findNearestNonRestInRow` / `distinctSubTagsInProgram`）— 16 case test。
- Domain `expandWizardDraft`（per-cycle override expand）— wave 18d，含 mixed legacy 偵測 + tests。

## Alternatives considered

- **(a) 保留兩段式 list → grid** — 1-2 program 情境下 friction 過大、且編輯模式不存在；REJECT。
- **(b) 編輯模式採 modal 而非 inline** — 增加 nav depth、grid 不可見不利對照；REJECT。
- **(c) wizard 仍 3 步（名稱 / 維度 / 預覽）+ 強度延後到 grid 編輯模式才設** — wave 18 grill 拍板「強度應該在 wizard 就先想好」，因為日曆預覽 + 訓練計劃定型階段才填強度比較自然；REJECT。
- **(d) 用 modal sheet 偵測同名覆蓋** — wave 18g first cut 是 modal、user 反饋「強度標籤直接出現不用跳方格」→ inline pivot；MODAL REJECTED。

## Consequences

- **Tab navigation 一鍵到 grid** — 配 ADR-0004 cycle-based grid 為主視覺、單一 program 使用者體驗大幅優化。
- **Wizard 6 步比 3 步 friction 大** — 但每步單純（避免「綜合維度頁」式擁擠）、且 90% 重複使用者會走「載入計劃」route 跳過大半。
- **強度 UX 全面落地** — 從 wave 11 拍板（強度是 Template identity 的一環）到 wave 18 wizard、Programs grid row-apply、字典 picker、覆蓋偵測全鏈路打通。
- **覆蓋同名計劃語意 explicit** — `overwriteProgram` write path + active session guard + inline banner 確認，不再被誤觸發。
- **wave 18g 漸進 smoke-driven** — Phase 6 落地過程 11 commits + 5 iterations reload-driven smoke fix（模態 → inline pivot / Step 3 ＋新建 pill 位置 / Step 3 template pill dedupe / setState-in-updater anti-pattern fix / inline `Stack.Screen options={headerShown:false}` remount root-cause），驗證「漸進 + iteration 緊接」對 polish-critical UX 比一次大爆 commit 健壯（已記入 polish-loop skill）。

## References

- **Waves** —
  - wave 15 commit `d79657e` (2026-05-21) — tab 直接 grid + 編輯模式 + 三 apply affordance + resize + start_date
  - wave 17 commit `d667fca` (2026-05-21 evening) — 長按拖曳 swap + start_date dropdown
  - wave 18a–g commits `c725aa6..485d605` (2026-05-22) — wizard 6 步重寫 + 載入計劃 + per-cycle 強度 + 覆蓋偵測 + 11-commit Phase 6 polish
- **Source code** —
  - `app/(tabs)/programs.tsx` — tab grid + 編輯模式 + drag-swap UI
  - `app/program-wizard/new.tsx` — 6-step wizard 主檔
  - `src/adapters/sqlite/programRepository.ts` — 寫入路徑全集
  - `src/domain/programGridLayout.ts` — pure grid 計算
- **Tests** —
  - `tests/db/swapProgramCells.test.ts` (7 case)
  - `tests/db/updateProgramStartDate.test.ts` (3 case)
  - `tests/db/programResize.test.ts` (7 case)
  - `tests/db/overwriteProgram.test.ts` (7 case)
  - `tests/db/programApply.test.ts` (extended — cells + sub_tags)
  - `tests/domain/programGridLayout.test.ts` (16 case)
  - `tests/db/listProgramSubTags.test.ts` + `tests/db/recordProgramSubTag.test.ts` (per ADR-0021)
- **Related ADRs** —
  - ADR-0003 § 三元組 identity — 強度仍是 Template identity 的一環
  - ADR-0004 § Cycle-based grid — 本 ADR 不改 grid 本質、改的是 grid 的 UX surface
  - ADR-0021 § Persistent 強度 dictionary — 本 ADR 是 ADR-0021 的 UI 上下文
- **Skill** —
  - `polish-loop` 加入 2 anti-pattern（component-body inline `Stack.Screen options` in modal-pushed route → remount；跳過 WARN 直接推測 → 多次 partial-fix）
  - `program-sub-tag-union-source` 鎖 `Promise.all([listDistinctSubTagsByProgram, listProgramSubTags])` union 為強度 picker 唯一正確 read pattern
