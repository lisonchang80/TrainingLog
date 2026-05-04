# 0003 — Program 2-tier 設計：Template identity 為 (name, Program, 副標籤) 三元組

Program 拆成兩層 tag — **Program 主標籤**（1st-tier 分類，例：增肌-Q1、力量-Q2、無）+ **Program 副標籤**（2nd-tier per-cell tag，free-form text 例：12-15RM、10-12RM、6-8RM）。
**Template identity 從單一 name 升級為 (name, Program, 副標籤) 三元組**：「胸日 (增肌-Q1, 10-12RM)」與「胸日 (增肌-Q1, 8-10RM)」是兩個獨立 Template entity，各有獨立處方（組數 / 重量 / 次數）。

理由：使用者實際訓練中，同 name 的 Template 在不同訓練週期下處方差異是常態（增肌-Q1 第 1-2 週 60kg×10×3、第 3-4 週 70kg×8×3）。把這個變化攤在 Template entity 層級而非屬性層級，使：

- Template 處方查詢直接 by 三元組 lookup，不需要 GROUP BY (name, rep_range)
- Snapshot 邏輯統一 — Session 開始時複製整個 Template entity 即可
- 副標籤是 free-form text（per-cell 自填），不適合 enum
- 「依 Program + 副標籤 autofill 處方」這個核心 UX 直接對應 schema 查詢

—— 拒絕的替代方案：

- **平面 Program + Template 加 `rep_range` 屬性**：variant query 永遠要 GROUP BY (template_id, rep_range)，且 rep_range free-form 會產生稀疏資料；查詢與索引設計都複雜化
- **Template 以 name 為唯一 key + 副標籤 attach 在 Session level**：失去「Template 預載處方」能力，Template 退化為只有 Exercise 清單沒處方，autofill 邏輯被迫從歷史 Sessions 推算
- **副標籤改為 fixed enum**（如 12-15RM / 10-12RM / 8-10RM / 6-8RM）：違反訓練方法的多樣性 — 線性週期、DUP（每日波動）、5/3/1、自製命名（「中重量 high-rep 收操週」）都會被擋下

修改此設計的代價：所有 Template 處方資料要遷移、Session snapshot 結構與 autofill 邏輯都要重做。
