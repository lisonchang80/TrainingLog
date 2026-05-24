# 0019 — Session UI/UX 整體 redesign：rest timer 系統、動作卡雙態、in-session stats panel、cluster 來源唯一性、lifecycle 全套、歷史頁 layout integration

Status: accepted (2026-05-16 grill)

Session 端的編輯體驗從 ADR-0012（set logger schema + per-row 5 gesture）開始一路加層，途中 ADR-0013（notes 雙欄 → 後續 ADR-0017 升 per-Exercise 全局）/ ADR-0014（session.title + 歷史詳情頁 4 按鈕 + 4-tile）/ ADR-0017（Reusable Superset entity）/ ADR-0018（session-side cluster grouping schema）各別補上 schema 與部分 UI，但 **session 在運動中編輯這條軸**從未被一次性整合 — 結果 v014 ship 後 user 仍**無法手動跑 cluster logger 路徑**（write path 沒入口）、各 ADR 散落 in-session 設計、ad-hoc cluster 模型 schema 上活著但語意未定、歷史詳情頁 layout 跟 in-session 不對稱、Freestyle 結束無對應行為。本 ADR 承接 ADR-0012 的設計哲學 anchor「Session 在運動中編輯，要快速、即時」，把 session 整個 lifecycle（start / 編組 / cluster / discard / finish）與歷史詳情頁的 layout 在同一個決策包裡釘死，並修訂沿途已落但跟 in-session 整體不一致的既有拍板。

## 設計哲學 anchor

延續 ADR-0012：**「Session 在運動中編輯，要快速、即時」**——所有 in-session 編輯路徑的最終裁判仍是這一條。但「快速、即時」不等於「無 stats」——v014 之後 user 自己回報 in-session 看不到累計容量 / 動作數 / 訓練時間反而打亂訓練節奏。本 ADR 翻盤 ADR-0012「session 頂層無 stats」的部分，把 stats 重新置入但僅限「stats panel」這層（chip / AI 仍砍）。其他 in-session 元素新增的判準依然是：

- 任何二次確認 → 砍
- 任何 modal / sheet → 沒用就砍
- 任何冗餘狀態 → 砍（無 pause 第三態）
- 任何 ad-hoc 撈攏行為 → 砍（cluster 不能在 session 中現場標記，只能從 RS picker 來）

例外 / 新增的 friction（confirm dialog / picker）一律對應「不可 redo 的破壞性操作」或「身份維度切換」這兩個語意，跟 ADR-0014 「friction 與不可逆性匹配」原則一致。

## Context

三個交織問題促成本 ADR：

1. **v014 ship 後 cluster write path 沒入口** — ADR-0018 加了 `session_exercise.parent_id` + `reusable_superset_id` 兩欄，但「user 怎麼在 session 內手動配對」這條 UI affordance 從未拍板，Q6 全 6 條 deferred 放在 ADR-0018 § Out of scope。Session UI redesign 不啟，user 無法跑 cluster 路徑。

2. **各 ADR 散落 in-session 設計** — ADR-0012（set logger）/ ADR-0013→0017（notes）/ ADR-0014（session.title + 歷史詳情頁）/ ADR-0017（exercise library + RS）/ ADR-0018（session-side cluster schema）每份 ADR 都 touch session 編輯體驗一小角，但「動作卡 collapsed/expanded 模型 / ⚙️ menu 內容 / rest timer 系統 / start dialog / finish 路徑 / 歷史頁 layout 整合」這些 cross-cutting 主題從未在同一個 grill 裡被釘死。

3. **Ad-hoc cluster 模型 schema 活著但語意死掉** — ADR-0018 Z2 schema 允許 `session_exercise.reusable_superset_id IS NULL` 同時 `parent_id IS NOT NULL` 的 row（i.e. session 內手動配對的 cluster），但 (a) write path 沒設計；(b) Cd-B reframe 後本來想留給 freestyle 臨場配對與 Session Split 衍生 case；(c) user 在本次 grill Q7 拍板「cluster 來源唯一性」直接撤銷這個用例。結果是 ADR-0018 的「ad-hoc cluster」概念實際上死掉，只剩 backfill β'-skipped 場景偶爾留 NULL row。

本 ADR 直接把這三條同時收口。Q1 鎖 scope（A1+ / B1 / C1 / D2），Q2-Q10 拍板細節，14 條 Sticky note 標記跨 ADR 影響。

## Q1 — Scope

鎖定 **A1+ / B1 / C1 / D2**：

- **A1+** — set logger 補洞（rest timer 系統 / 動作卡 collapsed-expanded / ⋯ icon 衝突 / 備註入口 / in-session stats panel）
- **B1** — 歷史詳情頁 layout integration（當前 `app/session/[id].tsx` vs ADR-0014 規格 gap + v014 cluster block 位置）
- **C1** — v014 Q6 deferred 6 條（cluster 標記入口 / tap target / header 位置 / promote to RS / asymmetric highlight / un-cluster）
- **D2** — Session lifecycle 缺口（pause yes/no / discard 路徑 / start UX 確認）

排除：(a) Watch 端的 in-session UX（屬 slice 11+ ADR-0008 Watch v1 scope）；(b) PRD catch-up（slice 後續獨立 task）；(c) Live activity / Dynamic Island；(d) AI 相關。

## Q2 — Rest timer 系統（R1 v1 必做）

### Q2.1 預設秒數來源

- **系統預設 = 60s（hardcoded，無 setting key）** — 「預設休息時間」設定值不存進 SQLite，不在 Settings UI 暴露
- 每動作可從動作卡 ⚙️ menu 自訂單值（**不分** warmup / working — 一個 `rest_sec` 欄位涵蓋整動作所有 set）
- 「跟模板一樣」= template editor 也走齒輪入口（既有），session 沿用同一個 affordance

### Q2.2 寫入範圍、Schema、Dropset、「另存」UI

- **(A) A1** — 改本場 only：in-session 改 `session_exercise.rest_sec`，**finish dialog 統一 gate** 是否寫回 template（Save-back 範圍擴展 — 見 Q9 + Sticky 3）
- **(B) Schema 落點**（migration number 留 `v01X` placeholder，下次 slice grill 決定具體版本）：
  ```sql
  ALTER TABLE template_exercise ADD COLUMN rest_sec INTEGER NULL;
  ALTER TABLE session_exercise  ADD COLUMN rest_sec INTEGER NULL;
  -- NULL = inherit 系統 hardcoded 60s
  ```
  `snapshotForSession` 把 `template_exercise.rest_sec` 複製到 `session_exercise.rest_sec`（NULL 也照抄，不在 snapshot 階段 coalesce）；finish dialog 「儲存」option 把 `session_exercise.rest_sec` 寫回對應 `template_exercise.rest_sec`
- **(C) Dropset cluster C1** — cluster 內 step 之間**不啟** timer（ADR-0012「cluster 內無休息」延伸）；cluster root ✓ → 用 root row 的 `rest_sec` 啟動 timer
- **(D) U1** — 「另存」option UI 共用歷史頁「另存模板」flow（Program + 副標 selector + 即時衝突偵測 + 建新 entity）

### Q2.3 Auto-popup 行為

- **(a)** 預設 ON + Settings 可關（`app_settings` 加 key `auto_popup_rest_timer BOOLEAN DEFAULT 1`，per Backup ADR-0011 Settings 搬進 SQLite）
- **(b) M1 + modal 不重彈變體** — 每次 ✓ tap reset timer；modal 已開時不重彈（~~chip 在背景同步更新~~；user multi-tap ✓ 不會被新 modal 連續打斷）（**slice 10d X1 修訂**：chip 整概念砍除、modal 是唯一 timer surface — 詳見本 ADR § slice 10d 段）
- **(c) F1** — Timer 倒到 0 → 震動 + 短音 + ~~chip 消失~~ → **modal auto-dismiss**（slice 10d X1 修訂；短音仍 deferred to slice 13）（不彈紅警告 / 不擋互動）
- **(d) Y2** — ✓ 取消（再 tap 同 ✓ 翻回空白）→ timer 立刻停 + ~~chip 消失~~ → **modal 立刻關閉**（slice 10d X1 修訂）（取消 ✓ = 取消那次「set 完成」的**所有**副作用，包含 timer / 動作記憶 / 容量 chip 推進）

### Q2.4 v014 Cluster ✓ Semantic — 重大設計轉向（一 cycle 一 ✓）

ADR-0018 鎖了 schema 與 6 條 I 級 render invariants，但 cluster row 的 ✓ semantic 沒拍 — 既要追求 user 心智「cluster 是一個動作」、又要在 schema 上記每 cluster member set 的 `is_logged`，兩者張力本次 grill 解開：

- **(2) 採「一 cycle 一 ✓」模型** — UI **不**對 cluster 內個別 row（A 側 set / B 側 set）顯 ✓；改成 cluster block 內每**cycle row** 一個 ✓（cycle row = 一輪 = A.set[i] + B.set[i] 配對）
- Tap ✓ → **事務性寫**所有 cluster member 的 `set[i].is_logged = true`（asymmetric 時不存在的 set 自動 skip — 例如 A 側 4 cycle、B 側 3 cycle，cycle 4 ✓ 只動 A.set[3]）
- Auto-popup 啟 timer 用 **cluster root（parent）的 `rest_sec`** — child row 自己的 rest_sec 即使有值也忽略
- Solo row 維持 per-row ✓ 不變
- **K1 cycle-aware 偵測邏輯完全不需要** — 拒絕的替代方案中曾考慮「per-member ✓，UI 自動偵測整 cycle ✓ 才彈 timer」，但邏輯複雜（要 detect partial cycle / 處理 asymmetric / cluster size > 2 假想未來）；「一 cycle 一 ✓」直接讓 timer 啟動條件無歧義。

## Q3 — 動作卡互動模型（a-1 + b-1 + c-2 + d-1 + e-3）

- **a-1** — Session 進入時動作卡**全 collapsed default**
- **b-1** — Tap 整張 collapsed 卡 = expand；tap expanded 卡頭 = collapse
- **c-2** — **只一張可展開**（tap 新卡 → 舊卡自動 collapse；非 accordion 多 expand）
- **d-1** — 換動作的主要方式 = scroll list（vertical scroll）
- **e-3** — Expanded 隱含 active（不另畫 active border / 不加 ring）

### 副作用拍板

- **狀態持久化**：session 開啟期間 memory only（重開 session 全 collapsed reset；schema 不存 `expanded_exercise_id` 之類 transient state）
- **多動作 list 長度**：c-2 模型下單張展開時頁面長度可預期（其他卡 collapsed = 高度小）；user 自己決定要不要 collapse 已完成的動作

### Cluster 影響（為何不破壞配對可視性）

Cluster 是**單一 block**（含 A+B 兩 side、cycle row 共 ✓，per Q8 + Sticky 4 + Sticky 5）— **不是兩張獨立卡**——所以 c-2「only one expanded」不會讓 A 與 B 拆開到兩張獨立 collapsible 卡之中。整 cluster 視覺單元 = 一張 collapsed 卡 → tap → 一張 expanded block（內含 cycle row）。

