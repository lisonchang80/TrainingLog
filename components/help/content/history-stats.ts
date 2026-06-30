/**
 * Help content — 歷史 ▸ 統計 分頁 (`components/stats-panel.tsx`, rendered by
 * `app/(tabs)/history.tsx` when effectiveTab === 'stats').
 *
 * style: 'coach' but NOT numbered — feature-explainer 聚光遮罩 (跟 chart /
 * library / programs 等頁同樣 coachNumbered:false). 解讀型圖表面板。
 *
 * 3 steps (2026-06-30 fix). The stats panel is a long ScrollView; only the
 * period selector + body heatmap fit above the fold. The capacity & duration
 * histogram cards sit BELOW the fold, so spotlighting them put the ring + bubble
 * off-screen and forced the user to scroll to find the overlay (user report
 * 2026-06-30). CoachMarkOverlay has no auto-scroll (it just measureInWindow's
 * the target). Fix: spotlight only the two above-the-fold cards, and fold the
 * two below-fold cards into ONE targetless step — a centred caption (hole=null →
 * `resolveCoachBubbleAnchor` centres it at 40% screen height) that simply tells
 * the user to scroll down. No step ever points off-screen.
 *
 * Verified against source on 2026-06-30 (stats-panel.tsx):
 *   - period selector 年/月/週 (:251-266) → target stats.period (錨點日在其下方)
 *   - body heatmap card (:301-314): BodyHeatmap 依「該期間每部位被練到的 session
 *     次數」上色（quintile，越深越多次）+ 圖例 → target stats.heatmap
 *   - per-MG capacity histograms (:317-349) + duration histogram (:352-370):
 *     both BELOW the fold → described in the final centred caption (no target).
 *
 * Spotlight targets (useCoachMarkTarget, in StatsPanel): stats.period /
 * stats.heatmap only.
 *
 * Mode-agnostic: 統計面板不含計劃/強度概念，極簡模式無變體。
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
        // 無 targetId → 置中字卡（容量／時長兩張圖在摺線下方，聚光會跑出畫面）。
        title: '往下還有兩張圖表',
        body: '繼續往下捲動，還有：①各肌群容量 — 每個有練到的肌群一張小圖，最近 6 期的訓練容量（重量×次數總和）長條＋平均線；②訓練時長 — 最近 6 期每次訓練的時長長條＋平均線。',
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
        // No targetId → centred caption (the two charts below sit off-screen).
        title: 'More charts below',
        body: 'Keep scrolling down for: 1) Capacity by muscle — one mini-chart per muscle you trained, capacity (weight × reps total) bars over the last 6 periods with an average line; 2) Session duration — duration bars over the last 6 periods with an average line.',
      },
    ],
  },
};
