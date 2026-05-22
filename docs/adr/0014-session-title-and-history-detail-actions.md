# 0014 — Session title 模型 + 歷史頁三按鈕 + Save-back 共存 + Freestyle 升級流程

引入 `session.title TEXT NOT NULL DEFAULT ''` 欄位：Template-based session create 時 eager copy Template name，Freestyle session 起始為空字串、UI fallback「自由訓練」。session.title 是 session 的「身份 snapshot」，凍結後不隨 Template 改名動態變動（跟 ADR-0013 notes_snapshot 同 eager-copy 哲學）。

歷史詳情頁頂部加三按鈕 [儲存模板] [另存模板] [刪除本訓練]，作為「身份維度」編輯入口；既有 ADR-0002 Save-back dialog 維持，負責「內容維度」（sets/reps/weight 差異）。兩維度**正交共存**。（**2026-05-16 Q9/Q10 修訂**：Save-back 範圍由「僅 sets/reps/weight 差異」**擴展為任何 in-session 修改 vs snapshot**（diff scope 涵蓋 set count / set_kind / set_position / 加刪換動作 / cluster 加刪 / rest_sec；不含 exercise.notes / session.title）。見 ADR-0019 § Q9 + 本文末 amendment）

本 ADR 整併 Q7.1–Q7.8 全鎖定（CONTEXT.md Q7 close-out 段）；對 ADR-0013 Q5.4-A 有一處微補充（collapsed 卡 title 來源 Template name → session.title），一併固化於本 ADR。

## 設計哲學 anchor

**「內容是 sets，身份是 title；內容靠 Save-back，身份靠歷史頁三按鈕」**——兩個維度正交，分別處理：

- **內容維度** (Save-back, ADR-0002)：session 結束時若 sets/reps/weight ≠ snapshot 目標 → 跳 dialog 問「同意修改模板？」；focus on 數據差異（**2026-05-16 Q9 修訂**：「sets/reps/weight ≠ snapshot」**改為**「任何 in-session 修改 vs snapshot」；Template-based 有 diff → 3-option dialog（儲存/另存/否）/ 無 diff → 直接 finish 無 dialog。見 ADR-0019 § Q9d）
- **身份維度** (本 ADR)：session.title 隨時可改 (in-session header tap-to-edit / 歷史頁編輯)；歷史詳情頁三按鈕負責 rename Template name / 新建 Template / 刪除本場

session.title 是「我這場叫什麼」的字串身份，跟 sets 數值正交。混在一起會破壞單一職責；分開後 trigger 點清晰、語意單一。

## Schema model（最關鍵）

```sql
-- v010 累加變動（接續 ADR-0013 v009）
ALTER TABLE session ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Backfill：Template-based 取 template.name；freestyle 留 ''
UPDATE session
   SET title = COALESCE(
     (SELECT name FROM template WHERE id = session.template_id),
     ''
   );
```

| 欄位 | 表 | 性質 | 寫入規則 |
|---|---|---|---|
| `title` | `session` | mutable，frozen-on-create | Template-based: session create 時複製 template.name；Freestyle: 起始 ''；之後使用者可任改（in-session / 歷史頁） |

`title` 一旦 set，**不會因為對應 Template 改名而自動同步**——這是 eager copy 哲學：歷史是固化的，Template 改名只影響未來新 session，不回溯歷史。

## session.title 生命週期

| 階段 | 行為 |
|---|---|
| Session create (Template-based) | 複製 template.name → session.title |
| Session create (Freestyle) | session.title = '' |
| In-session | timer header 顯示 session.title (空時 UI fallback「自由訓練」)；tap header → 編輯框 → UPDATE session.title (隨時可改、無 draft) |
| Session 完成 | session.title 已 frozen；後續 Template 改名不回溯影響 |
| 歷史頁 collapsed 卡 | 顯示 session.title (空時 UI fallback「自由訓練」)；ADR-0013 Q5.4-A 微補充 |
| 歷史詳情頁 | 頂部三按鈕入口（見下） |

## 歷史詳情頁三按鈕

### 按鈕 1：「儲存模板」（覆蓋既有 Template + sibling rename 連動）

