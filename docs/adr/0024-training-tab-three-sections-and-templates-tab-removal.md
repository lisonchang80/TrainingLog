# 0024 — 「訓練」tab 三區塊重構 + Templates tab 移除（Round E 拍板）

Status: accepted (2026-05-24 Round E grill；尚未實作、預計 slice 10g 落地)

把現有 Today tab 改名為「訓練」，內含三個固定區塊：**計劃訓練 / 空白訓練 / 模板訓練**；同時砍除獨立的 Templates tab、將其 list 與 start sheet 流程移入訓練 tab 的「模板訓練」區塊。連帶移除 Today tab 的 bodyweight pre-prompt UX、改採「session 開始時自動抓 `body_metric` 最後一筆當 snapshot」+「遇到 assisted 動作且 snapshot 為 null 時強制彈窗」的 lazy-blocking pattern。

本 ADR 承接 [ADR-0019 § Q9a](./0019-session-ui-ux-integral-redesign.md) 的「Templates tab → bottom sheet」結論。**ADR-0019 § Q9a 自本 ADR 起被取代**（Templates tab entity 不再存在；bottom sheet 流程不變、只是 invocation 改在「模板訓練」區塊內）。

## Context

ADR-0019 § Q9a 拍板「Templates tab → tap → bottom sheet」之後，slice 10c 開發過程出現三個 friction：

1. **Today tab 變雙態雞肋** — 既要管 idle 入口（單一「Start Session」btn + bodyweight pre-prompt），又要管 in-session view（3198 LOC 主體）。idle 態功能弱（只 freestyle）、Templates tab 又因 dedupe-by-name 與 [+ New] 入口冗餘，整個 start UX 形成「tab 之間互相補洞」的破碎感。
2. **Bodyweight pre-prompt 卡開頭** — 每次 start session 都彈 bodyweight 輸入框、user 多數時候 skip 或填上次同樣的值。對只用 `loaded` / `bodyweight` 動作的 session 完全多餘（snapshot 只在 assisted 動作計算時用到）。
3. **Active program 今天該做什麼缺乏入口** — Programs tab 顯示整 grid，但「今天該做什麼」需要 user 自己對日期找 cell。沒有「一鍵跳到今天 plan」的捷徑。

Round E grill 走 22 個 sub-decision、user 提出激進重構方向：把 Today tab 改名「訓練」、變成 3 區塊入口 hub。

## Decision

### 1. Tab 結構

| 變動 | Before | After |
|---|---|---|
| Tab 數 | 6 (index/templates/programs/library/history/settings) | **5** (index/programs/library/history/settings) |
| index tab title | `Today` | **`訓練`（zh）/ `Training`（en），跟 i18n locale**（per ADR-0023） |
| index tab icon | `plus.circle.fill` | **`figure.run` 或 `dumbbell` (確切 SF Symbol 實作時挑)** |
| templates tab | 獨立 tab | **砍除**，所有功能移入「訓練 → 模板訓練」區塊 |
| tab 順序 | index / templates / programs / library / history / settings | **訓練 / programs / library / history / settings**（保持現有相對順序、純抽出 templates） |

### 2. 訓練 tab idle 三區塊

無 active session 時，「訓練」tab 顯示 3 個固定區塊（永遠這個順序）：

#### (a) 計劃訓練

- 顯示 active program **今天**該做的單一 template（透過 `start_date + cycle_length` 反推當前 (cycle_index, day) → `program_cell.template_id`）。
- 不顯示「未來 N 天」、不顯示「補做候選」（保持單一今天）。
- **無 active program**：顯示 empty state「沒有啟用的計劃」+ CTA → `router.push('/programs')`。
- **今天 cell = 休息 / 空白**：顯示「今天休息 💤」灰底 row、無 tap、無 CTA。

#### (b) 空白訓練

- 單一按鈕「+ 開始空白訓練」(`t('button', 'startFreestyle')` 或類似 key)。
- Tap → 直接 `createSession({ id, started_at, bodyweight_snapshot_kg })`（snapshot 取得規則見 § 3）→ 切換到 in-session view。
- 不再有 bodyweight pre-prompt 步驟。

