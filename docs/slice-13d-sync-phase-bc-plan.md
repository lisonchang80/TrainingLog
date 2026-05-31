# Slice 13d — 同步重構 Phase B + C turnkey 落地計畫

> 對應 ADR-0019 §「Watch⇄iPhone 同步重構（三車道對稱同步）」。
> Phase **A（schema）+ D（墓碑 purge）已 ship main `184c902`**；本檔是剩餘 **B（iPhone runtime）+ C（Watch Swift）** 的逐檔落地藍圖。
> **B 與 C 命運相綁**——B producer 推的快照沒有 C 的 receiver 收就無可觀察效果。建議**同一個實機 session 一起做**，動工前先要 Watch UI 視覺參考。
>
> 所有 file:line 為 2026-05-31 盤點當下的近似座標（`app/(tabs)/index.tsx` 是 ~3000 行單一巨檔，行號會漂，落地時以符號名為準）。

---

## 0. 現況 5 大缺口（落地前必讀）

1. **Watch 端完全沒有 iPhone→Watch 接收路徑（C 最大工程量）**。`WCSessionDelegate` 只實作 `didReceiveMessage`（只認 `end-session` + `side==iphone`）+ `didReceiveUserInfo`（只認 `start-reconcile`），**無 `didReceiveApplicationContext`**（全 repo 零命中）。
2. **echo 抑制目前零防護（B 乒乓核心）**。iPhone 唯一寫入點 `onLiveMirror`→`replaceLiveMirror` 無條件採用每筆快照；`parseLiveMirrorSnapshot` 也還沒解析 `originator`/`rev`（Phase A 只加了型別欄位、receiver 還沒用）。
3. **iPhone 沒有統一的 in-session 變動訊號源（B producer 觸發點分散）**。新增/刪除/reorder/改 set/改 notes/改標題 散在 `index.tsx` 6+ 個 handler，各自直接呼叫 repo。
4. **`updateApplicationContext` channel 已被 Watch→iPhone 佔用、方向會撞**。目前只有 Watch 發、iPhone 收；兩端同 channel 雙向發會互相覆蓋（latest-replace）。
5. **boot-order gate 是隱性的（React render 順序），非 WC 層契約**。listener 在 `(tabs)/index.tsx` 空 deps effect 掛載，靠 `DatabaseProvider` 卡子樹保證 DB 先開；connectivity 的 `ensureXxxListenerMounted` 是 lazy（第一次 addListener 才訂閱原生）。

---

## Phase B — iPhone runtime（純 TS，可 jest、無 device）

> 目標：iPhone 變成「對稱的一端」——in-session 任何改動 debounce 推整包快照給 Watch（快車道 sendMessage + 背景底盤 applicationContext），且收到 Watch 快照時不反推回去（echo 抑制）。

### B1 — 統一 in-session 變動訊號源 + producer

**問題**：變動點分散（Q3 缺口）。**策略**：不逐點掛 hook（易漏），改在「DB 寫完 → `refresh()`」這層之上加一個 producer。

- **觸發點**（皆在 `app/(tabs)/index.tsx`，全部已 call `refreshRef.current?.()`）：
  - 新增動作 `~:744`（`appendSessionExercise`）
  - 刪除動作 `~:2021/2026`（`deleteSessionExerciseAndSets`）
  - reorder `~:2984`（`reorderSessionExercises`）
  - 改 set 欄位 `~:1250/1324`（`updateSetFields`）
  - 改 notes `~:1835`（`onUpdateNotes` → `updateSetFields(..., { notes })`）
  - 改標題（`SessionTitleEditor` `onUpdated` → `setSessionTitle`）
- **新檔** `src/services/iphoneLiveMirrorProducer.ts`：
  - `buildSnapshotFromDb(db, sessionId): Promise<SessionSnapshot>` — 從 SQLite 組整包快照（**重用** end-path 既有的 snapshot builder；確認 `endSnapshotReconcile`/handshake 是否已有可重用的 `fetchSessionSnapshot`，有就接、無則抽共用）。**必帶在地化 `exerciseName`**（同 Bug Y 契約，過 `tExercise`）、`notes`、`originator:'iphone'`、單調遞增 `rev`。
  - `scheduleLiveMirrorPush(db, sessionId)` — debounce ~250–300ms（trailing），合併連續編輯成一次推送。
  - `rev` 來源：per-session 記憶體計數器（producer 模組內 `Map<sessionId, number>`），每次送 +1。冷啟歸零可接受（整包快照自癒、rev 只防同窗亂序）。
