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
- **(c) F1** — Timer 倒到 0 → 震動 + 短音 + ~~chip 消失~~ → **modal auto-dismiss**（slice 10d X1 修訂；~~短音仍 deferred to slice 13~~ ✅ landed Phase A — 見 § Slice 13 Phase A Amendment）（不彈紅警告 / 不擋互動）（**2026-05-25 Slice 13 Phase A 拍板**：短音採 0.3s sine 440Hz beep `assets/sounds/rest-timer-done.wav` + `expo-audio` (SDK 54+) 觸發，於既有 `Haptics.notificationAsync(Success)` 同一處 fire — 詳見 § Slice 13 Phase A Amendment）
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
- **歷史詳情頁維持 ADR-0014 既拍 4-tile + 心率 vs 時間折線圖**（in-session stats panel 跟歷史頁 layout **內容不對稱**——歷史頁有獨立心率 chart 區塊 + 4 tile，in-session 是 3 或 5 tile 沒 chart）（**slice 10c 修訂**：5-tile Watch variant + 歷史頁 4-tile + 心率 chart 都 deferred to slice 13 (HealthKit landed)；在那之前 `SessionStatsPanel` 是 in-session + 歷史頁兩個 surface 的單一 3-tile 來源，kcal tile 與心率 chart 暫不渲染。詳見本 ADR § slice 10d 段 + Agent A drift audit M1/M2）（**2026-05-25 Slice 13 Phase A 拍板**：5-tile shell + 歷史頁 4-tile + HR chart canvas **placeholder** 全部於 Phase A 落地、Watch tracked / HK granted 由 Settings > 開發者 dev toggle 模擬；真 HR/kcal 資料 + 真 HKWorkoutSession 仍 Phase B 才接 — 詳見 § Slice 13 Phase A Amendment）（**2026-05-26 Slice 13d Amendment**：5-tile predicate 由 dev toggle 改為 `session.is_watch_tracked` v024 column @ D1 `4acfcce`；slice 13c 真 HR/kcal 已落地、HR live-fetch 由 Watch 端 `HKWorkoutSession.activeWorkoutHeartRate` observer + 3-5s applicationContext throttled push iPhone live mirror 取代 v016 `avg_hr_bpm` 持久化 — 見 § Slice 13d Amendment Q14/Q24）

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
2. **In-session 動作庫 RS picker 路徑**（本 ADR 新增）：session 進行中 user tap `[⊕ 加動作]` → `/library?mode=picker&targetSessionId=xxx` → 動作庫頂部 Tab 切到「超級組」(K1) → tap RS card(s) (**multi-select**, Round D Q3) → 整 RS explode 成 2 個 `session_exercise` row 加進當前 session（parent_id + reusable_superset_id 同 template explode pattern）（**Round D 修訂 2026-05-24**：URL param 訂正為 `sessionId=`（codebase 為真）；same-RS 已在 session 內存在則 **BLOCK**（3-layer lock：SQL throw + UI dim + integration test），不可重複 append；多選後一次 commit、`consumePick` drain 兩 array。詳見本 ADR § Round D Amendment Q1 + Q2 + Q3）

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
- **(c) Header = H1** — 左側縱條 RS 色（per ADR-0017 Q10 superset.color_hex）+ 上方 banner 顯「動作 A · 動作 B」（不顯 RS name；user 不需要在 in-session 看 RS entity name，配對的兩動作名足夠識別）（**2026-05-25 翻盤 H1 縱條**：見 § 2026-05-25 Amendment — Q8 (c) H1 縱條 walked-back，banner 部分維持）
- **(d) Asymmetric = AS1** — B 側「—」灰字 placeholder（不加 highlight）；template-sourced asymmetric 可能存在（少見，要 user 在 Template editor 手動造成 sets count 不平衡，per ADR-0017 9.8b lock rule 不允許 cluster 內改 sets — 但 lock rule 是針對 reusable cluster；manual cluster + per Template 手調仍可造成）
- **(e) Cluster 內 [新增一輪]** — A+B 同時 append 一 row（A.set + B.set）；user 操作不會造成 asymmetric（只有 (d) 中 template-side 罕見 case 才會）
- **(f) 一 cycle 一 ✓** — 同 Q2.4，UI 不畫 per-row ✓；整 cycle row 一 ✓ → 事務寫 A.set[i].is_logged = B.set[i].is_logged = true

### 2026-05-25 Amendment — Q8 (c) H1 縱條 walked-back

**翻盤**：(c) 中「左側縱條 RS 色」部分撤銷。Cluster card 不再畫 `borderLeftWidth + borderLeftColor: superset.color_hex`。

**Banner 部分維持**：「動作 A · 動作 B」(line 231 (c) 後半段) 仍是 cluster card identity 的主要視覺；本翻盤只動縱條，不動 banner。

**理由**：
- Slice 10c overnight #6 sweep ship 時實質砍掉，但無 ledger 記錄 → 2026-05-25 audit 揪出為 silent revert
- 設計直覺：cluster vs solo card 已有充足視覺差異（紫底「超」supersetTag chip + clusterName 兩動作合併顯示 + 共享 progress bar / 容量 chip）；額外加左側彩條造成視覺重量不均、跟 solo card 樣式不一致
- RS 自身的 `color_hex` 在 Library RS card preview / `app/superset/[id].tsx` 等 RS-tab UI 仍有用 — 只在 in-session cluster card 不畫
- `clusterRSColorThreading.test.ts` (4 tests) 對應的 SQL LEFT JOIN + `reusable_superset_color_hex` field 也一併砍除（dead code），未來 H2 設計要回來 1 行 LEFT JOIN re-add

**Code 改動**：
- `components/session/cluster-card.tsx`：drop `colorHex` prop + `borderLeftColor` derived constant
- `app/(tabs)/index.tsx` + `app/session/[id].tsx`：drop `colorHex={p.reusable_superset_color_hex}` caller pass
- `src/adapters/sqlite/sessionRepository.ts`：drop `reusable_superset_color_hex` field + LEFT JOIN
- `tests/db/clusterRSColorThreading.test.ts`：DELETE
- ASCII figures (line 208-209 + 217) 保留原樣作歷史記錄（縱條斜表示已撤）

### 2026-05-25 G1 Grill — App-level cascade + 右滑+1 分流 ratification

**主軸**：confirm + 記錄既有實作，不翻盤任何拍板。

**Dropset chain delete cascade**：

- Schema 層 `set.parent_set_id` 刻意無 FK（v015 line 16-17 "no FK, mirrors v014 pattern"）→ DB 層**不**自動 cascade
- App 層 `deleteSet` (`setRepository.ts:101-115`，commit `3fe066a` 2026-05-20) 在 transaction 內顯式 cascade：
  1. NULL `achievement_unlock.set_id` back-ref（避免 FK violation 對 logged set）
  2. `DELETE FROM "set" WHERE parent_set_id = head_id`（清 followers）
  3. `DELETE FROM "set" WHERE id = head_id`（清 head 自己）
- 等價於 schema-level CASCADE 對 user 而言，但保留「achievement 記錄不被連帶刪」的副作用控制
- 測試 `tests/db/clusterCascadeDelete.test.ts` 覆蓋 #17 isolation + #18 cascade

**右滑「+1」分流**（`app/(tabs)/index.tsx:1112-1143`）：

- Solo set 右滑 +1 → `insertSessionSetAfter`，mirror source 的 set_kind / weight / reps
- Dropset chain HEAD 或 follower 右滑 +1 → `addSessionDropsetCluster`，新 D2 cluster (head + 1 follower) 加在 D1 chain 之後
- Chain 內 inline `+` / `−` → `addSessionDropsetRow` / `removeSessionDropsetRow`，擴 / 縮**同一個** chain
- 設計直覺：「+1 swipe = 新增最後一組 = 同種類的下一個」；user 想擴 D1 走 inline，想加 D2 走 swipe

**為什麼是 G1 grill 而非寫進主 ADR**：兩塊都是 implementation detail（cascade 在 app 而非 DB；右滑分流 swipe-vs-inline 雙路徑）。未來讀者光看 schema 會誤判「Dropset 無 cascade」；光看 UI 行為會誤判「右滑+1 永遠延長同 chain」。本段為防止這兩個誤判而存在。

**Code action**：`app/(tabs)/index.tsx:3009-3017` stale TODO comment 改寫指向本段（commit 由本 grill 觸發）。

### 2026-05-25 Slice 13 Phase A Amendment — HealthKit-前 scaffold ship

**主軸**：把 Slice 13 整套（HR / kcal / 5-tile / Watch / Rest 短音）切成 **Phase A scaffold（無 HK、無 Watch native、無 expo-dev-build）** 與 **Phase B HealthKit unlock（接真資料 + native bridges）** 兩段。Phase A 落地 7 項，user 透過 Settings > 開發者 dev toggle 預覽 Phase B 的最終 UX shell。詳細 phasing 設計依據見 `/tmp/overnight-reports-2026-05-25-wave2/C-slice13-prep.md` Agent C 報告。

**App Store 上架紀律（user 拍板）**：iPhone + Watch 一起上、不 single-side ship。Phase A 產出僅 TestFlight 內部試。Phase B 後才公開上架。Phase A 不影響開發順序。

#### Phase A 範圍（7 項）

| # | Deliverable | 檔案 / 模組 | 估 LOC |
|---|---|---|---|
| 1 | `SessionStatsPanel` 加 `kcal` prop（NULL → "—"）+ `variant: '3tile' \| '4tile' \| '5tile-watch'` | `components/session/session-stats-panel.tsx` | +50 |
| 2 | 5-tile Watch shell render path（Phase A 由 Settings > 開發者 dev toggle 觸發） | 同上 | +30 |
| 3 | HR chart canvas + axes + grid + Z1-Z5 zone bands + grey overlay + hint（無資料 line） | `components/session/hr-zone-chart.tsx` (新增) | +150 |
| 4 | `hrZones.ts` pure module（HRmax = 220 - age；Z1-Z5 % bucketing） | `src/domain/session/hrZones.ts` (新增) | +60 |
| 5 | `computeDetailPageStats` interface 擴 `avgHr` / `maxHr` / `zones[]`（NULL when no data） | `src/domain/session/sessionStats.ts` | +20 |
| 6 | Rest timer 短音（0.3s sine 440Hz beep、`expo-audio` 觸發、與 Haptics fire 同處） | `components/session/rest-timer-modal.tsx` + `assets/sounds/rest-timer-done.wav` | +40 |
| 7 | Settings > 開發者 區塊：兩 dev toggle「模擬 Watch tracked session」+「模擬 HK granted」 | `app/(tabs)/settings.tsx` + 一個 setting key store | +30 |

**i18n keys 加入（Phase A 8 個）**：
- `domain.heartRate` / `domain.kcal` / `domain.bpm` / `domain.hrZone`
- `status.hrChartEmptyHint` / `status.hrZoneSummary` / `status.kcalEmpty`
- `page.hrZoneSection`

**i18n keys deferred 到 Phase B（6 個）**：`status.hrPlaceholder` / `status.hrZoneRange` / `status.kcalUnit` / `button.requestWatchSync` / `alert.healthKitPermission` / `alert.healthKitDenied`（這些 Phase A 沒 caller、避免 orphan key）

**測試 delta 估 ~30 unit tests**：zone bucketing × ~12、format helpers × ~6、kcal NULL fallback × ~4、`SessionStatsPanel` variant snapshot × ~6、`hr-zone-chart.tsx` empty-state × ~2。

#### Phase B 範圍（HealthKit unlock，~4-6 週）

| Deliverable | Phase B 工作 |
|---|---|
| `react-native-health` npm + iOS pod + entitlement | Expo Dev Build env 切 + native config |
| `src/adapters/healthkit/*` query layer | HR samples + activeEnergyBurned + workout UUID |
| HealthKit permission UI | Settings > HealthKit 區塊接真 permission request；Phase A dev toggle 刪除 |
| WatchConnectivity bridge | `transferUserInfo` / `updateApplicationContext` for live HR |
| SwiftUI Watch app target | 新 Xcode target + `HKWorkoutSession` lifecycle |
| HR chart 真資料 | Phase A placeholder overlay 移除、加 path line + 真 zone bands |
| 5-tile HR / kcal 真值 | Phase A 「—」 → live values + Z-zone border color |
| `session.healthkit_workout_uuid` writer | Watch → iPhone DB roundtrip |
| 「傳至手錶」 Alert → real transferUserInfo | `alert.watchComingSlice13` 換成真按鈕邏輯 |
| i18n keys 加入 Phase B 6 個 | 同上「Phase A deferred 6 個」 |

#### Phase A → Phase B 轉換點（不留 dead code）

- Settings > 開發者 區塊兩 dev toggle 在 Phase B 第一個 commit 移除（連同 setting key store）；HK permission UI 接真 logic
- `SessionStatsPanel` variant logic 不變 — Phase A 已正確 branch on a watch-tracked predicate（Phase A: `dev_simulate_watch_tracked` setting key；**Slice 13d**: `session.is_watch_tracked` v024 column 取代、shipped D5 commit `7b07f9b`）；Phase B 只是讓真 Watch-tracked session 自然 trigger 5-tile（dev toggle 移除後條件僅剩 `session.is_watch_tracked === true`，**不**用 `session.healthkit_workout_uuid !== null`，因 13c iPhone-only path 也寫 uuid 但不是 Watch-tracked predicate — per Slice 13d Q24；以 v024 column 為單一 source 比 HK UUID 更早可用，且不受 HK 寫入時機影響）
- `hr-zone-chart.tsx` grey overlay + hint 在 Phase B 條件移除（when data array length > 0）
- i18n Phase B 6 key 在 Phase B 第一個 commit 同 caller 一起 append（per i18n-sweep-alerts skill）

#### Slice 13a 落地紀律

- Branch `slice/13a-stats-and-hr-shell` 從 `slice/10c-set-logger-and-menu` tip stack（10c 仍未 merge）；10c 進 main 後 13a 需要 `git rebase main` 一次
- 7-commit chain：C1 docs+infra → C2 HR chart shell → C3 StatsPanel variants → C4 Detail page wire → C5 Today wire → C6 Settings dev toggles → C7 rest 短音
- 每 commit 須過 pre-commit hook（tsc + jest）
- 預期工期 2-3 週（含 smoke）

### 2026-05-25 Slice 13b Phase B 開工 Amendment — Foundation slice + Fitness app 補寫

**主軸**：把 Phase B 切成多 slice（13b → 13c → 13d → ...）。slice 13b 只做 foundation——離開 Expo Go 切 Bare workflow、裝 react-native-health、把 Phase A 「模擬 HK granted」dev toggle 換成真 HealthKit permission UI。**真讀 HR / activeEnergyBurned 資料 + HKWorkout writer 留給 13c-d**。

#### slice 13b 拍板 grill Q1-Q8（2026-05-25 ratified by user）

