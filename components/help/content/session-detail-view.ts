/**
 * Help content — 歷史 Session 詳情頁 · 檢視模式 (`app/session/[id].tsx`,
 * editMode === false).
 *
 * style: 'coach' (unnumbered) — a light 引導遮罩 that just EXPLAINS THE LAYOUT
 * (user request 2026-07-01「歷史 Session 詳情頁只需要用遮罩，說明佈局即可」). No
 * editing gestures here — those belong to the EDIT-mode tour (`session-detail-edit`).
 * The steps are independent regions, not an ordered procedure, so `coachNumbered`
 * is false (mirrors the Today idle start tour).
 *
 * Two leading screenshot cards explain scroll-body reading features (HR zone chart
 * + the 隱藏未打勾 toggle) — cards, not spotlights, because they sit in the scroll
 * body and spotlighting them would need `useCoachScroller` (avoided → dodges the
 * step-1 scroll landmine). Then three spotlights on the FIXED bottom action bar
 * (view-mode slots): session.edit / session.saveTemplate / session.delete.
 * (A stats-tile spotlight was considered but the view/edit SessionStatsPanel are
 *  byte-identical duplicates → hard to ref uniquely, deferred.)
 *
 * The matching EDIT-mode editing tour lives in `session-detail-edit.ts`; the page
 * dispatches `editMode ? sessionDetailEditHelp : sessionDetailViewHelp`.
 */
import type { LocalizedPageHelp } from '../types';

const HR_AR = 1020 / 840; // session-detail/hr-zone.png (HR zone chart)
const HIDE_AR = 1128 / 165; // session-detail/hide-unchecked.png (hide-unchecked toggle row)

export const sessionDetailViewHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        image: require('@/assets/help/session-detail/hr-zone.png'),
        aspectRatio: HR_AR,
        title: '心率區間',
        body: '這張圖顯示各心率區間各花了多少時間（沒戴錶記錄就會是空的）。',
      },
      {
        image: require('@/assets/help/session-detail/hide-unchecked.png'),
        aspectRatio: HIDE_AR,
        title: '隱藏未打勾',
        body: '打開這個開關，會藏起沒打勾（沒實際做）的計劃組，只看真正練到的。',
      },
      {
        targetId: 'session.edit',
        title: '編輯訓練',
        body: '點「編輯訓練」進入編輯，可改動作、組數與重量。',
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
    coachNumbered: false,
    coach: [
      {
        image: require('@/assets/help/session-detail/hr-zone.png'),
        aspectRatio: HR_AR,
        title: 'Heart-rate zones',
        body: 'This chart shows how long you spent in each HR zone (empty if no Watch data).',
      },
      {
        image: require('@/assets/help/session-detail/hide-unchecked.png'),
        aspectRatio: HIDE_AR,
        title: 'Hide unchecked',
        body: 'Turn this on to hide planned sets you never ticked (never actually did).',
      },
      {
        targetId: 'session.edit',
        title: 'Edit session',
        body: 'Tap “Edit” to change the moves, sets and weights.',
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
