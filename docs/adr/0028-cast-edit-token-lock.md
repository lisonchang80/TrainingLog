# 0028 — Cast 編輯鎖（edit-token mutual-exclusion lock）：放棄同時雙向編輯

Status: accepted (2026-06-28 grill)

Supersedes：cast / 投影 session 的「**iPhone↔Watch 同時雙向編輯**」模型（該模型從未獨立成 ADR，散落在 `docs/slice-13d-sync-phase-bc-plan.md` Phase B/C + skill `reverse-sync-apply-surfaces` + ADR-0019 § 2026-06-24 反向同步 ledger row）。本 ADR 不動 ADR-0019 的 **start / end 雙向 initiator 協定**與 **live-mirror 傳輸層**（那兩層保留並重用）；只廢止「兩端可同時對同一 active session 做結構性編輯」這條。

## Context

「投影（cast）」= iPhone 持有一個 active session、把它推到配對的 Apple Watch，讓兩端都能看到並編輯同一場訓練。原始實作讓 **forward（Watch→iPhone live-mirror）** 與 **reverse（iPhone→Watch `applyRemoteSnapshot` overlay）** 兩個方向**同時常開**：任一端編輯 → 推給另一端套用。

2026-06-26～06-28 的多輪實機 smoke 證明這個模型**本質脆弱**：

- 兩端各有獨立的非同步 actor（Watch overlay + 280ms debounced forward producer + reverse apply；iPhone atomic SQLite write + reverse producer + inbound reconcile），對同一筆資料的並發寫入會 echo / ping-pong。
- 我們逐一修了 4+ 個競態（added-set freeze、`ADD-<counter>` 跨 session 撞號 dup、set_kind 無 provenance 回彈、rapid-tap orphan dropset、加組重複、＃彈回、連點孤兒 dropset），每修一個就冒出下一個——典型「打地鼠」。修法（id-first 比對、provenance trio、`ADD-<UUID>`、dropset 鏈 heal）都正確且保留，但**只要兩端能同時編輯，新競態的生成速度就追不完**。
- 根因不是任何單一 bug，而是**架構允許對同一可變狀態的無協調並發結構編輯**。連點（rapid-tap）切換 #/熱/遞減時最容易觸發，因為它在 debounce 窗內塞入多筆互相打架的 op。

使用者拍板：**放棄同時雙向同步，改為單向 + 互斥編輯鎖**——「一方動作時，另一方出現鎖定視窗；在按下解除鎖定後，確保已經更新，並立即鎖定另一方。」

## Decision

導入一個邏輯上的 **編輯權（edit token）**。任一時刻在 cast pairing 中，{iPhone, Watch} 恰有一方是 **持有方（holder）**——可編輯、並單向把 live-mirror 推給對方；另一方是 **鎖定方（locked）**——唯讀即時鏡像 + 鎖定蓋層 + 解鎖鈕。**競態類別由構造消除**：鎖定方不產生編輯，所以同方向只有一條資料流，不會 echo / ping-pong。

### 核心不變量

- **INV-1（互斥）**：任一時刻至多一方為 holder。交接過程的「雙方暫時皆非 holder」允許（雙方都不能編輯＝安全）；「雙方同時 holder」永不允許（穩態）。
- **INV-2（epoch 單調）**：編輯權帶一個單調遞增的**世代號（token epoch）**。每次成功交接 epoch +1。任一端收到 epoch < 自己已知值的鎖訊息／鏡像一律丟棄；收到 epoch > 自己 → 視為「已被取代」，立即降為 locked 並採用該 epoch（萬用 self-heal / 強制奪取偵測）。
- **INV-3（方向跟隨持有方）**：live-mirror 只在 holder→locked 方向流動。鎖定方永不送 forward mirror。
- **INV-4（僅限 cast）**：鎖只在 cast pairing 存在時成立。沒被投影的單機 session 無鎖、正常編輯。

### 狀態機（每端）

```
UNPAIRED ──(本端發起 cast / 收到 cast)──▶ HOLDER 或 LOCKED
HOLDER   ──(收到對方 lock-request)──▶ OFFERING ──(收到 ack)──▶ LOCKED
HOLDER   ──(收到 epoch> 自己的任何訊息)──▶ LOCKED        // 被強制奪取/被取代
OFFERING ──(ack 逾時)──▶ HOLDER                          // 交接失敗、收回，編輯重啟
LOCKED   ──(使用者按解鎖)──▶ REQUESTING                  // 送 lock-request、起計時
REQUESTING ─(收到 lock-grant)─▶ HOLDER（送 ack）          // 正常交接完成
REQUESTING ─(逾時)─▶ 對話：強制奪取→HOLDER ／ 保留鎖定→LOCKED
LOCKED   ──(收到 holder 的 mirror，epoch==)──▶ LOCKED（套用唯讀鏡像）
任一狀態 ──(end-session)──▶ UNPAIRED
```