> **2026-05-18 wave 12 修訂**：4-branch 收斂為 silent overwrite linked template（無 diff prompt / 無 sibling rename）；Freestyle 升級改走「另存模板」(TemplateMetaSheet)。詳見 ADR-0019 翻盤 ledger 2026-05-18 row。

依 session 來源 + title 是否手動改過，分四種行為：

| Session 來源 | title 狀態 | 行為 |
|---|---|---|
| Template-based | 未改（= template.name） | 改 Template sets/reps/weight 內容；不改 name |
| Template-based | 手動改過（≠ template.name） | 改 sets + rename Template name = session.title + **連動所有同 name sibling 一起 rename**（不改內容）+ 繼承週期 · 強度（原 Program 主副標籤）；更新 Program 頁面 |
| Freestyle | session.title 已填 | 引導使用者選要覆蓋的三元組 → 改 sets + rename group（同上連動規則） |
| Freestyle | session.title = '' | 強制跳輸入框先填 session.title，再走上一條 |

**sibling rename 連動的根據**：同 name 的 sibling Templates 是獨立 entity，但 name = group identity（CONTEXT.md L55 + ADR-0002）；常設動作目標 per name 共享。改 name 時整組 sibling 都 rename 才能保 group invariant。

### 按鈕 2：「另存模板」（新建 Template entity）

引導補齊三元組 (週期, 強度)（原 (Program, 副標籤)） → 建新 Template entity，name = session.title。

**衝突偵測（Q7.5-α）**：UI 即時偵測（reactive query），若 (session.title, 週期, 強度)（原 (session.title, Program, 副標籤)） 命中既有 entity → **hard block** + 提示「該組合已存在於 T_existing」+ escape button「改用『儲存模板』覆蓋既有」。

跟 Program 起始日期 overlap 的「hard block + smart suggest」（ADR-0002）一致 UX 風格。

### 按鈕 3：「刪除本訓練」（hard delete + 確認 dialog）

按鈕 → 「確定刪除？無法復原」dialog → 確認 → `DELETE FROM session WHERE id=?` + CASCADE（`session_exercise` + `set` + `notes_snapshot`）。

連動 reactive 重算：
- **PR**（slice 8 engine）：該 session 內 PR 撤掉，重算各 bucket 最高
- **統計頁 / 容量 / 趨勢圖**：自然 reactive，刪了不在 query 結果
- **月曆**（Backlog #9）：該日不再標 Template 打勾

**不做**：soft delete / 垃圾桶 / undo —— v1 不過度設計，dialog 已是 safety net；trash table 是 v1.5+ escalation。

**Flagged**：HKWorkout 那筆 v1 不主動刪（HealthKit 保留）；iPhone DB 與 HealthKit 一致性是**已知不一致**（記入 Flagged ambiguities）。

**邏輯一致性 sanity check（跟 ADR-0012 set logger 對照）**：Q15 set logger 鎖定「無二次確認」是因為**單筆 set 可立刻 redo**（再記一遍 30 秒）；session 級刪除**不可 redo**（PR / 統計 / 月曆 / 1-2 hr 的記錄全沒了），所以這裡需要 confirmation；friction 與不可逆性匹配。

## Save-back 共存（跟 ADR-0002 分工）

> **2026-05-18 wave 12 修訂**：Save-back dialog 整題砍除、Save-back domain/repo/screen pipeline 退場；模板入口移至詳情頁 sticky 4-button bar。詳見 ADR-0019 翻盤 ledger 2026-05-18 row。

兩個 trigger 點正交分工：

| 機制 | trigger 點 | 處理 | 來源 |
|---|---|---|---|
| Save-back dialog | session 結束 summary | 內容差異（sets/reps/weight ≠ snapshot 目標）（**2026-05-16 Q9 修訂**：範圍擴展到任何 in-session 修改 vs snapshot，含 set count / set_kind / set_position / 加刪 / 換 / cluster / rest_sec；exercise.notes + session.title 不算 diff。見 ADR-0019 § Q9） | ADR-0002 既有 |
| 歷史頁三按鈕 | 歷史詳情頁手動 | 身份操作（rename / 升級 freestyle / 刪除） | 本 ADR |