#### (c) 模板訓練

- 整 list 攤開（無 accordion），mirror 現 Templates tab 的 `listTemplateGroupsByName` dedupe by name + scroll。
- 區塊 heading 右上角 `[+ 新建模板]` btn（mirror 現 Templates tab 慣例）。
- 模板數 = 0 → 顯示「沒有模板，點 [+ 新建] 開始建立」CTA + 隱藏 list 容器、保留 [+ New] btn。
- Tap row → 開現有 `StartTemplateSheet`（不動 sheet 本身）→ pick (program, sub_tag) → `startSessionFromTemplate` → 切換到 in-session view。
- **Sticky last-selected (program, sub_tag) 維持 GLOBAL** — 不翻盤現有 `start_dialog_last_program_id` / `start_dialog_last_sub_tag` 兩個 single key 設計。理由：code 已 ship、無 user complaint、改 per-template 成本（per-key naming + load logic + 空間隨 template 數增長）vs 收益不明顯，未來痛了再翻。

### 3. In-session view 處理（Mode switch）

當 active session 存在時，「訓練」tab 完全切換為 in-session view（mirror 現行 mode switch behaviour）。3 區塊在 in-session 期間隱藏、不顯示頁首 strip、不另開 `/session/[id]` 獨立路由。

理由：
- 與現行 Today tab 一致、改動最小。
- 雙重 UI（3 區塊 strip + in-session 主體）容易混淆、且 in-session 期間 3 區塊已無意義（user 不會中途換 template）。
- 拆獨立 route 會牽動 ADR-0019 § Q10 詳情頁編輯模式邏輯、scope 太大。

### 4. Bodyweight snapshot：Model E + 補丁

#### 寫入時機

```
session 開始時 (createSession / startSessionFromTemplate):
  bodyweight_snapshot_kg = listBodyMetrics(db).at(0)?.bodyweight_kg ?? null
  -- 無時效性限制；永遠拿最後一筆（哪怕 6 個月前）
```

#### Assisted 動作彈窗（補丁）

當 user 在 active session 透過 `appendSessionExercise` 加入動作時：
```
if (exercise.load_type === 'assisted' && session.bodyweight_snapshot_kg == null) {
  → 彈 modal「請先輸入體重」+ TextInput + [儲存]
  → 拒填無 Cancel option (block-only)；user 唯一出路 = 填值
  → 填值後：
    - update session.bodyweight_snapshot_kg
    - insert body_metric { recorded_at: now, bodyweight_kg, pbf:null, smm_kg:null }
    - 完成 appendSessionExercise
}
```

#### 不彈情境

- Session.bodyweight_snapshot_kg 已有值 → 不再彈（snapshot semantic = session 開始時體重、全程不變）。
- 同 session 後續第 2、3... 個 assisted exercise → 不彈（snapshot 已填、條件不成立）。
- 非 assisted 動作（`loaded` / `bodyweight`）→ 永不彈、bodyweight 不影響計算。

#### Trigger 點

`appendSessionExercise` 那一刻（**不是** 第一次 `[+ Set]`）。理由：早期 block 比晚期準、user 還沒投入 set log 時打斷成本最低。

### 5. Settings tab 新增「體重」row

目前 Settings tab 無 bodyweight 入口（只有單位 / rest timer / 語言）。本 ADR 新增：

- 「體重」row（位置：單位偏好之下、rest timer 之上、實作時最終排序待定）。
- Tap → mini sheet：1 個 TextInput（kg/lb 依 unit preference）+ [儲存] btn。
- 儲存 → `insertBodyMetric(db, { recorded_at: now, bodyweight_kg, pbf:null, smm_kg:null })`。
- **不負責 history list / delete** — 既有的 body-trend chart 在 idle screen 區（slice 4）保留 read-only 顯示，CRUD 仍走原路徑。

### 6. 程式碼結構

