/**
 * Help content — 計劃頁 (`app/(tabs)/programs.tsx`), mode-aware.
 *
 * The ⓘ (HelpButton) is ALWAYS visible (programs.tsx:909, outside the editing
 * conditional), so the page dispatches `editing ? programsEditHelp : programsViewHelp`
 * — mirroring session/[id]'s view/edit split.
 *
 * 2026-07-02 — user request「計劃表（非編輯）簡化，只需遮罩說明佈局就好」:
 *   - programsViewHelp (非編輯/idle): a LIGHT layout coach — 3 spotlights only
 *     (grid / 編輯 button / 管理列), NO screenshot cards. Just explains what the
 *     grid IS and where to go, since the idle grid is READ-ONLY.
 *   - programsEditHelp (編輯): keeps the detailed edit tour the user asked for
 *     earlier (下拉/▼/▶/拖曳 = 4 screenshot cards) + a grid intro spotlight. The
 *     idle-only「刪除」manage step is dropped (that row is hidden in edit mode).
 *
 * CRITICAL source facts (verified, NOT inferred):
 *   - Grid layout: each ROW = one cycle (週期), each COLUMN = a day within the
 *     cycle; a cell shows that day's template + intensity. (▼ applies down a
 *     day-column, ▶ applies across a cycle-row — programs.tsx :1311/:1333.)
 *   - Idle grid is READ-ONLY; every cell interaction is gated behind edit mode
 *     (ProgramGrid taps :1400 `editing && !isDragging`, CellWrapper long-press
 *     drag :1406 `enabled={editing}`, editControls dropdowns :939-961).
 *   - Manage row (刪除計劃/刪除強度) only renders when `!editing` (:913).
 *
 * Spotlight anchors: programs.grid (:982) / programs.edit (:888, idle-only
 * header button) / programs.manage (:916, idle-only row). Screenshot cards live
 * in `assets/help/programs/` — recapture (in edit mode) if the dropdown row or
 * grid layout changes.
 */
import type { LocalizedPageHelp } from '../types';

const DROPDOWNS_AR = 820 / 136; // dropdowns.png (4 edit-mode dropdowns)
const GRID_AR = 820 / 209; // grid.png (edit-mode grid: ▼ row + ▶ + cells)

// ── 非編輯（idle）：純佈局遮罩，只聚光、不放截圖卡 ──────────────────────────
export const programsViewHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'programs.grid',
        title: '課表格子',
        body: '啟用計劃的每日課表：每一列是一個週期（循環），每一欄是週期中的某一天，每格顯示那天的模板與強度。預設唯讀。',
      },
      {
        targetId: 'programs.edit',
        title: '編輯',
        body: '要換模板、調整強度或改計劃設定，先按「編輯」。',
      },
      {
        targetId: 'programs.manage',
        title: '刪除計劃 / 強度',
        body: '「刪除計劃」整支移除這個計劃；「刪除強度」清掉某個強度分類。',
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
        body: 'Your active program’s day-by-day schedule: each row is one cycle, each column a day within it, and each cell shows that day’s template and intensity. Read-only.',
      },
      {
        targetId: 'programs.edit',
        title: 'Edit',
        body: 'Tap “Edit” to swap templates, adjust intensity, or change program settings.',
      },
      {
        targetId: 'programs.manage',
        title: 'Delete program / intensity',
        body: '“Delete program” removes this program entirely; “Delete intensity” clears one intensity tag.',
      },
    ],
  },
};

// ── 編輯模式：保留 4 卡明細（下拉/▼/▶/拖曳）+ grid 引言聚光 ─────────────────
export const programsEditHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'programs.grid',
        title: '課表格子',
        body: '編輯模式：點格子中間換模板、點下排改強度。以下是幾個快捷：',
      },
      {
        image: require('@/assets/help/programs/dropdowns.png'),
        aspectRatio: DROPDOWNS_AR,
        title: '改計劃設定',
        body: '上方 4 個下拉：計劃、循環天數、週期數、起始日。',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: '整欄套用 ▼',
        body: '最上排的 ▼：把那一天（整欄）套用同一個模板。',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: '整列套用 ▶',
        body: '最左欄的 ▶：把那個週期（整列）套用同一個強度。',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: '拖曳交換',
        body: '長按任一格再拖到別格，交換兩天的課表。',
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
        body: 'Edit mode: tap a cell’s middle to swap its template, the bottom to change intensity. A few shortcuts:',
      },
      {
        image: require('@/assets/help/programs/dropdowns.png'),
        aspectRatio: DROPDOWNS_AR,
        title: 'Program settings',
        body: '4 dropdowns up top: program, cycle length, cycle count, start date.',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: 'Apply down a column ▼',
        body: 'The ▼ on top applies one template down that whole day-column.',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: 'Apply across a row ▶',
        body: 'The ▶ on the left applies one intensity across that whole cycle-row.',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: 'Drag to swap',
        body: 'Long-press any cell, then drag it onto another to swap those two days.',
      },
    ],
  },
};