兩者**不互相觸發**；按了 Save-back 同意 ≠ 按了「儲存模板」（前者改 sets、後者改 name）。（**2026-05-16 Q9 修訂**：「前者改 sets、後者改 name」描述失準 — Save-back 範圍擴展為任何 in-session 修改（含 cluster 加刪 / rest_sec 等），不只 sets；「身份維度」三按鈕仍只改 title / template_id linkage。差異化以「session-end 自動 prompt」vs「歷史頁手動編輯」為界、不以欄位類別為界。見 ADR-0019 § Q9）

使用者若同時想改內容 + 身份：session-end 走 Save-back (改 sets) → 進歷史詳情頁按「儲存模板」(rename + sibling 連動)。

## Freestyle 升級流程（細化既有 story #184）

ADR-0013 既有 story #184「freestyle session 結束時可選『存為 template』」現在透過歷史頁三按鈕實現：

1. Session create (freestyle)：`session.template_id IS NULL`、`session.title = ''`
2. In-session：tap header 填 session.title（或不填，等結束）
3. Session 結束 → Save-back dialog **不會觸發**（無 template_id 無 snapshot 目標可比）（**2026-05-16 Q9 修訂**：Freestyle session 結束改為跳 **2-option dialog（儲存 / 否）**，「儲存」走「另存模板」same flow 即時升級為 Template entity；歷史詳情頁三按鈕路徑仍保留作為補升級入口。見 ADR-0019 § Q9）
4. 進歷史詳情頁：
   - 按「另存模板」：補齊三元組 (週期, 強度)（原 (Program, 副標)） → 建新 Template entity → `session.template_id` UPDATE 為新 id（建立關聯）
   - 按「儲存模板」：引導選要覆蓋的三元組 → 同 group rename (Q7.3-A) + 內容覆蓋

**Program 日曆顯示**：
- 升級前（freestyle `session.template_id IS NULL`）：該日在 Program 日曆**非**正確 Template 打勾（只有「該日有 session」標記）
- 升級後（`session.template_id` = 新 id）：該日按對應 Template 打勾

具體 Program 日曆顯示行為 **defer 到 Backlog #9 月曆視圖 grill** 統一處理（記入 Flagged ambiguities）。

## In-session 編輯入口

`timer header` 顯示 session.title（空 → UI fallback「自由訓練」），tap header → 編輯框 → UPDATE session.title。

- 隨時可改，無 draft staging（跟 ADR-0013 notes 編輯同 in-place pattern）
- 編輯**不觸發**任何 dialog / Save-back / sibling 連動（改 session.title 而已）
- 即時 UPDATE，無 commit/cancel 雙態

跟 ADR-0012 set logger 哲學一致：「Session 在運動中編輯，要快速、即時 → 摩擦極力消除」。

## 歷史頁顯示（ADR-0013 Q5.4-A 微補充）

ADR-0013 Q5.4-A 鎖定 collapsed 卡 = (Template name + 週期 · 強度（原 Program 主+副標） + 容量總和 + 動作數)。本 ADR 微補充：

> Collapsed 卡 title 來源從 **Template name** 改為 **session.title**。Template-based 未改時 session.title = template.name (eager copy)，視覺上等效；手動改過或 freestyle 時顯示 session.title（空 → UI fallback「自由訓練」）。

詳情頁的 notes_snapshot 顯示維持 ADR-0013 Q5.4-B 鎖定。本 ADR 在詳情頁**頂部**加三按鈕 action bar（不動既有 sets / notes 區塊）。

## 跨 Backlog 影響

- **Backlog #9 月曆視圖**：Freestyle session 在 Program 日曆顯示行為（未升級 freestyle → 非 Template 打勾）；升級流程 trigger 重新標記
- **Backlog #11 Template 編輯流程**：「另存模板補齊三元組」UI 可共用 Template 建立的 UI 元件 (週期 + 強度 selector)（原 Program + 副標 selector）
- **ADR-0013 Q5.4-A**：collapsed 卡 title 來源微 amendment（本 ADR cross-link）

## 拒絕的替代方案

