---
name: mirror-template-from-session
description: Apply session card layout/behavior patterns to template editor when user reports visual inconsistency between the two. Trigger words 「template (editor) 跟 session 不一致」、「對齊 session」、「mirror session」、「session 有 X 但 template 沒有」、「為什麼 template 沒有 X」. Applies specifically to TrainingLog cluster card + set row rendering — survey session as the source-of-truth, propagate to template editor.
---

# Mirror Template from Session — UI consistency SOP

當使用者報告 template editor 跟 session 對應元件視覺/行為不一致時用這個 SOP。Slice 10c 累積 3+ 次此類 polish（#45 cluster header、#49 inline drag、#52 shared label）— 每次都是同樣的 5 步、不要重新發明流程。

**Rule of thumb**: session 端是 source of truth（用戶天天看）、template editor 對齊它、不反過來。

## Step 1 — Survey session 端 reference layout

找出 session 對應元件的具體實作（**不要憑記憶推測**）：

- Solo set row → `app/(tabs)/index.tsx` `ExerciseCard` body（`NestableDraggableFlatList` renderItem 區段）
- Cluster cycle row → `components/session/cluster-card.tsx` `NestableDraggableFlatList` renderItem 區段
- Set row content (cells / inputs) → `components/shared/set-row-content.tsx`（SetRowContent component、`compact` boolean 切尺寸、含 `hideLabel` / `hideNoteIndicator` 等 conditional props）
- Cluster header (chip / title) → `components/session/cluster-card.tsx` header 區段

對於非 trivial sizing / layout 用 Explore agent 列具體數值（minWidth / padding / fontSize），不要看一眼就猜。

## Step 2 — Survey template editor 對應位置

`components/template-editor/template-editor-view.tsx` 內：
- Solo body → 找 `NestableDraggableFlatList<SetGroup>` renderItem（line ~2099）
- Cluster body → 找 inner `NestableDraggableFlatList<CycleItem>` + `renderCell` helper（line ~1407）
- 共用樣式（exSuperRow / exSuperCycleRow / exSuperCol / setsBox）通常聚集在 styles 物件後段

對齊 wrapper style 通常需要：
- `exSuperCycleRow` cycle row wrapper（paddingV / gap）
- `exSuperCol` 兩側 cell 容器（flex: 1）
- `exSuperDivider` A/B 中間 hairline
- `supersetRowNoteSlot` 右側 note placeholder

## Step 3 — 評估改動類型

四種 case、由小到大：

### A. 純樣式對齊（最常見）
數值差異 only — 直接調 styles 物件值即可。**單檔改動**。範例：#52 cluster cell padding 撐爆 fine-tune（`setInputCompact` 數值縮）。

### B. 加共用 prop variant
SetRowContent 內部需要新行為（隱藏 label / 隱藏 note indicator etc.）— 看 SetRowContent 是否已有對應 prop（**先 grep `hideLabel` / `hideNoteIndicator` 之類**），有就直接傳；沒有再加新 prop。範例：#52 follow-up `hideLabel` 已存在、template renderCell 加 `hideLabel` flag 就完成。

### C. 加新 sub-element (shared element)
Template editor 缺整個元件、需新增 + 對齊 column 寬度 spacer：
- 加新 Pressable / View 在 row 開頭/末尾
- 加對應 styles 物件
- **不要忘記** column header (`exSuperRow`) 同步加 spacer 對齊 column 起點

範例：#52 follow-up 加 `exClusterSharedLabel` shared `#` button + column header `exClusterSharedLabelSpacer` (width 28)。

### D. 加 atomic operation helper
Session 有 cluster atomic op（如 cycleSetKindAcrossExercises）— template editor 通常**已有相同 helper**（`src/domain/template/templateOps.ts`），只是沒在 UI wire 起來。**先 grep helper 名稱**確認、再決定要不要寫新的。

## Step 4 — Atomic A+B operation 不要重寫

Cluster A+B paired invariant（A 跟 B 同 idx 必須同 set_kind / 同 ordering / 配對不可拆）是 ADR-0016 §A。Session 跟 template editor 都已用同一 helper：

- `cycleSetKindAcrossExercises` (templateOps.ts) — atomic flip A+B 兩側 set_kind、cluster path 自動 mirror
- `reorderTemplateClusterCycles` (templateOps.ts) — atomic A+B 兩側 cycle reorder

**Tap shared element 只需 call A 側即可**、helper 內 mirror 到 B 側。不要在 UI 層 dispatch 兩次。

## Step 5 — 對齊 column header alignment

當 cycle row 加新 element（shared label / leading spacer / trailing icon），對應 column header (`exSuperRow` 標題列「Cable Crossover / Chest Dip」) 也要加同寬 spacer、否則 column 起點偏移。

Session 端對應 — `sideLabelLead` (width 28) + `sideLabelGap` (width 52)。Template editor 端就是 `exClusterSharedLabelSpacer`、`supersetRowNoteSlot`。

## When NOT to use

- 改的是 session 端 layout 本身（這個 SOP 是「session→template」方向、反向需要更謹慎、可能需 ADR）
- 改 set-row-content.tsx 內部 props/styles（共用 component、影響 session + template 兩處、要兩邊都驗）
- 用戶要的是「session 跟 template 都改」(uniform new spec)、而非「template 對齊 session」

## Verify

- `npx tsc --noEmit` clean
- `npm test` — pure domain helpers test 一定要綠（templateOps）；UI styling 改動本身無 test、視覺驗在 reload
- 用戶 reload smoke 確認、特別注意 cluster A+B + ✓ + note slot 在 iPhone 寬度容納度

## Anti-patterns

- 不看 session 實作直接 hack template — 兩邊永遠對不上
- 不查 SetRowContent 既有 props 直接重寫 cell render — 通常想要的 prop 已存在
- 加新 cycle row element 但忘記 column header spacer — column 永遠歪
- 在 UI 層手動 dispatch atomic 兩次（A 一次 / B 一次）— 用 templateOps helper、helper 已 atomic
- 將 mirror 工作 fork 給 overnight agent 而 spec 仍在 grill — agent 沒 UI 反饋、會猜錯