## Q4 — Set row ⋯ icon 衝突（I1）

- **I1** — Image 3 「set ✓ 後右下 ⋯ icon 出現」是漏標 X；**維持 ADR-0012「per-row ⋯ icon 全砍」**
- ADR-0012 已把所有破壞性 / 切換 action 都改成 gesture-driven（左滑刪 / 右滑加 + 備註 / tap label cycle / 長按 reorder / tap ✓ toggle），⋯ menu 無功能可放，視覺噪訊不必引回

## Q5 — Per-exercise 備註入口 + ⚙️ menu 內容（N1 + 3 項 + 副作用）

### (a) N1 — ⚙️ menu 內「📝 編輯備註」一項

跟 user 直覺對齊；⚙️ menu 統一容納 per-exercise 各種設定（備註 / 休息 / 刪除動作）。

### (b) ⚙️ menu 3 項（**2026-05-16 修訂**：原 4 項砍除 🔄 換動作；cluster mark 第 5 項由 Q7 拍板移除）

| 項目 | 用途 | Schema 動作 |
|---|---|---|
| 📝 編輯備註 | 開 bottom sheet 改 per-Exercise 全局 notes | UPDATE `exercise.notes`（per ADR-0017 Q5）|
| ⏱️ 休息秒數 | 開 bottom sheet 數字輸入改 `session_exercise.rest_sec` | UPDATE `session_exercise.rest_sec` |
| 🗑️ 刪除動作 | confirm dialog「確定刪除？已記錄的 set 將一併刪除」→ DELETE CASCADE | DELETE `session_exercise` + CASCADE `set` |

> **slice 10c 修訂（cluster context 補 2 項）**：cluster row ⚙️ 額外加「📖 動作歷史 A」+「📖 動作歷史 B」兩個 shortcut（cluster 內無法靠 row label 區分 A/B 來開個別歷史，故走 ⚙️ menu）+ utility 「🔃 排序動作」（slice 10c Phase 4 fifth slot）。Solo ⚙️ 仍是 3 主項 + 1 utility = 4 槽；cluster ⚙️ 變 3 主項 + 2 history shortcut + 1 utility = 6 槽。Agent A drift audit L2 標 accepted。

> **訂正紀錄 (2026-05-16 修訂)**：原拍板含 4 項，第 4 項「🔄 換動作」slice 10b ⚙️ icon 落地時 user 提出砍除：「想換動作 = ⚙️ 🗑️ 刪除動作 + [⊕ 加動作] 動作庫勾選（或新建勾選）」即可達成相同效果，無需獨立 swap action。Cluster 與 solo 動作**統一適用**此流程：cluster 想換成員 = 刪整個 cluster + 加兩個新動作 + 重新配對成 cluster（不再有 cluster-內 swap 的快速路徑）。
>
> **接受的 trade-off**：(1) 操作步數多 1 step；(2) 新動作出現在列表最末（想換到原位需手動長按 reorder）；(3) Save-back 視為 delete + add 兩個獨立 op（既有 Save-back 已支援此 propagation，無需新邏輯）。
>
> **副效益**：(a) UI 簡化 4 項 → 3 項；(b) Known issues #3「🔄 picker 能否挑 RS」整題消失（已 ✅ resolved by removal）；(c) Slice 10c scope 簡化（少 1 個 sheet + 少 1 grill 議題「換動作 logged sets 處理」）；(d) 沒有 cluster 成員 swap 也避開了「cluster 內換 1 邊 schema 怎處理」的隱性複雜度。
>
> **更早的修訂紀錄**：grill 原 Q5 拍板含第 5 項「🔗 連結為超級組」當作 cluster 標記入口；Q7 拍板「cluster 來源唯一性」後 ad-hoc 標記入口砍除，「連結為超級組」這項若保留則跟底部 `[⊕ 加動作]` 進動作庫 picker 的 flow 功能重複——本 ADR 拍板**砍除這項**回歸 4 項 menu，再經 2026-05-16 修訂進一步簡化為 3 項。

### 副作用拍板

- **編輯 UI**：📝 編輯備註 / ⏱️ 休息秒數 都走 bottom sheet（per ADR-0013 沿用的 `.sheet(presentationDetents:)` 多 detent；keyboard 滑上來；[完成] btn）
- **刪除動作 D1**：要 confirm dialog（不可 redo 的多 set 紀錄全沒、跟 ADR-0014 friction 與不可逆性匹配原則一致）
- **「換動作」flow（無獨立 menu 項，2026-05-16 修訂）**：⚙️ 🗑️ 刪除動作 → [⊕ 加動作] (底部入口) → 動作庫 picker 勾選或新建後勾選（per ADR-0017 K1 picker + B1 即時新建 + L1 自動保存入口沿用）。Cluster 想換成員 → 刪整個 cluster → 加新成員 → 重新配對。
- **三入口連動**（per ADR-0017 Q5）：`exercise.notes` 是 per-Exercise 全局單層，Session ⚙️ menu / Template editor / 動作詳情頁三處入口改的是同一份；session 內編 → immediate UPDATE `exercise.notes`；`session_exercise.notes_snapshot` 不跟 in-session 編輯更新（snapshot 已凍結於 create 時，per ADR-0013 雙欄哲學中保留的「歷史保鮮」這條）

## Q6 — In-session stats panel（P1 + 3-tile / Watch 5-tile）— **翻盤 ADR-0012**

### (a) 位置 = P1

- Timer header 正下方、動作卡列表正上方
- 跟 ADR-0014 歷史詳情頁同位置（in-session 與 history detail 在 stats panel 位置對稱；內容不對稱 — 見 (b)）

### (b) 內容

- **非 Watch session = 3-tile 1 row**：容量 / 動作數 / 訓練時間
- **Watch-tracked session = 5-tile 2 row**：
  - Row 1: 容量 / 動作數 / 訓練時間
  - Row 2: **心率 H4 = 當前 BPM 大字 + Z1-Z5 區間 color border** / **大卡**
- **歷史詳情頁維持 ADR-0014 既拍 4-tile + 心率 vs 時間折線圖**（in-session stats panel 跟歷史頁 layout **內容不對稱**——歷史頁有獨立心率 chart 區塊 + 4 tile，in-session 是 3 或 5 tile 沒 chart）（**slice 10c 修訂**：5-tile Watch variant + 歷史頁 4-tile + 心率 chart 都 deferred to slice 13 (HealthKit landed)；在那之前 `SessionStatsPanel` 是 in-session + 歷史頁兩個 surface 的單一 3-tile 來源，kcal tile 與心率 chart 暫不渲染。詳見本 ADR § slice 10d 段 + Agent A drift audit M1/M2）

3-tile vs 5-tile 決定條件：Watch-tracked = 該 session 有 active `HKWorkoutSession` 寫資料進來（per ADR-0008）；若僅 iPhone 端走（無 Watch）則 3-tile。心率不可用 fallback 顯示「—」（不跳）。

### (c) ADR-0012 翻盤範圍 = 僅翻 stats panel

- ❌ **「session 頂層無 stats」這條 retract**（ADR-0012 § per-exercise card 結構 line 142、§ session 底部 bar line 150）
- ✅ **「無頂層 chip / 無 AI」維持**（user 的圖也 X 砍了喵喵 AI 跟右上文字 stats 行；chip / AI 不引回）
- ✅ session 底部 bar 維持 ADR-0012 既拍只剩 `[⊕ 加動作]`

### ADR-0012 amendment 要求

在 ADR-0012 § 「per-exercise card 結構」最末「session 頂層**無 chip / 無 stats / 無 AI**」這條加 inline marker（指向本 ADR § Q6）；並在 ADR-0012 文件最末加新 amendment section。詳細指引見本 ADR § 翻盤的既有拍板段。

## Q7 — v014 Cluster 來源唯一性（設計大轉向）

### 入口路徑（user 拍板）

> session 內 cluster 化**只能**透過 → 底部 `[⊕ 加動作]` → 進「動作庫」（Exercise Library, ADR-0017 v2）→ 在 picker 內挑選一個 **Reusable Superset（超級組 entity）** → 整個 RS（含 parent A + child B）snapshot 進當前 session 成 cluster block

**Cluster 來源完整列表（只剩兩條）**：

1. **Template snapshot 路徑**（既有）：Template-based session create 時，`snapshotForSession` 把 template 內的 cluster 結構（含 `parent_id` + `reusable_superset_id`）複製進 session_exercise — 用 ADR-0018 v014 schema 路徑。
2. **In-session 動作庫 RS picker 路徑**（本 ADR 新增）：session 進行中 user tap `[⊕ 加動作]` → `/library?mode=picker&targetSessionId=xxx` → 動作庫頂部 Tab 切到「超級組」(K1) → tap RS card → 整 RS explode 成 2 個 `session_exercise` row 加進當前 session（parent_id + reusable_superset_id 同 template explode pattern）（**Round D 修訂 2026-05-24**：URL param 訂正為 `sessionId=`（codebase 為真）；same-RS 已在 session 內存在則 **BLOCK**（3-layer lock：SQL throw + UI dim + integration test），不可重複 append。詳見本 ADR § Round D Amendment Q1 + Q2）

**Ad-hoc cluster 模型撤銷**：session 中**沒有**「手動把兩個 solo 動作標成 cluster」的 affordance；如果 user 想做臨場 superset，要嘛事前在動作庫建一個 RS（B1 picker 內即時新建），要嘛跑 freestyle pair 兩個 solo set（不會出 cluster 結構，僅相鄰執行）。

### v014 ADR-0018 Q6 deferred 全部 6 條的翻盤狀態

| 原 deferred | 翻盤後狀態 |
|---|---|
| C-1 cluster 標記入口（gesture/picker/multi-select）| ✗ **移除** — 只能從動作庫挑 RS，**沒有 mid-session 把兩 solo 標 cluster 的 affordance** |
| C-2 cluster block tap target | **仍需設計**（per Q3 collapsed/expanded 模型走，整 block 視為單一卡）|
| C-3 cluster header 位置 | **仍需設計**（H1：縱條色 + 上方 banner 動作 A · 動作 B；見 Q8）|
| C-4 promote ad-hoc to RS | ✗ **移除** — **沒有 ad-hoc cluster 存在**（cluster 來源唯一性 = RS sourced only；沒有 ad-hoc 來源可 promote）|
| C-5 asymmetric highlight | **仍需設計**（AS1：B 側顯「—」灰字 placeholder，不加 highlight；見 Q8）|
| C-6 un-cluster（拆 cluster）| ✗ **移除**（取消 cluster = ⚙️「🗑️ 刪除動作」整卡砍，無需獨立「拆」操作；schema 上 `session_exercise.parent_id` 沒法 mid-session 改回 NULL）|

→ **剩 3 條（C-2 / C-3 / C-5）**已在 Q8 解答。

### Q7 寄生子題拍板