| Q | Topic | Decision |
|---|-------|----------|
| Q1 | slice 13b scope | Foundation only：Expo Dev Build + RN-Health install + HK permission UI |
| Q2 | Build pipeline | **Local prebuild + Xcode build**（不走 EAS Build）|
| Q3 | bundleIdentifier | `com.lisonchang.TrainingLog`（ADP App ID 註冊 + enable HealthKit + iCloud capability）|
| Q4 | HK request scope | READ: HeartRate + ActiveEnergyBurned (2)；WRITE: Workout (1) — 共 3 scope |
| Q5 | Phase A toggle 處理 | **Watch tracked toggle 暫留到 slice 13d**（5-tile-watch UI regression guard）；**HK granted toggle 完整移除**（真 HK permission UI 取代） |
| Q6 | Settings UI | 單 button「連結 Apple Health」+ 已 request 後顯示「✓ 已連結」+「開啟系統設定」shortcut（state-based、配合 iOS one-shot dialog 限制）|
| Q7 | Commit chain | 4 commits（B1 prebuild + entitlement / B2 adapter + state machine / B3 Settings UI / B4 docs）|
| Q8 | Fitness app 覆蓋率 | **iPhone 補寫 HKWorkout**：session 結束時若 `session.healthkit_workout_uuid IS NULL` → iPhone 補寫、讓 Fitness app 100% 顯示所有訓練（slice 13c-d 實作 writer、13b 只 request WRITE 權限）|

#### slice 13b 4-commit chain（已 ship）

| # | Commit | 內容 |
|---|--------|------|
| B1 | `feat(slice-13b): bundleId rename + expo prebuild + HealthKit entitlement` | app.json bundleId → `com.lisonchang.TrainingLog`、`npx expo install react-native-health@1.19.0`、`npx expo prebuild --platform ios` 生 `ios/` 目錄（27 個追蹤檔、Pods/ + build/ + xcuserdata 排除）、HealthKit entitlement + NSHealth*UsageDescription 注入 |
| B2 | `feat(slice-13b): HealthKit adapter layer + permission state machine` | `src/adapters/healthkit/` 三檔（index.ts / permission.ts / types.ts）+ `requestHKAuthorization` (promisified) + `getAuthorizationState` / `markAuthorizationRequested` + settingsRepository 加 hk_authorization_requested key + 6 jest tests |
| B3 | `feat(slice-13b): Settings Apple Health 整合 section + delete HK dev toggle` | Settings UI 加「Apple Health 整合」section（state-based render）+ 移除 Phase A `dev_simulate_hk_granted` toggle + setting key + 對應 test；Watch tracked toggle 加 [dev] 標籤 + TODO(slice-13d) |
| B4 | `docs(adr-0019): Phase B 開工 amendment + slice 13b 落地紀錄` | 本 amendment |

**Test count delta**：1570 → 1573（+3 淨，6 個新 HK test - 3 個砍 HK granted toggle test）

**新檔**：`src/adapters/healthkit/index.ts` + `permission.ts` + `types.ts` + `tests/adapters/healthkit/permission.test.ts`、`ios/` 整個目錄

**新 deps**：`react-native-health@1.19.0`（單一 SDK-managed install via `npx expo install`、避免 overnight-parallel-agents skill #19 npm install fallback 陷阱）

**新 i18n keys（zh + en 對稱、5 個）**：
- `page.appleHealthSection`
- `button.connectAppleHealth` / `button.openSystemSettings`
- `status.appleHealthIntro` / `status.appleHealthConnected` / `status.managePermissionHint`

**Phase A → Phase B 轉換實際偏離**（與 Phase A Amendment § 轉換點 對照）：
- ❌ Watch tracked toggle 未在 Phase B first commit 移除 → 暫留到 slice 13d（理由：13b → 13d 之間沒有真 Watch tracked session、5-tile-watch UI variant 完全 unreachable、留 toggle 當 regression guard 比較保險）
- ✅ HK granted toggle 在 slice 13b（Phase B first commit）完整移除（連 setting key + repo 函式 + 對應 test）
- ✅ HK permission UI 接真 logic、不留 dev affordance

#### iOS HealthKit 行為紀錄（slice 13b 學到的）

1. **OS permission dialog 是 1-shot**：`requestAuthorization()` 第一次 call 才彈、之後 same app 不會再彈。User 改主意必須去 Settings.app → 隱私 → 健康 → TrainingLog 自己 toggle scope。
2. **per-scope grant status 不可程式讀**：iOS 為 privacy / fingerprinting 防護，連「user grant 了 HR 沒？」都不暴露給 app。唯一推斷方式是 query 試試看資料是否回得來。
3. **本地 flag 跟 OS 狀態不同**：`hk_authorization_requested` flag 在 app_settings 紀錄「我們問過了沒」、**不**代表 user 真的 grant 了。Settings UI 顯示「✓ 已連結」也是這個意思（asked successfully）、**不**保證 13c 能讀到資料。
4. **`Linking.openURL('App-Prefs:Privacy&path=HEALTH')`** iOS 14+ 支援、偶爾被 OS 版本擋；fallback `'app-settings:'` 跳 app 自己的設定頁、user 自己再點到隱私區。
5. **CocoaPods 1.16.2 + Ruby 4.0 unicode_normalize bug**：`pod install` 直接跑會炸 `Encoding::CompatibilityError`、必須 `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`。`npx expo prebuild` 內部跑 pod install 也踩到、需先環境變數設好。

#### 真機 build 階段踩到的 5 個 Phase B foundation 級坑（2026-05-26 ship）

1. **`react-native-health@1.19.0` 不支援 New Architecture**：Pod 裝成功 (`RNAppleHealthKit` in Podfile.lock)、native sources 都在、但 `NativeModules.AppleHealthKit === undefined` at runtime → `initHealthKit is not a function` 錯誤。原因是 RN-Health 還用 legacy bridge、未 register 成 TurboModule。**ADR-0019 § Phase B 範圍原 lock 的 `react-native-health` 套件 deviation 為 `@kingstinct/react-native-healthkit@14.x`（Nitro / New Arch native）**。
2. **`newArchEnabled: false` 也走不通**：嘗試 flip 關 New Arch 想留 RN-Health → `react-native-reanimated`'s Podspec 內 `assert_new_architecture_enabled` 直接擋 pod install。整 stack（reanimated 已是核心依賴）強制 New Arch 必須開、所以唯一可行路徑就是換 HK 套件。
3. **`expo prebuild --clean` 會洗掉 Xcode signing Team 選擇**：`project.pbxproj` 的 `DEVELOPMENT_TEAM` 欄位在重生時清空、Xcode reopen 後變回「None」+ 紅色 `requires a development team` 錯誤。每次 prebuild --clean 後必須在 Xcode Signing & Capabilities 重選 Team。Xcode 同時會跳 dialog 說 workspace file 不見了、點 **Close**（不要 Re-save）。
4. **Dev build 需要 Metro 跑著 serve JS bundle**：build 成功 + app install 完不代表能跑、debug config 第一次 launch 必須 Metro 在線（Expo Go 把 Metro 跑著當預設、bare workflow 不會自動）。`expo start` from worktree、確保 LAN IP 與 iPhone 同網段。錯誤訊息：`No script URL provided. Make sure the packager is running or you have embedded a JS bundle.`
5. **「271 issues / 1644 warnings」是 noise**：build log issue navigator 顯示一大堆 `Pointer is missing a nullability type specifier` warning、全部從 Expo / RN deps 來、非 blocking。Build Succeeded = 真的成功。Issue counter 別嚇到。

#### Kingstinct API 對 `requestAuthorization` 的語意

與原 RN-Health callback 不同、Kingstinct 是 Promise-based + 回 `boolean`：

```ts
await requestAuthorization({
  toRead: ['HKQuantityTypeIdentifierHeartRate', 'HKQuantityTypeIdentifierActiveEnergyBurned'],
  toShare: ['HKWorkoutTypeIdentifier'],
}); // → Promise<boolean>
```

回 `true` = user grant 了至少一個 scope。
回 `false` = user 不允許全部 / 直接 dismiss、但 **OS dialog 仍已 show 過**、iOS 不會再彈。
Reject = native module error（entitlement 配錯、HK 不可用、Sim host 不支援等）。

`permission.ts` 處理：true / false 都 → flip 本地 flag 為 `'requested'`（dialog 已 show 過、UI 該翻成「已連結」狀態、user 再要改去系統設定）。Reject → flag 不動、Alert.alert 顯錯訊。

#### Phase B 後續 slice（13c-d 規劃 placeholder）

- **slice 13c**: iPhone HK data reader — HR samples + activeEnergyBurned query layer、HR chart 真資料、4-tile kcal 真值。Q8 iPhone 補寫 HKWorkout writer 也在這 slice（session finish flow gate on `healthkit_workout_uuid IS NULL`）。
- **slice 13d**: SwiftUI Watch app target + WatchConnectivity bridge + `HKWorkoutSession` lifecycle。Watch tracked toggle 在這 slice 第一個 commit 移除（真 Watch session 自然 trigger 5-tile-watch variant）。

#### Slice 13b 落地紀律

- Branch `slice/13b-phase-b-foundation` 從 main 開（10c + 13a 已 merge）
- 4-commit chain：B1 prebuild + entitlement → B2 adapter + state machine → B3 Settings UI + delete HK toggle → B4 docs amendment
- 每 commit 須過 pre-commit hook（tsc + jest）
- 預期工期 1 週（含 ADP portal 註冊 App ID + HK capability 手動操作 + 真機 build smoke）
- ADR-0008 § HealthKit 整合 amendment（iPhone 補寫 HKWorkout 政策落地）留給 slice 13c-d，因為 13b 不寫 HKWorkout、只 request 權限

## Q9 — Session lifecycle（全套）

### (a) Start UX

> **2026-05-24 Round E 取代**：Templates tab entity 砍除（[ADR-0024](./0024-training-tab-three-sections-and-templates-tab-removal.md)）。Bottom sheet 本身保留、流程不動、只是 invocation 從 Templates tab 改到「訓練」tab 的「模板訓練」區塊。Sticky scope 維持 global（不翻盤）。

**Templates tab → tap Template name → bottom sheet（週期 + 強度 picker）→ [編輯模板] / [開始訓練]**

> ⚠️ **2026-05-24 Round E 修訂 (見 line 428)**：Templates tab entity 已撤，invocation 改到「訓練」tab 的「模板訓練」section（ADR-0024）。下方 ASCII 仍代表 list layout，但 owner 為 ADR-0024 而非 Templates tab；tap Template name → bottom sheet flow 完全保留不動。

- 預設值 = sticky last-selected（per Q9.2 N1；首次 fallback「無」FB1）

#### Templates tab 簡潔版 layout (Round E 後改隸屬「訓練」tab > 模板訓練 section)

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
- `[⋯]` menu 內項目（v1）：「放棄訓練」（其他次級操作如分享 / 匯出延後 — slice 後續再加，不卡 v1 ship）（**slice 10c 修訂**：menu 實際加了「Body data」shortcut 作為快速體重輸入入口，目前 `['取消', 'Body data', '🚫 放棄訓練']` (see `app/(tabs)/index.tsx:1781`)。Agent A drift audit L1 標 accepted — menu 容納次級操作的設計初衷允許此擴充）
- 「放棄訓練」→ confirm dialog「確定放棄？已記錄的 set 將全部刪除，無法復原」→ DELETE `session` + CASCADE (`session_exercise` + `set`) → 回 Today
- **跟刪除歷史 session 邏輯相同**（per ADR-0014 § 「刪除本訓練」按鈕 3）— 都是 hard delete + dialog + PR/統計 reactive 重算；session 進行中 vs 已完成的差別只是「PR 還沒 commit」這點

### (d) Finish 路徑差異化（翻盤 ADR-0014 Freestyle finish behavior）

> **❌ 2026-05-18 wave 12 整題翻盤** — finish 不彈 dialog；模板入口移至詳情頁 sticky 4-button bar (`app/session/[id].tsx:2010-2057`)，「儲存模板」silent overwrite。
>
> **❌ 2026-05-25 G4 grill 紮定** — wave 12 是最終解，不會回收 diff-aware finish 路徑。本表 + Diff scope (Sticky 3) 子段全 retracted；對應 orphan code (`src/domain/session/computeSessionDiff.ts` 212 LOC + `sessionRepository.ts:631 computeSessionDiff` adapter ~150 LOC + `tests/domain/computeSessionDiff.test.ts` 25 cases) 同 grill 一併砍除。未來若決定回收 diff-aware UI，直接 git revert 即可。
>
> **下方表格保留作歷史記錄。** Current truth = `app/(tabs)/index.tsx:1858 finalizeEndAndRoute` 直接 `endSession + router.push('/session/${id}')`。

❌ ~~| Session 來源 | Finish 行為 |~~
~~|---|---|~~
~~| **Template-based**（`template_id NOT NULL`）| 偵測 diff vs snapshot：**無 diff** → 直接 finish 無 dialog；**有 diff** → 跳 **3-option dialog**：(a) 儲存（覆寫 template，per ADR-0014「儲存模板」既有 flow + sibling rename 連動）/ (b) 另存（新建 Template entity，per ADR-0014「另存模板」）/ (c) 否（本場保留實際數據、template 目標不動）|~~
~~| **Freestyle**（`template_id IS NULL`）| 永遠跳 **2-option dialog**：(a) 儲存 = 新建 Template entity（同既有 ADR-0014「另存模板」flow，per 已知 known issues #4 確認）/ (b) 否（session 留為 freestyle，跟既有 ADR-0014「freestyle session.template_id 留 NULL」一致）|~~

❌ ~~**翻盤點**：ADR-0014 既拍「Session 結束 → Save-back dialog **不會觸發**…」（line 106）。本 ADR 把 Freestyle finish 改為走 2-option dialog…~~

### Diff scope（Sticky 3）❌ 2026-05-25 G4 grill 整段 retracted

> 同上 § (d)：wave 12 silent overwrite 落地後，diff 欄位範圍 spec 失去 caller；G4 grill 拍板 wave 12 是最終解 → 本表整段 moot。下方表格保留作歷史記錄。

❌ ~~定義「diff vs snapshot」的具體欄位範圍 — Save-back 範圍擴展到任何 in-session 修改 vs snapshot，**不**僅限既有 ADR-0002 Save-back dialog 的「sets/reps/weight」三項。~~

~~| 欄位 | 算 diff |~~
~~|---|---|~~
~~| set count（新增 / 刪 set）| ✅ |~~
~~| reps / weight / is_logged | ✅ |~~
~~| set_kind（warmup / working / dropset）| ✅ |~~
~~| set_position（reorder）| ✅ |~~
~~| 加動作 / 刪動作 | ✅ |~~
~~| 換動作（🔄）| ✅ |~~
~~| Cluster 加入 / 刪 cluster | ✅ |~~
~~| `rest_sec`（本 ADR Q2 新增）| ✅ |~~
~~| `exercise.notes`（全局，per ADR-0017 Q5 全局單層）| ❌ — 不算 diff…~~
~~| `session.title`（身份維度，per ADR-0014）| ❌ — 不算 diff…~~

~~「💾 儲存」option 寫回時 propagate scope 沿用 ADR-0014 Q7.3-A…~~

## Q10 — 歷史詳情頁 layout integration（HU1 + HV1 + HE1）

> **2026-05-25 Slice 13 Phase A 拍板**：終版 layout 4-tile + HR chart 已於 Phase A 落地為**有結構但無資料**的 scaffold — kcal tile 顯「—」、HR chart canvas 有 axes / grid / zone bands 但中央 grey overlay + 「需 Apple Watch 同步心率資料」hint。Phase B HealthKit 接 up 後同一 component 就能把 "—" / overlay 換成真資料、無 layout 重構 — 詳見 § Slice 13 Phase A Amendment。

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