- **發起方初握（Q1）**：iPhone 投影時，iPhone 即 HOLDER（epoch=E0）、Watch 即 LOCKED（epoch=E0，由 cast-session payload 帶下來）。cast 一發出 Watch 就顯示鎖定蓋層。
- **OFFERING**：holder 收到 lock-request 後的過渡態——**立即停止接受新編輯**（顯示「交接中…」），flush 最終 snapshot 給 requester（確保對方已更新），送 grant 後等 ack。
- **只有 LOCKED 端有解鎖鈕**；HOLDER 端只顯示「對方鎖定中／你正在編輯」指示、無按鈕。因此任一時刻只有一方能發起交接 → **同時解鎖的碰撞由構造不可能發生**（Q1 的「解鎖才奪取」）。

### 3 步交握（token 交接，Q2）

鎖定方 B 想拿走目前由 A 持有的 token（A.epoch = E）：

1. **B → A：`lock-request{epoch:E}`**。B 進 REQUESTING、顯示「取得編輯權中…」、起 `REQUEST_TIMEOUT_MS` 計時。
2. **A 收到 request**：若 `request.epoch == A.epoch` → A flush 最終 snapshot、送 **`lock-grant{epoch:E+1, snapshot}`**、進 OFFERING（仍持 E、編輯停、起 `ACK_TIMEOUT_MS` 計時）。若 `request.epoch < A.epoch`（stale）→ 回 `lock-sync{epoch:A.epoch, snapshot}` 把 B 重新鎖在現世代。
3. **B 收到 grant**：套用 snapshot（確保已更新）、進 HOLDER(E+1)、**送 `lock-ack{epoch:E+1}`**、取消計時。
4. **A 收到 ack**：進 LOCKED(E+1)。完成（A 鎖定、B 持有，互斥成立）。

容錯：
- **A 的 ack 逾時**（grant 丟失或 ack 丟失，A 無法分辨）：A 收回 OFFERING → HOLDER(E)、編輯重啟。若 B 其實已成 holder(E+1)（ack 丟），下一筆 B 送來的訊息帶 E+1 > E → A 由 INV-2 自動降 LOCKED(E+1)。故僅有「短暫且自癒」的雙持有窗，無穩態雙持有。
- **B 的 request 逾時**（A 不可達）：跳對話（Q2 逾時二選一）——
  - **強制取得控制權**：B → HOLDER(E+1)、送 `lock-takeover{epoch:E+1}`（best-effort、後續 mirror 也帶 E+1）。A 重新上線時，收到 takeover 或任何 E+1 mirror → 由 INV-2 降 LOCKED(E+1)。**代價**：A 未被 flush 的最後編輯會在 A 降鎖後被 B 的權威 mirror 覆蓋而遺失 → 對話須明示「可能遺失對方最新編輯」。
  - **保留鎖定**：B → LOCKED、取消 request、留在 E。

### 新增 WC 訊息 kind

加入 `payloadSchema.ts`（TS）與 Swift coordinator dispatcher：

| kind | 方向 | payload | 用途 |
|---|---|---|---|
| `lock-request` | locked → holder | `{sessionId, epoch}` | 請求拿走編輯權 |
| `lock-grant` | holder → requester | `{sessionId, epoch, snapshot}` | 同意交接 + 最終狀態 flush |
| `lock-ack` | requester → granter | `{sessionId, epoch}` | 確認已接手（granter 收到才降鎖）|
| `lock-takeover` | new-holder → old-holder | `{sessionId, epoch}` | 強制奪取通知（best-effort）|
| `lock-sync` | holder → stale-requester | `{sessionId, epoch, snapshot}` | 把落後的鎖定方重鎖在現世代 |

並在既有 `live-mirror`（與 `cast-session` 初始種子）payload **加 `epoch` 欄**：mirror 只由 holder 送、收方依 INV-2 比對 epoch（==套用、>降鎖採用、<丟棄）。傳輸沿用既有 dual-fire（`sendMessage` + `sendUserInfo`／`updateAppContext` 墊底），與 ADR-0019 一致。

### 鎖的範圍（Q：全部互動都鎖）