- **wire**：在 `index.tsx` 的 `refresh()` 內（或包一層 `refreshAndMirror()`）於「有 active session 且 iPhone 為主動編輯方」時呼叫 `scheduleLiveMirrorPush`。**注意不要在「套用 Watch 來的快照後的 refresh」也觸發**（見 B3 echo）。

### B2 — 快車道 + 背景底盤 transport（雙 channel）

- **快車道**：`connectivity.ts` 已有 `sendMessage`。producer push 時：reachable → `sendMessage(envelope)`（fire-and-forget，不等 reply，不判讀——同 Q3 精神）。
- **背景底盤**：同一份快照也 `updateAppContext`（latest-replace）。**方向衝突（缺口 4）**：iPhone 與 Watch 不能用同一個 applicationContext 槽位互相覆蓋。
  - **建議**：快車道 sendMessage 為主；applicationContext 底盤**改成 envelope 帶 `originator`**，收端靠 originator 分辨方向、且只在「比本地新（rev 更大）」時套用。或更保守：iPhone→Watch 的背景底盤也走 TUI（FIFO、不互相覆蓋），applicationContext 維持 Watch→iPhone 單向。**此抉擇 impl 時定**（影響 Watch receiver 要監聽哪個 channel）。
- **envelope kind**：沿用既有 live-mirror 形狀；若新增 kind 走 `wc-add-envelope-kind` skill 的 8-step pipeline（payloadSchema + 兩端 + 測試）。

### B3 — echo 抑制（防乒乓）

- **接點**：`src/services/watchLiveMirrorReceiver.ts:107` `parseLiveMirrorSnapshot`（解析 originator/rev）+ `index.tsx:647` 的 `addAppContextListener(async (ctx) => { await onLiveMirror(...) })`。
- **改法**：
  1. `parseLiveMirrorSnapshot` 解析 `originator` + `rev`（Phase A 已加型別、這裡補 parse；present-but-malformed → 視為 absent）。
  2. `onLiveMirror` / listener：`if (snapshot.originator === 'iphone') return;`（自己送出去的別收回來寫）。
  3. （選配）per-session 記住「最後套用的 rev」，`incoming.rev <= lastApplied` 則 drop（防亂序回放）。
- **關鍵**：B1 producer 推送時若也觸發了自己的 refresh，**不可**再推一次（無限迴圈）；用「正在套用遠端快照」的 in-flight flag 圍住套用區段。

### B4 — boot-order 顯式 gate（補保證②）

- 現況：隱性靠 `DatabaseProvider` 卡子樹（`components/database-provider.tsx:29-47`，`if (!db) return <ActivityIndicator>`）。
- **建議**：維持現狀即可滿足「DB 先開」，但加一行顯式註解 + （選配）在 connectivity 的 inbound handler 開頭做 `if (!db) { /* queue or warn */ }` 容錯，避免未來有人把 listener 搬出子樹。低風險、低優先。

### B5 — jest（B 全可測）

- `iphoneLiveMirrorProducer.test.ts`：buildSnapshotFromDb 帶 originator/rev/在地化名/notes；debounce 合併多次編輯成一次。
- `watchLiveMirrorReceiver.test.ts`（既有 +）：originator==='iphone' → drop（不寫 DB）；rev 回放亂序 → drop；originator 缺失（舊 Watch）→ 照舊套用（向後相容）。
- echo 迴圈 guard：套用遠端快照不觸發再推送。

**B 的驗證上限**：jest 全綠 = 邏輯對；但「真的推到 Watch 且 <1s」**必須有 C 的 receiver + 實機**才能觀察。B 單獨 ship 是 inert 的（沒人收）。

---

## Phase C — Watch Swift（device-gated + 需視覺參考）

> 目標：Watch 變成「對稱的一端」——收 iPhone 來的整包快照，把新增動作/備註/reorder/標題即時渲染；新增備註顯示 UI。
> ⚠️ **動工前先要 Watch UI 視覺參考**（per `feedback_watch_ui_reference`）：特別是「備註要怎麼在手錶上呈現」「iPhone 來的新動作插進清單的視覺」。

### C1 — inbound receiver（缺口 1，最大工程量）

- **檔**：`WatchConnectivityCoordinator.swift`（現只認 `end-session`/`start-reconcile`）。
- **加**：
  - 若 B 選 applicationContext 底盤 → 實作 `func session(_:didReceiveApplicationContext:)`。
  - 若 B 選 sendMessage 快車道 → 在 `didReceiveMessage` 加 `live-mirror`（或重用既有 kind）分支。
  - 解析 `SessionSnapshot`（`SessionSnapshot.swift` 已有 Codable，含 `notes` 欄位 `:51`，目前沒用）。
  - echo 抑制對稱：`originator == 'watch'`（自己送的）則 drop。

### C2 — 把外來 tree 併入 overlay 狀態（架構難點）