- **Q7.1=A**（廢 Save-back dialog 改全部歷史頁觸發）：失去「趁熱問」UX；單一入口語意不分
- **Q7.1=C**（Save-back 退役為快捷入口跳轉歷史頁）：多一跳；session-end 失去一鍵儲存
- **Q7.1=D**（歷史頁三按鈕只是事後補救）：邏輯曖昧
- **Q7.2=β**（lazy derive NULL = fallback Template name）：跟 Q5.1c-α (notes_snapshot eager) 哲學不一致；freestyle case 變混合行為；歷史頁要 JOIN Template 表
- **Q7.3=B**（只 rename 本 sibling、不連動）：sibling group 脫鉤、常設動作目標分裂；違反「name = group identity」
- **Q7.3=C**（跳 dialog 問範圍）：多 friction；A 已足夠
- **Q7.3=D**（預設只 rename 本 + 警告脫鉤）：心智複雜化
- **Q7.4=a**（空字串 + 沒 fallback）：「儲存模板」按下時 Template name = '' 會崩
- **Q7.4=b/c**（預填「Freestyle 2026-05-11」/「未命名訓練」）：使用者要 rename 才能升級為 Template；醜陋 default
- **Q7.4=d**（強制要使用者先填才能開 freestyle）：違反「freestyle = 想到就開」精神
- **Q7.5=β**（按 confirm 才檢測）：UX 較差；早期攔截更好
- **Q7.5=γ**（純拒絕、不提供 escape）：使用者意圖若是覆蓋，要回退
- **Q7.5=δ**（自動轉「儲存模板」）：自動換語意、使用者不察覺
- **Q7.6=b**（soft delete + `is_deleted` flag）：schema 多欄位；query 全要過濾條件；rows 累積；垃圾桶 UI 變新 feature
- **Q7.6=c**（30 天垃圾桶 trash table）：過度設計；v1.5+ 再考慮
- **Q7.6=d**（hard delete 無 dialog）：不可 redo 操作沒 safety net 太危險
- **Q7.7=a**（in-session 不可改 title）：freestyle 起始「自由訓練」一直頂到結束才能命名；Template-based 想 mid-session 分歧也得等
- **Q7.7=c**（只 freestyle 可改 / Template-based 鎖死）：邏輯分歧；增加心智負擔
- **Q7.7=d**（in-session 可改 + 結束跳確認 dialog）：friction 增加；Save-back dialog 已多
- **Q7.8=b**（全 backfill 空字串）：Template-based 歷史 session 顯示「自由訓練」混淆
- **Q7.8=c**（全 backfill 「歷史訓練」）：語意更弱

## v1 slice 影響

- **Slice 4 (Save-back)**：不變（既有 ADR-0002 行為保留）
- **Slice 3 (templateManager)**：多 `saveTemplate` / `saveAsTemplate` / `siblingRename` / 衝突偵測 entry point
- **Slice 8 (PR engine)**：不變；session delete 後自動 reactive 重算
- **Slice 9 (歷史 sub-tab)**：範圍擴大 — collapsed 卡 title 來源改 + 詳情頁三按鈕入口 + delete confirm dialog
- **In-session UI (slice ?)**：加 timer header tap-to-edit session.title
- **v010 migration**：加 1 欄位 + COALESCE backfill；無 transform

v1 ship 26 週時程：估 +0.5-1 週工作量（UI 主、邏輯部分多複用既有 saveBackDiff），落在原 slice 9 範圍內，不延期。

## 與既有 PRD User Story 的對應

**Refine 既有**：
- **#184** freestyle 存為 template → 細化為「歷史詳情頁三按鈕路徑」（本 ADR）
- **#191** 歷史頁 collapsed 卡 = Template name → 改為 session.title（ADR-0013 Q5.4-A 微補充）

**新增 stories #194-#207（14 條）**：
- session.title schema + v010 migration + backfill
- Template-based session.title 預設 = Template name (eager copy)
- Freestyle session.title 預設 '' + UI fallback「自由訓練」
- In-session header tap-to-edit session.title
- 歷史詳情頁頂部三按鈕入口
- 「儲存模板」case 1a: Template-based, title 未改 → 改 sets
- 「儲存模板」case 1b: Template-based, title 改過 → rename + sibling 連動
- 「儲存模板」case 2: Freestyle → 引導選三元組 + rename group
- 「另存模板」UI 即時衝突偵測 + hard block + escape
- 「另存模板」: 新建 entity + 補齊三元組 + Program 頁面更新
- 「刪除本訓練」hard delete + 確認 dialog + PR 重算
- 升級 Template 按鈕按下時 session.title='' 強制填
- 歷史 collapsed 卡 title 來源 Template name → session.title（ADR-0013 Q5.4-A 微 amendment）
- Save-back dialog vs 三按鈕正交共存的 sanity check（教學文案，可選）