- ~~Save-back dialog 範圍擴展（covers 任何 in-session 修改 vs snapshot — 見本 ADR Q9 diff scope 表）~~ ❌ **G4 retracted (2026-05-25)** — G4 wave 12 silent overwrite 為終局，Save-back scope 擴展失效。
- ~~Finish path differentiation：Template diff-aware 3-option + Freestyle 2-option（翻盤「Freestyle Save-back 不會觸發」）~~ ❌ **G4 retracted (2026-05-25)** — 同上，3-option / 2-option 路徑收回，finish = silent overwrite。
- 歷史頁 layout 砍 3 段統一動作清單（本 ADR Q10 HU1 拍板）  ✅ 仍適用

Inline 修訂 marker + 文件最末加新 amendment section（詳細指引見本 ADR § 翻盤的既有拍板段）。

## Schema 影響總覽

> 重要：migration 編號全用 `v01X` placeholder — 留待後續 slice grill 決定具體版本（不該在 ADR 內定死）。

| 變更 | 表 | 用途 | 預設值 |
|---|---|---|---|
| 新增欄位 | `template_exercise.rest_sec INTEGER NULL` | per-Exercise 休息秒數模板值 | NULL = inherit 系統 hardcoded 60s |
| 新增欄位 | `session_exercise.rest_sec INTEGER NULL` | per-Exercise 本場休息秒數（snapshot 自 template）| NULL = inherit 系統 hardcoded 60s |
| 新增 key | `app_settings.auto_popup_rest_timer BOOLEAN` | Auto-popup 開關 | DEFAULT 1 |
| 新增 seed | `program` 表 seed「無 Program」entity | Q9.2 N1 — 避免 NULL 特殊邏輯 | name = "無 Program" 或 "無"，slice ship 時定 |
| 既有提及 | `session.title TEXT NOT NULL DEFAULT ''` | per ADR-0014 v023 (5/24 ship — `src/db/schema/v023_session_title.ts`) | - |
| v015 | `set.set_kind` / `set.parent_set_id` / `set.is_logged` | slice 10a foundation — set kind enum (warmup/working/dropset) + dropset chain parent ref + ✓ flag for "completed set"；index + backfill | DEFAULT 'working' / NULL / 0 |
| v016 | `template_exercise.rest_sec` / `session_exercise.rest_sec` / `session.{healthkit_workout_uuid,avg_hr_bpm,kcal}` / `app_settings.auto_popup_rest_timer` seed | slice 10a Q3 + Q5 落地（rest timer 雙欄 + Watch handoff fields + Auto-popup default 1）。**註**：`template_exercise.rest_sec` 後 v021 DROP（見下方 row）；`session.avg_hr_bpm` 後 slice 13c/13d 改 HR live-fetch（無 writer，reader `app/session/[id].tsx:2351` 永遠回 null）→ stale column，未來 schema sweep 待 grill 是否 DROP。 | NULL / NULL / 1 |
| v017 | `program` 「無」 seed（nil-UUID `00000000-0000-0000-0000-000000000000` row name='無'） | slice 10a Q9.2 N1 — sentinel row 避免 NULL 特殊邏輯 | n/a (seed) |
| v018 | `set.notes TEXT NULL` | slice 10c Phase 2 right-swipe per-set notes 持久化（ADR-0013 衍生）| NULL |
| v019 | `set.session_exercise_id TEXT NULL` | set 隔離（同 session 內多個 reusable cluster 共用同 exercise 不互染）；index + backfill ORDER BY ordering ASC | NULL = legacy fallback（cross-session aggregate query 不動）|
| v020 | `template.color_hex` backfill | overnight #56 wave 56 ship；CalendarGrid 12 色 palette；既有 templates 按 name hash 從 palette 取色 | TEXT NOT NULL DEFAULT '' |
| v021 | `template_exercise.rest_sec` DROP | wave 13c orphan column 清除（per-Exercise rest_sec 已不掛 template_exercise；只剩 session_exercise.rest_sec）| n/a (drop) |
| v022 | `program_sub_tag` (program_id, sub_tag, created_at) | 持久化字典；backfill from `template.sub_tag` + `program_cell.sub_tag`；CASCADE on program delete；三 SQL write path 統一呼叫 `recordProgramSubTag` (INSERT OR IGNORE)；wave 18g 加第 4 條 `overwriteProgram` bulk re-INSERT — **詳見 ADR-0021** | n/a |
| v023 | `session.title TEXT NOT NULL DEFAULT ''` | per ADR-0014 — session 標題持久化；schema 表 row（line 630「既有提及」進化版） | DEFAULT '' |
| v024 | `session.is_watch_tracked INTEGER NOT NULL DEFAULT 0` | slice 13d D1（commit `4acfcce`、`aeff5bd`）— 5-tile predicate 改由本欄位驅動（取代 Phase A `dev_simulate_watch_tracked` setting key）；舊 row 自然 0、無 backfill | DEFAULT 0 |

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

> ⚠️ **2026-05-25 G4 grill 整段 retract**：前 2 條 Save-back 擴展 + Freestyle 2-option 路徑全部撤回，finish = silent overwrite（G4 wave 12 終局）。本段保留為歷史記錄、實際生效以 G4 amendment 為準。

- ~~❌ ADR-0014 § Save-back 共存 表 line 92-93「Save-back dialog | session 結束 summary | 內容差異（sets/reps/weight ≠ snapshot 目標）」**範圍擴展** — Save-back 範圍涵蓋任何 in-session 修改 vs snapshot（per Q9 diff scope 表），不再只看 sets/reps/weight 三項~~ ❌ G4 retracted (2026-05-25)
- ~~❌ ADR-0014 § Freestyle 升級流程 line 106「Session 結束 → Save-back dialog **不會觸發**（無 template_id 無 snapshot 目標可比）」retract — **Freestyle session 結束改為跳 2-option dialog（儲存 / 否）**，「儲存」走 ADR-0014「另存模板」same flow（per 已知 known issues #4）~~ ❌ G4 retracted (2026-05-25)
- ADR-0014 § 歷史詳情頁 4-button + 4-tile + 心率 chart 維持不動（per ADR-0014 § 2026-05-12 Amendment）  ✅ 仍適用
- ADR-0014 既有歷史頁 3 段 collapsed 結構 amend 為 HU1 統一動作清單 + HV1 全展開 default + HE1 整頁進編輯模式（per 本 ADR Q10）  ✅ 仍適用

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

## Silent deviations ledger（後驗拍板）

Code 已 ship、行為已穩定、但在落地當時未經顯式 Q-row grill 的設計選擇。本 section 後驗 sanction 並 grep-friendly 記錄 — 每條的 rationale 是「碼/comment 已寫、ADR 補錄」、不是「現在才決定」。Add newest first. Greppable 為 `silent deviation`、`後驗`、`後驗拍板`。

| 項目 | 現行行為 | rationale | 範圍 / 邊界 | 觸發 commit | 後驗 sanction |
|---|---|---|---|---|---|
| **NumericKeypad**（自製 4×3 modal 取代 system keyboard 編 set 數字） | Tap session set row 的 reps / weight → 開 slide-up modal、4×3 grid (1-9 + optional `.` + 0 + ⌫)；mode = `integer` 隱藏 `.`、`decimal` 顯示；Confirm 透過 `parseKeypadBuffer` 寫回；UI 亦 reuse 在 ⚙️ menu「⏱️ 休息秒數」入口 | iOS system keyboard 會頂卡上去、user 看不到正在編輯的 row / 不到剛輸入的值；4×3 大按鈕 grid 適合運動中粗指尖；inline TextInput 嘗試失敗（slice 10c Phase 2 commit 4 留 comment）。NumericKeypad 是「set logger 可實作的最快編輯路徑」 | Session 端所有數字 input（reps / weight / rest_sec）；Template editor 暫**不**採用（slice 10c Phase 2 commit 4 故意 scope out — 未來可推但無 schema 障礙） | Slice 10c Phase 2 commit 4 落地 + Phase 2 commit 5+「swap into SetRowContent」；後續 wave 14 reuse 進 cluster card 編 rest_sec | **Sanction as-is**（2026-05-27）— code comment ([components/shared/numeric-keypad.tsx:1-19](components/shared/numeric-keypad.tsx)) 把 rationale 寫齊備、行為 31 tests 穩定；ADR-0019 line 877 / 884 / 898 散見 implementation log 但無顯式 Q row，由本 ledger 補錄。Code 內錯誤 reference 「ADR-0019 Q6」（Q6 實為 stats panel）改 link 本 ledger 條為 SoT。 |
| **手動計時 button**（Today bottom-sticky bar 的「⏱ 手動計時」） | Today 訓練 tab 底部 sticky bar 放 button、tap → open `RestTimerModal` default 60s、**無 set anchor** (`exercise_name = t('button', 'manualRest')`)；user 可隨時 cancel；走跟 Q2.3 auto-popup 完全同一個 modal 與 state machine | Q2.3 rest timer auto-popup 只在 set ✓ 後 fire；user 場景含「exercise 間休息（同一動作 set 之間 ✓ 漏 tap 也算）」、「動態熱身 / 暖身組外」、「cluster 外短暫休息」等 — 全部超出 auto-popup 範圍；reuse 既有 modal/state machine、沒有獨立 timer 邏輯複雜化 | **僅 Today** (`app/(tabs)/index.tsx:2530`)；session detail edit mode (`session/[id].tsx`) **不**加（已結束 session 加 timer 無意義）；history-detail edit 不接（per slice 10d Q2.3 E2「`session/[id].tsx` edit mode 不接 timer」） | 2026-05-12 grill recommendation（mid-slice-10c）+ 2026-05-16 ultra-late pull-forward from slice 10d；commit hash 在 slice 10c 中段、未追記具體 sha | **Sanction as-is**（2026-05-27）— Today-only 範圍清晰、code comment ([app/(tabs)/index.tsx:2529-2545](app/(tabs)/index.tsx)) 註明 rationale + pull-forward 出處；ADR-0019 Q2 整套 rest timer 章節未包含此入口、由本 ledger 補錄。未來若要在 `session/[id].tsx` edit mode 加 manual timer 需先翻盤本條的「範圍 / 邊界」部分。 |

## 翻盤 ledger（greppable）

Per `grill-with-docs` skill closing ritual + `phase-precheck` skill sub-agent's primary grep target. Add at top, newest first. Each row machine-greppable for `修訂 / 翻盤 / 砍除 / 廢案`.

