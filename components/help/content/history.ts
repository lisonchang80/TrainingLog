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
 *     comment :13-16 + DayCell render :345-385): each populated day shows THREE
 *     rows — Row 1 容量合計 (systemGreen chip, kg int), Row 2 模板名稱 chip
 *     tinted with the template `color_hex` (freestyle = grey), Row 3 主場強度
 *     `sub_tag` grey caption (freestyle / no sub_tag → 「—」, and HIDDEN entirely
 *     in 極簡模式 per ADR-0026 :325-326). Top-right「+N」shown ONLY when
 *     sessionCount > 1; tap a day → open that session (:186), tap an empty
 *     in-month day → 補訓練 back-fill box (:252).
 *
 * The calendar gets TWO coach steps: a grid-level spotlight (tinting / +N / tap)
 * and a screenshot-CARD that zooms ONE real day cell to label the three rows
 * (user request 2026-06-29 — a single day is too small to read in the spotlight).
 * Card asset: `assets/help/history/day-cell.png` (a templated day, 拉日 / 重 —
 * a normal template name with a real intensity sub-tag; user 2026-06-30 asked
 * for a more ordinary-looking day than the previous 拉拉 / T1-1).
 * Recapture if the DayCell layout changes.
 *
 * Spotlight targets (useCoachMarkTarget, in HistoryScreen):
 *   history.subtabs / history.mode / history.calendar.
 */
import type { LocalizedPageHelp } from '../types';

const CELL_AR = 172 / 214; // day-cell.png (single zoomed calendar day, portrait)

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
      {
        image: require('@/assets/help/history/day-cell.png'),
        aspectRatio: CELL_AR,
        title: '放大看一天',
        body: '一個格子分三行：①綠色塊＝當天訓練總容量（kg）②中間色塊＝訓練模板（顏色就是該模板的代表色，自由訓練為灰）③最下灰字＝主場訓練強度（自由訓練顯示「—」）。',
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
      {
        image: require('@/assets/help/history/day-cell.png'),
        aspectRatio: CELL_AR,
        title: 'One day, zoomed in',
        body: 'A cell has three rows: 1) green chip = that day’s total volume (kg); 2) middle chip = the training template (its colour is the template’s colour; freestyle = grey); 3) grey caption = the session’s main intensity (freestyle shows “—”).',
      },
    ],
  },
};

/**
 * 極簡模式變體 (ADR-0026). 極簡模式月曆 cell 隱藏第 3 行（主場強度 sub_tag,
 * `MonthGridView` :325-326），所以「放大看一天」截圖卡（標示三行）在極簡無效——
 * 改為丟掉該截圖卡、把「分兩行」的說明折進「月曆怎麼看」那一步。
 *
 * 沿用同 pageId 'history'（同畫面微差），不像 Today 的 plan/minimal 是兩個
 * 不同起始畫面才各自拆 pageId。衍生自 historyHelp（plan 版為唯一真相）。
 */
const minimalCalendarBodyZh =
  '每天用該訓練模板的顏色標示；右上「+N」表示當天有超過一筆訓練。點一天看當天紀錄，點空白日可補登訓練。每個格子分兩行：上＝當天總容量（綠字，kg），下＝訓練模板色塊（自由訓練為灰）。';
const minimalCalendarBodyEn =
  'Each day is tinted with its template’s colour; a “+N” top-right means more than one session that day. Tap a day to view it, or an empty day to back-fill. Each cell has two rows: top = that day’s total volume (green, kg); bottom = the template colour block (freestyle = grey).';

export const historyHelpMinimal: LocalizedPageHelp = {
  zh: {
    ...historyHelp.zh,
    coach: (historyHelp.zh.coach ?? [])
      .filter((s) => s.targetId != null) // drop the day-cell screenshot card
      .map((s) =>
        s.targetId === 'history.calendar' ? { ...s, body: minimalCalendarBodyZh } : s,
      ),
  },
  en: {
    ...historyHelp.en,
    coach: (historyHelp.en.coach ?? [])
      .filter((s) => s.targetId != null)
      .map((s) =>
        s.targetId === 'history.calendar' ? { ...s, body: minimalCalendarBodyEn } : s,
      ),
  },
};