- **(i) K1 picker UI** — Tab 切換（頂部 `[動作]` / `[超級組]` 兩 tab）；動作 tab 是既有 ADR-0017 v2 Exercise grid，超級組 tab 是 ADR-0017 Q10 既有 RS list + 「+ 新建超級組」按鈕（**Round D 修訂 2026-05-24**：兩個 tab 都支援 **multi-select**（`exerciseIds[]` + `reusableSupersetIds[]` 兩個 array，per `pickerBridge.PickerPayload`）；user 按 [完成] 才 commit、`consumePick` drain 兩個 array；multi-pick 完成後自動展開最後一張 appended 卡。詳見本 ADR § Round D Amendment Q3 + Q4）
- **(ii) B1 picker 內即時新建 RS** — picker 內按 `[+ 新建超級組]` → 進 `/superset/new` flow（per ADR-0017 Q10）→ 命名 → 立刻加入當前 session（cross-route round-trip 沿用 ADR-0017 9.8b grill Q7 既設計的 `newlyCreatedSupersetId` mailbox 機制）
- **(iii) L1 自動保存到 Library** — 新建 RS 不論在哪個 mode（template editor picker / session picker）都自動成為 RS entity（INSERT `superset` + `superset_exercise` rows），下次也可挑（per ADR-0017 Q10 「`use_count` cached」既設計）
- **(iv) W1 ADR-0018 顯式 amendment** — 「Cd-B ad-hoc 用例由『即時新建 RS』承擔；session-side `reusable_superset_id IS NULL` 只剩 backfill β'-skipped 場景」（見本 ADR § 翻盤的既有拍板）
- **Cluster size 固定 2**（per ADR-0017「Reusable Superset = 固定 2 動作的命名組合 entity」line 3 + 既有 known issue 已記 schema 與 UI 張力，見已知 known issues #2）

### ADR-0018 amendment 要求

ad-hoc cluster 敘述全 retract；`reusable_superset_id IS NULL` 語意改為「只剩 backfill β'-skipped 場景」；Q6 deferred 從 6 條 → 3 條。Inline 修訂 marker + 文件最末加新 amendment section（詳細指引見本 ADR § 翻盤的既有拍板段）。

## Q8 — In-session cluster block 視覺

### Collapsed cluster 卡 layout

```
┌─────────────────────────────────────────┐
│ [A 圓圖+B 圓圖]  動作 A  ▌ 0.0/4200.0   │
│ 重疊 1/3 寬     動作 B  ▌ ⚙️           │
│                                          │
│ ▰▰▰▱▱▱▱▱▱▱  ← 0-100% bar                │
│                                          │
│ 3 cycles  ● ● ●                          │
│  (左側縱條 RS 色)                         │
└─────────────────────────────────────────┘
```

### Expanded cluster block layout

```
┌─────────────────────────────────────────────┐
│ [縱條 RS 色] 動作 A · 動作 B                │
│                                              │
│  1   A: 52×12     B: 25×15     ✓            │
│  2   A: 54×12     B: 25×15     ✓            │
│  3   A: 54×12     B: 25×15     ✓            │
│                                              │
│  [新增一輪]  [動作歷史] ← 單 btn 跳 RS history │
└─────────────────────────────────────────────┘
```

### 子題拍板

- **(a) Chip + bar** — collapsed 卡顯 0-100% bar（per ADR-0012 G.1 系統主色細 bar）
- **(b) Cluster 視為一個動作** — 已 ship `/superset-history/[id]` + `/superset-chart/[id]`，**不分 A/B 各自開歷史**；底部單一 `[動作歷史]` btn 跳整 RS history
- **(c) Header = H1** — 左側縱條 RS 色（per ADR-0017 Q10 superset.color_hex）+ 上方 banner 顯「動作 A · 動作 B」（不顯 RS name；user 不需要在 in-session 看 RS entity name，配對的兩動作名足夠識別）
- **(d) Asymmetric = AS1** — B 側「—」灰字 placeholder（不加 highlight）；template-sourced asymmetric 可能存在（少見，要 user 在 Template editor 手動造成 sets count 不平衡，per ADR-0017 9.8b lock rule 不允許 cluster 內改 sets — 但 lock rule 是針對 reusable cluster；manual cluster + per Template 手調仍可造成）
- **(e) Cluster 內 [新增一輪]** — A+B 同時 append 一 row（A.set + B.set）；user 操作不會造成 asymmetric（只有 (d) 中 template-side 罕見 case 才會）
- **(f) 一 cycle 一 ✓** — 同 Q2.4，UI 不畫 per-row ✓；整 cycle row 一 ✓ → 事務寫 A.set[i].is_logged = B.set[i].is_logged = true

## Q9 — Session lifecycle（全套）

### (a) Start UX

> **2026-05-24 Round E 取代**：Templates tab entity 砍除（[ADR-0024](./0024-training-tab-three-sections-and-templates-tab-removal.md)）。Bottom sheet 本身保留、流程不動、只是 invocation 從 Templates tab 改到「訓練」tab 的「模板訓練」區塊。Sticky scope 維持 global（不翻盤）。

**Templates tab → tap Template name → bottom sheet（週期 + 強度 picker）→ [編輯模板] / [開始訓練]**

- 預設值 = sticky last-selected（per Q9.2 N1；首次 fallback「無」FB1）

#### Templates tab 簡潔版 layout

```
┌────────────────────────────┐
│  訓練模板          [+]     │
│ ────────────────────────── │
│                             │
│  腿 (蹲)               ›   │
│ ────────────────────────── │
│  推 (胸+肩)            ›   │
│ ────────────────────────── │
│  拉 (背)               ›   │
│ ────────────────────────── │
└────────────────────────────┘
```

每張卡 = 純 Template name + `›` chevron。**無 sibling count、無動作 preview**（Template name 是 group identity，user 知道自己有幾個 sibling）。

#### Tap Template name → Bottom sheet

```
╔═══════════════════════════════╗
║  ‹ 返回          腿 (蹲)      ║
║                                ║
║  選擇週期                      ║
║  ─────────────────────────    ║
║  ○ 無               (固定項)  ║
║  ◉ 5x5 強度週   (最後使用)    ║
║  ○ 8x3 肌肥大週               ║
║  [ + 新增週期 ]                ║
║                                ║
║  選擇強度                      ║
║  ─────────────────────────    ║
║  ◉ 10-12RM       (最後使用)   ║
║  ○ 8RM                        ║
║  [ + 新增強度 ]                ║
║                                ║
║  ┌─────────────┐ ┌────────┐   ║
║  │  編輯模板    │ │開始訓練 │   ║
║  └─────────────┘ └────────┘   ║
╚═══════════════════════════════╝
```

- 選「無」週期時：副標區（強度 picker）整個隱藏（「無 Program」三元組無「強度」概念）（**2026-05-19 wave 11 補充**：當週期 ≠ 「無」時，強度 picker 仍渲染並包含「通用」這一固定項，user 仍可 collapse 至「通用」；參見本 ADR § Q9.2 wave 11 marker 與 `start-template-sheet.tsx` 實作）
- 「無」是**固定既有項目**（不可刪、DB seed 真實 Program entity，per Q9.2 N1）— 不是預設值，是固定選項

### Q9.2 寄生細節（implicit locks，all 採推薦）

- **(i) FB1** — 首次 fallback（無「最後使用」紀錄）預設選「無」週期
- **(N1)** — 「無」schema seed = **真實 Program entity**（DB seed 一筆 `program.name='無 Program'` 或 `'無'` — 確切字串見已知 known issues #1，slice ship 時決定，UI 顯短版「無」即可）。**避免 NULL 特殊邏輯** — 把「無」固定為 entity row，所有依賴 program 的 query 不必特殊處理 NULL
- **(TS1)** — 新 user 首次開 Templates tab = 全空 list + Empty state「還沒有模板，點 [+] 新增」
- **(P1)** — `[+ 新增週期]` / `[+ 新增強度]` 行為 = stack push 小 modal 輸入名稱 + [建立] → auto-select 新建項 → 回 dialog（不離開選擇流程）
- **(E1)** — `[編輯模板]` btn 目標 = 開該三元組對應 Template entity 的 editor；若三元組對應的 Template 不存在（user 選了個尚未建過的組合）則建空 sibling + 開 editor
- **(B1)** — 空 sibling 按 `[開始訓練]` = 建空 sibling Template entity + 立即進 freestyle-like in-session（template_id 指向新空 entity、snapshot 0 動作；user 在 session 中加動作就跟一般 freestyle 一樣走 `[⊕ 加動作]` flow）

### Q9.2 Terminology rename（locked）

- **「Program 主標」→「週期」**（UI / 內文 / dialog 文案）
- **「Program 副標」→「強度」**
- **「無 Program」UI label → 「無」**（DB schema 表的 `program.name` 仍可存 "無 Program" 或 "無"，UI 顯短版即可）（**slice 10c wave 11 修訂**：start-template-sheet + template-meta-sheet 的「無」radio label 改為「**通用**」（雙處同步）— 「通用」對「強度」context 更直覺（user 將「無強度」理解為「適用所有強度」較自然）；schema 端 `program.name='無'` + sentinel id 不變。Agent A drift audit L5 標 accepted；ADR-0003 amendment 等下一輪 ADR sweep 同步）

詳細 ADR-0003 amendment 觸發與影響範圍見本 ADR § 翻盤的既有拍板段。

### (b) Pause = PS0 — **無 pause 概念**

- iPhone session 不引入 paused 第三態（**沿用 ADR-0014 + 既有 Q6 拍板 / CONTEXT.md L704**）
- Elapsed = wall clock（per ADR-0009 Q12.6「pause 期間仍累計時長」）
- User 真要長停：靠 rest timer chip + (Q2.3.a) 預設 ON 的 auto-popup
- Watch 端的 `HKWorkoutSession.pause()` 不在本 ADR scope（ADR-0008 Watch v1 維持）

### (c) Discard = DP1 — Header `[⋯]` menu「放棄訓練」+ confirm dialog → DELETE session CASCADE → 回 Today

- Header layout：`00:00              [⋯]  完成`，新加 `⋯` icon 緊鄰 `[完成]`
- `[⋯]` menu 內項目（v1）：「放棄訓練」（其他次級操作如分享 / 匯出延後 — slice 後續再加，不卡 v1 ship）（**slice 10c 修訂**：menu 實際加了「Body data」shortcut 作為快速體重輸入入口，目前 `['取消', 'Body data', '🚫 放棄訓練']`。Agent A drift audit L1 標 accepted — menu 容納次級操作的設計初衷允許此擴充）
- 「放棄訓練」→ confirm dialog「確定放棄？已記錄的 set 將全部刪除，無法復原」→ DELETE `session` + CASCADE (`session_exercise` + `set`) → 回 Today
- **跟刪除歷史 session 邏輯相同**（per ADR-0014 § 「刪除本訓練」按鈕 3）— 都是 hard delete + dialog + PR/統計 reactive 重算；session 進行中 vs 已完成的差別只是「PR 還沒 commit」這點

### (d) Finish 路徑差異化（翻盤 ADR-0014 Freestyle finish behavior）