- **現況**：`SessionInteractionState`（`:121`）是 **overlay** = 不可變 base `SessionSnapshot`（來自 handshake fat-tree，`PickerViewModel.buildSnapshotFromFatTree`）+ 差異（`addedSets`/`deletedSetIds`/`editedValues`/`setKindOverrides`…）。`AddedSet` **只處理 set、不處理 exercise**。
- **問題**：iPhone 來的「新增動作」不在 base 裡，overlay 模型裝不下。
- **兩條路（impl 時擇一）**：
  - **(a) 擴 overlay**：加 `addedExercises`、`reorderedExerciseIds`、`exerciseNotes`、`titleOverride`。改動小但 overlay 邏輯變複雜。
  - **(b) 可變 base**：收到 iPhone 快照時**重建 base**（snapshot-replace，與 NEW-Q50 的 Watch→iPhone 對稱），把仍有效的本地未送出差異 re-apply。較乾淨但要小心丟失 Watch 端剛編輯未送出的差異。
  - **推薦 (b)**——與整包快照哲學一致；但需處理「Watch 正在編、iPhone 同時改」的合併（接力使用下罕見，rev 較大者勝）。
- **渲染端**：`SetLoggerView` / `ExerciseCard`（依 base + overlay 重繪）。reorder = 依快照 `ordering` 重排動作清單。

### C3 — 備註顯示 UI（缺口：Watch 無備註 UI，net-new）

- 現況：`notes` 在 `SessionInteractionState` 投影恆 `nil`（`:113`）；全 Watch 無 `TextField`/NoteSheet/備註元件。
- **C 範圍（依視覺參考定）**：至少**顯示** iPhone 來的 per-exercise / per-set 備註（唯讀即可滿足「手機改、手錶看」的接力情境）。是否要 Watch 端**編輯**備註 = 待使用者拍板（手錶打字體驗差，可能維持唯讀）。

### C4 — 出站對稱（Watch→iPhone 也帶新欄位）

- `LiveMirrorProducer.swift`（Watch 端現役 producer）push 的快照補 `originator:'watch'` + `rev` + （若 Watch 端支援刪除）`deletedIds`。
- 確認與 E2（Watch 刪 set/動作）+ Phase D 墓碑的 id 對齊：Watch 採 canonical id（Phase C 的前提），墓碑才精確。

### C5 — 實機 smoke（補保證③ + 對稱驗證）

對照 ADR-0019 的 4 情境 + 對稱渲染：

| # | 操作 | 預期 |
|---|------|------|
| 1 | iPhone 前景 + Watch 開，iPhone 新增動作 | Watch <1s 出現該動作 |
| 2 | iPhone 改某動作備註 | Watch <1s 顯示備註 |
| 3 | iPhone reorder 動作 | Watch <1s 重排 |
| 4 | iPhone 改標題 | Watch <1s 更新標題 |
| 5 | Watch 改 set / 刪 set | iPhone <1s 反映（既有 + 墓碑精確刪） |
| 6 | iPhone 背景 → Watch 完成 → 開 iPhone 歷史 | 看得到（情境 2，E1 已驗） |
| 7 | iPhone 被砍 → Watch 完成 → 冷開歷史 | 看得到（情境 3，冷啟補送） |
| 8 | 斷線 → Watch 完成 → 重連 | 看得到（情境 4，TUI FIFO） |
| 9 | 雙向乒乓檢查：iPhone 改 → Watch 收 → 不應再回推 → iPhone 不應再收到自己的回音 | 無震盪 |

---

## 落地順序建議

1. **先 B（純 TS、jest 綠）** 但**不單獨 ship**——留在 branch。
2. **接著 C（Swift）**，邊做邊用 B 推的快照驗證 receiver。
3. C2 的 overlay vs 可變 base 抉擇 + B2 的 channel 抉擇（applicationContext vs TUI 底盤）會**互相影響**——一起定。
4. 全套實機 smoke（C5 的 9 項）綠 → 才整包 ship。
5. ship 時注意：若彼時 main 已被其它 branch（如 F2）推進，沿用「branch 落地 + 視 git 狀態決定 ff/rebase」原則，勿擾動他人未提交工作。

## 風險備忘

- **C2 是真正的不確定點**：overlay 模型不是為「外來新增動作」設計的，可能比預期費工。先做一個最小可行（只渲染外來動作 + 備註唯讀），reorder/編輯備註可分批。
- **channel 方向衝突（缺口 4）**未定前不要兩端都寫 applicationContext。
- B 的 producer 若掛在 `refresh()` 太上層，debounce 粒度可能過粗（連 UI-only refresh 都推）；必要時退回逐觸發點掛。
