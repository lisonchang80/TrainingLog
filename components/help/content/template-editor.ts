/**
 * Help content — 模板編輯器 (`components/template-editor/template-editor-view.tsx`).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour. Steps that point at a real
 * on-screen element use a spotlight; steps a ring can't frame (the ⚙️ pop-up
 * menu, the per-set gestures) use a screenshot card interleaved in the same
 * sequence (CoachStep.image). 2 of the 5 steps are screenshot cards (≤3).
 *
 * EVERY operation was verified against source on 2026-06-29 (not inferred from
 * handler names — user directive):
 *   - ⚙️ menu = 備註 · 休息時間 · 移動動作 · 設為常設/一般 · 刪除
 *       (`openGearMenu` template-editor-view.tsx:1928 — there is NO「改器材」)
 *   - 點標籤 = 3-way cycle 正式→熱身→遞減組 (`cycleSetKind` templateOps.ts:209)
 *   - 左滑=刪除 / 右滑=複製一組·備註 (ExerciseBody swipe arrays :3430-3451)
 *   - 點數字格 = inline 直接輸入；長按組 = 拖曳排序；底部 = 新增 1 組 / 動作歷史
 *
 * Spotlight targets (useCoachMarkTarget):
 *   template.addExercise (加入動作鈕) / template.card (第一張動作卡) /
 *   template.start (開始訓練鈕)
 * Screenshot cards live in `assets/help/template-editor/` — recapture if the
 * editor's ⚙️ menu / set row layout changes (see that folder's README).
 */
import type { LocalizedPageHelp } from '../types';

const GEAR_AR = 720 / 1057; // gear-menu.png
const SETS_AR = 1000 / 673; // sets.png

export const templateEditorHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'template.addExercise',
        title: '加入動作',
        body: '點這裡，從動作庫挑動作加進模板。',
      },
      {
        targetId: 'template.card',
        title: '動作卡',
        body: '點卡片展開看組；長按換順序；點右側 ⚙️ 開更多。',
      },
      {
        image: require('@/assets/help/template-editor/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ 選單',
        body: '備註、休息時間、移動動作、設為常設、刪除。',
      },
      {
        image: require('@/assets/help/template-editor/sets.png'),
        aspectRatio: SETS_AR,
        title: '設定每一組',
        body: '點標籤循環 正式→熱身→遞減；點數字改重量·次數；左滑刪、右滑複製；長按排序。',
      },
      {
        targetId: 'template.start',
        title: '儲存或開始',
        body: '編好按左上「儲存」，或按「開始訓練」直接開練。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'template.addExercise',
        title: 'Add exercises',
        body: 'Tap here to pick moves from the library.',
      },
      {
        targetId: 'template.card',
        title: 'Exercise card',
        body: 'Tap to expand; long-press to reorder; tap ⚙️ for more.',
      },
      {
        image: require('@/assets/help/template-editor/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ menu',
        body: 'Note, rest time, move, make evergreen, delete.',
      },
      {
        image: require('@/assets/help/template-editor/sets.png'),
        aspectRatio: SETS_AR,
        title: 'Set up each set',
        body: 'Tap label to cycle working→warm-up→drop; tap cells to edit; swipe left to delete, right to clone; long-press to reorder.',
      },
      {
        targetId: 'template.start',
        title: 'Save or start',
        body: 'Tap Save (top-left), or Start workout to begin.',
      },
    ],
  },
};
