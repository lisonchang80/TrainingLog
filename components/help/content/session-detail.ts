/**
 * Help content — 訓練詳情/編輯頁 (`app/session/[id].tsx`).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour. This page is the EDITING TWIN of
 * the template editor, so the tour mirrors it (5 steps, 3 spotlight + 2
 * screenshot cards). The tour auto-shows in VIEW mode (the state the page opens
 * in after a session ends / from history), so the spotlight steps target
 * VIEW-mode action-bar buttons. The page's editing operations — the ⚙️ menu and
 * the per-set gestures — only exist in EDIT mode, which the tour isn't in, so
 * they are screenshot-card steps interleaved in the same tour
 * (page-help-overlay constraint #6), exactly like the template editor.
 *
 * EVERY operation verified against source on 2026-06-29 (not inferred from
 * handler names — user directive):
 *   - Bottom 4-button bar: 編輯訓練 (enterEditMode, view-mode slot 1
 *     `app/session/[id].tsx:2237-2246`) / 儲存模板 (update, slot 2, disabled when
 *     freestyle) / 另存模板 (create, slot 3 :2259) / 刪除 (discardSession, slot 4
 *     :2269). In edit mode slot 1 becomes 「+ 動作」.
 *   - The card ⚙️ menu (EDIT mode only) is built in `onSettingsPress` :1442-1477:
 *     SOLO = 編輯備註 · 休息秒數 · 刪除動作 · 排序動作 (the gear-menu.png shot is a
 *     solo card); CLUSTER also inserts 動作歷史 (A)/(B). NO「改器材」, NO「設為常設」.
 *   - EDIT-mode set row (sets.png): tap label cycles 正式→熱身→遞減組
 *     (`set-row-content.tsx:170-192`); tap a number cell opens the keypad
 *     (:194-225); swipe LEFT = 刪除 (:2909-2916), swipe RIGHT = +1·備註
 *     (:2917-2930); long-press = drag-reorder (:2907-2908); ○/✓ toggles logged
 *     (:2971-2992). View-mode rows are READ-ONLY.
 *
 * Spotlight targets (useCoachMarkTarget, attached to the view-mode action-bar
 * Pressables): session.edit / session.saveTemplate / session.delete.
 * Screenshot cards live in `assets/help/session-detail/` — recapture (with a
 * session opened in EDIT mode) if the ⚙️ menu or set-row layout changes.
 */
import type { LocalizedPageHelp } from '../types';

const GEAR_AR = 640 / 808; // gear-menu.png (solo ⚙️ ActionSheet)
const SETS_AR = 820 / 563; // sets.png (expanded edit-mode card)

export const sessionDetailHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'session.edit',
        title: '編輯訓練',
        body: '點這裡進入編輯，可改動作、組數與重量。',
      },
      {
        image: require('@/assets/help/session-detail/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ 選單',
        body: '編輯備註、休息秒數、刪除動作、排序動作。',
      },
      {
        image: require('@/assets/help/session-detail/sets.png'),
        aspectRatio: SETS_AR,
        title: '改每一組',
        body: '點標籤切換 正式/熱身/遞減；點數字改重量次數；左滑刪、右滑加組；長按排序。',
      },
      {
        targetId: 'session.saveTemplate',
        title: '存成模板',
        body: '把這次訓練「另存模板」重複用；「儲存模板」則更新原模板。',
      },
      {
        targetId: 'session.delete',
        title: '刪除',
        body: '不要這筆紀錄就按「刪除」。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'session.edit',
        title: 'Edit session',
        body: 'Tap here to edit the moves, sets and weights.',
      },
      {
        image: require('@/assets/help/session-detail/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ menu',
        body: 'Note, rest seconds, delete move, reorder moves.',
      },
      {
        image: require('@/assets/help/session-detail/sets.png'),
        aspectRatio: SETS_AR,
        title: 'Edit each set',
        body: 'Tap label to cycle kind; tap cells to edit; swipe to delete / add; long-press to reorder.',
      },
      {
        targetId: 'session.saveTemplate',
        title: 'Save as template',
        body: '“Save as” makes a reusable template; “Save” updates the original.',
      },
      {
        targetId: 'session.delete',
        title: 'Delete',
        body: 'Tap Delete to remove this session record.',
      },
    ],
  },
};
