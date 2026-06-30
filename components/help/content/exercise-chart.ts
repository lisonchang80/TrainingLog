/**
 * Help content — 動作圖表頁 (`app/exercise-chart/[id].tsx`).
 *
 * style: 'coach' but NOT numbered — this is a 功能說明遮罩, not a do-1-then-2
 * procedure. Each step spotlights one *counter-intuitive* control and says what
 * it does; the controls are independent, so numbering them would imply a wrong
 * "do these in order" reading (page-help rubric: coachNumbered only for真流程).
 *
 * EVERY control verified against source on 2026-06-29 (not inferred):
 *   - Rep-bucket chips `styles.filterRow` (ChartPageContent :566-582). "全部"
 *     is mutually exclusive: active when `bucketFilters.size === 0`
 *     (:568-571); `onBucketChipTap('all')` clears the set (:481-495). NOT
 *     additive — this is the non-obvious bit worth teaching.
 *   - Cluster segmented `ClusterModeSegmented` (:584-586) renders ONLY when
 *     `hasClusterRows` (this move has SUPERSET history — `hasClusterHistory`
 *     keys on `session_exercise.parent_id`, NOT dropset `parent_set_id`).
 *     3 modes, labels 不含/包含/只含超級組 (`ClusterFilterMode`). When absent
 *     the spotlight degrades to a centred caption — copy is written to read
 *     fine either way.
 *   - 進階篩選 `styles.advancedWrap` (:588-660): collapsible, opens Program
 *     cycle dropdown (:609) + intensity sub-tag chips (:624-634).
 *   - Metric toggle `styles.metricToggle` (:669-688): weight / volume / e1rm /
 *     parallel; 'parallel' renders all three ChartCards (:690-700).
 *
 * Spotlight targets (useCoachMarkTarget, in ChartPageContent):
 *   chart.buckets / chart.cluster / chart.advanced / chart.metric.
 */
import type { LocalizedPageHelp } from '../types';

export const exerciseChartHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'chart.buckets',
        title: '次數區間篩選',
        body: '只看某個次數區間（例如 8RM、6RM）的紀錄。點「全部」會清掉其他選擇——它和各區間互斥，不是疊加。',
      },
      {
        targetId: 'chart.cluster',
        title: '超級組切換',
        body: '若這個動作做過超級組，這裡會出現切換：不含超級組（只看單獨做的）／包含超級組（全部）／只含超級組。',
      },
      {
        targetId: 'chart.advanced',
        title: '進階篩選',
        body: '展開後可再依「計劃週期」與「強度」副標籤縮小範圍。',
      },
      {
        targetId: 'chart.metric',
        title: '圖表指標',
        body: '切換看 最大重量 / 訓練量 / 估計 1RM；選「並排」會一次顯示三張圖。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'chart.buckets',
        title: 'Rep-range filter',
        body: 'Show only sets in one rep range (e.g. 8RM, 6RM). Tapping “All” clears the rest — it’s mutually exclusive with the ranges, not additive.',
      },
      {
        targetId: 'chart.cluster',
        title: 'Superset toggle',
        body: 'When this move has superset history, a toggle appears: exclude supersets (solo sets only) / include supersets (all) / supersets only.',
      },
      {
        targetId: 'chart.advanced',
        title: 'Advanced filter',
        body: 'Expand to further narrow by program cycle and intensity sub-tag.',
      },
      {
        targetId: 'chart.metric',
        title: 'Chart metric',
        body: 'Switch between max weight / volume / est. 1RM; “Parallel” shows all three charts at once.',
      },
    ],
  },
};

/**
 * 極簡模式變體 (ADR-0026). 極簡模式隱藏「進階篩選」裡的 計劃週期 / 強度 控制
 * （只留 action row — 看歷史 / 取消篩選），所以 chart.advanced 那步改寫文案、
 * 不再提 計劃/強度。聚光環 ref 仍掛在外層 advancedWrap → 步驟不變 null。
 * 沿用同 pageId 'exercise-chart'；衍生自 exerciseChartHelp（plan 版為唯一真相）。
 */
const minimalAdvancedBodyZh = '展開可一鍵切換到「歷史」檢視，或清除目前的篩選。';
const minimalAdvancedBodyEn =
  'Expand to jump to the History view or clear the current filters.';

export const exerciseChartHelpMinimal: LocalizedPageHelp = {
  zh: {
    ...exerciseChartHelp.zh,
    coach: (exerciseChartHelp.zh.coach ?? []).map((s) =>
      s.targetId === 'chart.advanced' ? { ...s, body: minimalAdvancedBodyZh } : s,
    ),
  },
  en: {
    ...exerciseChartHelp.en,
    coach: (exerciseChartHelp.en.coach ?? []).map((s) =>
      s.targetId === 'chart.advanced' ? { ...s, body: minimalAdvancedBodyEn } : s,
    ),
  },
};