> **2026-05-18 wave 12 翻盤**：本表整題砍除，finish 不彈 dialog；模板入口移至詳情頁 sticky 4-button bar。詳見翻盤 ledger 2026-05-18 row。

| Session 來源 | Finish 行為 |
|---|---|
| **Template-based**（`template_id NOT NULL`）| 偵測 diff vs snapshot：**無 diff** → 直接 finish 無 dialog；**有 diff** → 跳 **3-option dialog**：(a) 儲存（覆寫 template，per ADR-0014「儲存模板」既有 flow + sibling rename 連動）/ (b) 另存（新建 Template entity，per ADR-0014「另存模板」）/ (c) 否（本場保留實際數據、template 目標不動）|
| **Freestyle**（`template_id IS NULL`）| 永遠跳 **2-option dialog**：(a) 儲存 = 新建 Template entity（同既有 ADR-0014「另存模板」flow，per 已知 known issues #4 確認）/ (b) 否（session 留為 freestyle，跟既有 ADR-0014「freestyle session.template_id 留 NULL」一致）|

**翻盤點**：ADR-0014 既拍「Session 結束 → Save-back dialog **不會觸發**（無 template_id 無 snapshot 目標可比）」（line 106）。本 ADR 把 Freestyle finish 改為走 2-option dialog，等同把「升級成 Template」這個 ADR-0014 § Freestyle 升級流程從歷史詳情頁三按鈕「也」搬到 finish 即時提示——但歷史頁三按鈕**仍保留**（user 可在歷史詳情頁補升級）。兩條路徑並存。

### Diff scope（Sticky 3）

定義「diff vs snapshot」的具體欄位範圍 — Save-back 範圍擴展到任何 in-session 修改 vs snapshot，**不**僅限既有 ADR-0002 Save-back dialog 的「sets/reps/weight」三項。

| 欄位 | 算 diff |
|---|---|
| set count（新增 / 刪 set）| ✅ |
| reps / weight / is_logged | ✅ |
| set_kind（warmup / working / dropset）| ✅ |
| set_position（reorder）| ✅ |
| 加動作 / 刪動作 | ✅ |
| 換動作（🔄）| ✅ |
| Cluster 加入 / 刪 cluster | ✅ |
| `rest_sec`（本 ADR Q2 新增）| ✅ |
| `exercise.notes`（全局，per ADR-0017 Q5 全局單層）| ❌ — 不算 diff（編輯 = 即時 UPDATE 全局，跟 session 沒掛勾）|
| `session.title`（身份維度，per ADR-0014）| ❌ — 不算 diff（屬身份維度，由歷史頁三按鈕處理）|

「💾 儲存」option 寫回時 propagate scope 沿用 ADR-0014 Q7.3-A 「一般動作只本三元組；常設動作 group-wide sibling」既有規則。

## Q10 — 歷史詳情頁 layout integration（HU1 + HV1 + HE1）

### 終版 layout（整合 ADR-0014 既拍 4-button + 4-tile + 心率 chart）

```
┌────────────────────────────────────────┐
│  ‹ 返回                                 │
│                                          │
│  腿 (蹲)                       [✏]     │
│  5x5 強度週 · 10-12RM                   │
│  2026-05-15 19:32 ~ 20:45               │
│                                          │
│  ─────────────────────────────────────  │
│  [編輯訓練][儲存模板][另存模板][刪除]   │
│  ─────────────────────────────────────  │
│                                          │
│  ┌────┐┌────┐┌────┐┌────┐               │
│  │1h13││4200││ 8  ││350 │               │
│  │訓練││容量││動作││大卡│               │
│  │時間││    ││數  ││    │                │
│  └────┘└────┘└────┘└────┘               │
│                                          │
│  心率訓練區間  140-170 · 平均 152        │
│  ─────────                              │
│  [折線圖 5 色分區]                       │
│                                          │
│  ─────────────────────────────────────  │
│  動作清單                                │
│  ─────────────────────────────────────  │
│                                          │
│  ┌────────────────────────────────┐    │
│  │ ● 深蹲                          │    │
│  │ ─────────                       │    │
│  │ #1  80 × 5  ✓                  │    │
│  │ #2  85 × 5  ✓                  │    │
│  │ #3  90 × 5  ✓                  │    │
│  └────────────────────────────────┘    │
│                                          │
│  ┌────────────────────────────────┐    │
│  │ [縱條] 深蹲 · 箭步蹲             │    │
│  │ ─────────                       │    │
│  │ 1   A: 80×5   B: 50×5   ✓      │    │
│  │ 2   A: 85×5   B: 50×5   ✓      │    │
│  │ 3   A: 90×5   B: 50×5   ✓      │    │
│  └────────────────────────────────┘    │
│                                          │
│  ┌────────────────────────────────┐    │
│  │ ● 腿屈伸                        │    │
│  │ ─────────                       │    │
│  │ #1  52 × 12  ✓                 │    │
│  │ #2  54 × 15  ✓                 │    │
│  │ #3  54 × 16  ✓                 │    │
│  └────────────────────────────────┘    │
│                                          │
└────────────────────────────────────────┘
```

### 子題拍板

- **HU1** — 砍既有 3 段 (Per exercise / 超級組 / All sets) 統一「動作清單」（依 `ordering ASC` solo + cluster inline 混排，per ADR-0018 v014 schema 已能直接還原 cluster 結構）
- **HV1** — 動作清單**全 expanded default**（歷史頁是 read mode；不沿用 in-session Q3 c-2 only-one-expanded 模型 — 看歷史時 user 要 scan 全 session 內容、collapsed 沒幫助）（**slice 10c 修訂**：補「隱藏未打勾」switch 在動作清單上方 — user reload smoke 後要求過濾未打勾 set 的 quick filter；不衝突 HV1 「全 expanded default」、只是補 filter affordance。Agent A drift audit L3 標 accepted）
- **HE1** — `[編輯訓練]` = 整頁進編輯模式（卡片 inline edit + header `[✓ 完成編輯]` exit btn + in-session 同款 row gesture 生效；per ADR-0014 既拍 4-button 中「編輯訓練」內容維度入口的具體 affordance）

### ADR-0014 amendment 要求

- Save-back dialog 範圍擴展（covers 任何 in-session 修改 vs snapshot — 見本 ADR Q9 diff scope 表）
- Finish path differentiation：Template diff-aware 3-option + Freestyle 2-option（翻盤「Freestyle Save-back 不會觸發」）
- 歷史頁 layout 砍 3 段統一動作清單（本 ADR Q10 HU1 拍板）

Inline 修訂 marker + 文件最末加新 amendment section（詳細指引見本 ADR § 翻盤的既有拍板段）。

## Schema 影響總覽

> 重要：migration 編號全用 `v01X` placeholder — 留待後續 slice grill 決定具體版本（不該在 ADR 內定死）。

| 變更 | 表 | 用途 | 預設值 |
|---|---|---|---|
| 新增欄位 | `template_exercise.rest_sec INTEGER NULL` | per-Exercise 休息秒數模板值 | NULL = inherit 系統 hardcoded 60s |
| 新增欄位 | `session_exercise.rest_sec INTEGER NULL` | per-Exercise 本場休息秒數（snapshot 自 template）| NULL = inherit 系統 hardcoded 60s |
| 新增 key | `app_settings.auto_popup_rest_timer BOOLEAN` | Auto-popup 開關 | DEFAULT 1 |
| 新增 seed | `program` 表 seed「無 Program」entity | Q9.2 N1 — 避免 NULL 特殊邏輯 | name = "無 Program" 或 "無"，slice ship 時定 |
| 既有提及 | `session.title TEXT NOT NULL DEFAULT ''` | per ADR-0014 v010 已 ship | - |
| v015 | `set.set_kind` / `set.parent_set_id` / `set.is_logged` | slice 10a foundation — set kind enum (warmup/working/dropset) + dropset chain parent ref + ✓ flag for "completed set"；index + backfill | DEFAULT 'working' / NULL / 0 |
| v016 | `template_exercise.rest_sec` / `session_exercise.rest_sec` / `session.{healthkit_workout_uuid,avg_hr_bpm,kcal}` / `app_settings.auto_popup_rest_timer` seed | slice 10a Q3 + Q5 落地（rest timer 雙欄 + Watch handoff fields + Auto-popup default 1）| NULL / NULL / 1 |
| v017 | `program` 「無」 seed（nil-UUID `00000000-0000-0000-0000-000000000000` row name='無'） | slice 10a Q9.2 N1 — sentinel row 避免 NULL 特殊邏輯 | n/a (seed) |
| v018 | `set.notes TEXT NULL` | slice 10c Phase 2 right-swipe per-set notes 持久化（ADR-0013 衍生）| NULL |
| v019 | `set.session_exercise_id TEXT NULL` | set 隔離（同 session 內多個 reusable cluster 共用同 exercise 不互染）；index + backfill ORDER BY ordering ASC | NULL = legacy fallback（cross-session aggregate query 不動）|
| v020 | `template.color_hex` backfill | overnight #56 wave 56 ship；CalendarGrid 12 色 palette；既有 templates 按 name hash 從 palette 取色 | TEXT NOT NULL DEFAULT '' |
| v021 | `template_exercise.rest_sec` DROP | wave 13c orphan column 清除（per-Exercise rest_sec 已不掛 template_exercise；只剩 session_exercise.rest_sec）| n/a (drop) |
| v022 | `program_sub_tag` (program_id, sub_tag, created_at) | 持久化字典；backfill from `template.sub_tag` + `program_cell.sub_tag`；CASCADE on program delete；三 SQL write path 統一呼叫 `recordProgramSubTag` (INSERT OR IGNORE)；wave 18g 加第 4 條 `overwriteProgram` bulk re-INSERT — **詳見 ADR-0021** | n/a |

**雙欄 `rest_sec` 同步**：`snapshotForSession` 拓展現有 cluster snapshot 邏輯（per ADR-0018 v014 Q4.1）順帶複製 `rest_sec` 欄位；NULL → NULL 照抄（不在 snapshot 時 coalesce 預設 60s——預設值用「inherit NULL」這個 sentinel 表達，避免歷史 session 紀錄被未來改變的「系統預設」回溯影響）。

## 翻盤的既有拍板段

### ADR-0012 § per-exercise card 結構（line 142）

- ❌ **「session 頂層無 chip / 無 stats / 無 AI」這條 retract**：in-session 加 3-tile / 5-tile stats panel（Q6 P1 位置 = timer header 下方），「無 chip / 無 AI」維持
- ❌ ADR-0012 § session 底部 bar line 150「原 reference UI 上的 stats / 容量 / AI 按鈕全砍」中**stats 部分** retract（chip / 容量 / AI 仍砍）

### ADR-0018 § ad-hoc cluster 模型 + Q6 deferred 6 條