## 2026-05-12 Amendment — 詳情頁 layout 擴充（prototype review）

原 Q7 close-out 鎖定的「三按鈕 + 既有 sets / notes 區塊」之上，於原型 review 過程確認以下補充：

### 按鈕：三 → 四

最終 action bar 順序（左到右）：

| 按鈕 | 目的 |
|---|---|
| **編輯訓練** | 進入逐組編輯模式，修改 weight/reps/動作清單，**僅影響本場**（不寫回 Template）|
| 儲存模板 | 同原 Q7：覆蓋既有 Template（含 sibling rename 連動）|
| 另存模板 | 同原 Q7：建新 Template entity |
| **刪除訓練** | 同原 Q7 按鈕 3，文字 rename（「刪除本訓練」→「刪除訓練」）|

「編輯訓練」**內容維度**入口；跟「儲存模板/另存模板」（身份維度）正交：本場只改自己 vs 寫回模板 group。跟 ADR-0002 Save-back dialog（session 結束時觸發）正交分工：

- Save-back dialog = session 結束 summary 自動 prompt 改 Template
- 編輯訓練 = 歷史頁手動進編輯態（本場 only）
- 儲存模板 = 歷史頁手動 rename Template + sibling 連動

### 詳情頁頂部新增 stats panel

標題之下、動作卡之上插入 4-tile stats row。**每 tile 2 行**：大字（value）`numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}` 防換行、小字（label / sub-detail）一行：

| Tile | 大字（value） | 小字（label） | 條件 |
|---|---|---|---|
| 訓練時間 | `H 小時 M 分鐘` | `HH:MM~HH:MM` | 永遠顯示（duration 格式本身已隱含「訓練時間」語意，省略 explicit label）|
| 容量 | `kg 整數`（依 ADR-0015 round 規則） | `容量 (kg)` | 永遠顯示 |
| 動作數 | 整數 | `動作數` | 永遠顯示 |
| 大卡 | 整數 | `大卡` | **僅 Watch-tracked session 顯示** |

### Watch-tracked session 額外區塊：心率訓練區間（折線圖）

stats panel 之下、動作卡之上條件式顯示：

- **標題列**：`心率訓練區間` + 右側 `min–max BPM · 平均 N`
- **折線圖**：x 軸 = 相對訓練時間 (0:00 → duration)、y 軸 = BPM（左側 max / avg / min 三個 tick）
- **平均紅虛線**：水平虛線標示 avg
- **線段分色**（**5 區段，綠 → 紅**，閾值來自 Apple Watch app「體能訓練 → 心率」設定）：

| 區間 | BPM（示例：max HR 184） | 色 |
|---|---|---|
| Z1 Recovery | < 140 | `#A7F0BA` 淡綠 |
| Z2 Easy | 141–151 | `#34C759` 綠 |
| Z3 Tempo | 152–161 | `#FFCC00` 黃 |
| Z4 Threshold | 162–172 | `#FF9500` 橘 |
| Z5 Max | ≥ 173 | `#FF3B30` 紅 |

線段色取相鄰兩點的平均落在哪區決定。
- **下方 legend**：5 色 swatch + `Z<N> <range>` label
- 取樣密度 ≈ 1 sample/min（30–90 samples 區間，超出則限頂）
- **僅 Watch-tracked session 顯示**（slice 11+ HealthKit landed 後生效；之前的 session 一律無此區塊；HR 資料來源 `HKQuantityTypeIdentifierHeartRate` 透過 `HKWorkout` association）
- **閾值來源** (slice 11+)：讀使用者 Watch app「體能訓練 → 心率 → 自動/手動」設定，自動模式用 HR reserve 公式（Karvonen）= `rest + (max - rest) × {0.5, 0.6, 0.7, 0.8, 0.9}`；手動模式直接讀使用者覆寫的 5 個區間值。HealthKit 介接優先順序：先嘗試 `HKQuantityTypeIdentifierHeartRate` + `restingHeartRate` + max HR（從 workout 計算或設定值）→ 算 Karvonen；若 user 在 Watch 設手動值，從 NSUserDefaults Watch sync 或 HealthKit metadata 取得（具體 API 未定，slice 11 確認）。Prototype 用 hardcode 閾值（140 / 152 / 162 / 173）對應截圖中 max=184/rest=78 的示例值。

