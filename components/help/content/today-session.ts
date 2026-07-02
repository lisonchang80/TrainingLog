/**
 * Help content — 開始訓練 / 訓練進行中 (Today tab in-session view,
 * `app/(tabs)/index.tsx` in_progress branch).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour, mirroring the template editor +
 * session-detail EDIT tour (user request 2026-07-01「開始訓練的 ⓘ 只有一頁，做得
 * 跟編輯模板相似」). Spotlight steps target the FIXED chrome (bottom sticky
 * [加入動作] + header ⋯ / 完成), and the per-set gestures — which a spotlight ring
 * can't frame and which live in the memoized scrolling set-row subtree — are
 * screenshot-card steps interleaved in the same sequence (page-help-overlay
 * constraint #6). All three spotlight targets sit OUTSIDE the scroll container,
 * so the tour needs no `useCoachScroller` (avoids the step-1 scroll landmine).
 *
 * The 打勾/改數字 card uses a today-session-specific screenshot (`sets.png`, the
 * live-logging set row). The 左滑/右滑/長按 shots are the SHARED gesture assets in
 * `assets/help/gestures/` (same `SwipeableSetRow` as session-detail + template
 * editor). In-session 右滑 green button reads「＋1」(matches session-detail).
 *
 * Spotlight targets (useCoachMarkTarget, in-session chrome):
 *   today.session.add / today.session.menu / today.session.finish
 * The per-card ⚙️ menu (reuses session-detail/gear-menu.png — same options) is a
 * screenshot card. The header ⋯ menu is a SPOTLIGHT on the fixed ⋯ button
 * (2026-07-01 user request「⋯ 選單可以用遮罩」— ⋯ is fixed header chrome, so a ring
 * lands on it cleanly; body text still lists what's inside the ActionSheet).
 *
 * ⚠ HOST SAFETY unchanged: the in-session branch UNMOUNTS on a Watch-led session
 * end. `inSessionHelp.close()` fires synchronously at the top of
 * `finalizeEndAndRoute` (both end paths) + a status-transition effect backstop,
 * so the overlay (InfoModal OR CoachMarkOverlay — same handle) never orphans.
 */
import type { LocalizedPageHelp } from '../types';

const SETS_AR = 1092 / 735; // today-session/sets.png (live-logging set row — tap ops)
const LABEL_AR = 820 / 563; // gestures/set-label-cycle.png (set-number label red-box)
const GEAR_AR = 640 / 808; // session-detail/gear-menu.png (per-card ⚙️ ActionSheet — SHARED, same options)
const SWIPE_AR = 1030 / 190; // swipe-left / swipe-right row strip
const DRAG_AR = 1030 / 350; // long-press (two rows)

export const todaySessionHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'today.session.add',
        title: '加入動作',
        body: '點這裡從動作庫把動作加進這次訓練。',
      },
      {
        image: require('@/assets/help/today-session/sets.png'),
        aspectRatio: SETS_AR,
        title: '打勾完成・點格子改',
        body: '點 ✓ 標記完成一組（休息計時自動跳出）；點數字格改重量·次數。',
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle.png'),
        aspectRatio: LABEL_AR,
        title: '切換組別',
        body: '點紅框內的編號標籤，可循環切換 正式組 / 熱身組 / 遞減組。',
      },
      {
        image: require('@/assets/help/session-detail/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ 動作卡選單',
        body: '點動作卡右側 ⚙️：編輯備註、休息秒數、刪除動作、排序動作。',
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
      {
        targetId: 'today.session.menu',
        title: '⋯ 選單',
        body: '點右上角 ⋯：儲存/另存模板、投影到手錶、身體數據、捨棄這次訓練。',
      },
      {
        targetId: 'today.session.finish',
        title: '完成訓練',
        body: '練完按「完成」，這次訓練會存進歷史。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'today.session.add',
        title: 'Add exercises',
        body: 'Tap here to add moves from the library to this workout.',
      },
      {
        image: require('@/assets/help/today-session/sets.png'),
        aspectRatio: SETS_AR,
        title: 'Tick to finish / tap to edit',
        body: "Tap ✓ to finish a set (the rest timer pops up); tap a number cell to edit weight / reps.",
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle.png'),
        aspectRatio: LABEL_AR,
        title: 'Switch set type',
        body: 'Tap the boxed set-number label to cycle working / warm-up / drop set.',
      },
      {
        image: require('@/assets/help/session-detail/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ exercise-card menu',
        body: "Tap the ⚙️ on an exercise card: edit note, rest seconds, delete move, reorder moves.",
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
      {
        targetId: 'today.session.menu',
        title: '⋯ menu',
        body: 'Tap the top-right ⋯: save / save-as template, cast to Watch, body data, discard.',
      },
      {
        targetId: 'today.session.finish',
        title: 'Finish workout',
        body: 'Tap Done when you’re finished; the session is saved to history.',
      },
    ],
  },
};
