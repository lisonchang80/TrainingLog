/**
 * Help content — 動作歷史頁 (`app/exercise-history/[id].tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩, independent controls (see
 * exercise-chart.ts header for the rationale). This page shares its filter row
 * with the chart page (both drive `historyFilterMailbox`), so steps 1-3 mirror
 * the chart help; step 4 covers the history-only session list interactions.
 *
 * EVERY control verified against source on 2026-06-29 (not inferred):
 *   - Rep-bucket chips `styles.filterRow` (HistoryPageContent :888-904), "全部"
 *     mutually exclusive (`bucketFilters.size === 0`, :890-893).
 *   - Cluster segmented `ClusterModeSegmented` (:906-908), only when
 *     `hasClusterRows`. Degrades to centred caption when absent.
 *   - 進階篩選 `styles.advancedWrap` (:910-979): Program dropdown + intensity
 *     sub-tags + 切換到圖表 / 清除.
 *   - Session list rows `SessionRow` (:985-1003): tap header `onToggle` expands
 *     per-set detail (`toggleExpand` :635); cluster rows carry a「超」chip
 *     (`rowIsCluster`); a per-row ▶ replay button shows only when
 *     `canReplayRow(rowShape, replayTarget)` is true (:989) — i.e. there's a
 *     matching in-progress card to replay the sets onto (`onReplay` :749).
 *
 * Spotlight targets (useCoachMarkTarget, in HistoryPageContent):
 *   history.buckets / history.cluster / history.advanced / history.row
 *   (history.row is attached to the FIRST rendered SessionRow wrapper).
 */
import type { LocalizedPageHelp } from '../types';

export const exerciseHistoryHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'history.buckets',
        title: '次數區間篩選',
        body: '只看某個次數區間（例如 8RM、6RM）的紀錄。點「全部」會清掉其他選擇——它和各區間互斥。',
      },
      {
        targetId: 'history.cluster',
        title: '組合篩選',
        body: '若這個動作有遞減組／超級組的紀錄，這裡會出現切換：全部 / 排除組合 / 只看組合。',
      },
      {
        targetId: 'history.advanced',
        title: '進階篩選',
        body: '展開後可再依「計劃」與「強度」副標籤縮小範圍，也能一鍵切換到圖表。',
      },
      {
        targetId: 'history.row',
        title: '展開每一筆 · 重播',
        body: '點一筆可展開看當次每組明細；有遞減組／超級組的列會標「超」。列上的 ▶ 能把那次的組數「重播」套到目前進行中的訓練（需先有進行中的訓練）。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'history.buckets',
        title: 'Rep-range filter',
        body: 'Show only sets in one rep range (e.g. 8RM, 6RM). Tapping “All” clears the rest — it’s mutually exclusive with the ranges.',
      },
      {
        targetId: 'history.cluster',
        title: 'Cluster filter',
        body: 'When this move has dropset / superset history, a toggle appears: All / Exclude clusters / Clusters only.',
      },
      {
        targetId: 'history.advanced',
        title: 'Advanced filter',
        body: 'Expand to narrow by program and intensity sub-tag, or jump straight to the chart.',
      },
      {
        targetId: 'history.row',
        title: 'Expand a session · Replay',
        body: 'Tap a row to expand its per-set detail; cluster rows carry a「超」chip. The ▶ on a row replays those sets onto your in-progress session (needs an active session first).',
      },
    ],
  },
};
