/**
 * Help content — 訓練進行中（Today tab in-session view）.
 *
 * style: 'info' — a "hidden gestures" 說明視窗 with interleaved text + screenshot
 * `blocks` (2026-07-01, user request「set 編輯的 i 補一頁，左滑/右滑/長按各一張小
 * 截圖」). These gestures are swipe/long-press motions a coach ring can't frame,
 * and the set rows live in a memoized conditional subtree that's hard to tag, so
 * this is the `info` screenshot-flow fallback (page-help-overlay constraint #6).
 *
 * The 左滑 / 右滑 / 長按 shots are the SHARED gesture assets under
 * `assets/help/gestures/` (same `SwipeableSetRow` as session-detail). The in-
 * session 右滑 green button reads「＋1」(matches session-detail; the template
 * editor's is「加」— see template-editor.ts). Gestures verified against
 * `components/session/cluster-card.tsx` + `SwipeableSetRow` + live sim 2026-07-01.
 *
 * ⚠ HOST SAFETY: this help must NOT be hosted as a `<Modal>` inside the in-session
 * branch, which unmounts on a Watch-led session end (2026-06-29 stuck-overlay).
 * The wire in `app/(tabs)/index.tsx` closes the handle synchronously at the top of
 * `finalizeEndAndRoute` (both end paths) + a status-transition effect backstop.
 */
import type { LocalizedPageHelp } from '../types';

const SWIPE_AR = 1030 / 190; // swipe-left / swipe-right row strip
const DRAG_AR = 1030 / 350; // long-press (two rows)

export const todaySessionHelp: LocalizedPageHelp = {
  zh: {
    style: 'info',
    info: {
      title: '訓練中的隱藏手勢',
      blocks: [
        {
          kind: 'text',
          heading: '打勾完成一組',
          body: '點該組的 ✓ 標記完成，休息計時會自動跳出。',
        },
        {
          kind: 'text',
          heading: '改重量／次數',
          body: '直接點數字格，跳出數字鍵盤即可修改。',
        },
        {
          kind: 'text',
          heading: '左滑刪除',
          body: '在一組上向左滑，出現紅色「刪除」，放開即刪掉這組。',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/swipe-left.png'),
          aspectRatio: SWIPE_AR,
        },
        {
          kind: 'text',
          heading: '右滑加組・備註',
          body: '向右滑，綠色「＋1」加一組、藍色「備註」寫這組的筆記。',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/swipe-right.png'),
          aspectRatio: SWIPE_AR,
        },
        {
          kind: 'text',
          heading: '長按排序',
          body: '長按一組拖曳，可調整這個動作內各組的順序。',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/long-press.png'),
          aspectRatio: DRAG_AR,
        },
      ],
    },
  },
  en: {
    style: 'info',
    info: {
      title: 'Hidden gestures while training',
      blocks: [
        {
          kind: 'text',
          heading: 'Tick to finish a set',
          body: "Tap a set's ✓ to mark it done; the rest timer pops up.",
        },
        {
          kind: 'text',
          heading: 'Edit weight / reps',
          body: 'Tap a number cell to open the keypad and change it.',
        },
        {
          kind: 'text',
          heading: 'Swipe left to delete',
          body: 'Swipe a set left to reveal the red “Delete”, then release to remove it.',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/swipe-left.png'),
          aspectRatio: SWIPE_AR,
        },
        {
          kind: 'text',
          heading: 'Swipe right to add / note',
          body: 'Swipe right: green “＋1” adds a set, blue “Note” jots a note for it.',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/swipe-right.png'),
          aspectRatio: SWIPE_AR,
        },
        {
          kind: 'text',
          heading: 'Long-press to reorder',
          body: 'Long-press a set and drag to reorder the sets within this move.',
        },
        {
          kind: 'image',
          source: require('@/assets/help/gestures/long-press.png'),
          aspectRatio: DRAG_AR,
        },
      ],
    },
  },
};
