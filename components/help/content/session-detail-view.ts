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
 * All three targets are the FIXED bottom action bar (view-mode slots), so the
 * tour needs no `useCoachScroller`:
 *   - session.edit / session.saveTemplate / session.delete.
 * (A stats-tile spotlight was considered but the view/edit SessionStatsPanel are
 *  byte-identical duplicates → hard to ref uniquely, deferred; the action-bar
 *  spotlights are the interactive layout the user actually asks about.)
 *
 * The matching EDIT-mode editing tour lives in `session-detail-edit.ts`; the page
 * dispatches `editMode ? sessionDetailEditHelp : sessionDetailViewHelp`.
 */
import type { LocalizedPageHelp } from '../types';

export const sessionDetailViewHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
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
