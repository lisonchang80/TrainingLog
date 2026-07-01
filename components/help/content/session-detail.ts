/**
 * Help content — 訓練詳情/編輯頁 (`app/session/[id].tsx`).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour. This page is the EDITING TWIN of
 * the template editor, so the tour mirrors it. The tour auto-shows in VIEW mode
 * (the state the page opens in after a session ends / from history), so the
 * spotlight steps target VIEW-mode action-bar buttons. The page's editing
 * operations — the ⚙️ menu and the per-set gestures — only exist in EDIT mode,
 * which the tour isn't in, so they are screenshot-card steps interleaved in the
 * same tour (page-help-overlay constraint #6).
 *
 * 2026-07-01 — per-gesture split (user request「set 編輯的 i 補一頁，左滑/右滑/
 * 長按各一張小截圖」): the single combined sets card became a tap-only card +
 * three real-capture gesture cards (左滑刪除 / 右滑加組·備註 / 長按排序). The
 * swipe/long-press shots are SHARED across session-detail + today-session +
 * template-editor (same `SwipeableSetRow`) and live in `assets/help/gestures/`.
 *
 * EVERY operation verified against source + live sim on 2026-07-01 (not inferred
 * from handler names — user directive):
 *   - Bottom 4-button bar: 編輯訓練 (enterEditMode, view-mode slot 1) / 儲存模板
 *     (update, disabled when freestyle) / 另存模板 (create) / 刪除 (discardSession).
 *   - EDIT-mode set row: tap label cycles 正式→熱身→遞減組; tap a number cell opens
 *     the keypad; ○/✓ toggles logged. swipe LEFT = 刪除 (red); swipe RIGHT = ＋1·備註
 *     (green ＋1 + blue 備註); long-press = drag-reorder. (Session 右滑綠鈕＝「＋1」,
 *     vs template editor's「加」— both add a set; sim-verified 2026-07-01.)
 *
 * Spotlight targets (useCoachMarkTarget, view-mode action-bar Pressables):
 * session.edit / session.saveTemplate / session.delete.
 */
import type { LocalizedPageHelp } from '../types';

const GEAR_AR = 640 / 808; // gear-menu.png (solo ⚙️ ActionSheet)
const SETS_AR = 820 / 563; // sets.png (expanded edit-mode card — tap ops)
const SWIPE_AR = 1030 / 190; // swipe-left / swipe-right (shared row strip)
const DRAG_AR = 1030 / 350; // long-press (two rows)

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
        title: '點一下改',
        body: '點標籤切換 正式/熱身/遞減；點數字格改重量次數；點 ○ 標記完成。',
      },
      {
        image: require("@/assets/help/gestures/swipe-left.png"),
        aspectRatio: SWIPE_AR,
        title: '左滑刪除',
        body: '在一組上向左滑，出現紅色「刪除」，放開即刪掉這組。',
      },
      {
        image: require("@/assets/help/gestures/swipe-right.png"),
        aspectRatio: SWIPE_AR,
        title: '右滑加組・備註',
        body: '向右滑，綠色「＋1」加一組、藍色「備註」寫這組的筆記。',
      },
      {
        image: require("@/assets/help/gestures/long-press.png"),
        aspectRatio: DRAG_AR,
        title: '長按排序',
        body: '長按一組拖曳，可調整這個動作內各組的順序。',
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
        title: 'Tap to edit',
        body: 'Tap the label to cycle kind; tap a number cell to edit; tap ○ to mark done.',
      },
      {
        image: require("@/assets/help/gestures/swipe-left.png"),
        aspectRatio: SWIPE_AR,
        title: 'Swipe left to delete',
        body: 'Swipe a set left to reveal the red “Delete”, then release to remove it.',
      },
      {
        image: require("@/assets/help/gestures/swipe-right.png"),
        aspectRatio: SWIPE_AR,
        title: 'Swipe right to add / note',
        body: 'Swipe right: green “＋1” adds a set, blue “Note” jots a note for it.',
      },
      {
        image: require("@/assets/help/gestures/long-press.png"),
        aspectRatio: DRAG_AR,
        title: 'Long-press to reorder',
        body: 'Long-press a set and drag to reorder the sets within this move.',
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
