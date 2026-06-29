/**
 * Help content — 歷史總覽 (`app/(tabs)/history.tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩.
 *
 * Verified against source on 2026-06-29:
 *   - Sub-tab row `styles.subTabRow` (:79-94): 歷史 / 統計 / 獎章. The 獎章 tab
 *     is hidden when the achievement system is OFF (`visibleTabs` :65-68,
 *     ADR-0009 amendment) — copy notes this so the absence isn't confusing.
 *   - Mode row `styles.modeRow` (:95-112): 月曆 / 表列, only rendered in the
 *     歷史 tab (`effectiveTab === 'history'`).
 *   - Calendar `<MonthGridView>` (:115) cell semantics (component header
 *     comment :13-16 + DayCell): each day tinted with its template colour
 *     (`color_hex`, freestyle = grey); top-right「+N」shown ONLY when
 *     sessionCount > 1; tap a day → open that session (:186), tap an empty
 *     in-month day → 補訓練 back-fill box (:252).
 *
 * Spotlight targets (useCoachMarkTarget, in HistoryScreen):
 *   history.subtabs / history.mode / history.calendar.
 */
import type { LocalizedPageHelp } from '../types';

export const historyHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'history.subtabs',
        title: '三個分頁',
        body: '上方切換看 歷史紀錄 / 統計 / 獎章 三個面板（獎章可在設定關閉）。',
      },
      {
        targetId: 'history.mode',
        title: '月曆 / 表列',
        body: '在「歷史」分頁可切換 月曆 與 表列 兩種檢視。',
      },
      {
        targetId: 'history.calendar',
        title: '月曆怎麼看',
        body: '每天用該訓練模板的顏色標示；右上「+N」表示當天有超過一筆訓練。點一天看當天紀錄，點空白日可補登訓練。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'history.subtabs',
        title: 'Three tabs',
        body: 'Switch between History / Stats / Achievements up here (Achievements can be turned off in Settings).',
      },
      {
        targetId: 'history.mode',
        title: 'Calendar / List',
        body: 'In the History tab you can switch between calendar and list views.',
      },
      {
        targetId: 'history.calendar',
        title: 'Reading the calendar',
        body: 'Each day is tinted with its template’s colour; a “+N” top-right means more than one session that day. Tap a day to view it, or an empty day to back-fill a session.',
      },
    ],
  },
};
