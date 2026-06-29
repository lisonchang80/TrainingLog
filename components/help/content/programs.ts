/**
 * Help content — 計劃頁 (`app/(tabs)/programs.tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩.
 *
 * 2026-06-29 — split the edit flow finer (user request: 下拉式選單 / 縱列 /
 * 橫列 / 拖曳 each its own step). Those four controls are EDIT-MODE-ONLY and the
 * tour auto-shows in IDLE, so they're SCREENSHOT-CARD steps (captured in edit
 * mode), interleaved with the idle spotlights — same hybrid pattern as
 * session/[id]. (Four card steps here exceeds the usual ≤3 guideline; the user
 * explicitly wanted this granularity.)
 *
 * CRITICAL source fact (verified, NOT inferred): the grid is READ-ONLY in idle
 * — every cell interaction is gated behind edit mode (ProgramGrid:1367 taps,
 * :1311/:1333 ▼/▶ apply rows, CellWrapper:1373 long-press drag, editControls
 * :939-961 dropdowns). The copy says "press 編輯 first" and never claims the
 * idle cells are tappable.
 *
 * Spotlight anchors (idle): programs.grid (:964) / programs.manage (:898-924).
 * Screenshot cards live in `assets/help/programs/` — recapture (in edit mode)
 * if the dropdown row or grid layout changes.
 */
import type { LocalizedPageHelp } from '../types';

const DROPDOWNS_AR = 820 / 136; // dropdowns.png (4 edit-mode dropdowns)
const GRID_AR = 820 / 209; // grid.png (edit-mode grid: ▼ row + ▶ + cells)

export const programsHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'programs.grid',
        title: '課表格子',
        body: '這是目前啟用計劃的每日課表，每格顯示日期、模板與強度。預設唯讀——按右上「編輯」才能改。編輯模式能做這些：',
      },
      {
        image: require('@/assets/help/programs/dropdowns.png'),
        aspectRatio: DROPDOWNS_AR,
        title: '改計劃設定',
        body: '編輯模式上方有 4 個下拉：計劃、循環天數、週期數、起始日。',
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
        body: '最左欄的 ▶：把那個週期（整列）套用同一個強度。點格子中間換模板、點下排改強度。',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: '拖曳交換',
        body: '長按任一格再拖到別格，交換兩天的課表。',
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
        body: 'Your active program’s day-by-day schedule (date / template / intensity). Read-only by default — tap “Edit” (top-right) to change it. In edit mode you can:',
      },
      {
        image: require('@/assets/help/programs/dropdowns.png'),
        aspectRatio: DROPDOWNS_AR,
        title: 'Program settings',
        body: 'Edit mode adds 4 dropdowns up top: program, cycle length, cycle count, start date.',
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
        body: 'The ▶ on the left applies one intensity across that whole cycle-row. Tap a cell’s middle to swap its template, the bottom to change intensity.',
      },
      {
        image: require('@/assets/help/programs/grid.png'),
        aspectRatio: GRID_AR,
        title: 'Drag to swap',
        body: 'Long-press any cell, then drag it onto another to swap those two days.',
      },
      {
        targetId: 'programs.manage',
        title: 'Delete',
        body: 'When idle, this row lets you “Delete program” entirely, or “Delete intensity” to clear an intensity tag.',
      },
    ],
  },
};
