# 0004 — Cycle-based Program 日曆（vs hardcode 7 天週曆）

Program 日曆網格以「**循環**」為主軸渲染，而非以週為主軸。Program 多兩個必要屬性：

- `循環長度` (天，預設 7，範圍 3-14)
- `循環次數` (例 4)

日曆 = 循環次數 行 × 循環長度 列。當循環長度 = 7，column 標籤顯示「一二三四五六日」對齊 iOS 原生週曆視覺；非 7 時 column 標籤顯示「Day 1 / Day 2 / ...」（不對齊週幾）。
真實日期由 `起始日期 + (循環 index, day index)` 推導；Session ↔ cell 對應 by date 比對。

理由：重訓的訓練週期不一定是 7 天 —

- 5 天 bro split（胸 / 背 / 腿 / 肩臂 / 休）
- 6 天 PPL × 2（上推 / 下推 / 上拉 / 下拉 / 腿 / 休）
- 9 天高頻深蹲方案

這些 schedule 一旦塞進 7 天週曆，每週的「rest day」「腿日」會落在不同週幾，使用者無法視覺地確認「我這個週期的 pattern 一致」。Cycle-based grid 把循環變成 row、循環內位置變成 column，pattern 永遠對齊在垂直方向 → 視覺一致。

—— 拒絕的替代方案：

- **純 7 天週曆 + 由使用者擺 rest day 位置**：6 天循環第 1 週的「休」= 週日、第 2 週的「休」= 週六，週曆每行 rest 落點都不同 → pattern 一致性必須靠使用者自己心算
- **完全 aperiodic（每天獨立 cell，無 row 概念）**：失去「fan-out 第 1 個循環的 pattern 到所有循環」這個 wizard 加速能力；強度進展（per-cycle 強度（原副標籤））也失去自然的承載單位
- **Cycle length 限定 enum (7 / 14 / 28)**：仍排除 5 / 6 / 9 天等真實常見方案，沒有實質幫助
- **Cycle length 範圍 1-30**：1 天 = 每天獨立，與 aperiodic 退化等效；> 14 天的微週期在實務上不存在；3-14 是平衡 schema 約束與真實覆蓋率的範圍

—— 後續含意：

- Wizard 步驟 2 必須問 (循環長度, 循環次數, 起始日期) 才能展開日曆
- Session ↔ cell 對應計算：`(date - 起始日期) / 循環長度 = 循環 index`、`(date - 起始日期) % 循環長度 = day index`
- Day-of-week 邏輯只在循環長度 = 7 時生效，UI 要 conditional render

修改此設計的代價：Program schema 欄位、日曆 UI rendering、Session ↔ cell linkage 計算、wizard step 順序都要重做。