| 日期 | 翻盤項 | 原拍板 | 新拍板 | 觸發 | 關聯 commit |
|---|---|---|---|---|---|
| 2026-05-27 20:00 | D0 spike A 真機 land — Q28 Branch C trigger-only HK 確認 + 發現 spike B 不能被 spike A 覆蓋 | (Q28 原拍板) Branch C trigger-only：Watch `HKWorkoutSession.startActivity()` 開 HR sampling、end 時 `HKLiveWorkoutBuilder.discardWorkout()` **不**寫 HKWorkout entry；iPhone 13c writer 為唯一 HKWorkout entry。D0 spike A 驗 watchOS 11+ 行為；spike A 失敗 → 退 Branch A (Watch 寫 HKWorkout、dual-write race 需另解) | **Branch C confirmed** — 真機 spike (Apple Watch Ultra watchOS 11.6.2) 9 phases 56.3s 全 PASS：`discardWorkout()` 不寫 HKWorkout entry (0 entries queried in `[start, end+10s]`)、HR samples persist in HK store post-discard (3 samples in `[start, end]`、其中 1 個是 settle 期間 async 寫入)；iPhone Health app 獨立 cross-check 體能訓練 tab 今天無新「傳統重量訓練」entry + 心率 tab 19:51-19:53 有 87-92 bpm sample 點 — 證明 spike harness 的 HK query 不是 false negative。HK 分工模型 (Watch trigger-only sampling + iPhone 13c writer 為唯一 HKWorkout writer) 可 land 進 D5 SessionController.swift；Branch A dual-write race fallback 確認不寫。**+ 意外發現 for spike B**：`store.requestAuthorization()` 從 Watch process 呼叫時，HK auth dialog **出現在 Watch 上、不是 iPhone**；spike A 因此走 Watch-side auth 路徑、**沒**驗到 Q22 paired-share（iPhone 先 grant → Watch 不主動 request 也能讀）；spike B 須單獨跑、不能 piggyback spike A | User 排出空檔跑 spike A（D4 Watch target 1 hour 前已 land 後立刻續攻）；首次 build 失敗 4 errors 都 `SpikeAHarness.swift` 漏 `import Combine`（`ObservableObject` + `@Published` 都來自 Combine 而非 Foundation）；加 import 後一次過。實機 connectivity 走了「iPhone USB-C tethered to Mac + Mac WiFi 回家用 router」配置（spike C 時的 iPhone 熱點配置會讓 Xcode Watch dev tunnel `Timed out while attempting to establish tunnel using negotiated network parameters`、紀錄進 expo-bare-build-pipeline skill gotcha #9）| D0 partial spike A = (本 commit)；spike harness code 留 branch `slice/13d-d0-spike-a` @ `be3c179`（含 Combine import fix；不 cherry-pick、不刪除、等 D5 SessionController.swift 落地時參考或回收 HK setup pattern）；spike B 仍 pending（要 iPhone-side grant HK auth + Watch app launch 確認不彈 dialog 流程） |
| 2026-05-27 14:30 | D0 spike C 真機 land — Q5 Branch B 確定不退 Branch A | (Q5 原拍板) Branch B `react-native-watch-connectivity@2.0.0` + 2-hour validation gate (D0 spike C)；spike C 失敗 → fallback Branch A (Swift Nitro module ~150 LOC) | **Branch B confirmed** — 真機 spike (iPhone 14 Pro + Apple Watch Ultra) 6 phases 44ms 全 PASS：TurboModule 在 Expo SDK 54 + New Arch 下 load clean、subscription handle 正常、sendMessage errCb fired 12ms with WCErrorDomain code 7006 (`WCErrorCodeWatchAppNotInstalled`) 證明 native bridge 真的 process 我們的請求；Q5 拍板 cell 改為 confirmed、NEW-Q47 row 標 spike C 已 land；Branch A Swift Nitro fallback ~150 LOC 確認不寫；D3 `connectivity.ts` foundation 鎖定 | User 排出空檔跑 spike C；過程中 iPhone 鏡像→熱點切換造成 Metro 連線斷產生 `TurboModuleManager: Timed out waiting for modules to be invalidated` 紅屏假警報，事後確認是 dev infra noise（Metro 沒在跑、JS bundle 拿不到）、不是 lib 問題；冷啟動 + Metro 起來後 spike harness 跑出 PASS 44ms | D0 partial spike C = (本 commit)；spike harness code 留 branch `slice/13d-d0-spike-c` @ `e81c0f5`（不 cherry-pick、不刪除、保留供 D3 connectivity.ts 動工時參考或回收 mock 設定）；spike A/B 仍 pending、卡 D4 Watch target |
| 2026-05-27 evening | D-chain 推進策略：純 TS commit 可亂序提前 ship | （2026-05-26 28-commit chain 落地段）forward 接 D4 → D5 → ... 順序進行；隱含每條 D-commit 都要前置依賴先 land | **純 TS / 純 logic / 無 native dep 的 D-commit 可亂序提前 ship**；UI wire-in 留待 connectivity.ts 落地時補。當天全部落地 5 條 pure-logic / partial commits（D20 LWW / D19 live mirror / D7 partial reconciliation reducer / D9 partial handshake builders / D24 partial sync readout formatter），跨越 D6-D18 / D22-D27 多條未 land 的 native bridge / Watch UI / wire-in commit；額外加 D26 partial ADR doc sweep 三次（base + 二次補刀 + 三次補刀）+ 兩次把模式萃成 / 擴充 `ship-partial-pure-logic` project skill；**slice 13d 純 TS backlog 至此清空**、剩餘全 gated on D0 spike 或 Xcode 實機操作 | 用戶當天 6 backlog 候選都做完後接著做純 TS 工作；D0 spike 需實機 (user 排時段)、D4 Watch Xcode target 卡 D0、D6 / D7 wire-in / D9 wire-in 卡 connectivity.ts 卡 D0；不卡的純 TS commit 留著「等順序」是浪費 | D20 = `2e3b13d`、D19 = `791a0ed`、D26 partial = `54b8f9d`、D7 partial = `9a29ef6`、skill = `faf09f5`、D9 partial = `c350b5c`、D26 二次補刀 = `02f8625`、skill v2 = `3cba27b`、D24 partial = `355bf00`；本 commit = D26 docs(adr) 三次補刀 |
| 2026-05-27 | Slice 13d D-chain 5-commit → 28-commit 擴張時 D5 變號（predicate switch D5 → D21） | （Slice 13c amendment 5-commit chain）D5 = 5-tile predicate switch；該 chain 在 wave-2 brief agent B2（task #125）時即為唯一 chain source-of-truth、agent commit message 用 `slice-13d/D5` tag | （2026-05-26 28-commit chain，本 ADR § 28-commit chain）D5 = Watch HK lifecycle (SessionController + discardWorkout pattern)；5-tile predicate switch 移到 D21；D4 (Xcode Watch target scaffold + entitlements) 為新插入 slot、未 land；shipped commit `7b07f9b` 在 28-commit chain 視野裡實際對應 D21（commit message tag 不再追改，git history 不動）| 28-commit chain 是 2026-05-26 wave 3 grill expansion 的產物（Q1-Q28 + NEW-Q29-Q47），expansion 時 wave-2 D5 commit 已 ship 到 main；renumber 沒回頭重 tag commit、ADR 也沒同步加說明，造成 main `slice-13d/D5` label 跟新 chain D5 條目語意脫鉤；wave 4 Agent E micro-PRD（[/tmp/overnight-reports-2026-05-27/31-overnight-E-d6d7-microprd.md](/tmp/overnight-reports-2026-05-27/31-overnight-E-d6d7-microprd.md) line 3）指出「D5 last landed (`7b07f9b`)；D4 NOT landed」是這個錯位的觀察 | shipped tagged `slice-13d/D5`：`7b07f9b`、`6f00709`、`09f1e75`（皆對應現 chain D21）；未來 brief agent 一律以 28-commit chain 為準、不再用 shipped tag 反推 |
| 2026-05-26 | Slice 13d α-model 擴張 — 9 條既有拍板翻盤（ADR-0008 6 條 + Slice 13c 2 條 + Slice 10e bundle 3 ADR-0008 amendment 1 條） | (ADR-0008 line 3) 全程 Watch 主、iPhone 不掏；(line 24) bw_snapshot pre-session 鎖；(line 76-79) Watch 寫 HKWorkout、HKWorkoutSession Watch-only；(line 87-88) Watch 寫 metadata duration/卡路里/平均+max HR；(17 條 row 10) HKWorkoutSession.pause()；(Slice 10e bundle 3 line 58-72) FEATURE_WATCH_HANDOFF gate；(13c line 1088-1089) Watch 寫 HK active energy / 5-tile predicate；(13c line 1090) Watch picker 留尾未拍 | 雙向 initiator（兩端 [開始訓練] 入口、SQLite SoT 在 iPhone、另一端 WC live mirror）+ bw_snapshot session-start moment 鎖 + HK trigger-only sampling（Watch `HKLiveWorkoutBuilder.discardWorkout()` 不寫 entry、iPhone 13c writer 為唯一 HKWorkout 寫入點）+ 移除 Watch metadata 寫入 + pause defer to v1.5+ + FEATURE_WATCH_HANDOFF flag 退役（D2 commit 砍按鈕 + features.ts const + tests）+ 5-tile predicate switch 到 `session.is_watch_tracked` v024 column + Watch picker root 三步 UI ratified | User 2026-05-26 grill — narrow scope B2/B3 fix 擴張為完整 α-model slice；Q1-Q28 + NEW-Q29-Q47 共 47 拍板；28-commit chain (D0-D27) + 16-case smoke matrix + 13-message-kind WC mapping | 見 § 2026-05-26 Slice 13d Amendment（commit D0..D27、未 land）；本 commit = D26 docs(adr) |
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

### 2026-05-26 Slice 13c Amendment — HK reader + writer + 歷史頁 wire

**主軸**：slice 13c 是 Phase B 的「功能完成 slice」——iPhone 端把 13b 拉好的 HK 權限基礎變成真資料：(1) `HealthKitReader` 從 HK 撈 HR samples + activeEnergyBurned aggregate、(2) `HealthKitWriter` 於 session finish 時補寫一筆 `HKWorkoutType` 進 Fitness app、(3) 歷史詳情頁 HR chart + kcal tile 由 Phase A 的 placeholder / overlay 翻成真資料渲染。**In-session live HR / kcal、SwiftUI Watch app、`HKWorkoutSession` lifecycle 全部 deferred to slice 13d**——13c 只動 iPhone 端、不碰 native target / WatchConnectivity。本 slice ship 後 Fitness app 的「體能訓練」tab 會 100% 覆蓋 13b 之後完成的所有 session（13b 之前的舊 session 永遠 `kcal=NULL` / `healthkit_workout_uuid=NULL`、不補）。ADR-0008 § HealthKit 整合「Watch 寫 HKWorkout」原 v1 設計不動、13c 是 iPhone 補寫補集（per slice 13b Q8 已拍）。

#### slice 13c 拍板 grill Q1-Q12（2026-05-26 ratified by user）

| Q | Topic | Decision |
|---|-------|----------|
| Q1 | Scope | 4-pack：HR reader + kcal reader + HKWorkout writer + 歷史頁 wire |
| Q2 | HR fetch 策略 | **Live fetch each detail page open**（不 cache、HK = source of truth；user 重進詳情頁就重 query、避免 stale）|
| Q3 | Time range | `session.start_at → session.end_at`（active session 不適用本 slice、active live HR 留 13d）|
| Q4 | In-session live HR/kcal | **Deferred to slice 13d**（需配 SwiftUI Watch app + WatchConnectivity + `HKWorkoutSession` 才有意義）|
| Q5 | kcal storage | Persist to `session.kcal` column on finish（finish 時一次性 query active energy aggregate + 寫 column、之後詳情頁不再重 query）|
| Q6 | HKWorkout 寫入欄位 | `activityType=traditionalStrengthTraining`（Fitness app「傳統肌力訓練」filter；**2026-05-26 fix commit `e5732ac`**：原本拍 `functionalStrengthTraining`，後改 traditional 因「重量訓練」語意更貼近 — `traditional` = barbell / dumbbell weight lifting，`functional` = HIIT / circuit training）+ `totalEnergyBurned={quantity: session.kcal, unit: 'kcal'}` + `metadata={ HKMetadataKeyWorkoutBrandName: session.title, HKMetadataKeyExternalUUID: session.id }` |
| Q6.5 | 「總大卡 ≠ 動態大卡」差異化 | 依 Apple HK 個人資料（生日 / 性別 / 身高 / 體重）自動算 basal samples；TrainingLog **不額外寫 `basalEnergyBurned`**。User 未填 HK 個人資料時兩值相等（如使用者本人 = 訓記場景）|
| Q7 | Writer 時機 | finish button 內 synchronous `await`——寫完 HKWorkout 才 `router.push` 詳情頁（fail-stop UX、避免 user 進詳情頁時 uuid 還沒落）|
| Q8 | 寫失敗 / 無權限處理 | **Best-effort 三層**：(1) `session` DB row 一定先存；(2) HK write 失敗 → silent skip（`uuid=NULL` / `kcal=NULL`）；(3) UI 不彈 alert。Recovery 路徑 = user 重 finish 別場 session 或去 Settings 翻 HK toggle、不在 13c 處理 retry |
| Q9 | HR chart wire | 詳情頁 `useEffect` mount → `queryHeartRateSamples(start, end)` → setState → `<HRZoneChart samples={data} />`。Phase A 既有的 zone bands / axes / grid 不動、只把中央 grey overlay 換成真 polyline |
| Q10 | Commit chain | **5 commits**（C1 reader / C2 writer / C3 finish wire / C4 detail page wire / C5 ADR amendment）|
| Q11 | Backfill 既有 session | **不補**：13b 之前 finish 的 session 永遠 `kcal=NULL` / `healthkit_workout_uuid=NULL`、歷史頁顯「—」kcal + HR chart grey overlay（既有 Phase A 行為原樣 fallthrough）|
| Q12 | 真機 smoke matrix | 8 項（見下）|

#### slice 13c 5-commit chain

| # | Commit title | 摘要 |
|---|--------|------|
| C1 | `feat(slice-13c): HealthKit reader (HR samples + active energy aggregate)` | `src/adapters/healthkit/reader.ts` 新增 + `index.ts` re-export + `tests/adapters/healthkit/reader.test.ts`（mock Kingstinct API）|
| C2 | `feat(slice-13c): HealthKit workout writer` | `src/adapters/healthkit/writer.ts` 新增（`saveWorkout` wrapper、metadata 組裝）+ `index.ts` re-export + `tests/adapters/healthkit/writer.test.ts` |
| C3 | `feat(slice-13c): wire session finish flow → kcal persist + HKWorkout write` | `app/(tabs)/index.tsx` `finalizeEndAndRoute` 改：先 `endSession` → query activeEnergy aggregate → `sessionRepository.setKcal(sessionId, kcal)` → `writer.saveWorkout(...)` → `sessionRepository.setHealthKitWorkoutUuid(sessionId, uuid)` → `router.push`。`src/adapters/sqlite/sessionRepository.ts` 加 `setKcal` / `setHealthKitWorkoutUuid` setter（兩個 idempotent UPDATE）|
| C4 | `feat(slice-13c): detail page HR chart real data + kcal column read` | `app/session/[id].tsx` mount `useEffect` query HR samples + read `session.kcal` column → 4-tile kcal tile 真值 + `<HRZoneChart samples={data} />` 真 polyline；`uuid IS NULL` / 無 sample 走既有 Phase A fallback（「—」+ grey overlay）|
| C5 | `docs(adr-0019): Slice 13c amendment` | 本 amendment（含 grill table + commit chain + smoke matrix + 13d preview）|

#### 8 項真機 smoke matrix

| # | 描述 | Pass 條件 |
|---|------|-----------|
| S1 | 開新 session → 完成幾組 → finish → 進詳情頁 | 4-tile kcal tile 顯示真值（不是「—」）、<5 秒內出現 |
| S2 | 同 S1、進詳情頁 | HR chart 顯示真 sample polyline（zone bands / axes / grid 維持 Phase A layout 不變）|
| S3 | 開 Apple Fitness app → 體能訓練 tab | 新增一筆 workout、顯示 `session.title`（例：「腿 (蹲)」）+ duration + kcal |
| S4 | 同一 session 詳情頁進去 → 退出 → 再進去 | HKWorkout 不重複寫（`session.healthkit_workout_uuid IS NOT NULL` guard 生效）|
| S5 | Settings 把 HK 權限拒絕 / 移除 → 開新 session → finish | session DB row 仍存、詳情頁 kcal 顯「—」、HR chart grey overlay、無 alert（per Q8 best-effort）|
| S6 | 不戴 Apple Watch（HK 無 HR samples）→ 開 session → finish | 詳情頁 HR chart grey overlay（既有 Phase A 行為 fallthrough）、kcal tile 顯「—」（無 active energy aggregate）|
| S7 | 開 13b 之前的舊 session（uuid=NULL、kcal=NULL）詳情頁 | kcal tile「—」+ HR chart grey overlay（per Q11 不 backfill）|
| S8 | finish 後重裝 app → 重開詳情頁 | uuid persist（從 DB column 讀）、Fitness app workout 不被重寫 |

#### Test count delta（estimate）

1574 → **~1585-90**（reader test +6 / writer test +5 / 邊界 case +N）。具體數字依實作拍板、commit message 內填真值；超出 estimate ±5 不視為 spec drift。

#### Slice 13d preview（Phase B 收尾）

13c ship 後進入 Phase B 收尾 slice 13d：

- ✅ **landed @ D4 `9b380d1`** — **SwiftUI Watch app 新 Xcode target**（bundleId `com.lisonchang.TrainingLog.watchkitapp`、native target、不走 RN-for-watchOS per ADR-0008）
- ✅ **landed @ D3 `c29f1fd` + D6 `10f94b4`** — **WatchConnectivity bridge**（iPhone ↔ Watch state sync、protocol 選型 grill 13d 拍）
- ✅ **landed @ D5 `150a3d8`** — **`HKWorkoutSession` lifecycle on Watch**（start / pause / end）→ Watch 寫 active energy + HR 進 HK、iPhone 自動拿到（per ADR-0008 § HealthKit「HKWorkoutSession 啟動點 = Watch 端」）（**Slice 13d 修訂**：HKWorkoutSession 改為 trigger-only sampling、`discardWorkout()` 不寫 HKWorkout entry；iPhone 13c writer 為唯一 HKWorkout 寫入點。HR / activeEnergyBurned sample 仍進 HK store、iPhone reader 照撈。見 § 2026-05-26 Slice 13d Amendment Q28 Branch C）
- ⏳ **pending D17 / D18** — **In-session live HR / kcal**（5-tile Watch variant 真資料、不再是 Phase A `dev_simulate_watch_tracked` toggle 模擬）（**Slice 13d 修訂**：5-tile predicate 改為 `session.is_watch_tracked` v024 column；live HR / kcal Watch 端從 `HKWorkoutSession.activeWorkoutHeartRate` 觀察、3-5s applicationContext throttled 推 iPhone live mirror。見 § 2026-05-26 Slice 13d Amendment Q14 + Q24）
- ⏳ **pending D8** — **Watch picker UI**（user requirement 2026-05-25：可以從 Watch 開啟「計劃訓練 / 模板訓練」、不必先掏 iPhone）
- ✅ **landed @ D2 `6aa2bd8`** — **Phase A `dev_simulate_watch_tracked` setting key + Settings toggle 第一個 commit 移除**（per slice 13b § Phase A → Phase B 轉換點規約、13b 暫留作 regression guard、13d 真 Watch session 自然 trigger 5-tile-watch variant 後即可砍）（**Slice 13d 修訂**：predicate switch 改由 `is_watch_tracked` v024 column 承擔、非「session 自然 trigger」；D2 commit fail-stop 砍 dev toggle 5 處 hit + tests）