**所有會改變 active session 的互動**在 `!canEdit()`（非 HOLDER 或 OFFERING）時被閘斷並提示鎖定：
- iPhone：set 打勾／欄位編輯（weight/reps/rpe/rest）／set_kind 切換／set 備註／加組·刪組·排序／加動作·刪動作·排序動作／標題／每動作休息時間／**結束訓練**。
- Watch：打勾／cell 編輯／cycleType／加組（+1）／刪組／reorder 拖曳／長按備註／刪動作／超級組對應動作。

**唯讀互動不鎖**：看歷史（history-request）、看備註（notes-request）、捲動、展開/收合卡片、看 stats。

**結束訓練收進鎖內**：只有 holder 能結束。鎖定方按結束 → 提示先解鎖（拿回 token 會先 flush 對方最終狀態＝結束前一定拿到最終資料，語意正確）。

### 鎖定方 UI（Q3：單向 live 唯讀鏡像）

鎖定方持續顯示對方編輯的**即時唯讀鏡像**（不是凍結快照），上覆一層鎖定蓋層：鎖 icon + 「對方編輯中」+ 解鎖鈕。Watch 端蓋層由我設計（使用者授權、無視覺參考），鏡像 CellEditOverlay 的全屏 ZStack 半透明 backdrop pattern；iPhone 端為 session 畫面上的 overlay + 解鎖鈕。REQUESTING 顯「取得編輯權中…」、逾時跳二選一對話。

## 上次 grill 拍板 ledger（2026-06-28）

| Q | 決策 |
|---|---|
| Q1 token 歸屬 | **發起方初握 + 解鎖才奪取**（只有 LOCKED 端有解鎖鈕、構造上互斥）|
| Q2 交握 | **3 步交握**（request→grant→ack）+ **逾時二選一**（強制取得控制權／保留鎖定）+ **token epoch** 仲裁 |
| Q3 鎖定顯示 | **單向 live 唯讀鏡像** + 鎖定蓋層 + 解鎖鈕 |
| 範圍 | **全部（編輯類）互動都鎖**、**僅 cast**（單機 session 不受影響）|

## 本 ADR 落筆時補的實作層決策（grill 未逐條問、由接地後我裁定）

1. **epoch 嵌入 mirror**：不另開「lock-state 廣播」訊息；epoch 直接搭 `live-mirror`／`cast-session`，省訊息數、且讓 INV-2 的 self-heal 走既有資料流。
2. **OFFERING 暫停 holder 編輯**：holder 一收到 request 就停編輯 + flush，保證 grant 的 snapshot 是最終態（對齊「確保已經更新」）。
3. **end-session 收進鎖**：只有 holder 能結束（理由見上）。
4. **唯讀操作（history/notes/捲動/展開）不鎖**：「全部互動都鎖」在語境下＝全部**編輯**互動；純檢視不算編輯。
5. **lossy 交接容錯靠 epoch 自癒**：不追求兩將軍式完美交握；穩態互斥保證、過渡態自癒即可（手機/手錶同人近距、丟包罕見）。

## Consequences

- **正向**：echo / ping-pong 競態類別由構造消除；同一時刻只有一條 holder→locked 資料流。既有 cast dropset apply 修（id-first / rank / added-set / dropset 鏈 heal、整合分支 `integration/dropset-cast-smoke-2026-06-28`）保留——它們在編輯鎖下成為「交接瞬間套用對方最終 snapshot」的正確性保險，仍需要。
- **代價**：多一層交握延遲（按解鎖→拿到控制權有 round-trip）；強制奪取路徑可能遺失對方未 flush 的最後編輯（已於對話明示）。
- **對稱**：兩端都要實作完整狀態機 + epoch + 鎖蓋層 + 解鎖 + 全編輯入口閘斷（iPhone TS、Watch Swift 各一份，實作同一份協定）。

## Out of scope

- 非 cast 的單機編輯（不受影響）。
- start / end 雙向 initiator 協定與 live-mirror 傳輸層本身（ADR-0019，保留重用）。
- 多裝置（>2）編輯權（目前只 iPhone↔單一配對 Watch）。

## 翻盤 ledger（greppable）

| 日期 | 翻盤項 | 原拍板 | 新拍板 | 觸發 | 關聯 commit |
|---|---|---|---|---|---|
| 2026-06-28 | cast 同步模型 | iPhone↔Watch 同時雙向編輯（forward+reverse 常開）| **編輯鎖互斥單向**（holder 編輯+單向 mirror、locked 唯讀+解鎖鈕、token epoch 仲裁、3 步交握+逾時二選一）| 多輪實機 smoke 證同時雙向本質脆弱（連點打地鼠）；user 拍板放棄雙向 | 本 ADR（impl pending）|
