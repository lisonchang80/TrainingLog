/**
 * Help content — 歷史 ▸ 獎章 分頁 (`components/achievements-panel.tsx`, rendered
 * by `app/(tabs)/history.tsx` when effectiveTab === 'achievements').
 *
 * style: 'coach', coachNumbered:false — feature-explainer 聚光遮罩.
 *
 * Verified against source on 2026-06-30 (achievements-panel.tsx + ADR-0009
 * slice 17 amendment):
 *   - filter chips 全部/部位/訓練目的/里程碑 (:115-127) → target ach.filters
 *     · 部位   = 每個碰過的 (肌群 × 重量) / (肌群 × 容量) 一張卡
 *     · 訓練目的 = 每個碰過的 (次數區間 × 重量) / (區間 × 容量) 一張卡（+ 入門 badge）
 *     · 里程碑 = 單張、恆顯示的累積訓練次數卡
 *   - TierProgressCard list (:129-139): 每張卡 = 一條獎章階梯，邊框/accent ＝
 *     目前階級，進度條 = 目前次數 / 下一階門檻 → target ach.cards
 *
 * Spotlight targets (useCoachMarkTarget, in AchievementsPanel):
 *   ach.filters / ach.cards.
 *
 * (獎章系統可在設定關閉；關閉時此分頁整個不顯示 — visibleTabs，ADR-0009
 *  amendment — 所以這份 help 在關閉時根本到不了，無需處理該狀態。)
 */
import type { LocalizedPageHelp } from '../types';

export const achievementsHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'ach.filters',
        title: '四種篩選',
        body: '全部 / 部位 / 訓練目的 / 里程碑 切換要看哪一類獎章。「部位」依肌群、「訓練目的」依次數區間（最大力量／肌耐力…）、「里程碑」是累積訓練次數。',
      },
      {
        targetId: 'ach.cards',
        title: '階級卡怎麼看',
        body: '每張卡是一條獎章階梯：邊框顏色＝目前階級，進度條顯示「目前次數 ／ 下一階門檻」。只有練過的部位／目的才會出現卡片。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'ach.filters',
        title: 'Four filters',
        body: 'All / Muscle / Goal / Milestone switch which kind of achievement you see. “Muscle” groups by muscle, “Goal” by rep range (strength / endurance…), “Milestone” is your cumulative session count.',
      },
      {
        targetId: 'ach.cards',
        title: 'Reading a tier card',
        body: 'Each card is one achievement ladder: the border colour = your current tier, the progress bar shows “current count / next-tier threshold”. Only muscles/goals you’ve actually trained get a card.',
      },
    ],
  },
};