ADR-0008 § HealthKit 整合「Watch 寫 HKWorkout」與本 slice 13c「iPhone 補寫 HKWorkout」的覆蓋率分工 amendment 留給 slice 13d ship 時補（屆時 Watch session 真上線、補寫路徑只在 Watch 不可用時 fallback）。（**Slice 13d 修訂**：此分工模型推翻 — 改為「Watch HKWorkoutSession trigger-only sampling、iPhone 13c writer 為唯一 HKWorkout 寫入點」，per Slice 13d Amendment Q28 Branch C，見下節）

---

### 2026-05-26 Slice 13d Amendment — α-model 完整實作 (Watch 雙向 initiator + live mirror + Live Activity)

**主軸**：slice 13d 原規劃為 narrow B2/B3 fix（補 Watch 端 `HKWorkoutSession` trigger 解 13c 詳情頁 HR / kcal 空）。grill 過程使用者要求擴張為 **α-model full slice** — 實作 Watch SwiftUI app + WatchConnectivity bidirectional bridge + HKWorkoutSession trigger-only sampling pattern + iPhone Live Activity + 雙向 initiator + bidirectional live mirror set logger + Watch 端 picker (計劃訓練 + 模板訓練)。13c iPhone 補寫 HKWorkout 路徑保留為**唯一** HKWorkout writer；Watch 端 `HKWorkoutSession` 改為純 HR / kcal sampling trigger，end 時用 `HKLiveWorkoutBuilder.discardWorkout()` 不寫 HKWorkout entry，徹底消除 dual-write race（per Q28 Branch C）。

#### 翻盤的既有拍板（既有決定的 13d revision）

- ❌ ADR-0008 line 3「**全程 Watch 主、iPhone 不掏**」→ 改為 **雙向 initiator**：iPhone 訓練 tab + Watch picker root 兩端 UI 都有 [開始訓練] 入口、user 隨手挑、SQLite 寫在 iPhone、另一端 WC push 進 in-session view。原 α-model「iPhone 不掏」是 watch-leadership 假設、現實使用者期待雙向彈性。
- ❌ ADR-0008 line 79「**HKWorkoutSession 啟動點 = Watch 端 ... iPhone 端不寫**」→ 改為 **trigger-only sampling**：Watch 端 `HKWorkoutSession.startActivity()` 開 HR sampling、end 時 `HKLiveWorkoutBuilder.discardWorkout()` **不寫** HKWorkout entry；iPhone 13c `saveTrainingLogWorkout` 為唯一 HKWorkout 寫入點。Watch HR sample 仍進 HealthKit store（sample 與 builder 分離）、iPhone 13c reader 不在乎 source、照撈得到。
- ❌ ADR-0008 line 24「**bw_snapshot 鎖定時機 = pre-session 階段**」→ 改為 **session-start moment 鎖定**：雙向 initiator 後 iPhone 在 session start moment 一定 reachable（WC roundtrip 必經 iPhone），不需 pre-session 提前鎖。
- ❌ ADR-0008 line 87-88「**Watch 寫 HKWorkout metadata = duration / 卡路里 / 平均 HR / max HR**」→ 改為 iPhone 13c writer 為唯一 metadata 寫入點（與 § Slice 13c Amendment Q6 一致）；Watch 不寫 metadata、不寫 HKWorkout。
- ❌ Slice 13c Amendment line 1089「**In-session live HR / kcal（5-tile Watch variant 真資料、不再是 dev toggle 模擬）**」→ 改為 5-tile variant predicate = `session.is_watch_tracked`（v024 新 column）；live HR / kcal Watch 端從 `HKWorkoutSession.activeWorkoutHeartRate` 觀察、3-5s applicationContext throttled 推 iPhone live mirror。
- ❌ Slice 13c Amendment line 1090 留尾 user requirement 2026-05-25「**可以從 Watch 開啟計劃訓練 / 模板訓練**」→ ratified 為 Watch picker root 三步 UI（root [計劃訓練] + [模板訓練] dropdown → 選模板 name → 方塊選計劃 → 強度）。
- ❌ Slice 10e bundle 3 ADR-0008 amendment line 58-72「**FEATURE_WATCH_HANDOFF gate**」→ **移除按鈕、flag 退役**。α-model native handoff = WC bidirectional、原按鈕「iPhone 交接 Watch」語意過時。

不翻盤、繼續成立：
- ✅ ADR-0019 § Q9 (b) line 497「iPhone v1 維持 pre-session ↔ in-session 兩態狀態機、不引入 paused 第三態」；補：Watch 端也不引入 pause button（α-model 擴張後維持 no-pause 紀律）
- ✅ ADR-0008 路徑 C（prefetch + event queue）核心仍成立；只是 Stage 1 / 2 mapping 擴張為完整 13 message-kind 表
- ✅ ADR-0008「iPhone SQLite source of truth；Watch in-memory mirror」仍成立；Watch in-memory map session 結束清掉（不需 UserDefaults backup、handshake on launch 即可重 fetch）

#### slice 13d 拍板 grill Q1-Q28 + NEW-Q29-Q47 (47 decisions total, 2026-05-26 ratified by user)

| Q | Topic | Decision |
|---|-------|----------|
| Q1 | Xcode Watch target 加入方式 | Branch C — 手動 Xcode scaffold + `ios/` committed + 不再跑 `expo prebuild --clean` |
| Q2 | Watch app bundleId | Branch A — `com.lisonchang.TrainingLog.watchkitapp` |
| Q3 | Signing + entitlement | Branch A — 同 ADP team + Xcode automatic signing + Watch target HealthKit boolean entitlement + Background Modes "Workout processing" |
| Q4 | WC channel mapping | 完整 13 message kind mapping table（見下節）；start trigger / set events / end signal 走 sendMessage + TUI fallback；HR / kcal 走 applicationContext (3-5s 節流) |
| Q5 | WC bridge lib | **Branch B confirmed** (D0 spike C 2026-05-27 14:18 真機 PASS in 44ms — TurboModule loaded clean on Expo SDK 54 + New Arch；sendMessage errCb fired 12ms with WCErrorDomain code 7006 `WCErrorCodeWatchAppNotInstalled` 證明 bridge alive)；`react-native-watch-connectivity@2.0.0` 為 D3 `connectivity.ts` foundation。Branch A fallback (Swift Nitro module ~150 LOC) 確認不需要。|
| Q6 | WC payload 型別 | Branch A — JSON-compatible primitives + Date epoch ms + shared `src/adapters/watch/payloadSchema.ts` + Swift mirror `WCPayload.swift` |
| Q7 | sendMessage 失敗 fallback | sendMessage primary + TUI fallback + message-id dedupe |
| Q8 | HKWorkoutSession source-of-truth | **雙向 initiator**（推翻 narrow scope Branch A「iPhone primary」決定）；兩端任一可發起 session、彼此 WC push live mirror |
| Q9 | Pause | 維持 no-pause 紀律；Watch / iPhone 都不顯 pause button |
| Q10 | End race | Q28 Branch C 後 race 消失；end-session 雙向：either-side initiates → WC msg → 另一端被動同步 |
| Q11 | iPhone 無 Watch 時 | Branch A silent skip + Settings 開發者區塊「Watch 整合 last sync」debug readout (replace 退役的 dev toggle) |
| Q12 | per-session checkbox | Branch A — 不加 checkbox；user 自選哪端 initiate |
| Q13 | FEATURE_WATCH_HANDOFF | **移除按鈕、flag 退役** — α-model native handoff 取代 |
| Q14 | HR / kcal 資料 path | (c) 並行 — 13d 同時實作 (a) 即時 push (3-5s applicationContext throttle) + (b) HK auto-sync (finish 時 13c reader 仍跑) |
| Q15 | In-session live HR / kcal | **進 scope** — Watch `activeWorkoutHeartRate` observer + 3-5s applicationContext push iPhone live mirror |
| Q16 | Watch UI 範圍 | **完整 α-model UI**：picker root 三步 + in-session vertical scroll set logger + 完成頁 + NowPlaying 左滑 (OS) + ⋯ menu + ⚙ menu |
| Q17 | Watch picker UI | **進 scope** — 三步：root [計劃訓練 (一鍵)] + [模板訓練 (dropdown)] → dropdown 選 template name → 方塊選計劃 (program/週期) → 強度 (兩步分開) |
| Q18 | Background delivery / iPhone wake | α-model 期間 HR/kcal applicationContext 每 3-5s overwrite、iPhone 不需主動 wake；Live Activity 持續顯狀態 |
| Q19 | Max session 時長警告 | Defer to v1.5+（ADR known issue、revisit 條件：≥ 3 reported incidents or any single >12hr session）|
| Q20 | Testing 策略 | 全 3 path：unit + Watch simulator + 實機 smoke matrix（~28 unit case + 16 smoke case）|
| Q21 | Migration | v024_session_is_watch_tracked.ts — `session.is_watch_tracked INTEGER NOT NULL DEFAULT 0`；舊 row 自然 0、無 backfill |
| Q22 | Watch HK permission | Paired-share 為主、Watch 端不主動 request；spike B 驗 (D0)；fail 則 fallback Watch 端獨立 requestAuthorization |
| Q23 | Failure modes | Q28 Branch C 後 dual-write race 消失；`is_watch_tracked` flag 純 5-tile UI predicate；finalize 後 5 sec timeout reconcile（Watch ack 失敗 → flag flip false） |
| Q24 | 5-tile predicate | `session.is_watch_tracked === true` — 不用 `healthkit_workout_uuid !== null`（13c iPhone-only path 也寫 uuid、不是 Watch-tracked predicate）|
| Q25 | dev_simulate_watch_tracked 退役 | Branch A fail-stop — 13d D2 commit 一次性砍 5 處 hit + tests |
| Q26 | CocoaPods + Watch target | Branch A — Watch target 純 Apple framework、無 npm dep；Podfile Watch target section stub or skip |
| Q27 | TestFlight + Watch 上架 | Branch A 自動 embed；新增 5 must-fix（Watch App ID 註冊、watchOS icon set 13-size、Watch entitlements signing、CFBundleVersion sync via agvtool、watchOS screenshots）|
| Q28 | ADR-0008 HK 分工 | **Branch C trigger-only confirmed** (D0 spike A 2026-05-27 19:51 真機 PASS — Apple Watch Ultra watchOS 11.6.2、56.3s 9-phase harness、`discardWorkout()` 確認 0 HKWorkout entries written；3 HR samples persist in HK store post-discard for session window；iPhone Health app cross-check 體能訓練 tab 無新條目 + 心率 tab 19:51-19:53 有 87-92 bpm sample 點 — 見 shipped 表 D0 partial spike A row)：Watch sampling + `HKLiveWorkoutBuilder.discardWorkout()`、iPhone 13c writer 為唯一 HKWorkout entry。 |
| NEW-Q29 | Watch picker root UI 詳 | [↻刷新] + [計劃訓練] big primary（副標 today's program 排程）+ [模板訓練] dropdown |
| NEW-Q30 | Watch in-session list 導航 | Vertical scroll 全 exercise list + active card 自動 expand + Digital Crown 滾動 |
| NEW-Q31 | Set row UX | Inherit planned weight/reps 預填 + tap 數字 → Digital Crown 滾 2.5kg/1rep step + tap ✓ 自動跳下組 |
| NEW-Q32 | Top bar 兩列 sticky | Row 1: elapsed timer + clock；Row 2: ♥HR + 🔥kcal + ⚙；兩列凍結頂部 |
| NEW-Q33 | 進度條 | 每 exercise segmented bar (組數 N 格、完成格亮)、無 (n/N) 文字計數 |
| NEW-Q34 | Set type 共存 | 熱身組「熱」/ 一般組「1./2./...」 / D# (Dropset)/ Superset (A/B) 同 exercise 內混存；長按 row → popover 切換 type |
| NEW-Q35 | Active row 修改限制 | 僅 Active row（外框高亮）可改 weight/reps；✓ 任何時候可按（不需先選中）；tap 其他/空白/✓ → 解除 Active |
| NEW-Q36 | Gesture 分層 | Active row: 左滑刪除/右滑 +1組；non-active row 或空白: 左滑 → NowPlaying (OS auto)/右滑 → 完成頁 |
| NEW-Q37 | Cluster 視覺 | Inline nested cluster — Dropset 紫帶 + 副組 inline `⊖[數值]⊕`；Superset 綠帶 + A/B 子標籤；不分子頁、不抹平 |
| NEW-Q38 | 動作 ⋯ menu | 4 項：🗑刪除動作 (警示) / ↺重置此動作 / ⏭跳過此動作 / 📊查看歷史 |
| NEW-Q39 | ⚙ 設定 | 5 項：輸入方式 (鍵盤/滾輪) / ✓ 後自動跳下組 / Rest timer 模式 (popup/chip/off) / HR alert zone5 / 觸覺回饋 (弱/中/強) |
| NEW-Q40 | iPhone state during Watch-led | Live mirror bidirectional + ActivityKit Live Activity (鎖屏 + Dynamic Island) |
| NEW-Q41 | State SoT | iPhone SQLite SoT、Watch 純 in-memory mirror；Watch app kill → 重啟跑 handshake re-fetch |
| NEW-Q42 | Session initiator | 雙向 — 兩端 UI 都有 [開始訓練] 入口；initiator 寫 session row 在 iPhone、另一端 WC push auto-jump in-session view |
| NEW-Q43 | set-modified conflict 模式 | Option A diff + per-field LWW ts (in-memory map, session 結束清掉) |
| NEW-Q44 | Watch launch handshake | Two-stage — Stage 1 handshake reply = session 狀態 + template list 名單；Stage 2 lazy fetch template detail on pick |
| NEW-Q45 | End session 雙向協定 | Watch-led: Watch.end() + discardWorkout → WC → iPhone finalize. iPhone-led: iPhone finalize → WC → Watch.end() + discardWorkout. WC unreachable: 仍 complete 自己流程、queue TUI fallback |
| NEW-Q46 | iPhone Live Activity | 進 13d scope；ActivityKit native widget extension + `NSSupportsLiveActivities=true` |
| NEW-Q47 | D0 spike 內容 | Spike A (Q28 trigger-only watchOS 11+) + Spike B (Q22 paired-share HK) + Spike C (Q5 react-native-watch-connectivity New Arch) 一次跑、3-5 hours 實機。**Spike C 已 land 為 D0 partial (2026-05-27 14:18 真機 PASS 44ms、見 Q5 + shipped 表)**；**Spike A 已 land 為 D0 partial (2026-05-27 19:51 真機 PASS 56s、見 Q28 + shipped 表)**；**Spike B 仍 pending** — 須 iPhone 端先 grant HK auth 再 launch Watch app 確認 Watch query HR 不再彈 dialog；spike A 走 Watch-side auth (Watch process 呼叫 `store.requestAuthorization()`、dialog 出現在 Watch 上)、覆蓋不到 Q22 paired-share 路徑。Spike A/C 已不卡 D-chain（D5 / D6 / D7 / D8 / ... 可推進），spike B 結果只影響 D5 SessionController 是否需要保留 `requestAuthorization` fallback 呼叫。|

#### WC channel mapping table (13 message kinds)