- 抽 shared component `components/training/template-list-section.tsx`（包 list + sheet state + onStart + sticky load/save）— 避免 `app/(tabs)/index.tsx` 從 3198 LOC 膨脹到 ~3800+。
- `app/(tabs)/templates.tsx` 整檔刪除。
- `app/(tabs)/_layout.tsx` 移除 templates `<Tabs.Screen>` entry。

### 7. 實作 phasing（Slice 10g）

獨立 slice、跨 lifecycle bundle（slice 10e）解耦、可在 slice 10c–f 主路徑完成後並行 ship。預估 5-6 commit：

1. 抽 `<TemplateListSection>` shared component（拷貝 templates.tsx 邏輯不動）。
2. `app/(tabs)/index.tsx` idle 區改成 3 區塊 layout（含「計劃訓練」today resolver + 「空白訓練」btn + 嵌入 `<TemplateListSection>`）。
3. `_layout.tsx` 改 tab name + icon + 砍 templates entry；刪 `templates.tsx` file。
4. Settings 「體重」row + mini sheet。
5. `appendSessionExercise` assisted 彈窗 + session start snapshot auto-pull。
6. 移除 Today pre-prompt + 相關 state + body_metric 寫入 path (`onConfirmPrePrompt` 整個砍)。

## Reversed / superseded decisions

| 文件 | 段落 | 取代內容 |
|---|---|---|
| ADR-0019 | § Q9a | Templates tab entity 不再存在；「Templates tab → tap → bottom sheet」變成「訓練 tab → 模板訓練區塊 → tap → bottom sheet」（sheet component 與 logic 不動） |
| ADR-0019 | § Q9.1a sticky scope 預設值 | 維持 global single key 不變（plan stale-default 曾推 per-template、被本 ADR 否決） |
| 既有 Today tab pre-prompt | `prePromptVisible / preBwInput / onConfirmPrePrompt` | 整段砍除；bodyweight 抓取改 lazy auto-pull |

## Alternatives considered

- **In-session view 拆獨立 `/session/[id]` 路由**：被否決，理由：scope 過大、會牽動 ADR-0019 Q10 詳情頁編輯模式。
- **Bodyweight Lazy model（snapshot 開始為 null、整段延後）**：被否決，理由：snapshot semantic 漂移、彈窗時機更難解釋。
- **彈窗加 Skip btn**：被否決，理由：assisted 計算 silently 不準是 bad UX。
- **Bodyweight 時效性限制（7/14/30 天）**：被否決，user 選「無限制、永遠拿最後一筆」。
- **Sticky 改 per-template-name**：被否決（stale-plan-default），維持現 global。

## Consequences

- ADR-0019 § Q9a 內容 deprecated；後續修訂需 cross-reference 到本 ADR。
- `app/(tabs)/templates.tsx` 砍檔之後，所有 router refs（grep 確認過：0 個外部 push 到 `/templates`）不破。
- `body_metric` 表使用模式改變：原本 user 主動填（pre-prompt 與 inline UI），現在改 (a) Settings 主動填 + (b) assisted modal 被動補。`listBodyMetrics` 仍是唯一 read 路徑、無 schema 改動。
- `bodyweight_snapshot_kg` 欄位語意微調：原本「session 開始時 user 確認的體重」，現在「session 開始時 system 自動 snapshot 的 latest body_metric」。對 historical session 不影響（既有 row 已 freeze）。
- 增 1 個新測試面向：assisted 彈窗 block + insertBodyMetric round-trip + snapshot auto-pull invariant。

## References

- [ADR-0019 § Q9a](./0019-session-ui-ux-integral-redesign.md) — Templates tab → sheet（被本 ADR 取代）
- [ADR-0007](./0007-load-type-taxonomy-and-bodyweight-asymmetry.md) — `load_type = 'assisted'` 為何需要 bodyweight
- [ADR-0014](./0014-session-title-and-history-detail-actions.md) — bodyweight snapshot 抓取 invariant
- [ADR-0023](./0023-i18n-locale-resolution-and-persistence.md) — tab title i18n
- 設計 plan: `docs/design/2026-05-24-set-logger-implementation-plan.md` § Round E
- Grill round transcript: `slice/10c-set-logger-and-menu` 2026-05-24 對話