- ❌ ADR-0018 § Decision § v014 schema（line 30）「NULL = manual / ad-hoc cluster（no RS identity）」語意 retract — NULL 只剩 backfill β'-skipped 場景，**不**作為 ad-hoc cluster 的入口
- ❌ ADR-0018 § Decision § Session detail render invariants I6（line 152）「`reusable_superset_id IS NULL` → neutral 『Superset』label + default color (ad-hoc)」**部分翻盤** — backfill β'-skipped 場景下仍用此 fallback；session 新建路徑不再產生此狀態（write path 沒入口）
- ❌ ADR-0018 § Out of scope（line 154-163）「Session logger affordance to mark an ad-hoc cluster mid-session」這條 retract — **沒有此 affordance**（cluster 來源唯一性）
- ❌ ADR-0018 § Out of scope 「Affordance to promote an ad-hoc cluster into a saved RS」retract — **沒有 ad-hoc 存在可 promote**
- ❌ ADR-0018 § Out of scope 「Cluster un-marking」retract — **沒有獨立『拆 cluster』操作**，取消 cluster = ⚙️「刪除動作」整卡砍
- Q6 deferred 從 **6 條 → 3 條**（剩 C-2 tap target / C-3 header 位置 / C-5 asymmetric highlight），全部在本 ADR Q3 + Q8 拍板

### ADR-0014 § Save-back dialog scope + Freestyle finish behavior

- ❌ ADR-0014 § Save-back 共存 表 line 92-93「Save-back dialog | session 結束 summary | 內容差異（sets/reps/weight ≠ snapshot 目標）」**範圍擴展** — Save-back 範圍涵蓋任何 in-session 修改 vs snapshot（per Q9 diff scope 表），不再只看 sets/reps/weight 三項
- ❌ ADR-0014 § Freestyle 升級流程 line 106「Session 結束 → Save-back dialog **不會觸發**（無 template_id 無 snapshot 目標可比）」retract — **Freestyle session 結束改為跳 2-option dialog（儲存 / 否）**，「儲存」走 ADR-0014「另存模板」same flow（per 已知 known issues #4）
- ADR-0014 § 歷史詳情頁 4-button + 4-tile + 心率 chart 維持不動（per ADR-0014 § 2026-05-12 Amendment）
- ADR-0014 既有歷史頁 3 段 collapsed 結構 amend 為 HU1 統一動作清單 + HV1 全展開 default + HE1 整頁進編輯模式（per 本 ADR Q10）

### ADR-0003 § 主標 / 副標 terminology

- 「Program 主標」rename → **「週期」**（UI / 內文 / dialog 文案；ADR-0003 內首次出現「主標」處加 rename 指引 inline marker）
- 「Program 副標」rename → **「強度」**
- 「無 Program」UI label → **「無」**
- **DB seed 真實 Program entity**「無 Program」（N1，避 NULL 特殊邏輯）

詳細 amendment 段見 ADR-0003 文末新加 section。

## 拒絕的替代方案

### Rest timer

- **設定預設秒數 setting key**（`app_settings.default_rest_sec`）— 增加 Settings UI 面積 + 多一條 fallback 鏈（user setting → exercise.rest_sec → 60s），心智負擔不必要；hardcoded 60s 直接 fallback 就好
- **Per-set rest_sec**（warmup vs working 各設）— 一個 `rest_sec` 欄位涵蓋整動作所有 set 已足夠，per-set 細分 v1 看不出收益
- **Cluster 內 step 之間啟 timer** — 違反 ADR-0012「cluster 內無休息」訓練學語意
- **K1 cycle-aware 偵測（per-member ✓ + UI 自動偵測整 cycle ✓ 才彈 timer）** — 邏輯複雜（partial cycle / asymmetric / future size > 2）；「一 cycle 一 ✓」直接拒絕複雜性
- **Auto-popup 預設 OFF** — user 訓練中本來就需要 timer，預設 OFF 等同把 R1 feature 預設關掉，違反設計初衷
- **Timer 0 → 紅警告 / 攔截互動** — 違反「快速、即時」哲學；震動 + 短音 + chip 消失已足夠告知

### 動作卡互動

- **動作卡全 expanded default** — session 動作多時頁面太長，scroll cost 大；c-2 only-one-expanded 更聚焦
- **Accordion multi-expand** — 跟 ADR-0016 Template editor 既拍 Q11.3 修訂版「expanded 走 accordion 單卡展開」一致（2026-05-12 prototype amendment 推翻 multi-expand）
- **Expanded 加 active border / ring** — 視覺噪訊；expanded 本身已是「目前操作中」隱含信號

### Set row ⋯ icon

- **Set ✓ 後右下 ⋯ icon 出現**（Image 3 漏標）— 跟 ADR-0012「per-row ⋯ icon 全砍」衝突；維持砍

### Cluster

- **Ad-hoc cluster 標記入口 gesture**（multi-select / long-press pair）— 跟「cluster 來源唯一性」衝突；要 cluster 直接走 `[⊕ 加動作]` → RS picker
- **Cluster 內 [新增一輪] 只 append A 側** — 違反 cluster invariant「A.set[i] 配對 B.set[i]」（ADR-0018 I3）；A+B 同時 append
- **Asymmetric 加 highlight / 紅警告** — 訓練學上 asymmetric 不一定是 bug（user 故意 A 多做 1 cycle）；「—」placeholder 中性表達
- **Cluster un-cluster（拆 cluster）操作** — 整卡砍已足夠；獨立「拆」會留 orphan set 不知該歸哪 row

### Lifecycle

- **iPhone 引入 paused 第三態** — 重複 ADR-0014 + Q6 既拍駁回（WatchConnectivity 同步太複雜）
- **無 discard 入口 / 強制完成** — session 中 user 可能不小心開、家裡突發事件等；hard delete + dialog 是合理 safety net
- **Freestyle 結束無 finish dialog（沿用 ADR-0014 不觸發）** — 本 ADR 翻盤，理由：user 在 freestyle 結束時就在 in-session 編輯流的 context 裡，「升級成 Template」一鍵問是合理的 friction；歷史詳情頁三按鈕補充路徑保留
- **Template-based 無 diff 也跳 dialog** — 多餘 friction（沒改東西 user 為什麼要回答 dialog）；直接 finish

### Stats panel

- **Stats panel 跟 session 頂層 chip 並存** — 跟 ADR-0012「無 chip」維持衝突；chip 走「per-exercise card 右上 0.0/3080.0」既有設計
- **In-session 也顯心率折線圖** — session 進行中沒位置（動作卡列表佔滿）；歷史頁 chart 是事後分析的 affordance
- **5-tile 1 row 不 wrap** — iPhone screen 寬度不夠 5 tile + label 全在一行；2 row 自然 break

### Terminology

- **「Program」字眼維持** — 跟 user 「週期 / 強度」口語不對齊，rename 是長期一致性 fix
- **「無 Program」字眼當 UI label** — 太囉嗦，「無」短而清

## Consequences

### Slice 10+ ship 範圍

- **Slice 10 估時** — 主結構 reimplement（rest timer 系統 + auto-popup + cluster ✓ semantic + 動作卡 collapsed/expanded + ⚙️ menu + in-session stats panel + start dialog + finish dialog 差異化 + 歷史頁 layout 整合）+ 4 個 ADR amendment 落地：估 **~5-8 週**（落在 slice 10 範圍內，依 cluster write path 整合複雜度可能上下浮動 1-2 週）
- v014 ship 後 session 端 cluster write path 才真正活，本 ADR ship 是「v014 schema 配套 UI」收尾
- Watch 端在 slice 11+ ADR-0008 scope 中再對齊本 ADR 的 in-session affordance（Watch 端 stats panel / cluster 視覺需另獨立設計）

### 跨 ADR impact

| ADR | 影響 |
|---|---|
| **ADR-0012**（set logger）| Stats panel 翻盤；其他 set logger 機制（per-row 5 gesture / dropset cluster B3 / inline edit）全保留 |
| **ADR-0013 → 0017 Q5**（per-Exercise notes）| 不影響 — notes 編輯入口走本 ADR ⚙️ menu「📝 編輯備註」，schema 仍是 `exercise.notes` 全局 |
| **ADR-0014**（session.title + 歷史頁）| Save-back 範圍擴展 + Freestyle finish dialog + 歷史頁 HU1/HV1/HE1 layout |
| **ADR-0016**（Template editor）| 不影響 — Template editor 在本 ADR scope 外（in-session 流程 only）|
| **ADR-0017**（Exercise library + RS）| K1 picker Tab 切換、B1 即時新建 RS、L1 自動保存 — 都是 ADR-0017 既有 affordance 在 session-mode 沿用 |
| **ADR-0018**（session-side cluster schema）| Ad-hoc cluster 模型撤銷；Q6 deferred 6 → 3；`reusable_superset_id IS NULL` 語意只剩 backfill β'-skipped |
| **ADR-0003**（two-tier program）| Terminology rename + 「無」schema seed 真實 entity |

### PRD drift

PRD #1（GitHub issue）原本已 drift 5 個 ADR（0014/15/16/17/18）— 本 ADR 是第 6 個。PRD catch-up 不在本 ADR scope，列入後續獨立 task（per 已知 known issues #5）。

### CONTEXT.md update

- Terminology block（週期 / 強度 / 無）— 新加
- Session UI/UX glossary 段（rest timer 系統 / 動作卡雙態 / cluster 來源唯一性 / lifecycle 4 路徑）— 新加
- 既有 L21-L60 「Program 主標 / 副標 / 無 Program」處加 rename inline marker（slice 後續逐步 propagate code / UI label，本 ADR 範圍只到 docs / glossary）

### Test coverage

- Migration tests：`rest_sec` 雙欄 ALTER TABLE idempotency、`auto_popup_rest_timer` setting seed、`program` 表「無」seed
- snapshotForSession 拓展：rest_sec 複製 NULL → NULL；既有 cluster parent_id 兩 pass remap 不變
- Lifecycle tests：start dialog sticky last-selected、finish diff detection（含 rest_sec diff）、Freestyle 2-option dialog
- Cluster ✓ semantic：一 cycle 一 ✓ 事務寫 A/B set；asymmetric skip 不存在的 row

## References

- ADR-0012 — Set logger schema + 全 gesture-driven affordance（設計哲學 anchor 來源）
- ADR-0013 — Per-exercise notes 持久化（被 ADR-0017 Q5 升 per-Exercise 全局）
- ADR-0014 — Session.title + 歷史詳情頁 4-button + 4-tile + 心率 chart（Save-back 範圍擴展 + Freestyle finish dialog 翻盤）
- ADR-0016 — Template editor UI redesign + per-set 預設值 schema
- ADR-0017 — Exercise Library v2 + Reusable Superset entity（K1 picker / B1 即時新建 / L1 自動保存 入口沿用；Q10 RS entity schema 為 cluster 來源唯一性提供母體）
- ADR-0018 — Session-side cluster grouping schema（ad-hoc cluster 模型撤銷 + Q6 deferred 6 → 3）
- ADR-0003 — Two-tier program-template-triple-identity（terminology rename + 「無」schema seed amendment）
- ADR-0008 — Multi-device strategy + Watch v1 scope（in-session stats panel 5-tile 條件 = Watch-tracked session）
- Grill summary `/tmp/grill-summary-session-ui-2026-05-16.md`（2026-05-16 grill 拍板 source of truth）