### Header back btn 文字

「‹ 回月曆」→ 「**‹ 返回**」（不寫死目的地語意，因為 user 可能從表列 view 進入）。

### 週期 · 強度 標題顯示（原「Program 主標題顯示」）

標題附近顯示 **`週期 · 強度`** 合併一行（原 `Program 主標題 · Program 副標`；如 `5x5 強度週 · 10-12RM`）。Freestyle session 無週期時不顯示這一行。（**2026-05-16 Q9.2 rename**：Program 主標 → 週期 / Program 副標 → 強度 / 無 Program → 無。見 ADR-0003 amendment + ADR-0019 § Q9.2）

---

## 2026-05-16 Amendment — Save-back 範圍擴展 + Freestyle finish dialog + 歷史頁 layout (ADR-0019 § Q9/Q10)

Session UI/UX integral redesign grill 拍板 Save-back 範圍擴展、Freestyle finish dialog 新增、歷史詳情頁 layout 砍 3 段統一動作清單。

### 翻盤的既有拍板

- ❌ **§ Save-back 共存 line 92-93「內容差異（sets/reps/weight ≠ snapshot 目標）」範圍擴展** — 改為「任何 in-session 修改 vs snapshot」，涵蓋 set count / reps / weight / is_logged / set_kind / set_position / 加動作 / 刪動作 / 換動作 / cluster 加入 / cluster 刪除 / rest_sec；**例外**：`exercise.notes`（全局，編輯 = 即時 UPDATE 跟 session 沒掛勾，不算 diff）/ `session.title`（身份維度，由歷史頁三按鈕處理，不算 diff）
- ❌ **§ Freestyle 升級流程 line 106「Session 結束 → Save-back dialog 不會觸發」retract** — Freestyle session 結束改為跳 **2-option dialog（儲存 / 否）**，「儲存」走 ADR-0014「另存模板」same flow 即時升級為 Template entity（補齊三元組 + reactive 衝突偵測 + hard block + escape）
- ❌ **歷史詳情頁既有「3 段 collapsed 結構」（Per exercise / 超級組 / All sets）retract** — 改為 HU1 統一動作清單：依 `ordering ASC` solo + cluster inline 混排（ADR-0018 v014 schema 已能直接還原 cluster 結構）

### 新增 — Finish 路徑差異化

| Session 來源 | Finish 行為 |
|---|---|
| **Template-based**（`template_id NOT NULL`）| **無 diff** → 直接 finish 無 dialog；**有 diff** → 跳 **3-option dialog**：(a) 儲存（覆寫 template，本 ADR 既有 flow + sibling rename 連動）/ (b) 另存（新建 Template entity，本 ADR 既有 flow）/ (c) 否（本場保留實際數據、template 目標不動）|
| **Freestyle**（`template_id IS NULL`）| 永遠跳 **2-option dialog**：(a) 儲存 = 新建 Template entity（同本 ADR「另存模板」flow）/ (b) 否（session 留為 freestyle，可由歷史頁三按鈕補升級）|

### 新增 — 歷史詳情頁 layout 細節

- **HU1** — 砍 3 段統一「動作清單」（依 `ordering ASC` solo + cluster inline 混排）
- **HV1** — 動作清單**全 expanded default**（歷史頁是 read mode；不沿用 in-session only-one-expanded 模型）
- **HE1** — `[編輯訓練]` btn = 整頁進編輯模式（卡片 inline edit + header `[✓ 完成編輯]` exit btn + in-session 同款 row gesture 生效）

### 不動

- 4-button action bar `[編輯訓練][儲存模板][另存模板][刪除]` 維持（per 2026-05-12 Amendment）
- 4-tile stats panel + 心率 vs 時間折線圖維持（per 2026-05-12 Amendment）
- session.title eager copy 哲學維持
- 「儲存模板 / 另存模板 / 刪除本訓練」三按鈕語意維持（per Q7.3 / Q7.5 / Q7.6）

詳細決策邏輯與拒絕的替代方案見 ADR-0019 § Q9 / § Q10。