| # | Kind | 方向 | Channel | Latency | Payload 摘要 |
|---|---|---|---|---|---|
| 0 | `handshake` | Watch→iPhone | sendMessage + ack | <2s | ack: {session?, prefetch:{templates}} |
| 1 | `start-from-watch` | Watch→iPhone | sendMessage + ack | <2s | {progId, cycleId, intensId}; ack: {sessionId, snapshot} |
| 2 | `start-from-iphone` | iPhone→Watch | sendMessage + TUI fallback | <2s | {sessionId, snapshot} |
| 3 | `set-completed` | Watch→iPhone | sendMessage + ack + TUI | <1s | {setId, weight, reps, ts} |
| 4 | `set-modified` | bidirectional | sendMessage | <1s | {setId, diff:{field}, ts} |
| 5 | `set-deleted` | bidirectional | sendMessage | <1s | {setId} |
| 6 | `set-added` (+1組) | bidirectional | sendMessage | <1s | {exerciseId, planned} |
| 7 | `exercise-added` | iPhone→Watch | sendMessage + TUI | <2s | {full exercise card} |
| 8 | `exercise-deleted` | bidirectional | sendMessage | <2s | {exerciseId} |
| 9 | `hr-tick` | Watch→iPhone | applicationContext | ~3-5s | {hrBpm, ts}（latest-wins overwrite）|
| 10 | `kcal-tick` | Watch→iPhone | applicationContext | ~3-5s | {kcalAccum, ts}（latest-wins）|
| 11 | `end-session` | bidirectional | sendMessage + TUI | <2s | {sessionId, side, ts} → 觸發 finalize |
| 12 | `settings-sync` | iPhone→Watch | applicationContext | n/a | {input_mode, rest_mode, ...} |

**Channel 用法 design rules**：
- 即時互動 (set events / end) → sendMessage + TUI fallback + message-id dedupe
- Hot stream (HR / kcal) → applicationContext (overwriting, low overhead)
- 全 payload < 1KB（per Apple WC limit）
- 每 message 帶 `kind` + `msgId` + `ts`；兩端各維護 `seen msgIds` ring buffer 防重
- set-modified 採 **diff + per-field LWW ts**：incoming diff 對 (setId, fieldName) compare ts vs in-memory map、newer wins

#### slice 13d 28-commit chain

> **Status reference**：下表是 spec/plan、不掛 ✅/⏳ marker（避免重複）。actual landed SHA + 進度對齊上方 **Shipped 進度** 表 + table 後段 "剩下未 land" 段落。本表 commit title 可能因實作微調（D5/D21 label swap 已記在翻盤 ledger）。

**Shipped 進度（per main HEAD 2026-05-27 night、跟下表 chain slot 對齊；最新 main HEAD `bf6ef83` = skill lessons #16 #17 from D7-Swift real-device fix）**

| Shipped commit tag | hash | 落地時間 | 對應 28-commit chain slot | 備註 |
|---|---|---|---|---|
| `slice-13d/D1` | `4acfcce` | 2026-05-27 00:11 | **D1** | v024 schema column |
| `slice-13d/D2` | `6aa2bd8` | 2026-05-27 00:35 | **D2** | retire FEATURE_WATCH_HANDOFF |
| `slice-13d/D5`（label） | `7b07f9b` | 2026-05-27 00:55 | **D21**（renumber、見 2026-05-27 翻盤 ledger row） | 5-tile predicate switch；commit tag 不再追改 |
| `slice-13d/D3`（feat） | `c29f1fd` | 2026-05-27 01:16 | **D3** | WC payload schema (protocol-only) |
| `slice-13d/D3`（test） | `8ca6671` | 2026-05-27 01:19 | **D3** | payload schema 8+ case |
| `slice-13d/D20` | `2e3b13d` | 2026-05-27 11:47 | **D20** | set-modified per-field LWW reducer（純 TS、不卡 D0/D4；接 D3 payload schema、ready-to-wire 等 connectivity.ts 落地）|
| `slice-13d/D19` | `791a0ed` | 2026-05-27 11:57 | **D19** | iPhone live mirror reducer（純 TS、6 mirror-affecting kind + 7 no-op kind；接 D20 admitDiff 處理 set-modified；wire-in gated on connectivity.ts）|
| `docs(slice-13d)/D26-partial` | `54b8f9d` | 2026-05-27 12:03 | **D26 partial** | ADR-0019 doc sweep：shipped 表加 D19/D20 列、schema 表 backfill v023/v024、翻盤 ledger top row 記 D-chain 推進策略 update |
| `slice-13d/D7-partial` | `9a29ef6` | 2026-05-27 12:13 | **D7 partial** | end-session 5-sec reconciliation reducer（純 TS + Clock-injected `tick` action，無 setTimeout）；**註**：D7-TS（`cc3307d`）grill 拍板用 `sendMessage({timeoutMs:5000})` Promise-based 路徑、未 wire 此 reducer；此模組 retained as future generic primitive（需 AppState ticker 的場景才會用），不再算 D7 critical path 一部分 |
| `docs(skills)` | `faf09f5` | 2026-05-27 12:18 | _project skill_ | `.claude/skills/ship-partial-pure-logic/SKILL.md`：把今日 4 條 partial commit 模式萃成 skill（branch / module / tests / barrel / commit body discipline / cherry-pick + cleanup recipe）|
| `slice-13d/D9-partial` | `c350b5c` | 2026-05-27 12:24 | **D9 partial** | handshake pure builders：`buildStage1Reply`（discriminated union by `hasActiveSession`）+ `matchesPendingRequest` race predicate + `buildStartFromIphone` Stage 2 純 transform；Z scaffold 17 case 活化 + 9 wire-in case 保留 describe.skip |
| `docs(slice-13d)/D26-partial-2` | `02f8625` | 2026-05-27 12:32 | **D26 partial 二次補刀** | shipped 表 + remaining 列 + 翻盤 ledger 同步 D7-partial / D9-partial / skill commit（同晚高頻 land 造成 doc drift 一次性追補）|
| `docs(skills)/ship-partial` | `3cba27b` | 2026-05-27 12:36 | _project skill_ | SKILL.md validated cases 表擴到 6 + naming variant note + mixed-test scaffold refactor note（D9 partial 落地後的 skill 自我升級）|
| `slice-13d/D24-partial` | `355bf00` | 2026-05-27 12:41 | **D24 partial** | watch sync readout pure formatter — `WatchSyncResult` 6 變體 + `formatWatchSyncReadout(state, now)` 相對時間 4 bucket（剛剛/分鐘/小時/絕對 MM-DD HH:mm）+ 19 case test；wire-in 補上 `app_settings` key + repository getter/setter + connectivity.ts hook + Settings UI row 後即完整 D24 |
| `slice-13d/D0-partial-spike-c` | (本 commit) | 2026-05-27 14:30 | **D0 partial spike C** | 真機 spike C 結果 land 進 ADR：iPhone 14 Pro + Apple Watch Ultra、44ms total、6 phases 全 PASS（getIsPaired=true 29ms / getIsWatchAppInstalled=false / getReachability=false / subscribe+unsubscribe / sendMessage errCb 12ms with `WCErrorDomain` code 7006 `WCErrorCodeWatchAppNotInstalled`）；Q5 + NEW-Q47 row 更新為 Branch B confirmed；spike harness code 仍留 branch `slice/13d-d0-spike-c` @ `e81c0f5`（不 cherry-pick、等 D3 connectivity.ts ship 時或刪或吸收）|
| `slice-13d/D4-prep` | `a34b948` | 2026-05-27 14:29 | **D4 prep** | `docs/slice-13d-d4-watch-target-checklist.md` ~473-line user-driven Xcode runbook — 手動 add target / signing / capabilities (HealthKit + Background Modes "Workout processing") / Info.plist HK usage descriptions / deployment target watchOS 11.0；Inline Swift template for ContentView.swift + TrainingLog_WatchApp.swift；failure-mode 排錯表（device unavailable / bundle ID 對齊 / sandbox sync / objectVersion 70 / Watch dev mode）|
| `slice-13d/D4` | `9b380d1` | 2026-05-27 17:45 | **D4** | Watch Xcode target scaffold + entitlements 真上 — manual `ios/TrainingLog Watch Watch App/` (TrainingLog_WatchApp.swift + ContentView.swift placeholder + .entitlements with `com.apple.developer.healthkit=true`) + `TrainingLog-Watch-Watch-App-Info.plist` (WKBackgroundModes workout-processing) + `ios/TrainingLog.xcodeproj/project.pbxproj` Watch target definitions (objectVersion=70、INFOPLIST_KEY_NSHealthShareUsageDescription / NSHealthUpdateUsageDescription)；device-install verify PASS on Apple Watch Ultra watchOS 11.6.2 showing 3-line placeholder UI；解 blocker for spike A/B + D5 native Swift land |
| `slice-13d/D0-partial-spike-a` | `c394b9c` | 2026-05-27 20:00 | **D0 partial spike A** | 真機 spike A 結果 land 進 ADR：Apple Watch Ultra (watchOS 11.6.2)、56,323ms total (37s 為 HK auth dialog 人工互動、spike body ~19s)、9 phases 全 PASS — Phase 1 HK auth、Phase 2 configure HKWorkoutSession + HKLiveWorkoutBuilder + HKLiveWorkoutDataSource (traditionalStrengthTraining + indoor)、Phase 3 startActivity + beginCollection、Phase 4 wait 15s for HR samples、Phase 5 query HR during session = **2 samples in [start, now]** (positive collection check)、Phase 6 stopActivity + `discardWorkout()` (synchronous 0ms)、Phase 7 settle 3s post-discard、Phase 8 query HKWorkout entries = **0 entries in [start, end+10s]** ← **negative assertion confirmed**、Phase 9 query HR after discard = **3 samples in [start, end]** (1 extra async sample landed during settle) ← **positive assertion confirmed**；Health app cross-check 獨立確認（體能訓練 tab 今天 2026-05-27 無新 "傳統重量訓練" 條目 / 心率 tab 19:51-19:53 有 87-92 bpm sample 點）；**Q28 Branch C 100% confirmed**，HK 分工模型 (Watch trigger-only sampling + iPhone 13c writer 為唯一 HKWorkout writer) 可 land；Q28 + NEW-Q47 row 更新；spike harness code 仍留 branch `slice/13d-d0-spike-a` @ `be3c179`（含 SpikeAHarness.swift ~230 LOC + ContentView.swift +76 LOC + Combine import fix；不 cherry-pick、等 D5 SessionController 落地時或刪或吸收 HK setup pattern）|
| `slice-13d/D5 (native)` | `150a3d8` | 2026-05-27 night | **D5** | Watch HK lifecycle native Swift land — `ios/TrainingLog Watch Watch App/SessionController.swift` (`@MainActor` ObservableObject + 6-case `State` enum + `start()/end()/cancel()` + `HKWorkoutSessionDelegate` 監聽 OS-side terminal transitions) + `HealthKitController.swift` (HKHealthStore wrapper + `ensureAuthorized()` 走 Q22 fallback path until spike B confirmed) + `ContentView.swift` dev_smoke 3-button UI；xcodebuild watchOS target Debug PASS；real-device smoke PASS on Apple Watch Ultra (watchOS 11.6.2、HK auth dialog 出現在 Watch + State.active→.ended + discardWorkout 同步 0ms + 0 HKWorkout entry written 確認)；解 Q28 Branch C 從 spike confirmed → production landed；ADR-0008 § HK 分工 production-realized (Watch trigger-only sampling + iPhone 13c writer 為唯一 HKWorkout entry writer)。 |
| `slice-13d/D6` | `10f94b4` | 2026-05-27 night | **D6** | iPhone start-session WC push — `src/adapters/watch/connectivity.ts` (lazy-require WC bridge + 256-slot msgId ring buffer + ack-or-timeout `sendMessage` Promise wrapper + per-kind inbound listener registry + `isPaired/isReachable` 早 gate) + `src/services/watchSessionStart.ts` (`pushStartToWatch` 2s timeout + Q11 silent-skip + ack 時 `setIsWatchTracked(true)`) + `app/(tabs)/index.tsx` 2 start sites wired (`startSession` + template start) + jest 6 case 涵蓋 happy / timeout / errCb / unreachable / unpaired / pre-ack idempotent；WC channel #2 (`start-from-iphone`) production landed、wire-format 跟 D3 payloadSchema `makeEnvelope` 對齊。 |
| `slice-13d/D7-TS` | `cc3307d` | 2026-05-27 night | **D7（TS half）** | iPhone end-session WC push + Watch-led inbound handler — `src/services/watchSessionEnd.ts` (`pushEndToWatch` 5s timeout per Q23 + 非-ack 時 `setIsWatchTracked(false)` reconcile) + `app/(tabs)/index.tsx` 加 `addMessageListener('end-session')` Watch-led handler (useRef pattern for stable listener with unstable `finalizeEndAndRoute` closure) + 入口 idempotent DB gate (`ended_at != null` check 跨 iPhone-led + Watch-led 兩條進入路徑共用) + 6 case jest；WC channel #11 (`end-session`) bidirectional 在 TS 半邊 closed；Q23 + NEW-Q45 端到端規約落地。 |
| `slice-13d/D7-Swift` | `5a39db0` | 2026-05-27 night | **D7（Swift half）** | Watch WC bridge code-side — `ios/TrainingLog Watch Watch App/WatchConnectivityCoordinator.swift` ~190 LOC (`@MainActor` ObservableObject + Status 5-state machine + `sendEndToiPhone(sessionId:)` outbound + `WCSessionDelegate.session(_:didReceiveMessage:replyHandler:)` inbound — filter side='iphone'、call `await sessionController.end()`、reply `["ok": true]`) + `ContentView.swift` dev_smoke WC section（status text + Inbound/Outbound 視窗 + sessionId TextField + 「End + send → iPhone」橘色 button）；xcodebuild watchOS Debug target PASS（用 `-target` 隔離 Watch、不拉 iPhone pod modulemap chain）。**註**：本 commit code 含兩個 real-device-only bug、隨後 `234ee33` fix 修掉。 |
| `slice-13d/D7-Swift-fix` | `234ee33` | 2026-05-27 night | **D7（Swift fix）** | Real-device smoke 找到的兩個 bug：(1) **arm64_32 Int 溢位** — watchOS Swift `Int` 是 32-bit、`Int(epoch_ms)` 強轉 1.78e12 crash → 改 `Int64`；(2) **`react-native-watch-connectivity` 永遠走 reply-variant delegate** — library iPhone 側同時定義 `session:didReceiveMessage:` + `:replyHandler:` 兩個 delegate、Apple framework 永遠選後者、replyHandler 存 NSCache 等 JS 自己 call `replyToMessageWithId` (D7-TS 沒做)，造成 3-arg sendMessage 死等 reply → 改 2-arg + swallow `WCError 7016` (`messageReplyTimedOut`) 顯示 `sent sess=… (no-ack)`；real-device smoke matrix PASS on Apple Watch Ultra: Scenario A iPhone-led (iPhone end → Watch Inbound 收到 + iPhone route 到詳情頁)、Scenario B Watch-led (Watch tap → Outbound `sent sess=Test-3` + iPhone JS handler 跑 silent no-op 預期)；D7 整條 wire bidirectional production landed。 |