## Known issues / 留尾

從 grill summary § 已知 known issues 繼承（slice ship 時逐一決議；不卡 ADR ship）：

1. **「無」schema seed 細節**（✅ **2026-05-16 late grill Q1+Q1b 拍板**）— `program.name = '無'`（短版，DB 直接存 UI 顯示字串，不另存 `'無 Program'`）；`program.id = '00000000-0000-0000-0000-000000000000'`（**nil UUID** 全零保留 id，安全因為 UUID v4 variant + version bits 保證生成 id 不會碰撞）。匯出 `RESERVED_NONE_PROGRAM_ID` 常數於 `src/db/seed/v017ProgramNone.ts`。其他欄位：`cycle_length=3`（v005 CHECK 最低值）/ `cycle_count=1` / `start_date='1970-01-01'` / `is_active=0` / `main_tag=NULL`。Slice 10a `v017_program_none_seed.ts` 落地；`listPrograms` 過濾此 sentinel id（Programs tab 不顯示，非用戶可編輯/刪除）。
2. **Cluster size 固定 2 跟 schema `parent_id` 支援 N children 的張力** — schema 允許 N children 但 UI 層強制 2；invariant 明寫在 ADR-0017 + ADR-0018，本 ADR Q8 cluster size 固定 2 重申
3. **「換動作」🔄 內動作 picker 可否挑 RS** — ✅ **2026-05-16 ultra-late slice 10b 拍板：整題消失** — 「🔄 換動作」 menu 項本身砍除（per Q5 § (b) 修訂段），cluster 與 solo 統一走 ⚙️ 🗑️ 刪除動作 → [⊕ 加動作] 動作庫勾選 flow。沒有獨立 swap action = 沒有「picker 能否挑 RS」這個子問題。
4. **Finish dialog「另存」UI 共用歷史頁 flow** — Freestyle finish「儲存」option 與 ADR-0014「另存模板」same flow 確認為**是**（per 本 ADR Q9 (d) 表 + ADR-0014 § Freestyle 升級流程既有設計）
5. **PRD 已 drift 6 條 ADR**（原 5 + 本 ADR-0019）— ✅ **2026-05-16 overnight wave-1 完成**（PR #39 ship docs；PR #40 ship terminology propagation；PRD issue #1 catch-up applied via gh issue edit，744→874 行 + 70 new stories #287-#356）

## Slice 10a foundation schema 落地（2026-05-16 late grill Q1-Q5 拍板）

實作 slice 10a foundation 前需收 5 條 ADR-0019 schema 留尾。2026-05-16 late grill 拍板如下；slice 10a worktree `slice/10a-foundation-schema` 已落地（branch `slice/10a-foundation-schema`，PR pending）。

### Q1 + Q1b — 「無」 program seed
見上方 § Known issues #1。

### Q2 — Set table 三欄擴充（v015）
- v015 ALTER `"set"` 加：
  - `set_kind TEXT NOT NULL DEFAULT 'working' CHECK(set_kind IN ('warmup','working','dropset'))` — same enum as v009 `template_set.set_kind`，**不**為 v014 cluster 加新值
  - `parent_set_id TEXT NULL` — no FK，沿用 v014 `session_exercise.parent_id` convention；用於 Q2.4 一 cycle 一 ✓ cluster + dropset chain
  - `is_logged INTEGER NOT NULL DEFAULT 0` — per-row 「set 完成」 flag，tap ✓ 翻 1 + 啟 rest timer；cluster ✓ 事務寫整 cluster member
- **不**做 `is_warmup` data migration — 2026-05-16 grep 驗證：runtime `set` 表**從未**有 `is_warmup` 欄（ADR-0012 § 161 deprecate 計畫未落地）；既有 rows 走 default 'working' / 0 即可
- `set_kind` 維持 v009 既有三值 enum（warmup/working/dropset）

### Q3 — Session HealthKit stub 三欄（v016）
- v016 ALTER `session` 加：
  - `healthkit_workout_uuid TEXT NULL` — slice 13 真實 writer 填
  - `avg_hr_bpm REAL NULL`
  - `kcal REAL NULL`
- Slice 10b 5-tile UI 走 NULL fallback（不顯心率區間 / kcal tile 顯「—」）；slice 13 HealthKit 整合後自動有資料

### Q4 — Terminology rename 範圍（UI strings only）
- **動**：UI strings ~20 hits in `app/`（「主標籤」→「週期」、「副標籤」→「強度」）+ JSDoc 註解
- **不動**：schema column names `main_tag` / `sub_tag` 保留英文；TS identifiers `mainTag` / `subTag` 不動（192 hits 視為 internal naming，out of scope）
- 落地 commit：`refactor(ui): rename 主標→週期 / 副標→強度 (terminology propagation)`

### Q5 — 3 grouped migrations 落點
- `src/db/schema/v015_set_kind_and_clusters.ts` — Q2 set 三欄
- `src/db/schema/v016_session_runtime_data.ts` — Q3 HK 三欄 + `template_exercise.rest_sec` + `session_exercise.rest_sec`（per 本 ADR line 54-55 雙欄 ALTER 要求）+ `app_settings.auto_popup_rest_timer='1'` seed
- `src/db/schema/v017_program_none_seed.ts` + `src/db/seed/v017ProgramNone.ts` — Q1 「無」 seed

每 migration 配對 idempotency + defaults test（v015 = 4 cases、v016 = 6 cases、v017 = 5 cases）。

### Out of scope for slice 10a（slice 10b-10g 接手）

- Set logger 5-gesture UI / ⚙️ menu bottom sheets
- Rest timer chip / modal / auto-popup
- Cluster row UI（一 cycle 一 ✓ semantic）
- Freestyle finish 2-option dialog
- 歷史詳情頁 layout 整合（4-tile + chart + 動作清單）
- HealthKit 真實寫入（slice 13）
- ✅ ~~`snapshotForSession` 把 `template_exercise.rest_sec` 複製到 `session_exercise.rest_sec`~~（slice 10b 落地，見下方 § Slice 10b 段）

## Slice 10b session card layout + rest_sec bridge（2026-05-16 ultra-late ship）

Slice 10b 落地 ADR-0019 Q3 動作卡互動模型 + Q2.2 § (B) snapshotForSession rest_sec copy + 「無」program label resolution，並修正 slice 10a v016 漏看 schema 命名衝突。PR pending。

### ⚠️ Schema 命名不一致 — slice 10a 漏看修正

Slice 10a v016 加 `template_exercise.rest_sec INTEGER NULL`，但 **v009 早已有 `template_exercise.rest_seconds INTEGER NULL`**（ADR-0016 落地，template editor 既有用）。Grill 拍板時沒查 v009，照著本 ADR line 54 的 `rest_sec` 名字加，造成 `template_exercise` 多了一個 orphan 重複欄。

**Slice 10b 採取的並存 bridge 策略**：
- `template_exercise.rest_seconds` (v009) — **canonical 來源欄**，template editor 讀寫不變
- `template_exercise.rest_sec` (v016) — **orphan**，永遠 NULL，無 reader（將來 v018 migration 可 DROP，slice 10b 不做）
- `session_exercise.rest_sec` (v016) — **canonical session 邊欄**，由 snapshotForSession 從 `rest_seconds` 抄入；slice 10c+ rest timer / ⚙️ menu 直接讀寫此欄
- Domain 層：`TemplateExerciseSpec.rest_sec` + `SessionExerciseSnapshot.rest_sec` 統一用「rest_sec」字段名稱（per 本 ADR 的命名選擇）；`templateRepository.getTemplate` 在 read time 把 `rest_seconds` 列映射成 `rest_sec` 欄位

**為什麼不在 slice 10b 直接 DROP `rest_sec` orphan**：DROP COLUMN 需 SQLite 3.35+ 或 12-step rebuild，破壞性 + 額外 migration v018，跟 slice 10b「無新 schema migration」原則衝突。留待後續 cleanup slice。

### Q2.2 § (B) snapshotForSession rest_sec copy ✅ 落地
- `TemplateExerciseSpec` + `SessionExerciseSnapshot` 加 `rest_sec` 欄位（NULL = inherit hardcoded 60s）
- snapshotForSession 在 Pass 1 複製 `ex.rest_sec ?? null`（NULL 也照抄，不在 snapshot 階段 coalesce — Save-back 區分「user set NULL」vs「user set 60」）
- `templateRepository.getTemplate` 從 `rest_seconds` (legacy) 列映射到 `rest_sec` 欄位
- `sessionRepository.insertSessionExercise` + `listSessionExercisesWithName` 持久化/讀取 `session_exercise.rest_sec`
- Tests: 4 snapshot unit cases + 1 full-pipeline integration case (`templates.test.ts`)

### Q3 動作卡互動模型 ✅ 落地（minimal scope）
- a-1: 動作卡 collapsed default — `expandedExerciseId` state 起始 NULL
- b-1: tap collapsed → expand；tap expanded header → collapse self
- c-2: only-one-expanded — single-id state 自動 collapse 別張
- d-1: vertical scroll — 沿用 parent ScrollView
- e-3: expanded 隱含 active — 用更大背景 opacity，不畫 active border / ring
- 狀態持久化：memory only（per 本 ADR Q3 § 副作用拍板）— 重開 session 全 collapsed reset
- ⚙️ icon 加在卡 header 右側（min 44×44 hit area），tap → Alert placeholder「Coming in slice 10c」+ documentation of 4 sheets
- Expanded body 含 rest_sec 顯示（NULL fallback「60s default」）+ set logger gesture coming-soon hint

### Q5 ⚙️ menu — placeholder only（slice 10c 完整 sheet 落地）
本 slice 只落 affordance（icon + Alert），**3 個** sheet 內容（📝編輯備註 / ⏱️休息秒數 / 🗑️刪除動作）以及 DB write paths 在 slice 10c。

**2026-05-16 ultra-late 修訂**：原 4 項中第 4 項「🔄 換動作」於 slice 10b ⚙️ icon 落地時 user 拍板砍除（per Q5 § (b) 修訂段）。Today tab Alert placeholder 文字同步更新為 3 項。「換動作」flow 改走 ⚙️ 🗑️ 刪除動作 → [⊕ 加動作] 動作庫勾選。

### 「無」 program label resolution（ADR-0019 § (N1) 配套）
- 新增 `resolveProgramLabel(program | null | undefined): string` 在 `src/domain/program/programManager.ts`
- 行為：real program → its name；sentinel program (name='無') → '無'（forwards verbatim，無 special-case）；null/undefined → '無' fallback
- Today tab `programBanner` 改用此 helper；3 unit tests
- Future UI surfaces 一律走此 helper，避免散落 `?? '無'` fallback

### Slice 10c 落地紀錄（2026-05-16 ultra-late）

Slice 10c Phase 1-5 + Phase 8 (本 amend) 落地，**Phase 6-7 留尾**。

**Phase 1** — components/shared/ 共用（commits `3bce155`, `ea0b011`）
- `SwipeableSetRow` 從 `components/template-editor/` 搬到 `components/shared/`
- `SetRowContent` 抽出 + 改寫成 generic over `S extends SetRowItem`

