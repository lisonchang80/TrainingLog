/**
 * countPerformedExercises — 「動作數」= 該訓練「實際做過」(有打勾) 的 distinct 動作數.
 *
 * 一個 exercise 只要有 ≥1 個 `is_logged === 1` 的 set 就算「做過」(warmup 打勾也算)。
 * 完全沒打勾的動作 (使用者加進來但一組都沒勾) 不計入。
 *
 * 用於「已完成 / 檢視中 session」的動作數 tile：
 *   - 歷史列表 (loadHistoryListRows 的 SQL `COUNT(DISTINCT CASE WHEN is_logged=1
 *     THEN exercise_id END)` 與此同義)
 *   - session 詳情頁 stats panel
 *
 * 對比 `countUniqueExercises`（不濾 is_logged，算所有已加入的 distinct 動作）——
 * 後者仍用於 Today 進行中面板，顯示「已加入的動作數」(不該因尚未打勾而歸零)。
 */

interface CountPerformedExercisesInput {
  exercise_id: string;
  is_logged: number; // 0/1
}

export function countPerformedExercises(
  sets: ReadonlyArray<CountPerformedExercisesInput>,
): number {
  const seen = new Set<string>();
  for (const s of sets) {
    if (s.is_logged === 1) seen.add(s.exercise_id);
  }
  return seen.size;
}