剩下未 land：**D0 spike B**（spike A/C 已 land 為 D0 partial、剩 spike B 驗 Q22 paired-share HK auth — 須 iPhone 先 grant HK auth → launch Watch app → 確認 Watch query HR 不彈 dialog；spike A 走 Watch-side auth、覆蓋不到 paired-share 路徑；optional、不阻塞 D-chain）、**D8**、**D9 wire-in**、**D10**-**D18**、**D22**、**D23**、**D24 wire-in**、**D25**、**D27**。D21 視為已落地（label 在 main 上是 `slice-13d/D5`），未來不再 implement D21。D7-partial reducer (`9a29ef6`) 在 D7-TS grill 後不再算 critical path（被 `sendMessage({timeoutMs:5000})` 取代、仍保留為 future generic primitive）。D9 / D24 各自的「partial」commit 落了純邏輯子集、wire-in 子集留待 settings repository 落地時補完（D3 connectivity.ts bridge 已 D6 落地、本來的 wire-in blocker 已解）。Spike A/C 已 unblock D5-D7（已落地）+ D8-D18（D-chain 可推進）；spike B 結果只影響 `SessionController.ensureAuthorized()` 是否保留 fallback `requestAuthorization` 呼叫。

**D-chain 推進策略 update（2026-05-27 evening）**：原規約「forward 接 D4 → D5 → ... 順序進行」翻盤 — 純 TS / 純 logic / 無 native dep 的 commit 可亂序提前 ship（見 2026-05-27 翻盤 ledger row）。**全部落地（2026-05-27 evening session）共 5 + 4 commits**：D20 (`2e3b13d`) + D19 (`791a0ed`) + D7 partial (`9a29ef6`) + D9 partial (`c350b5c`) + D24 partial (`355bf00`) 五條 pure-logic / partial 模組，加上 D26 partial 一次 (`54b8f9d`) + D26 partial 二次補刀 (`02f8625`) + D26 partial 三次補刀（本 commit）+ `faf09f5` / `3cba27b` 兩次把模式萃成 / 擴充 `ship-partial-pure-logic` project skill。**slice 13d 純 TS backlog 至此清空** — 剩下的 D-commit 都需 Xcode 操作（D4 / D8 / D10-D17 / D22 / D23）或 connectivity.ts native bridge（D0 spike + D6 + D7 wire-in + D9 wire-in + D24 wire-in），全部留實機開工時做。