**Phase 2** — Solo set logger（commits `9ca2447` … `8cb8986`）
- `cycleSetKindAcrossExercises` template-side wrapper + 8 cluster tests
- `NumericKeypad` modal + pure `src/domain/keypad.ts` + 31 tests
- 砍 `app/(tabs)/index.tsx` 外層 pills / Weight / Reps / Save Set / Recent sets，set logger 全 inline 進動作卡
- `SetRowContent` inline 編輯接通 + `setLabels` pure extract（template + session 共用）
- `cycleSessionSetKind` pure（4 transitions + DB op list）+ 10 tests
- 左滑刪 / 右滑加 / tap-✓ is_logged 全接通
- **v018 migration**：`ALTER set ADD COLUMN notes` + 4 migration tests
- 右滑「備註」sheet
- NumericKeypad swap 進 SetRowContent（`onTapNumber` prop）
- DB+domain integration smoke 7 tests
- **留尾**：commit 9 long-press reorder via draggable-flatlist 需 `npm install react-native-draggable-flatlist`（user installs in separate Terminal per feedback_workflow）

**Phase 3** — Progress bar + PR display（commits `22b0ca1`, `800693a`）
- `computeExerciseProgress` pure（7 tests）：workingDone / plannedTotal / volumeDone / volumeTotal
- `SegmentedProgressBar` 元件
- 卡 header 顯示 `done/planned` + 進度條 + 容量 numerator/denominator（warmup 排除）（**Q5 修訂 2026-05-17 ultra-late**：sets count line + target line 砍除；容量 `done/planned` chip 提升為 header 主位，無單位文字；見下方 ledger）
- `computePRSnapshot` pure（10 tests）：Pareto frontier of (weight, reps) + max volume PR（**Q5 修訂**：新增 `topWeightSet` + `topVolumeSet` 兩個 single-set 欄位給卡 PR 行用；Pareto frontier 保留給將來圖表 / 多 PR 使用情境）
- 卡 header 下方 PR line：🏆 `100 × 8` `85 × 12` + 整體容量 PR，底線 emphasis 數字（**Q5 修訂**：改 inline `重量 PR: w×r  容量 PR: w×r` 單組顯示，砍 🏆 + 砍「整體」字 — UI 簡潔；per-bucket 細節留給動作歷史頁）

**Phase 4** — ⚙️ menu 3 sheets + reorder（commits `dd0fa3a`, `7451ff6`, `18ea66d` (reverted in 後續 commit), `a3dc423`, `<this-commit>`）
- ActionSheetIOS 3 主項（📝/⏱️/🗑️）+ 1 reorder utility（🔃）+ cancel slot
- 📝 編輯備註：SetNoteSheet 加 `title`/`placeholder` props, 寫回 `Exercise.notes`（全域 per ADR-0017）
- ⏱️ 休息秒數：NumericKeypad reuse, 寫回 `session_exercise.rest_sec`
- 🗑️ 刪除動作：confirm Alert with logged-set count breakdown + `deleteSessionExerciseAndSets` cascade
- 🔃 排序動作：full-screen DraggableFlatList modal（per Phase 6 落地，5th menu item + 長按 card header 雙入口）

**Q11 修訂（2026-05-16 ultra-late）**：原 grill 拍板 4 主項（📝/⏱️/🔀/🗑️），slice 10c Phase 4 commit `18ea66d` 曾落地 🔀。但用戶在落地後拍板再次砍除 🔀 — 統一回到「換動作」走 🗑️ 刪除動作 → bottom-bar [+ 動作] 動作庫勾選 flow（per ADR-0019 amend Q5 § (b) 修訂段的既有共識）。實裝 revert：
  - 砍 `components/shared/swap-exercise-sheet.tsx`
  - 砍 `swapSessionExercise` repo method
  - 砍 ⚙️ menu「🔀 換動作」項目（idx 3 移除，🗑️ 改為 idx 3 + destructive）

ADR-0014 sibling rename propagation 隨 🔀 一起 moot — 不再需要 in-session swap path。

**Phase 5** — Session chrome（commit `ca0f3fe` + revert `<this-commit>`）
- Header 右上 `[⋯][完成]`：[⋯] ActionSheet → 放棄訓練 → `discardSession` cascade delete；[完成] 替換原 bottom End Session
- Bottom sticky bar `[+ 動作][傳至手錶 ⌚]`：跳出 ScrollView 之外
- [+ 動作] `router.push('/exercise-picker?mode=picker')` → LibraryScreen multi-select → `submitPick` → `consumePick` 在 Today 的 `useFocusEffect` drain → `appendSessionExercise` per id（ordering=MAX+1, planned_sets=3）。**初版用 SwapExerciseSheet quick picker**，user 反映該對齊 template editor 全頁動作庫 → 改走 exercise-picker route（per ADR-0017 統一 picker convention）。（**Round D 修訂 2026-05-24**：`consumePick` 尾段擴充 +1 line `setExpandedExerciseId(lastAppendedId)` — multi-pick 後自動展開最後一張新增的卡，配合 Q3 c-2「only-one-expanded」。詳見本 ADR § Round D Amendment Q4）
- [傳至手錶] placeholder Alert（slice 13 WatchConnectivity wires real）

**Schema drift fix**: spec `/tmp/slice-10c-ship-spec-2026-05-16.md` L311「no migration」是樂觀假設；Q9 per-set notes 必須 v018 ADD COLUMN「notes」到 runtime `set` table（template_set 從 v009 就有）。第一個 schema-touching commit 是 Phase 2 commit 7c `4ff79e0`。

**Phase 6-7 留尾**：
- **Phase 6** — Reorder modal（Q10）：需 `react-native-draggable-flatlist` 或自寫 up/down 按鈕 UI（**Phase 6 ✅ done**：DraggableFlatList modal 已落地）
- **Phase 7** — Cluster atomic ✓ pull-forward（Q16）：需新 `components/session/cluster-card.tsx` 元件 + warmup↔working 限制的 sibling mirror + aggregated 容量計算（**Phase 7 ✅ done**：wave 13 chain-aware + wave 14 cluster_partner_exercise_id）

**測試**：main baseline 663/663 → branch 10c 累積 765/765（+102 tests）。

## 翻盤 ledger（greppable）

Per `grill-with-docs` skill closing ritual + `phase-precheck` skill sub-agent's primary grep target. Add at top, newest first. Each row machine-greppable for `修訂 / 翻盤 / 砍除 / 廢案`.

| 日期 | 翻盤項 | 原拍板 | 新拍板 | 觸發 | 關聯 commit |
|---|---|---|---|---|---|
| 2026-05-18 | Q9 (d) Finish dialog 整題砍除 + Q10 action bar 位置改 + ADR-0014「儲存模板」4-branch 收斂為 silent overwrite | (Q9d) Template-based 有 diff → 3-option dialog (儲存/另存/否) + Freestyle 永遠 2-option (儲存/否); (Q10) action bar 在 title 之下、上方位; (ADR-0014) 「儲存模板」4-branch (Freestyle + Template + title-改/未改) sibling rename 連動 | **「完成」→ endSession 直接跳 /session/[id] 詳情頁、無 dialog**；模板操作（儲存模板 / 另存模板 / 刪除）統一改由詳情頁**底部 sticky 4-button bar** 承擔（edit-mode swaps [編輯訓練]→[+ 動作]）；「儲存模板」收斂為 silent overwrite linked template (name 不變、無 diff prompt、無 sibling rename)；歷史頁三按鈕仍是補升級入口；ADR-0014 sibling rename + diff-aware contract 退場 — Freestyle 補升級走另存模板 (TemplateMetaSheet) | 用戶 2026-05-18 #28 拍板「結束訓練？alert 太囉嗦、模板入口跟詳情頁三按鈕重複、freestyle 跟 template-based dialog 不對稱」+ slice 10c overnight #55「另存模板」+ wave 12 #0c9c3d2「儲存模板 silent overwrite」一系列累積；Save-back domain/repo/screen pipeline (`app/save-back/[id].tsx` + `saveBackDiff.ts` + `saveBackRepository.ts`) 完全 orphan、本 commit 一併砍除 | af590fd, 2131e1d, 2301595 (#28), 0a03fb0+2d2cc98 (#55), 0c9c3d2 (silent overwrite), (this commit dead code) |
| 2026-05-20 | Q2.3 rest-timer chip 概念砍除（X1） | (b)(c)(d) 三條反覆描述 chip 為 timer 持續可見 surface、modal 為輔；Q2.3 (b) "chip 在背景同步更新"、(c)(d) "chip 消失" | **X1 modal-only**：chip 概念整題砍除、modal 為唯一 timer surface；(b) re-tap = modal 內部 reset / (c) 0 → modal auto-dismiss / (d) ✓ 取消 → modal 立刻關閉；user 持續可見 surface 等同 modal 持續開啟。短音 F1 仍 deferred to slice 13 | slice 10d grill — user 拍板 X1：chip 多一層 UI 元件複雜度、modal-only ship 速度快、Settings 開關 (S1) 給 user 控制權即可、`session/[id].tsx` edit mode 不接 (E2)、BG2 AppState wall-clock self-correct | (slice 10d ship commit) |
| 2026-05-17 | 超級組獨立 history/chart 頁砍除 | ADR-0017 9.8a 落地時新增 `/superset-history/[id]` + `/superset-chart/[id]` 兩個獨立 modal 頁（搭配 `historyChartFilterMailbox` + `supersetChart` domain wrapper）作為 reusable superset 的歷史檢視管道 | 砍掉兩頁 + domain wrapper；改在 `/exercise-history/[id]` + `/exercise-chart/[id]` 加 3-段 segmented control（`不含超級組` / `包含超級組` / `只含超級組`），由 `clusterMode` URL param + `historyFilterMailbox.clusterMode` 控制；cluster card ⚙️ → cluster_only / solo card ⚙️ → exclude_cluster；reusable superset 詳情頁的「歷史/圖表」footer button 重導向到 A side exercise + `clusterMode=cluster_only` | overnight #8 — segmented control 比兩頁分散更直覺，且省掉 `historyChartFilterMailbox` + `supersetChart` 整層代碼路徑 | overnight #8 commits c9f4c5a → (this commit) |
| 2026-05-16 ultra-late | Q5 動作卡 header + PR row 結構 | sets count + target line + Pareto frontier `🏆 PR: ...` + `整體容量 PR: <sum>` 兩行 | 容量 chip `done/planned` 主位 + PR row inline `重量 PR: w×r  容量 PR: w×r`（單組 top-weight + top-volume，不再 Pareto multi-display） | user 雙 mockup confirm 後拍板 — UI 簡潔 / per-bucket 細節留給動作歷史頁 | (this commit) |
| 2026-05-16 ultra-late | Q11 ⚙️ menu 砍 🔀 | spec L45「重新加 🔀」 | 4 槽 cancel + 3 主項 + 🔃 reorder | user post-spec verbal grill | `18ea66d` (bad impl) + `4b89d63` (revert) |
| 2026-05-16 ultra-late | [+ 動作] picker UX | initial: SwapExerciseSheet quick-list | router.push('/exercise-picker?mode=picker') 全頁 + consumePick | user post-impl preference | `4b89d63` |
| 2026-05-16 ultra-late | 「換動作」flow | 砍 🔀 之 ADR-0014 sibling propagation 留尾 | moot — flow 改走 🗑️ 刪除 + [+ 動作] 動作庫勾選 | derivative of 🔀 砍除 | n/a (跟 4b89d63 同) |
| 2026-05-16 | Q16 cluster atomic ✓ | scoped to slice 10d | pulled forward → slice 10c Phase 7 | spec L14 + visual coherence | n/a (留尾) |
| 2026-05-16 | Q9 set.notes schema | spec L311「no migration」 | v018 ADD COLUMN required | Q9 right-swipe-备注 sheet 需要 notes 欄 | `4ff79e0` (v018) |
| 2026-05-15 | Q15.5 容量公式 | planned_X × planned_Y | Σ working/non-warmup (is_logged=1) / Σ all non-warmup | grill Q15.5 schema-grounding | n/a (pre-impl) |

