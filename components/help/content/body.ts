/**
 * Help content — 身體數據頁 (`app/body.tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩.
 *
 * Verified against source on 2026-06-29:
 *   - Input row `styles.inputRow` (:172-202): three Field inputs whose
 *     placeholders are the LAST recorded value (`kgToDisplay(latest…)`,
 *     :177-200) — a hint, not a default; the bodyweight/SMM labels carry the
 *     unit from settings (`tBodyweightWithUnit(unit)` :174, `(${unit})` :192).
 *   - Trend chart `<BodyTrendChart>` (:218): per its header (:15-19) it's a
 *     DUAL-Y-axis chart — left axis = weight (bodyweight + SMM, same unit),
 *     right axis = PBF (%). NO human-body figure on this page.
 *   - Legend `styles.legendRow` (:219-238): three LegendChips that toggle each
 *     series' visibility on the chart (`toggleVisibility`).
 *   - History list (:240-259) is sliced to the 20 most recent — NOT spotlighted
 *     (minor), but the chart/legend captions cover the confusing bits.
 *
 * Spotlight targets (useCoachMarkTarget, in BodyScreen):
 *   body.input / body.chart / body.legend.
 */
import type { LocalizedPageHelp } from '../types';

export const bodyHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'body.input',
        title: '記錄新數據',
        body: '填 體重 / 體脂(PBF) / 肌肉量(SMM)。單位依設定（kg/lbs）；灰色提示字是你上次的值，只是參考、不是預設。',
      },
      {
        targetId: 'body.chart',
        title: '趨勢圖',
        body: '左右各一個 Y 軸：左邊是體重類（體重、肌肉量），右邊是體脂 %——量級不同才分開畫。',
      },
      {
        targetId: 'body.legend',
        title: '開關線條',
        body: '點圖例可在趨勢圖上顯示或隱藏每一條線。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'body.input',
        title: 'Record data',
        body: 'Enter bodyweight / PBF / SMM. The unit follows Settings (kg/lbs); the grey hint is your last value — a reference, not a default.',
      },
      {
        targetId: 'body.chart',
        title: 'Trend chart',
        body: 'Two Y axes: the left is weight (bodyweight + SMM), the right is PBF (%) — they’re split because the magnitudes differ.',
      },
      {
        targetId: 'body.legend',
        title: 'Toggle lines',
        body: 'Tap a legend chip to show or hide that line on the chart.',
      },
    ],
  },
};
