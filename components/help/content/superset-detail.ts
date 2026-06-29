/**
 * Help content — 超級組詳情頁 (`app/superset/[id].tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩 for the page's two genuinely
 * counter-intuitive facts (verified against source 2026-06-29):
 *   - Exercises row `styles.exercisesRow` (:163-177): two ExerciseTiles with a
 *     「+」between; tapping a tile → that individual exercise's detail
 *     (`/exercise/{id}`). The pair is locked (ADR-0017 Q10) — the edit page
 *     only renames; changing the moves means delete + recreate.
 *   - Footer `styles.footer` (:180-215): 歷史 / 圖表 do NOT open a superset-only
 *     view — they `router.push` the A-side exercise's history/chart with
 *     `clusterMode=cluster_only&partner=<B>&side=A` (:195/:205), i.e. the
 *     shared per-exercise page filtered to this combo. 編輯 → /superset/edit
 *     (rename only), 刪除 → Alert.
 *
 * Spotlight targets (useCoachMarkTarget, in SupersetDetailScreen):
 *   superset.pair / superset.footer.
 */
import type { LocalizedPageHelp } from '../types';

export const supersetDetailHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'superset.pair',
        title: '成對動作',
        body: '超級組就是把 A + B 兩個動作鎖在一起做。點任一個方塊可看該動作的詳情。',
      },
      {
        targetId: 'superset.footer',
        title: '下方按鈕',
        body: '「歷史 / 圖表」其實會帶你到 A 側動作的頁面（自動篩成只看這個組合）；「編輯」只能改名稱，要換動作得刪掉重建。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'superset.pair',
        title: 'Paired moves',
        body: 'A superset locks two moves (A + B) to do together. Tap either tile to see that move’s detail.',
      },
      {
        targetId: 'superset.footer',
        title: 'Bottom buttons',
        body: '“History / Chart” actually take you to the A-side move’s page (auto-filtered to this combo); “Edit” only renames it — to change the moves, delete and recreate.',
      },
    ],
  },
};