### Slice 10c 落地紀錄（2026-05-16）

Slice 10c Phase 1-6 + Phase 8（含 ADR amend + 本 ledger）落地，**Phase 7 留尾**。

### Out of scope for slice 10b（slice 10c-10g 接手）
- ~~⚙️ menu 4 項 bottom sheets（slice 10c）~~ ✅ done in slice 10c Phase 4
- ~~Set logger 5-gesture（slice 10c）~~ ✅ partially done（4/5 — long-press reorder 留尾）
- ~~Rest timer chip + modal + auto-popup（slice 10d）~~ ✅ done in slice 10d（chip 概念於 X1 grill 砍除，modal-only ship）
- ~~Cluster ✓ 一 cycle 一 ✓ semantic（slice 10d）~~ moved to slice 10c Phase 7（留尾）
- Freestyle finish 2-option dialog（slice 10e）
- 歷史詳情頁 layout 整合（slice 10f）
- HealthKit 真實寫入（slice 13）
- v018 migration DROP `template_exercise.rest_sec` orphan column

## Slice 10d rest timer modal-only 落地（2026-05-20 grill）

Slice 10d 接手 ADR-0019 Q2 rest timer 系統收尾。Slice 10c 期間 Agent C 已 ship 中央 modal + state machine + Today tap-✓ 線；slice 10d grill 釘住 4 個未拍板的設計題並補洞。

### Grill 拍板（2026-05-20）

| 題 | 拍板 | 翻盤點 |
|---|---|---|
| **X1** — chip 整概念砍除 | Modal 為唯一 timer surface、不另做 chip persistent badge | 翻盤 Q2.3 (b)(c)(d) 中 chip 敘述，已 inline mark + ledger row |
| **S1** — Settings UI 開關 | Slice 10d ship「自動跳出休息倒數」Switch；讀寫 `app_settings.auto_popup_rest_timer` | 兌現 Q2.3 (a)「Settings 可關」 |
| **E2** — `session/[id].tsx` edit mode 不接 timer | 歷史頁編輯模式 tap-✓ 不啟 modal；edit mode 為事後修訂語意、非 in-session | 跨 page 行為差異化、`enableRestTimer` flag 不需引入因 Today 與 detail 走獨立 state |
| **BG2** — AppState wall-clock self-correct | `RestTimerModal` 加 `AppState.addEventListener('change', ...)`；app foreground → `tickTimer(state, Date.now())` 自動 reconcile | `end_at_ms` wall-clock anchor 既設、self-correct 是 30 行內 patch |

### 落地清單

| # | 項目 | 觸發改動 |
|---|---|---|
| 1 | Q2.3 (b)(c)(d) inline X1 修訂 marker + 翻盤 ledger row | `docs/adr/0019-...md` |
| 2 | BG2：`RestTimerModal` AppState listener | `components/session/rest-timer-modal.tsx` |
| 3 | S1：`settingsRepository.getAutoPopupRestTimer` / `setAutoPopupRestTimer` helpers（容忍 v016 raw `"1"` seed 與 JSON `1` round-trip 兩種 shape；missing key → default ON） | `src/adapters/sqlite/settingsRepository.ts` |
| 4 | S1：Settings tab 加「訓練偏好 > 自動跳出休息倒數」`<Switch>` row | `app/(tabs)/settings.tsx` |
| 5 | S1：Today refresh 改用 `getAutoPopupRestTimer`（與 Settings 同來源、missing key 一致 default ON） | `app/(tabs)/index.tsx` |
| 6 | Tests：BG2 wall-clock resume 4 case + S1 round-trip + raw seed shape 6 case | `tests/domain/restTimer.test.ts`、`tests/db/autoPopupRestTimerSetting.test.ts` |

### Y2 + dropset chain head ✓ 驗證

- **Y2 cancel wiring**：Today `onToggleLogged` (line 985-988) + `onToggleClusterCycle` (line 1051-1053) 兩處 `nextLogged === 0 → setRestTimerTarget(null)` 已 wire（slice 10c 已落地）。Slice 10d 無新 code 改動。
- **Dropset chain head ✓**：head row 走 solo path、`session_exercise.rest_sec` 自動帶入、follower row 無 ✓ slot 故不會觸發 timer。Slice 10d 無新 code 改動，per dropset-chain-semantics skill 已 chain-aware。

### 已知 v1 限制（slice 13+ 處理）

- **短音 F1**：`expo-av` 整合 deferred to slice 13；`RestTimerModal` 0 → 仍只震動（`Haptics.notificationAsync` Success）+ auto-dismiss 400ms。
- **iOS 硬 kill recovery**：app 被 OS low-memory eviction 時 modal React state 整個沒；無 local notification fallback。可接受 v1 trade-off。
- **`session/[id].tsx` edit mode 行為對稱性**：edit mode tap-✓ 不啟 timer，與 Today 視覺上 mirror 但 timer 行為不同。E2 拍板認可此「語意非對稱」（編輯歷史 ≠ 現場訓練）。

## Round D Amendment (2026-05-24) — set-logger plan finalization

Grill round D（set-logger implementation plan finalization）resolved 4 decisions on 2026-05-24。3 reversed prior plan recommendations after codebase cross-reference at HEAD `01a0a62`；1 aligned with plan。這 4 條的目的是把 plan 文件（`/tmp/2026-05-24-set-logger-implementation-plan.md` 12 implementation card）跟既存 codebase 對齊，避免 plan 描述的入口 / 介面與真實 code 矛盾。

### Q1 — URL param naming = `sessionId=`（**翻盤 plan**）

- **Plan recommendation**：`targetSessionId=`（更明確表達語意 = 「append into THIS session」）
- **Codebase truth at `01a0a62`**：
  - `app/(tabs)/library.tsx:75` 已宣告 `useLocalSearchParams<{ mode?: string; sessionId?: string }>()`
  - `app/session/[id].tsx:1850` 用 `router.push('/exercise-picker?mode=picker&sessionId=${id}')`
- **Decision**：保留 `sessionId=`。Codebase 為真，plan 文字 `targetSessionId=` 一律 superseded；本 ADR § Q7 第 168 行同步加 inline marker。

### Q2 — Duplicate RS in session = BLOCK（**翻盤 plan**）

- **Plan recommendation**：not block（允許同一個 RS 在 session 內多次 append，方便 user 重複操作）
- **Codebase truth at `01a0a62`**（3-layer lock 已落定）：
  - **SQL layer**：`src/adapters/sqlite/sessionRepository.ts:381-395` `appendReusableSupersetToSession` 內 SELECT-then-throw guard，命中即 `throw new Error('duplicate RS in session')`
  - **UI layer**：picker mode 模式 dim 已用 SupersetCard / ExerciseCard（per `app/(tabs)/library.tsx` slice 10c round 4 #20）
  - **Test layer**：`tests/db/appendReusableSupersetActiveSessionInterlock.test.ts:184` `.rejects.toThrow(/duplicate RS/i)`
- **Decision**：BLOCK 三層鎖 enforced。Plan「not block」superseded — user 真要重做 RS，刪掉舊的 + 重新加（per Q5 cluster 「換成員」flow 同一語意）。

### Q3 — Multi-select uniformity 兩 array（**翻盤 plan**）

- **Plan recommendation**：single-shot RS（每次 picker 只能挑 1 個 RS，其他 solo exercise 才支援 multi-select）
- **Codebase truth at `01a0a62`**：
  - `src/domain/exercise/pickerBridge.ts` `PickerPayload` 已宣告 `reusableSupersetIds: string[]`（array shape，可承載多筆 RS id）
  - 本 ADR § Q7 (i) K1 picker UI「tap RS card → 整 RS explode」文字 ambiguous（沒明寫 single vs multi、code 已是 array）
- **Decision**：`exerciseIds[]` 與 `reusableSupersetIds[]` 兩個 array 都統一 multi-select；UI 完成才 commit（user 按 [完成]）；`consumePick` at `app/(tabs)/index.tsx:347-413` 同時 drain 兩個 array。Plan「single-shot RS」superseded — 與 pickerBridge 既有 array shape 對齊就好，不引入 single/multi 雙模式複雜度。

### Q4 — Auto-expand LAST appended exercise card（**對齊 plan**）

- **Plan recommendation**：multi-pick 後自動展開最後一張新增的卡（user mass-pick 完不必再點開最後一張就能直接 inline-edit）
- **Codebase truth at `01a0a62`**：`app/(tabs)/index.tsx:347-413` `consumePick` drain 後**不動** `setExpandedExerciseId`，新卡 land 在 collapsed 狀態
- **Decision**：對齊 plan。`consumePick` 尾段 +1 line `setExpandedExerciseId(lastAppendedId)`（最後一張 appended 卡的 `session_exercise.id`）。與 Q3 c-2「only-one-expanded」一致（自動 collapse 別張、展開新卡這一張）。**此項 plan 與 code 不衝突、純擴充行為**。

### Revision ledger

| Date | Section | Action | Reason |
|---|---|---|---|
| 2026-05-24 | Q7 (i) K1 picker URL param naming | ❌ supersede `targetSessionId=` mentions | Codebase truth: `sessionId=` 已 ship（`app/(tabs)/library.tsx:75` + `app/session/[id].tsx:1850`） |
| 2026-05-24 | Q7 § In-session 動作庫 RS picker 路徑 — duplicate RS behavior | ❌ supersede "do not block" plan | 3-layer lock 已落定（SQL throw + UI dim + integration test） |
| 2026-05-24 | Q7 (i) K1 picker selection mode | ❌ supersede "single-shot RS" plan | `pickerBridge.PickerPayload.reusableSupersetIds: string[]` 既為 array shape |
| 2026-05-24 | Slice 10c § Phase 5 consumePick post-append behavior | ➕ extend "auto-expand last appended" | New behavior (no prior decision in ADR-0019 / ADR-0017) |
