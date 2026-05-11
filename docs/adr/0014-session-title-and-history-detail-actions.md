# 0014 — Session title 模型 + 歷史頁三按鈕 + Save-back 共存 + Freestyle 升級流程

引入 `session.title TEXT NOT NULL DEFAULT ''` 欄位：Template-based session create 時 eager copy Template name，Freestyle session 起始為空字串、UI fallback「自由訓練」。session.title 是 session 的「身份 snapshot」，凍結後不隨 Template 改名動態變動（跟 ADR-0013 notes_snapshot 同 eager-copy 哲學）。

歷史詳情頁頂部加三按鈕 [儲存模板] [另存模板] [刪除本訓練]，作為「身份維度」編輯入口；既有 ADR-0002 Save-back dialog 維持，負責「內容維度」（sets/reps/weight 差異）。兩維度**正交共存**。

本 ADR 整併 Q7.1–Q7.8 全鎖定（CONTEXT.md Q7 close-out 段）；對 ADR-0013 Q5.4-A 有一處微補充（collapsed 卡 title 來源 Template name → session.title），一併固化於本 ADR。

## 設計哲學 anchor

**「內容是 sets，身份是 title；內容靠 Save-back，身份靠歷史頁三按鈕」**——兩個維度正交，分別處理：

- **內容維度** (Save-back, ADR-0002)：session 結束時若 sets/reps/weight ≠ snapshot 目標 → 跳 dialog 問「同意修改模板？」；focus on 數據差異
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

依 session 來源 + title 是否手動改過，分四種行為：

| Session 來源 | title 狀態 | 行為 |
|---|---|---|
| Template-based | 未改（= template.name） | 改 Template sets/reps/weight 內容；不改 name |
| Template-based | 手動改過（≠ template.name） | 改 sets + rename Template name = session.title + **連動所有同 name sibling 一起 rename**（不改內容）+ 繼承 Program 主副標籤；更新 Program 頁面 |
| Freestyle | session.title 已填 | 引導使用者選要覆蓋的三元組 → 改 sets + rename group（同上連動規則） |
| Freestyle | session.title = '' | 強制跳輸入框先填 session.title，再走上一條 |

**sibling rename 連動的根據**：同 name 的 sibling Templates 是獨立 entity，但 name = group identity（CONTEXT.md L55 + ADR-0002）；常設動作目標 per name 共享。改 name 時整組 sibling 都 rename 才能保 group invariant。

### 按鈕 2：「另存模板」（新建 Template entity）

引導補齊三元組 (Program, 副標籤) → 建新 Template entity，name = session.title。

**衝突偵測（Q7.5-α）**：UI 即時偵測（reactive query），若 (session.title, Program, 副標籤) 命中既有 entity → **hard block** + 提示「該組合已存在於 T_existing」+ escape button「改用『儲存模板』覆蓋既有」。

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

兩個 trigger 點正交分工：

| 機制 | trigger 點 | 處理 | 來源 |
|---|---|---|---|
| Save-back dialog | session 結束 summary | 內容差異（sets/reps/weight ≠ snapshot 目標） | ADR-0002 既有 |
| 歷史頁三按鈕 | 歷史詳情頁手動 | 身份操作（rename / 升級 freestyle / 刪除） | 本 ADR |

兩者**不互相觸發**；按了 Save-back 同意 ≠ 按了「儲存模板」（前者改 sets、後者改 name）。

使用者若同時想改內容 + 身份：session-end 走 Save-back (改 sets) → 進歷史詳情頁按「儲存模板」(rename + sibling 連動)。

## Freestyle 升級流程（細化既有 story #184）

ADR-0013 既有 story #184「freestyle session 結束時可選『存為 template』」現在透過歷史頁三按鈕實現：

1. Session create (freestyle)：`session.template_id IS NULL`、`session.title = ''`
2. In-session：tap header 填 session.title（或不填，等結束）
3. Session 結束 → Save-back dialog **不會觸發**（無 template_id 無 snapshot 目標可比）
4. 進歷史詳情頁：
   - 按「另存模板」：補齊三元組 (Program, 副標) → 建新 Template entity → `session.template_id` UPDATE 為新 id（建立關聯）
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

ADR-0013 Q5.4-A 鎖定 collapsed 卡 = (Template name + Program 主+副標 + 容量總和 + 動作數)。本 ADR 微補充：

> Collapsed 卡 title 來源從 **Template name** 改為 **session.title**。Template-based 未改時 session.title = template.name (eager copy)，視覺上等效；手動改過或 freestyle 時顯示 session.title（空 → UI fallback「自由訓練」）。

詳情頁的 notes_snapshot 顯示維持 ADR-0013 Q5.4-B 鎖定。本 ADR 在詳情頁**頂部**加三按鈕 action bar（不動既有 sets / notes 區塊）。

## 跨 Backlog 影響

- **Backlog #9 月曆視圖**：Freestyle session 在 Program 日曆顯示行為（未升級 freestyle → 非 Template 打勾）；升級流程 trigger 重新標記
- **Backlog #11 Template 編輯流程**：「另存模板補齊三元組」UI 可共用 Template 建立的 UI 元件 (Program + 副標 selector)
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
