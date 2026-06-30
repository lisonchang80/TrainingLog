/**
 * Help content — 歷史 ▸ 統計 分頁 (`components/stats-panel.tsx`, rendered by
 * `app/(tabs)/history.tsx` when effectiveTab === 'stats').
 *
 * style: 'coach' but NOT numbered — feature-explainer 聚光遮罩 (跟 chart /
 * library / programs 等頁同樣 coachNumbered:false). 解讀型圖表面板，逐塊聚光
 * 說明「這是什麼 / 怎麼讀」。
 *
 * Verified against source on 2026-06-30 (stats-panel.tsx):
 *   - period selector 年/月/週 (:251-266) → target stats.period (錨點日在其下方)
 *   - body heatmap card (:301-314): BodyHeatmap 依「該期間每部位被練到的
 *     session 次數」上色（quintile，越深越多次）+ 圖例 → target stats.heatmap
 *   - per-MG capacity histograms (:317-349): 每個有練到的肌群一張 6 期(−5..0)
 *     容量(重量×次數)長條 + 平均線 → target stats.capacity
 *   - duration histogram (:352-370): 近 6 期每次訓練時長長條 + 平均線 + 註腳
 *     → target stats.duration
 *
 * Spotlight targets (useCoachMarkTarget, in StatsPanel):
 *   stats.period / stats.heatmap / stats.capacity / stats.duration.
 *   (capacity/duration 常在摺線下方，聚光環找不到 mounted target 時自動退化成
 *    置中字卡 — 仍可讀，per CoachStep.targetId 文件。)
 *
 * Mode-agnostic: 統計面板不含計劃/強度概念，極簡模式無變體（不像 history 有
 * historyHelpMinimal）。
 */
import type { LocalizedPageHelp } from '../types';

export const statsHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'stats.period',
        title: '選擇期間',
        body: '先選 年 / 月 / 週 — 下面所有圖表都以這個尺度、往回算最近 6 期來統計。點下方日期可改「錨點日」（往前回顧某個時間點）。',
      },
      {
        targetId: 'stats.heatmap',
        title: '身體熱力圖',
        body: '顏色越深＝這段期間該部位被練到的次數越多（依當期所有訓練統計）。下方圖例對應深淺的次數級距。',
      },
      {
        targetId: 'stats.capacity',
        title: '各肌群容量',
        body: '每個有練到的肌群一張小圖：最近 6 期的訓練容量（重量×次數的總和）長條，橫線是平均。只顯示這段期間有練的肌群。',
      },
      {
        targetId: 'stats.duration',
        title: '訓練時長',
        body: '最近 6 期每次訓練的時長長條，橫線是平均時長。下方註腳是這 6 期的總訓練次數。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'stats.period',
        title: 'Pick a period',
        body: 'Choose Year / Month / Week first — every chart below uses this scale over the last 6 periods. Tap the date to move the anchor day (look back from an earlier point).',
      },
      {
        targetId: 'stats.heatmap',
        title: 'Body heatmap',
        body: 'Darker = that muscle was trained more times this period (across all sessions). The legend below maps the shades to frequency bands.',
      },
      {
        targetId: 'stats.capacity',
        title: 'Capacity by muscle',
        body: 'One mini-chart per muscle you trained: capacity (weight × reps total) bars over the last 6 periods, with an average line. Only muscles trained in this window appear.',
      },
      {
        targetId: 'stats.duration',
        title: 'Session duration',
        body: 'Duration bars for your sessions over the last 6 periods, with an average line. The footnote is the total session count across those 6 periods.',
      },
    ],
  },
};
