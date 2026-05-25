# 0003 — Program 2-tier 設計：Template identity 為 (name, Program, 副標籤) 三元組

Program 拆成兩層 tag — **Program 主標籤**（1st-tier 分類，例：增肌-Q1、力量-Q2、無）+ **Program 副標籤**（2nd-tier per-cell tag，free-form text 例：12-15RM、10-12RM、6-8RM）。（**2026-05-16 Q9.2 修訂**：「Program 主標」rename → **「週期」**；「Program 副標」rename → **「強度」**；「無 Program」UI label → **「無」**；DB seed 真實 Program entity「無 Program」避 NULL 特殊邏輯。見 ADR-0019 § Q9.2 + 本文末 amendment）
**Template identity 從單一 name 升級為 (name, Program, 副標籤) 三元組**：「胸日 (增肌-Q1, 10-12RM)」與「胸日 (增肌-Q1, 8-10RM)」是兩個獨立 Template entity，各有獨立目標（組數 / 重量 / 次數）。

理由：使用者實際訓練中，同 name 的 Template 在不同訓練週期下目標差異是常態（增肌-Q1 第 1-2 週 60kg×10×3、第 3-4 週 70kg×8×3）。把這個變化攤在 Template entity 層級而非屬性層級，使：

- Template 目標查詢直接 by 三元組 lookup，不需要 GROUP BY (name, rep_range)
- Snapshot 邏輯統一 — Session 開始時複製整個 Template entity 即可
- 副標籤是 free-form text（per-cell 自填），不適合 enum
- 「依 Program + 副標籤 autofill 目標」這個核心 UX 直接對應 schema 查詢

—— 拒絕的替代方案：

- **平面 Program + Template 加 `rep_range` 屬性**：variant query 永遠要 GROUP BY (template_id, rep_range)，且 rep_range free-form 會產生稀疏資料；查詢與索引設計都複雜化
- **Template 以 name 為唯一 key + 副標籤 attach 在 Session level**：失去「Template 預載目標」能力，Template 退化為只有 Exercise 清單沒目標，autofill 邏輯被迫從歷史 Sessions 推算
- **副標籤改為 fixed enum**（如 12-15RM / 10-12RM / 8-10RM / 6-8RM）：違反訓練方法的多樣性 — 線性週期、DUP（每日波動）、5/3/1、自製命名（「中重量 high-rep 收操週」）都會被擋下

修改此設計的代價：所有 Template 目標資料要遷移、Session snapshot 結構與 autofill 邏輯都要重做。

---

## 2026-05-16 Amendment — Terminology rename + 「無」schema seed (ADR-0019 § Q9.2)

Session UI/UX integral redesign grill 拍板 terminology rename — Program 主標 / 副標 / 無 Program 三個字眼跟 user 口語「週期 / 強度 / 無」對齊，並把「無 Program」從 NULL-special-case 升級成真實 Program entity 避免 schema 層 NULL 邏輯。

### Terminology rename

| 舊字眼 | 新字眼 | Scope |
|---|---|---|
| **Program 主標** / **Program 主標籤** | **週期** | UI / 內文 / dialog 文案 |
| **Program 副標** / **Program 副標籤** | **強度** | UI / 內文 / dialog 文案 |
| **無 Program** UI label | **無** | UI 顯短版（DB schema 字串可仍存 "無 Program" 或 "無"，slice ship 時定，見 ADR-0019 § 已知 known issues #1）（**2026-05-16 slice 10a 拍板**：DB 存 `program.name = '無'` (短版)。詳見 ADR-0019 § Known issues #1）|
| **「無」radio label（強度 context）** | **通用** | （wave 11 修訂 2026-05-19；start-template-sheet + template-meta-sheet 兩處同步；schema `program.name='無'` + sentinel id 不變）|

Schema 層欄位名 (`program_id`, `program_subtag`) 不動 — rename 是 UI / 文案層的事，code level rename 由後續 slice 逐步 propagate（不在本 ADR 範圍）。

### 「無」schema seed（N1）

- **DB seed 真實 Program entity** — `INSERT INTO program (id, name) VALUES ('<fixed_id>', '無 Program')` （或 '無'）作為 v_X migration 的一部分（migration 編號 v01X placeholder，slice ship 時定）
- **避 NULL 特殊邏輯** — 所有 Template entity 都掛在某個 Program entity 上（包含「無 Program」），query 不必特殊處理 `program_id IS NULL` 邊界
- **不可刪、UI 固定既有項目** — `[+ 新增週期]` flow 永遠列「無」當第一項固定選項

### 影響範圍

- **ADR-0003**（本檔）— terminology rename 內文 + 文末 amendment
- **ADR-0014**（session-title）— 提到「Program 主標題 · Program 副標」處需後續 slice propagate rename 到「週期 · 強度」
- **CONTEXT.md** — terminology block 更新（在 L21-L60「Program / Program 副標籤」段加 rename 指引 + 在 session UI/UX glossary 新段加 rename 對照表）
- **程式碼 / 變數 / UI label** — 後續 slice ship 時逐步 propagate（不在本 ADR 範圍，也不卡 ADR-0019 ship）

詳細決策邏輯見 ADR-0019 § Q9.2。