| # | Commit title | 摘要 |
|---|---|---|
| D0 | `chore(slice-13d): spike — trigger-only HK + paired-share + react-native-watch-connectivity` | 3 spike 實機跑、結果寫進 commit message；spike A 失敗 → Q28 退 Branch A、spike B 失敗 → Watch 加 requestAuthorization、spike C 失敗 → 自造 Swift native module |
| D1 | `feat(slice-13d): v024 schema — session.is_watch_tracked column` | migration + Session type + sessionRepository `setIsWatchTracked` + test |
| D2 | `feat(slice-13d): retire dev_simulate_watch_tracked (Phase A → Phase B fail-stop)` | 砍 settingsRepository 4 處 + index.tsx 3 處 + tests |
| D3 | `feat(slice-13d): WC bridge — connectivity.ts + payloadSchema.ts` | src/adapters/watch/* + 6+ unit tests（mock target = react-native-watch-connectivity OR NativeModules.RNWatchBridge）|
| D4 | `feat(slice-13d): Watch Xcode target scaffold + entitlements` | 手動 Xcode add target + Info.plist + entitlements + Background Modes "Workout processing" + .watchkitapp bundleId |
| D5 | `feat(slice-13d): Watch HK lifecycle — SessionController + discardWorkout pattern` | Swift SessionController.swift + HealthKitController.swift + discardWorkout trigger-only flow |
| D6 | `feat(slice-13d): iPhone start-session WC push` | 既有 13c finalizeEndAndRoute 不動；加 start session 時 WC sendMessage to Watch |
| D7 | `feat(slice-13d): end-session bidirectional protocol` | finalizeEndAndRoute 加 WC send + delegate handler 收 watch-led end + 5-sec reconcile timeout |
| D8 | `feat(slice-13d): Watch picker root 3-step UI` | SwiftUI Root + Templates dropdown + 計劃方塊 + 強度方塊 |
| D9 | `feat(slice-13d): start-from-watch WC + handshake-on-launch (two-stage)` | Watch picker [計劃訓練] / [模板訓練] → WC sendMessage; Watch app launch 跑 handshake、iPhone delegate reply 帶 session snapshot or null + prefetch list |
| D10 | `feat(slice-13d): Watch in-session UI — 2-row top bar + 進度條 + exercise card` | SwiftUI top sticky 2-row + per-exercise card with segmented progress bar |
| D11 | `feat(slice-13d): Watch set logger — set row + Active state + Crown + ✓` | Set row layout + tap 數字 highlight Active + Digital Crown observer + tap ✓ confirm + auto-advance |
| D12 | `feat(slice-13d): Watch dropset / superset inline cluster rendering` | 紫帶 Dropset + 副組 `⊖[]⊕` + 綠帶 Superset + A/B subrow |
| D13 | `feat(slice-13d): Watch gestures — 左滑刪除/右滑+1/長按切 type` | Active row gesture + 警示 confirm；非 Active or 空白 swipe 走 page-level (NowPlaying / 完成頁) |
| D14 | `feat(slice-13d): Watch 完成頁 + 右滑非 active → 完成頁 transition` | 完成頁 SwiftUI + transition + 雙 button (結束訓練 / 返回繼續) |
| D15 | `feat(slice-13d): Watch 動作 ⋯ menu — 刪除 / 重置 / 跳過 / 查看歷史` | 4-item context menu + 警示 dialog + sub-page 歷史 (read-only 最近 3 場) |
| D16 | `feat(slice-13d): Watch ⚙ settings popover + settings-sync applicationContext` | 5-item settings popover + per-session 套用 + WC settings-sync push iPhone |
| D17 | `feat(slice-13d): Watch in-session live HR display (activeWorkoutHeartRate observer)` | Top bar HR 真值由 Watch 本地 observer 拉、無 WC 依賴 |
| D18 | `feat(slice-13d): HR/kcal applicationContext push Watch → iPhone (3-5s throttle)` | Watch observer 節流 → applicationContext push；iPhone delegate update React state |
| D19 | `feat(slice-13d): iPhone live mirror — in-session view 受 WC msg 即時更新` | app/(tabs)/index.tsx in-session view 加 WC listener、set / exercise events → state update |
| D20 | `feat(slice-13d): set-modified diff + per-field LWW (in-memory ts map)` | merge logic + ring buffer dedupe + edge case test 8 case |
| D21 | `feat(slice-13d): 5-tile predicate switch to is_watch_tracked` | session-stats-panel 改用 v024 column；ADR-0019 line 325 文字修訂 |
| D22 | `feat(slice-13d): NowPlaying 左滑 + 完成頁 右滑 transitions` | TabView pageStyle + custom 右滑 detect → 完成頁；NowPlaying 系統內建 |
| D23 | `feat(slice-13d): iOS Live Activity — ActivityKit native widget extension` | Widget extension target + ActivityKit + NSSupportsLiveActivities + Lock screen / Dynamic Island content |
| D24 | `feat(slice-13d): Settings 開發者「Watch 整合 last sync」debug readout` | replace 退役 dev toggle、顯 last attempted sync ts + result code |
| D25 | `chore(slice-13d): smoke matrix run + bug fix sweep` | 16 case smoke matrix log + 任何 fix-as-you-go commits |
| D26 | `docs(adr): Slice 13d Amendment + CONTEXT.md α-model update` | 本 amendment + ADR-0008 amendment + CONTEXT.md |
| D27 | `chore(testflight): Watch add-ons — App ID + icon set + version sync` | ADP App ID 註冊 + Watch icon set 13 size sips script + agvtool version sync + signing manual config |

#### Smoke matrix (16 項 — α-model 完整覆蓋)

| # | 描述 | Pass 條件 |
|---|---|---|
| S1 | Watch [計劃訓練] one-tap → in-session UI | 1-2 秒進 set logger、HR sampling 啟動、HKWorkoutSession console no error |
| S2 | Watch [模板訓練] dropdown 選 template → 方塊計劃 → 強度 → 開始訓練 | 三步 nav 流暢、選完進 in-session UI、bw_snapshot 帶入正確 |
| S3 | iPhone 訓練 tab [開始訓練] → Watch auto-jump in-session view | Watch 在 <2s 內離 picker、進 in-session UI 同步 |
| S4 | Watch set ✓ 後、iPhone in-session view 內 set row 即時更新 | <1s 內 iPhone view 反映 |
| S5 | iPhone +動作 → Watch 同步看到新 exercise card | <2s 內 Watch in-memory mirror 加 exercise |
| S6 | Set 同時改 weight (Watch) + reps (iPhone) — non-overlap | 兩 field 各保留、無丟失 |
| S7 | 戴 Watch 完成 session → 詳情頁 HR chart 真資料 + kcal tile > 0 | 5-tile variant、HR polyline 真 sample |
| S8 | 完成 session → Apple Fitness app 只有一筆 workout (iPhone 寫) | Watch 未額外寫 entry |
| S9 | 不戴 Watch / Watch 沒電 → iPhone-led session | is_watch_tracked=false、3-tile variant、HR chart grey overlay |
| S10 | Watch app kill mid-session → 重啟 | handshake 帶回 session snapshot、in-memory mirror 重 hydrate、無資料遺失 |
| S11 | iPhone 鎖屏 in-session | Live Activity 顯 elapsed + HR + kcal；Dynamic Island compact + expanded 各正確 |
| S12 | Watch 左滑非 active → NowPlaying | OS 內建 NowPlaying page 自然出現 |
| S13 | Watch 右滑非 active → 完成頁 | 完成頁 顯 elapsed + 組數 + 雙 button、tap 結束觸發 end protocol |
| S14 | Settings HK 權限拒絕 → Watch session 起不來 | silent log + 5-tile fallback 3-tile + Watch UI 不卡 |
| S15 | Battery 1hr session 跑完 Watch 耗電 | ≤ 10% drain (Apple Watch S9/SE2 baseline) |
| S16 | Phase A `dev_simulate_watch_tracked` toggle 已不存在於 Settings | Setting key gone、tsc clean、無對應 test 殘留 |

#### Test count delta (estimate)

1666 → **~1740-1780** delta：
- WC connectivity adapter: +6 case (send happy / unreachable / dual-send dedupe / payload too large / Watch app uninstalled / paired=false)
- WC payload schema: +8 case
- `is_watch_tracked` repository setter: +4 case
- 5-tile predicate (post-migrate): +4 case
- syncSessionWithHealthKit Watch path: +3 case
- finalizeEndAndRoute Watch branch: +3 case
- set-modified diff + per-field LWW merge: +8 case
- Live Activity ActivityKit hook: +5 case
- handshake reply shape + two-stage lazy fetch: +6 case
- Watch picker SwiftUI (snapshot test if applicable): +N case
- 總 estimate: ~+47-114 case；±5% tolerance allowed before considered drift

#### TestFlight Watch add-ons（02-testflight 6 must-fix 之外的 5 新增）

per Slice 13d Q27：

| 新增 must | 細節 | 工時 |
|---|---|---|
| Watch App ID 註冊 | ADP portal → Identifiers → App ID `com.lisonchang.TrainingLog.watchkitapp` + HealthKit capability | 10 min |
| watchOS Watch App AppIcon multi-size | 24/27.5/29/40/44/50/55/86/98/108pt 共 9 size + 1024 marketing；sips script 從 source 生 | 20 min |
| Watch entitlements signing | Xcode → Watch target → Signing & Capabilities → automatic + Team XQTU89U2J2 + HealthKit + Background Modes | 5 min |
| CFBundleVersion sync | `VERSIONING_SYSTEM = apple-generic` 已具備、`agvtool next-version -all` 兩 target 同步 bump | 0 |
| watchOS screenshots | App Store Connect 需 Watch screenshot；用 simulator 截 3-5 張 picker / in-session / 完成頁 | 15 min |

#### Slice 13e+ preview / known issues

Items 留 13e 或之後（intentional defer）：
- **Pause button** — 永不（per Q9 紀律、α-model 擴張後仍維持）
- **Watch face complication**（ADR-0008 #14）— 13e+
- **PR 達成觸覺通知**（#12）— 13e+
- **結束 summary 卡片**（#15）— 13e+ Watch end UI
- **Max session 時長警告**（Q19）— v1.5+ revisit triggered by report ≥ 3 incidents
- **iCloud backup integration**（ADR-0011）— slice 15
- **Watch 上 +動作**（user 主動限制）— 永不（Watch 畫面小、選 exercise 麻煩）；user 要 +動作 → 掏 iPhone +動作、Watch via WC sync 自然看到
- **Watch on-device exercise library picker UI** — 不做（同上原因）
- ~~**react-native-watch-connectivity New Arch 確認**~~ ✅ **resolved** — D0 spike C 2026-05-27 真機 PASS (`14183bc`)、Q5 Branch B confirmed；Branch A fallback (Swift Nitro module) 確認不需要。本 bullet 留作歷史記錄。

#### 涉及 ADR cross-references

- ADR-0008 — § 2026-05-26 Slice 13d Amendment（同步寫、α-model 路徑 + 雙向 initiator + HK 分工 trigger-only）
- ADR-0019 § Slice 13c Amendment line 1089-1090（本 amendment 推翻範圍）
- ADR-0019 § Q9 (b) line 497（pause 紀律維持、不推翻）
- ADR-0019 § Q6 line 145（5-tile predicate 由 dev toggle → `is_watch_tracked`）
- ADR-0014 — Session.title schema、與 Live mirror 雙向 sync 對齊
- ADR-0012 — Cluster card + set row、Watch UI inline nested cluster 視覺對齊

---

## Slice 13d D11 Set Logger Spec（凍結 2026-05-28）

**Status**: Spec frozen — ASCII mock 8 輪迭代收斂、待 D8 picker land 後動工 SwiftUI 實作
**Depends on**: D4 (Watch target ✅) / D5 (lifecycle ✅) / D8 (picker, pending)
**Blocks**: D14 (完成頁) / D15 (⋯ menu) / D16 (⚙ settings) impl
**Iteration log**: chat session 2026-05-28、8 輪 mock v1→v8

### Overview

In-session SwiftUI view on Apple Watch（~36 char wide @ 49mm Ultra）。User 在這 view log set / 切 set type / 管理 cluster / 標完成 / 切頁到完成頁或音樂。

### View anatomy

每張動作卡：
- **Header**: 動作名稱（`深蹲 (Squat)`）、不顯示組數
- **Progress bar**: continuous（無 gap）、單行、寬度滿、segments = 工作組 + cluster 數（熱身不計）
- **Set rows**: 細線分隔、結構 `編號 [重量] [次數] ◯`

### Visual: idle（無 highlight、無 focus marker）

```
┌──────────────────────────────────┐
│ 深蹲 (Squat)                     │
│ ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱     │
│                                  │
│ 熱 ( 40 kg ) ( 12 次 )   ◯     │
│ ─────────────────────────────    │
│  1 [ 80 kg ] [  8 次 ]   ◯     │
│ ─────────────────────────────    │
│  2 [ 80 kg ] [  8 次 ]   ◯     │
│ ─────────────────────────────    │
│  3 [ 80 kg ] [  8 次 ]   ◯     │
│ ─────────────────────────────    │
│  4 [ 80 kg ] [  8 次 ]   ◯     │
│ ─────────────────────────────    │
│ D1 [ 80 kg ] [  8 次 ]   ◯     │
│    [ 40 kg ] [  8 次 ]         │
│    [ 20 kg ] [  8 次 ]         │
└──────────────────────────────────┘
```

熱身用圓括號 `( )` 示意灰調 dim、不計進度條。Cluster sub-set 縮排無編號、cluster 算 1 段進度條。

### Visual: {} Active（row mode）

Tap row 中段（編號 / cells / 空白）→ 4 邊框、row 可編輯：

```
╔══════════════════════════╗
║ 2 [ 80 kg ] [  8 次 ]    ║ ◯  ← ◯ 在框外
╚══════════════════════════╝
```

Cluster {} Active 額外顯示 `-`/`+` CRUD：

```
╔════════════════════════════╗
║ D1 [ 80 kg ] [ 8 次 ]      ║◯
║    -[ 40 kg ] [ 8 次 ] +   ║   ← `-` 刪 sub / `+` 新增 sub
║    -[ 20 kg ] [ 8 次 ] +   ║
╚════════════════════════════╝
```

### Visual: [] Active（cell mode、inline）

從 {} Active tap cell → cell highlight + 輸入 overlay（不跳新 view）。

⚙ keypad mode（必 Done 退出）：
```
╔══════════════════════════╗
║ 2 ┃▌80 kg▐┃ [  8 次 ]    ║ ◯
╚══════════════════════════╝
╓──────────────────────────╖
║   1    2    3            ║
║   4    5    6            ║
║   7    8    9     Done   ║
║   ⌫    0    .            ║
╙──────────────────────────╜
```

⚙ crown mode（tap 外即退、值即時生效）：
```
╔══════════════════════════╗
║ 2 ┃▌80 kg▐┃ [  8 次 ]    ║ ◯
╚══════════════════════════╝
       ↻ Crown 旋轉調整
       (tap 框外退出)
```

### Visual: 超級組（獨立卡片）

idle：
```
┌──────────────────────────────────┐
│ 超級組 (Squat + Bench)           │
│ ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱     │
│                                  │
│  1  A [ 80 kg ] [  8 次 ]  ◯    │
│     B [ 60 kg ] [ 10 次 ]       │
│ ─────────────────────────────    │
│  2  A [ 80 kg ] [  8 次 ]  ◯    │
│     B [ 60 kg ] [ 10 次 ]       │
└──────────────────────────────────┘
```

{} Active 整 superset set 一個框、A/B cells 都可 tap 進 [] Active：
```
╔═══════════════════════════╗
║ 1  A [ 80 kg ] [  8 次 ]  ║ ◯
║    B [ 60 kg ] [ 10 次 ]  ║
╚═══════════════════════════╝
```

Superset type 只支援「熱 / 工作」、**不支援 D**。

### Visual: 完成頁（右滑進入、非 {} Active 區域）

```
┌──────────────────────────────────┐
│  Session 完成？                  │
│                                  │
│  ✓ 已完成 12/15 組               │
│  ⏱ 32:14                         │
│  ❤ 平均 142 bpm                  │
│                                  │
│  ┌──────────┐  ┌──────────┐      │
│  │  取消    │  │  完成    │      │
│  └──────────┘  └──────────┘      │
│                                  │
│  (← 左滑回 session 繼續)         │
└──────────────────────────────────┘
```
- [取消] = abort session、不儲存任何資料
- [完成] = 結束 session、儲存
- 左滑回 = 繼續 session（swipe-to-page 連續性）

### Visual: 音樂頁（左滑進入、非 {} Active 區域）

走原生 NowPlaying / system music control（不自己 design）。

### Interaction rules — full table

#### Row gestures（{} Active 時）

| Gesture | Action |
|---|---|
| tap 編號 (`2` / `熱` / `D1`) | Cycle type（見下方 type cycling）|
| tap `[重量]` / `[次數]` | 進 [] Active inline edit |
| tap ◯/✓ | Toggle done state（**跟 Active state 無關、隨時可打**）|
| ⬅ swipe left | Delete row（row 內手勢優先、不切頁）|
| ➡ swipe right | +1 set 插入後 |
| Long press | Move mode（drag to reorder）|
| tap 框外 | 退回 idle |

#### Cell gestures（[] Active 時）

| Mode | 退出方式 | 值保存時機 |
|---|---|---|
| keypad | Done button 必按 | on Done |
| crown | tap 框外 | live（即時生效）|

#### ◯/✓ semantics

- 任何 state（IDLE / {} Active / [] Active）皆可 tap ◯/✓ 切換
- tap ◯ → ✓: single tap、無確認、自動退所有 Active state、保存當前 cell 值
- tap ✓ → ◯: undo、無確認
- **Cluster: header 一個 ✓ 標完整 cluster、sub-set 無個別 ✓**

### Advance focus

| Trigger | Behavior |
|---|---|
| 中間 row ✓ | 不動、保 idle、user 自己 tap 下一 row |
| 該動作最後 row ✓ | auto-scroll 到下一動作卡、自動展開、無 highlight |
| 最後動作的最後 row ✓ | 停在原卡、**不自動跳完成頁**、user 右滑進完成頁 |
| 初次進 card | 全 idle、無 highlight、user tap 才出 |

### Type cycling rules

Tap 編號 → 三態循環：`工作` → `熱` → `D` → `工作`

切換副作用（**即時生效**）：
- 整列重編號：熱身穿插原物理位置、工作組 1-N 連續重編
- 例：`1 / 2 / 3 / 4 / D1` tap row 3 切熱 → `1 / 2 / 熱 / 3 / D1`（原 row 4 → 重編 3）
- 多熱身: 都顯示「熱」（無 `熱1 / 熱2`）
- 多 cluster: `D1 / D2 / D3` 自動編號
- 切到 D 預設: 1 sub-set、數值同 header
- 解構 D: tap header `D1` 切 → 工作組、sub-set 全砍

### Cluster rules

- Min 2 rows（header + ≥1 sub-set）
- 剩 2 rows 時、唯一 sub 的 `-` 虛化 disabled
- Cluster header **無** `-`/`+`
- Cluster ✓ = 整 cluster 一次標完

### Progress bar rules

- Continuous `▰▰▰▱▱`（無 gap）
- 段數 = 工作組數 + cluster 數（熱身不計、cluster 算 1 段）
- 動態：+1 set / 刪 set / 切 type 都即時 recalc
- 寬度: 滿 row 寬、視覺上分隔標題區跟 row 區

### Swipe-to-page rules

- 觸發範圍：**非 {} Active 區域**（標題、進度條、divider、空白邊緣、idle row 整列）
- {} Active row 上滑動 → row 內手勢優先（delete / +1 / move）、**不切頁**
- Pages: 音樂 ← session card → 完成頁
- 連續可滑回（iOS workout-style）

### State transition table

| From | Trigger | To | Side effect |
|---|---|---|---|
| Idle | tap row 中段 | {} Active | 4 邊框、◯ 留外 |
| Idle | tap ◯ | Idle (✓) | mark done、無 advance |
| Idle | tap ✓ | Idle (◯) | undo |
| Idle | swipe right (edge) | 完成頁 | swipe-to-page |
| Idle | swipe left (edge) | 音樂 | swipe-to-page |
| {} Active | tap cell | [] Active | input overlay |
| {} Active | tap 編號 | {} Active | cycle type + renumber + recalc bar |
| {} Active | swipe left row | row deleted | row 內手勢 |
| {} Active | swipe right row | +1 row inserted | row 內手勢 |
| {} Active | long press | move mode | drag |
| {} Active | tap 框外 | Idle | exit |
| {} Active | tap ◯/✓ | Idle (✓ toggled) | exit Active + save |
| [] Active (keypad) | tap Done | {} Active | save |
| [] Active (crown) | tap 框外 | {} Active | save (live) |
| [] Active | tap ◯ | Idle (✓) | exit both + save |

### Settings dependency（⚙ pane 必含）

- Input mode toggle: `keypad` / `crown`（global、[] Active 中不能切、必須回 ⚙）

### Out of scope（deferred to other D sub-slices）

- Rest timer trigger / popup — 另 view、待 grill
- Pause / resume session — lifecycle 另 view
- Animation choreography（cross-fade vs slide for 動作切換）— 留 impl 階段
- 音樂頁 inner control — 走原生、不自己 design

### Decisions captured（8 輪 ASCII mock iteration log）

| 輪次 | 主要決策 |
|---|---|
| v1-v2 | row 結構 `編號 [重量] [次數]` + `{}` 框 + `[]` 兩階 Active |
| v3 | 進度條改 continuous + 拉長當 divider、`▸` focus marker、◯/✓ 獨立 tap target |
| v4 | 移除 `▸`、純 box highlight |
| v5 | [] Active inline（不跳新 view）+ keypad/crown 兩模式 ⚙ 全局 |
| v6 | 熱身灰調 + 不計進度條、cluster 算 1 段、左右滑切頁 |
| v7 | type chip `[#]/[熱]/[D]` |
| v8 | type chip 砍掉、編號本身=button、cluster sub-set `-`/`+` CRUD |
| 收尾 | 切 D 預設 1 sub-set、熱身無編號、編號重排即時 |

---

## Slice 13d D8 Watch Picker Spec（凍結 2026-05-28）

**Status**: Spec frozen — ASCII mock 5 輪迭代收斂、待 SwiftUI 動工
**Depends on**: D4 (Watch target ✅) / D6 (start sync ✅) / iPhone-side Program + Template schema (已有)
**Blocks**: D11 (set logger) entry point
**Iteration log**: chat session 2026-05-28、5 輪 mock v1→v5（同會 D11 後續）

### Overview

Watch app 開啟後 user 選擇要做的訓練的 picker UI。Root = 兩區（計劃訓練 / 模板訓練）+ 🔄 update icon。3 元組（模板 + 計劃 + 強度）集齊才能進 set logger。「通用」作為計劃跟強度的 fallback option（tap 通用 = bypass 該 sheet）。

### View anatomy

#### Root view（picker = root、無 splash）

```
┌──────────────────────────────────┐
│ 選擇訓練                    🔄   │
│ ─────────────────────────────    │
│ 計劃訓練                         │
│  ▶ 推日 W3D1（今日）             │
│ ─────────────────────────────    │
│ 模板訓練                         │
│  • 推日（A）                     │
│  • 拉日（B）                     │
│  • 腿日（C）                     │
│  • 全身                          │
└──────────────────────────────────┘
```

- 右上 🔄 = 強制 pull iPhone 最新 program/template 資料
- 「計劃訓練」區 = 當前 active program 的「今日該做的」單行（自動推算）
- 「模板訓練」區 = 全部 templates、純名稱、按最近執行時間排序

#### Calendar variants

休息日：
```
│ 計劃訓練                         │
│  今日休息（無訓練）              │
```

無 active program：
```
│ 計劃訓練                         │
│  （無計劃進行中）                │
│  請至 iPhone 設定計劃            │
```

#### 計劃 sheet（tap 模板訓練 row 後）

```
┌──────────────────────────────────┐
│ ← 計劃                           │
│ ─────────────────────────────    │
│  • 通用                          │
│ ─────────────────────────────    │
│  • Linear progression W3         │
│  • PPL W5                        │
│  • PHUL W2                       │
└──────────────────────────────────┘
```

「計劃」= Program 主標籤。
- 「通用」永遠頂、有 divider 分隔
- 列當前 active programs（user 在 iPhone 設定）
- **tap「通用」→ bypass 強度 sheet、直接進 set logger**（跟 iPhone 行為一致）
- tap 其他 program → 進強度 sheet

#### 強度 sheet（per program 動態）

```
┌──────────────────────────────────┐
│ ← 強度（Linear progression）     │
│ ─────────────────────────────    │
│  • 通用                          │
│ ─────────────────────────────    │
│  • Volume day                    │
│  • Intensity day                 │
│  • Deload                        │
└──────────────────────────────────┘
```

「強度」= Program 副標籤（user 在 iPhone 預先建立）。
- 標題帶 program context `← 強度（Linear progression）`
- 「通用」永遠頂、有 divider 分隔（每個 program 強度都有此 fallback）
- 列該 program 自帶的強度副標籤
- 選擇後 → 進 set logger（D11）

### Interaction rules

#### 3 元組（模板 + 計劃 + 強度）

進 set logger 需集齊 3 元組：

| 入口 | 走過的 sheet | 3 元組來源 |
|---|---|---|
| 計劃訓練 row tap（推日 W3D1）| bypass 兩 sheet | program day spec 已含 3 元組 |
| 模板訓練 + tap「通用」計劃 | bypass 強度 sheet | 模板 / 通用 / 通用 |
| 模板訓練 + 其他 program 計劃 | 計劃 → 強度兩 sheet | 模板 / program / 強度副標籤 |

#### Sheet flow

```
Root (D8-1)
  ├─ 計劃訓練 row tap ─────────────────────┐
  └─ 模板訓練 row tap                       │
        └─ 計劃 sheet (D8-2)                │
             ├─ 「通用」tap ─────────────────┤
             └─ 其他 program tap             │
                   └─ 強度 sheet (D8-3)     │
                        └─ 任一 tap ────────┤
                                            ↓
                                       Set logger (D11)
```

#### 「今日」推算

從 active program 的當前 mesocycle 推算今日 W?D?：
- 是訓練日 → 顯示 `推日 W3D1（今日）`
- 是休息日 → 顯示 `今日休息（無訓練）`
- 無 active program → 顯示 `（無計劃進行中、請至 iPhone 設定計劃）`

#### 🔄 update icon 行為

| Trigger | Behavior |
|---|---|
| tap 🔄 | 強制 pull iPhone 最新 program/template 資料 |
| Visual | icon 旋轉 0.5s 結束、無成功/失敗訊號 |
| Post-pull | 列表自動 refresh、變動 user 自然看到（變動本身是反饋）|

#### Watch session 啟動路徑

- **Watch 獨立啟動**：通過 picker → sheet flow → set logger（α-model Watch-initiator）
- **iPhone 已啟動 session、Watch 開 app**：直接進 set logger（mirror、無中介 splash、跳過 picker）

### Excluded（不在 Watch 做）

- ❌ 空白訓練（無動作 session）— picker 沒此 option、要空白 session 必須 iPhone 啟動
- ❌ Watch 上 +動作 / +Program / +Template — 永不（per ADR-0019 既有原則、必須 iPhone 上做）
- ❌ 中介 splash「TrainingLog」LOGO — 跳過、Watch app 開即 picker
- ❌ 🔄 同步狀態 spinner / ✓ / ⚠ icon — 只有 0.5s 旋轉、不細分結果

### Decisions captured（5 輪 ASCII mock iteration log）

| 輪次 | 主要決策 |
|---|---|
| v1 | root view 初稿（template list + 空白訓練 option）|
| v2 | 計劃 / 模板兩區分隔、🔄 update icon、移除空白訓練 |
| v3 | 3 元組概念、tap 模板 → 計劃 sheet → 強度 sheet flow |
| v4 | 「無計劃」→「通用」（計劃 = Program 主標籤、強度 = 副標籤）、強度依 program 動態 |
| v5 | tap 通用 = bypass 強度 sheet、強度 sheet 也有「通用」option、休息日 / 無 program 顯示 |
