/**
 * Help content — 計劃頁 (`app/(tabs)/programs.tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩.
 *
 * CRITICAL source fact (verified 2026-06-29, NOT inferred): the grid is
 * READ-ONLY in idle mode. EVERY cell interaction is gated behind edit mode:
 *   - cell taps (template / sub-tag / rest): `tapsEnabled = editing && !isDragging`
 *     (ProgramGrid :1367) → disabled when not editing.
 *   - ▼ column-apply (:1311-1328) and ▶ row-apply (:1333-1343): rendered ONLY
 *     `editing ? …`; in idle the left column shows plain「C1/C2」labels (:1345).
 *   - long-press 300ms drag-swap: `enabled={editing}` (CellWrapper :1373,
 *     `.activateAfterLongPress(300)` :1508), edit-mode only (:185 comment).
 *   - the 計劃/循環天數/週期數/起始日 dropdowns (`styles.editControls`
 *     :939-961) render ONLY when editing.
 * The help auto-shows in IDLE, so the copy MUST say "press 編輯 first" — it must
 * NOT claim the cells are tappable as-shown.
 *
 * Idle-mode anchors (what's actually on screen when help auto-shows):
 *   - 編輯 button (header, :874-882) → programs.edit (carries the edit-mode
 *     interaction explanation).
 *   - 管理列 `styles.manageRow` (:898-924, `!editing` only) → programs.manage
 *     (刪除計劃 / 刪除強度).
 *   - ProgramGrid (:964) → programs.grid (read-only schedule view).
 */
import type { LocalizedPageHelp } from '../types';

export const programsHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'programs.grid',
        title: '課表格子',
        body: '這是目前啟用計劃的每日課表，每格顯示日期、模板與強度。預設是唯讀檢視——要修改先按右上「編輯」。',
      },
      {
        targetId: 'programs.edit',
        title: '編輯計劃',
        body: '進編輯模式後：點格子中間換模板、點下排改強度；長按格子可拖曳交換兩天；最上排 ▼ 整欄套用、最左欄 ▶ 整列套用；上方也能改 計劃／循環天數／週期數／起始日。',
      },
      {
        targetId: 'programs.manage',
        title: '刪除',
        body: '閒置時這列可「刪除計劃」整支移除，或「刪除強度」清掉某個強度分類。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'programs.grid',
        title: 'Schedule grid',
        body: 'Your active program’s day-by-day schedule — each cell shows date, template and intensity. It’s read-only by default; tap “Edit” (top-right) to change it.',
      },
      {
        targetId: 'programs.edit',
        title: 'Edit the program',
        body: 'In edit mode: tap a cell’s middle to swap its template, the bottom row to change intensity; long-press a cell to drag-swap two days; ▼ applies down a column, ▶ across a row; you can also change program / cycle length / cycle count / start date.',
      },
      {
        targetId: 'programs.manage',
        title: 'Delete',
        body: 'When idle, this row lets you “Delete program” entirely, or “Delete intensity” to clear an intensity tag.',
      },
    ],
  },
};
