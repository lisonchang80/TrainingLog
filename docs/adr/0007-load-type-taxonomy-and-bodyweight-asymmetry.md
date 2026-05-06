# 0007 — Load type taxonomy + bodyweight 計算 asymmetry

Exercise 帶 `load_type ∈ {loaded, bodyweight, assisted}`。v1 容量 / PR 計算公式刻意 **asymmetric**：

- **loaded**（A 類；槓鈴/啞鈴/史密斯/滑輪/固定機械）：`weight × reps`，bodyweight 不進。
- **bodyweight**（B 類；徒手 / 加重引體 / 加重 dip）：`weight × reps`，bodyweight **不進**。守 lifting community 紀錄慣例（「+10kg 引體」非「83kg 引體」）。純徒手 set (`weight=0`) 跳過 PR check。
- **assisted**（C 類；助力機 / 阻力帶輔助）：`(session.bodyweight_snapshot_kg − weight) × reps`，bodyweight **進計算**。給新手「離徒手目標還差多遠」的進步指標。

asymmetry 不是 bug — B / C 兩類 user profile 不同：B 類跨度大（新手到加掛 50kg 進階者），守訓練圈紀錄慣例優先；C 類專屬新手轉接期（進階者不用助力機），UX 服務新手進步追蹤優先。weight × reps 公式套在 C 類會反向（助力越大容量越大），不可接受。

`session.bodyweight_snapshot_kg` 在 Session 開始時 query `body_metric` 最新一筆鎖入；無 snapshot 時 C 類顯示「—」。承襲 ADR-0001 器械分割精神：「不改 mechanics 的加重」（徒手 → 腰掛 10kg 引體）= 同一 Exercise；「改 mechanics 的加重」（徒手 → 啞鈴/壺鈴/槓鈴單腿蹲）= 不同 Exercise。

—— 拒絕的替代方案：

1. **完全對稱（A/B/C 一律 weight × reps）**：C 類助力大 = 容量/PR 大，反向訊號，新手體驗破壞。
2. **完全對稱（A/B/C 一律加 bodyweight）**：違反 lifting community 慣例，PR 變得難解釋（「我引體 PR 是 83kg？」），bodyweight 變動把歷史比對變雜訊。
3. **延到 v2 全套整合（c2）**：v1 沒任何 B/C 類進步指標，徒手做 10 下 / 助力遞減全部「啞」，使用者體驗破洞。
4. **C 類也跳過 PR**：失去 C 類使用者最核心的「離徒手還差多遠」進步追蹤。

bodyweight 變動的 PR 公平性 noise（例：bw 73 助力 30 vs bw 75 助力 30 在 v1 算出不同 effective weight）v1 接受，理由：新手用助力機週期短、bw 變動 ≤ 2kg 可忽略。v2+ 升級為跨類整合「實際負荷」演算法時再重新檢視。
