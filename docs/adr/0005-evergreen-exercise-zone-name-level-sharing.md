# 0005 — 常設動作分區：name-level 目標共享 + Save-back differential propagation

Template 內 Exercise 清單**分兩區**：

- **一般動作區**：目標 per `(Template name, Program, 副標籤)` 三元組獨立，跟著週期化變化
- **常設動作區**：目標 per `Template name` **共享**（同 name 的所有 sibling Templates 共用同一份目標），新建三元組時自動繼承同 name 的常設動作池

> 術語：本文件中「Template」一律指**完整三元組 entity**；同 name 的多個 Template 互稱「sibling Templates」。**避免**用「Template instance」，以免與「entity」概念混用。

Session 結束時若實際數據與目標不同 → 跳「同意修改模板？」dialog。同意則：

- **一般動作的修改**：只更新本次 Session 對應的 Template（其他 sibling Templates 不動）
- **常設動作的修改**：propagate 到該 Template name 下**所有** sibling Templates 的目標

理由：訓練目標有兩種本質不同的動作，硬塞同一個傳播規則必踩坑：

- **(a) 跟著週期化變的「主菜」**（深蹲、臥推、硬舉等大動作）：12-15RM → 10-12RM → 8-10RM → 6-8RM 漸進，每個 (Program, 副標籤) 三元組的目標必然不同
- **(b) 不分週期的「配菜 / finisher / 收操」**（蝴蝶機、三頭下推、伸展類動作）：使用者期望「我覺得蝴蝶機 30kg 太輕想升 32.5kg」一改全部 sibling Templates 同步，不要每換一個三元組重 manually 改一次

把 (b) 也綁在 per-Template (per-三元組) 目標上會造成「每換一個週期就要手動同步常設動作微調」的維護地獄；反過來把所有動作都做 name-level 共享則會讓 (a) 的週期化進展互相覆蓋。**分區 + differential save-back 是讓兩種動作各自走自然語意的最小設計**。

—— 拒絕的替代方案：

- **單區 Template + Save-back 永遠只更新本 Template**：常設動作改一處要手動改 N 個 sibling，違反 single source of truth，使用者必然會漏改造成目標 drift
- **單區 Template + Save-back 永遠 propagate 到所有 sibling**：一般動作的週期化進展會被互相覆蓋（增肌-Q1 改 10-12RM 目標污染力量-Q2 的 6-8RM）
- **常設動作改為獨立 entity，Template ↔ 常設動作池 m:n**：schema 多一張 join 表，rendering 要 JOIN，CONTEXT.md 概念複雜化；雖然在 storage 層可能仍會走這條路（見 Consequences），但 domain model 不該外露這層
- **完全靠使用者紀律「記得自己手動同步」**：違反系統設計幫使用者承擔複雜度的原則

—— Consequences：

- **Storage 實作有兩條路徑**，CONTEXT.md 只鎖 semantics 不鎖 storage：
  - (i) 每個 Template 各存一份完整 Exercise 清單（含常設）+ Save-back 時 propagate 到 siblings — 寫複雜、讀單純
  - (ii) 抽出 `template_name_common_exercises` 表 + render 時 JOIN — 寫單純、讀 JOIN
  - 選擇留給後續 implementation ADR
- **Save-back dialog 文案要 differential**：「只改本次 (Q1, 10-12RM) 的目標」vs「改所有『胸日』Templates 的常設動作目標」— 兩種傳播範圍對使用者要明示
- **Snapshot 完整性不變**：Session 開始時仍 snapshot 整個 Template 完整目標（一般 + 常設），Save-back 只影響反向更新的傳播範圍

修改此設計的代價：Template 結構欄位、Save-back 邏輯、Snapshot 完整性、Template 編輯 UI 都要重做。
