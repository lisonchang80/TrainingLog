/**
 * Help content — 訓練進行中（Today tab in-session view）.
 *
 * style: 'info' — a "hidden gestures" flow note. These gestures are
 * swipe/long-press/tap motions a coach ring can't frame, and the set rows
 * live in a memoized conditional subtree that's hard to tag — so this is
 * the `info` screenshot-flow fallback (constraint #6). Text-only for now;
 * `images[]` screenshots are a follow-up sim-capture pass.
 *
 * Gestures verified against `components/session/cluster-card.tsx` +
 * `SwipeableSetRow` (2026-06-29): swipe-LEFT = delete, swipe-RIGHT =
 * add/note, long-press = drag-reorder, ✓ = complete. (NOT the earlier
 * memory guess of long-press=dropset / left-swipe=cast.)
 */
import type { LocalizedPageHelp } from '../types';

export const todaySessionHelp: LocalizedPageHelp = {
  zh: {
    style: 'info',
    info: {
      title: '訓練中的隱藏手勢',
      sections: [
        {
          heading: '打勾完成一組',
          body: '點該組的 ✓ 標記完成，休息計時會自動跳出。',
        },
        {
          heading: '改重量／次數',
          body: '直接點數字格，跳出數字鍵盤即可修改。',
        },
        {
          heading: '滑動編輯',
          body: '左滑刪除這組；右滑加一組或加備註。',
        },
        {
          heading: '長按排序',
          body: '長按一組拖曳，可調整動作內的順序。',
        },
      ],
    },
  },
  en: {
    style: 'info',
    info: {
      title: 'Hidden gestures while training',
      sections: [
        {
          heading: 'Tick to finish a set',
          body: "Tap a set's ✓ to mark it done; the rest timer pops up.",
        },
        {
          heading: 'Edit weight / reps',
          body: 'Tap a number cell to open the keypad and change it.',
        },
        {
          heading: 'Swipe to edit',
          body: 'Swipe left to delete a set; swipe right to add one or a note.',
        },
        {
          heading: 'Long-press to reorder',
          body: 'Long-press a set and drag to reorder within the exercise.',
        },
      ],
    },
  },
};
