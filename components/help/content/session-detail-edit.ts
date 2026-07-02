/**
 * Help content — 歷史 Session 編輯訓練 · 編輯模式 (`app/session/[id].tsx`,
 * editMode === true).
 *
 * style: 'coach' (numbered) — the EDITING tour, mirroring the template editor
 * (user request 2026-07-01「歷史編輯訓練，也要跟編輯模板參考」). Opens with a
 * spotlight on the edit-mode [+ 動作] button, then the per-card ⚙️ menu + set-row
 * tap ops + swipe/long-press gestures as screenshot cards (a ring can't frame a
 * pop-up ActionSheet or a swipe). Same assets as the template editor / the old
 * combined session-detail tour: `assets/help/session-detail/{gear-menu,sets}.png`
 * + the shared `assets/help/gestures/*`.
 *
 * Spotlight target (useCoachMarkTarget, edit-mode action bar):
 *   session.addExercise  → the [+ 動作] Pressable (edit-mode slot 1, fixed bottom
 *   bar → no scroller needed).
 *
 * The matching VIEW-mode layout tour lives in `session-detail-view.ts`; the page
 * dispatches `editMode ? sessionDetailEditHelp : sessionDetailViewHelp`.
 *
 * Verified against source + the old session-detail.ts (which this splits from):
 *   - ⚙️ menu = 備註 · 休息秒數 · 刪除動作 · 排序動作.
 *   - EDIT-mode set row: tap label cycles 正式→熱身→遞減; tap number cell = keypad;
 *     ○/✓ toggles logged. swipe LEFT = 刪除 (red); swipe RIGHT = ＋1·備註 (green ＋1
 *     + blue 備註); long-press = drag-reorder.
 */
import type { LocalizedPageHelp } from '../types';

const GEAR_AR = 640 / 808; // gear-menu.png (solo ⚙️ ActionSheet)
const SETS_AR = 820 / 459; // sets.png (expanded edit-mode card — tap ops; note banner cropped)
const SWIPE_AR = 1030 / 190; // swipe-left / swipe-right (shared row strip)
const DRAG_AR = 1030 / 350; // long-press (two rows)

export const sessionDetailEditHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'session.addExercise',
        title: '加入動作',
        body: '點「＋動作」從動作庫把動作加進這次訓練。',
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
        body: '點數字格改重量次數；點 ○ 標記完成。',
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle.png'),
        aspectRatio: SETS_AR,
        title: '切換組別',
        body: '點紅框內的編號標籤，可循環切換 正式組 / 熱身組 / 遞減組。',
      },
      {
        image: require('@/assets/help/gestures/swipe-left.png'),
        aspectRatio: SWIPE_AR,
        title: '左滑刪除',
        body: '在一組上向左滑，出現紅色「刪除」，放開即刪掉這組。',
      },
      {
        image: require('@/assets/help/gestures/swipe-right.png'),
        aspectRatio: SWIPE_AR,
        title: '右滑加組・備註',
        body: '向右滑，綠色「＋1」加一組、藍色「備註」寫這組的筆記。',
      },
      {
        image: require('@/assets/help/gestures/long-press.png'),
        aspectRatio: DRAG_AR,
        title: '長按排序',
        body: '長按一組拖曳，可調整這個動作內各組的順序。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'session.addExercise',
        title: 'Add exercises',
        body: 'Tap “+ Exercise” to add moves from the library to this workout.',
      },
      {
        image: require('@/assets/help/session-detail/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ menu',
        body: 'Edit note, rest seconds, delete move, reorder moves.',
      },
      {
        image: require('@/assets/help/session-detail/sets.png'),
        aspectRatio: SETS_AR,
        title: 'Tap to edit',
        body: 'Tap a number cell to edit; tap ○ to mark done.',
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle.png'),
        aspectRatio: SETS_AR,
        title: 'Switch set type',
        body: 'Tap the boxed set-number label to cycle working / warm-up / drop set.',
      },
      {
        image: require('@/assets/help/gestures/swipe-left.png'),
        aspectRatio: SWIPE_AR,
        title: 'Swipe left to delete',
        body: 'Swipe a set left to reveal the red “Delete”, then release to remove it.',
      },
      {
        image: require('@/assets/help/gestures/swipe-right.png'),
        aspectRatio: SWIPE_AR,
        title: 'Swipe right to add / note',
        body: 'Swipe right: green “＋1” adds a set, blue “Note” jots a note for it.',
      },
      {
        image: require('@/assets/help/gestures/long-press.png'),
        aspectRatio: DRAG_AR,
        title: 'Long-press to reorder',
        body: 'Long-press a set and drag to reorder the sets within this move.',
      },
    ],
  },
};
