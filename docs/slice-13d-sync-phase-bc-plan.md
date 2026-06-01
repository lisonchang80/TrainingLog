# Slice 13d — 同步重構 Phase B + C turnkey 落地計畫

> 對應 ADR-0019 §「Watch⇄iPhone 同步重構（三車道對稱同步）」。
> Phase **A（schema）+ D（墓碑 purge）已 ship main `184c902`**；本檔是剩餘 **B（iPhone runtime）+ C（Watch Swift）** 的逐檔落地藍圖。
> **B 與 C 命運相綁**——B producer 推的快照沒有 C 的 receiver 收就無可觀察效果。建議**同一個實機 session 一起做**，動工前先要 Watch UI 視覺參考。
>
> 所有 file:line 為 2026-05-31 盤點當下的近似座標（`app/(tabs)/index.tsx` 是 ~3000 行單一巨檔，行號會漂，落地時以符號名為準）。

---

> ## 🔄 2026-06-01 evening refresh（live-mirror fast-lane 落地後重新對齊）
>
> **本檔原稿寫於 2026-06-01 morning，在 live-mirror fast-lane + reconcile fix 落地之前。** 那之後 **Watch→iPhone 半邊**已大幅補齊（branch `slice/13d-livemirror-fastlane`，**尚未 merge main**，待實機 smoke）：
>
> - `5ceb8fe`（TS）— 新 WC kind **`live-mirror`（第 17 種）** + `LiveMirrorPayload` + `onLiveMirror` 加 **per-session 單調 `rev` high-water-mark 守門**（`rev <= lastApplied` 即丟、claim-before-await）+ `index.tsx` 加 `addMessageListener('live-mirror')`。
> - `f860c19`（Swift）— `updateLiveMirror` **DUAL-FIRE**（reachable 時 `sendMessage` 快車道 + `updateApplicationContext` 背景墊底）；`LiveMirrorProducer` 蓋單調 `rev`（ms-since-epoch、`max(now,prev+1)`）+ `originator:"watch"`。
> - `484b13f`（Swift）— producer `project()` 拿掉 ordinal-permute、emit 每 set 自己穩定的 ordinal（遞減組 follower 不再遺失；接受代價 = Watch reorder/中插不同步 iPhone）。
> - `8e91f08`（TS）— `onLiveMirror` 在 `replaceLiveMirror` 拋錯時 rollback rev high-water，讓 dual-fire 同 rev 的 backstop 能自癒。
> - **ADR-0019 § 2026-06-01**（兩段：transport fast-lane + reconcile B-fix）記錄上述；⚠️ **那兩段 ADR amendment 目前只在 `slice/13d-livemirror-fastlane` 上**，本 plan branch 的 ADR 還沒有 —— 兩者會隨 fastlane branch 一起進 main。
>
> **本次 refresh 範圍**：① 重新校準下方「5 大缺口」狀態（哪些已被 fast-lane 覆蓋）；② 釐清 Phase B 還剩哪些（= iPhone→Watch 半邊未做）；③ 銳化 Phase C（真正剩餘工程）；④ 標記 2026-06-01 grill 的 reorder/中插 open fork。原稿 stale 段落以 `〔refresh〕` 行內標注，不整檔重寫。

---

## 0. 現況 5 大缺口（落地前必讀）

> **〔2026-06-01 evening refresh — 缺口狀態重校準表〕** fast-lane 補齊的是 **Watch→iPhone** 半邊。摘要：
>
> | # | 缺口 | 2026-06-01 evening 狀態 | 落地 commit |
> |---|------|------|------|
> | ① | Watch 端無 iPhone→Watch 接收路徑 | **仍 OPEN** — fast-lane 全在 TS/iPhone 收、Swift producer 出站；Watch 端 `didReceiveApplicationContext`/`live-mirror` inbound 分支**仍未做** = Phase C 核心 | — |
> | ② | echo 抑制 / 亂序防護 | **部分覆蓋** — Watch→iPhone 方向：`rev` 守門 + `originator` parse 已有（`onLiveMirror`、`5ceb8fe`+`8e91f08`）；**`originator` echo-drop 尚未接**（receiver 還沒 `if originator==='iphone' return`，因 iPhone 還沒當 producer 送、無回音可擋）。reconcile permute bug 已修（`484b13f`） | `5ceb8fe`/`8e91f08`/`484b13f` |
> | ③ | iPhone 無統一 in-session 變動訊號源 | **仍 OPEN** — 屬 iPhone-side producer（Phase B 剩餘半邊）；觸發點仍分散 | — |
> | ④ | appContext channel 方向會撞 | **大幅緩解** — fast-lane 確立 **前景即時走 `sendMessage`（新 `live-mirror` kind）、appContext 降為背景墊底**；iPhone→Watch 即時也應走 `sendMessage`（不撞 latest-replace）。撞車風險縮到只剩「兩端同 appContext 槽位墊底」這一點 | `5ceb8fe`/`f860c19` |
> | ⑤ | boot-order 隱性 gate | **仍 OPEN（不變）** — 仍靠 `DatabaseProvider` 卡子樹；低風險、低優先 | — |
>
> 下方原列保留為各缺口的完整描述，逐條附 `〔refresh〕` 狀態註。

1. **Watch 端完全沒有 iPhone→Watch 接收路徑（C 最大工程量）**。`WCSessionDelegate` 只實作 `didReceiveMessage`（認 `end-session` + `side==iphone`，**fast-lane 後 Watch 端仍未加 `live-mirror` 分支**）+ `didReceiveUserInfo`（只認 `start-reconcile`），**無 `didReceiveApplicationContext`**（全 repo 零命中）。
   - 〔refresh〕**仍 OPEN**。fast-lane 只動了 iPhone 收 / Watch 出站，**沒碰 Watch inbound**。這是 Phase C 最大工程量。
2. **echo 抑制目前零防護（B 乒乓核心）**。
   - 〔refresh〕**部分覆蓋**。`parseLiveMirrorSnapshot` 現在**已解析** `originator`/`rev`/`deletedIds`（`5ceb8fe`，Phase A 只加型別、fast-lane 補了 parse + 用）；`onLiveMirror` 已有 **per-session `rev` high-water 守門**（`rev <= lastApplied` 即丟、claim-before-await、db-error rollback 自癒）。**但 `originator` 還沒拿來 echo-drop** —— 因 iPhone 尚未當 producer 推，沒有自己的回音要擋；等 iPhone producer（B 剩半）一上，才需在 receiver 加 `if (snapshot.originator === 'iphone') return;`（對稱地 Watch receiver 要 `originator==='watch'` drop）。
3. **iPhone 沒有統一的 in-session 變動訊號源（B producer 觸發點分散）**。新增/刪除/reorder/改 set/改 notes/改標題 散在 `index.tsx` 6+ 個 handler，各自直接呼叫 repo。
   - 〔refresh〕**仍 OPEN**。fast-lane 完全沒碰 iPhone-side producer；這是 Phase B 剩下的核心半邊。
4. **`updateApplicationContext` channel 已被 Watch→iPhone 佔用、方向會撞**。
   - 〔refresh〕**大幅緩解**。fast-lane 把前景即時主力從 appContext 搬到新 `live-mirror` `sendMessage` kind，appContext 降為背景墊底（ADR-0019 § 2026-06-01 transport：「NEW-Q50 Q6=a 修訂、appContext 降墊底」）。iPhone→Watch 的即時推**應直接複用 `sendMessage`/`live-mirror`**（兩方向用同一 kind、靠 `originator` 分辨），就不會撞 appContext 的 latest-replace。剩餘撞車面只剩「若兩端都還想用 appContext 墊底」—— B2 抉擇時定（見下）。
5. **boot-order gate 是隱性的（React render 順序），非 WC 層契約**。listener 在 `(tabs)/index.tsx` 空 deps effect 掛載，靠 `DatabaseProvider` 卡子樹保證 DB 先開；connectivity 的 `ensureXxxListenerMounted` 是 lazy（第一次 addListener 才訂閱原生）。
   - 〔refresh〕**仍 OPEN（不變）**。fast-lane 的 `addMessageListener('live-mirror')` 也掛在同一 effect、同樣靠子樹 gate；維持現狀即可，低優先。

---

## Phase B — iPhone runtime（純 TS，可 jest、無 device）

> 〔**2026-06-01 evening refresh — Phase B 半邊已落地**〕原 Phase B = 「iPhone producer + 快車道 + echo + boot-order」。fast-lane（`slice/13d-livemirror-fastlane`）**已把 transport + 守門基礎建設做完，但全是 Watch→iPhone 方向**：
> - ✅ **快車道 transport 已存在** — 新 `live-mirror` WC kind（`5ceb8fe`）+ Swift dual-fire（`f860c19`）。B2 的「快車道 sendMessage」對 iPhone→Watch 方向**可直接複用同一 kind**（不必再走 `wc-add-envelope-kind` 開新 kind）。
> - ✅ **rev 反序守門已存在** — `onLiveMirror` 的 per-session high-water（`5ceb8fe`/`8e91f08`）。B3 的「rev drop 亂序」這條已完成（Watch→iPhone 收端）。
> - ✅ **`originator`/`rev`/`deletedIds` parse 已存在** — `parseLiveMirrorSnapshot`（`5ceb8fe`）。
>
> **Phase B 剩餘 = 純 iPhone→Watch 半邊**：
> - **B1 iPhone-side producer 仍未做**（缺口 ③）—— 把 iPhone in-session 改動 debounce 成整包快照、蓋 `originator:'iphone'`+`rev`、走 `live-mirror` `sendMessage` 快車道推給 Watch。
> - **B3 echo-drop 仍未接**（缺口 ②半）—— receiver 需加 `originator==='iphone' → drop`（防 iPhone 收回自己的回音；現況 inert 因沒人送 iphone-originated）。
> - **B4 boot-order** 維持現狀（不變）。
>
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

> 〔**2026-06-01 evening refresh — 快車道 kind 已存在**〕`live-mirror` WC kind（第 17 種）已在 `5ceb8fe` 建好、Swift dual-fire 在 `f860c19`。**iPhone→Watch 直接複用同一 kind 即可**，不需再開新 kind（不必走 `wc-add-envelope-kind`）。下方原文敘述仍適用於「iPhone 出站」這半邊。

- **快車道**：`connectivity.ts` 已有 `sendMessage`。producer push 時：reachable → `sendMessage({ kind:'live-mirror', payload })`（fire-and-forget，不等 reply，不判讀——同 Q3 精神）。
- **背景底盤**：同一份快照也 `updateAppContext`（latest-replace）。**方向衝突（缺口 4，已大幅緩解）**：fast-lane 後前景即時已不靠 appContext；剩餘張力僅「兩端都用 appContext 墊底」會互蓋。
  - **建議**：快車道 sendMessage 為主（兩方向同 `live-mirror` kind，靠 `originator` 分辨）；iPhone→Watch 的**背景墊底可暫不做**（live tick 掉了下一次 push 自癒、`end-session` 才是耐久後備、且 iPhone→Watch 不背耐久情境）—— 先只做快車道、appContext 維持 Watch→iPhone 單向，避開撞車。日後若要 iPhone→Watch 墊底再評估走 TUI（FIFO、不互蓋）。**此抉擇 impl 時定**（影響 Watch receiver 要監聽哪個 channel；見 C1）。

### B3 — echo 抑制（防乒乓）

> 〔**2026-06-01 evening refresh — parse + rev 守門已落地，echo-drop 仍待接**〕步驟 1+3 已完成（`5ceb8fe`/`8e91f08`），步驟 2（originator echo-drop）仍未接、但目前 inert（沒人送 iphone-originated 快照）。

- **接點**：`src/services/watchLiveMirrorReceiver.ts` `parseLiveMirrorSnapshot`（**已解析 originator/rev/deletedIds** ✅）+ `index.tsx` 的 `addAppContextListener` ✅ **及新 `addMessageListener('live-mirror')`** ✅（皆路由到同一個 rev-guarded `onLiveMirror`）。
- **改法**：
  1. ✅ **已做** — `parseLiveMirrorSnapshot` 解析 `originator` + `rev`（present-but-malformed → reject）。
  2. ⬜ **仍待接** — `onLiveMirror`：`if (snapshot.originator === 'iphone') return;`（自己送出去的別收回來寫）。等 B1 iPhone producer 一上才有實效。
  3. ✅ **已做** — per-session `rev` high-water（`lastAppliedRev` Map、claim-before-await、db-error rollback 自癒）。
- **關鍵**：B1 producer 推送時若也觸發了自己的 refresh，**不可**再推一次（無限迴圈）；用「正在套用遠端快照」的 in-flight flag 圍住套用區段。對稱地 Watch C1 receiver 也要 `originator==='watch'` echo-drop。

### B4 — boot-order 顯式 gate（補保證②）

- 現況：隱性靠 `DatabaseProvider` 卡子樹（`components/database-provider.tsx:29-47`，`if (!db) return <ActivityIndicator>`）。
- **建議**：維持現狀即可滿足「DB 先開」，但加一行顯式註解 + （選配）在 connectivity 的 inbound handler 開頭做 `if (!db) { /* queue or warn */ }` 容錯，避免未來有人把 listener 搬出子樹。低風險、低優先。

### B5 — jest（B 全可測）

> 〔**2026-06-01 evening refresh**〕`watchLiveMirrorReceiver.test.ts` 的 rev-guard + originator/rev parse + 向後相容 case 已在 `5ceb8fe`（+5 rev-guard）+ `8e91f08`（rollback 自癒）落地。剩餘 = iPhone producer + echo-drop 的測試。

- `iphoneLiveMirrorProducer.test.ts`（**新、仍待寫**）：buildSnapshotFromDb 帶 originator/rev/在地化名/notes；debounce 合併多次編輯成一次。
- `watchLiveMirrorReceiver.test.ts`：✅ rev 回放亂序 → drop（已有）；✅ originator 缺失（舊 Watch）→ 照舊套用（已有）；⬜ **仍待加** `originator==='iphone' → drop`（不寫 DB，配合 B1 echo-drop）。
- echo 迴圈 guard：套用遠端快照不觸發再推送（**仍待寫**，配合 B1 in-flight flag）。

**B 的驗證上限**：jest 全綠 = 邏輯對；但「真的推到 Watch 且 <1s」**必須有 C 的 receiver + 實機**才能觀察。B 單獨 ship 是 inert 的（沒人收）。

---

## Phase C — Watch Swift（device-gated + 需視覺參考）

> 〔**2026-06-01 evening refresh — Phase C = 真正剩餘工程的全部**〕fast-lane 把 Watch 端做成了「**只出站、不入站**」的 producer（`LiveMirrorProducer` emit `originator:'watch'` + `rev`、coordinator dual-fire 出去）。**Watch 收 iPhone-originated 快照的 inbound 路徑完全沒有** —— 這就是 Phase C。fast-lane 也順手把 Watch producer 的 `SessionSnapshot.swift` 加好了 `rev`/`originator` 欄（`f860c19`），C4 出站對稱已大半完成（見下）。
>
> 目標：Watch 變成「對稱的一端」——收 iPhone 來的整包快照，把新增動作/備註/reorder/標題即時渲染；新增備註顯示 UI。
> ⚠️ **動工前先要 Watch UI 視覺參考**（per `feedback_watch_ui_reference`）：特別是「備註要怎麼在手錶上呈現」「iPhone 來的新動作插進清單的視覺」「reorder 後的清單動畫」—— C2/C3 都卡視覺參考。

### C1 — inbound receiver（缺口 1，最大工程量）

- **檔**：`WatchConnectivityCoordinator.swift`（現只認 `end-session`/`start-reconcile`；**fast-lane 後仍未加任何 inbound live-mirror 分支**）。
- **加**：
  - **建議直接對稱 fast-lane 的快車道** → 在 `didReceiveMessage` 加 `live-mirror` 分支（解 `{kind,payload}` envelope，payload = 原始 `SessionSnapshot` dict，**與 iPhone `onLiveMirror` 消費的同一 shape**）。
  - 若 B2 最終決定也做 iPhone→Watch appContext 墊底 → 再補 `func session(_:didReceiveApplicationContext:)`；B2 現建議「先只快車道、不做 iPhone→Watch 墊底」，故 C1 第一版可只接 `didReceiveMessage`。
  - 解析 `SessionSnapshot`（`SessionSnapshot.swift` 已有 Codable，**fast-lane 已加 `rev`/`originator` 欄** + `notes` 欄位 `:51`，目前 inbound 沒用）。
  - **echo 抑制對稱（B3 的 Watch 半邊）**：`originator == "watch"`（自己送的）則 drop；只採 `originator == "iphone"` 的快照。對應 iPhone 端 B3 的 `originator==='iphone'` drop。
  - **rev 守門對稱**：Watch 端也應持 per-session `rev` high-water、`rev <= lastApplied` 即丟（對稱 `onLiveMirror`，防 iPhone dual-fire 的遲到 backstop 覆蓋）。

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

> 〔**2026-06-01 evening refresh — 大半已落地**〕

- ✅ `LiveMirrorProducer.swift` push 的快照**已補** `originator:"watch"` + 單調 `rev`（`f860c19`）。
- ✅ producer `project()` 已拿掉 ordinal-permute、emit 每 set 自己穩定的 ordinal（`484b13f`）—— 遞減組 follower 不再遺失。
- ⬜ **仍待**：`deletedIds` 墓碑（若 Watch 端 live 刪除要傳播，現役 D11 Watch 刪 set/動作走 end-session 路徑、live 墓碑尚未在 producer 帶出）。
- 確認與 E2（Watch 刪 set/動作）+ Phase D 墓碑的 id 對齊：Watch 採 canonical id（Phase C 的前提），墓碑才精確。

### C5 — 實機 smoke（補保證③ + 對稱驗證）

對照 ADR-0019 的 4 情境 + 對稱渲染：

| # | 操作 | 預期 |
|---|------|------|
| 1 | iPhone 前景 + Watch 開，iPhone 新增動作 | Watch <1s 出現該動作 |
| 2 | iPhone 改某動作備註 | Watch <1s 顯示備註 |
| 3 | iPhone reorder 動作 | Watch <1s 重排 〔refresh: **第一版可能 deferred** — 見 open fork、需 option C `displayOrder` 才安全；第一版建議與 Watch→iPhone 對齊不做 reorder 對稱〕 |
| 4 | iPhone 改標題 | Watch <1s 更新標題 |
| 5 | Watch 改 set / 刪 set | iPhone <1s 反映（既有 + 墓碑精確刪） |
| 6 | iPhone 背景 → Watch 完成 → 開 iPhone 歷史 | 看得到（情境 2，E1 已驗） |
| 7 | iPhone 被砍 → Watch 完成 → 冷開歷史 | 看得到（情境 3，冷啟補送） |
| 8 | 斷線 → Watch 完成 → 重連 | 看得到（情境 4，TUI FIFO） |
| 9 | 雙向乒乓檢查：iPhone 改 → Watch 收 → 不應再回推 → iPhone 不應再收到自己的回音 | 無震盪 |

---

## 落地順序建議

> 〔**2026-06-01 evening refresh**〕**前置**：fast-lane（`slice/13d-livemirror-fastlane`）的 Watch→iPhone 半邊待實機 smoke → cherry-pick / merge main。**Phase B+C 應 rebase 在 fast-lane 之後**（不要在它之前做，否則 `live-mirror` kind / `onLiveMirror` 守門會缺）。

1. **先確認 fast-lane 已進 main**（或 base 在其上）——Phase B+C 依賴 `live-mirror` kind + `onLiveMirror` rev 守門。
2. **B 剩半（iPhone producer + echo-drop，純 TS、jest 綠）** 但**不單獨 ship**——留在 branch（沒 C receiver 收仍 inert）。複用既有 `live-mirror` kind，不開新 kind。
3. **接著 C（Swift）**，邊做邊用 B 推的快照驗證 Watch receiver。
4. C2 的 overlay vs 可變 base 抉擇 + reorder 對稱 fork（option A/C）+ B2 的「iPhone→Watch 要不要 appContext 墊底」會**互相影響**——一起在 grill 定。
5. 全套實機 smoke（C5 的 9 項）綠 → 才整包 ship。
6. ship 時注意：若彼時 main 已被其它 branch 推進，沿用「branch 落地 + 視 git 狀態決定 ff/rebase」原則，勿擾動他人未提交工作。

## 風險備忘

- **C2 是真正的不確定點**：overlay 模型不是為「外來新增動作」設計的，可能比預期費工。先做一個最小可行（只渲染外來動作 + 備註唯讀），reorder/編輯備註可分批。
- **channel 方向衝突（缺口 4）**未定前不要兩端都寫 applicationContext。〔refresh〕fast-lane 後已大幅緩解，但 iPhone→Watch 第一版建議**只走 `sendMessage`/`live-mirror`、不做 appContext 墊底**（B2）。
- B 的 producer 若掛在 `refresh()` 太上層，debounce 粒度可能過粗（連 UI-only refresh 都推）；必要時退回逐觸發點掛。

## 〔2026-06-01 evening refresh〕Open design fork — reorder/中插的反向對稱

**背景**：fast-lane 的 reconcile fix（`484b13f`、ADR-0019 § 2026-06-01 reconcile）為了不丟遞減組 follower，**拿掉了 producer 的 ordinal-permute**，並**接受代價（grill Q2）：Watch reorder / 中插位置不同步到 iPhone**（set 留原始 ordinal、內容正確、順序不傳）。reorder 在 Watch→iPhone 方向降為「Watch 本地顯示 affordance」。

**對 Phase C（iPhone→Watch）的影響**：Q6 要求**完全對稱全即時**，明列「reorder：Watch 動作清單順序跟快照 ordering 即時重排」。但若沿用現役 wire 形狀（`ordinal` 同時當身分配對 key + 顯示序），iPhone→Watch 的 reorder 會撞**同一個 root cause**（permute 身分 key → 寫錯 row）。所以 Phase C 若真要做 reorder 對稱，必須先決定升級路徑：

- **option C（加 `displayOrder` wire 欄）**：在快照 set/exercise 加一個獨立於 `ordinal`（身分 key）的 `displayOrder` 欄，純編碼顯示序。兩端渲染按 `displayOrder`、配對仍按 `ordinal`。較小侵入、不動 id 模型。
- **option A（Watch 採用 iPhone 真 id / id-adoption）**：`onStartFromWatch` reply 補 snapshot、Watch overlay 做 id-rebase，讓兩端 id 收斂，reorder 才能用穩定 id 表達順序。較大工程（動到 NEW-Q50 的 standalone id 模型）。

**建議**：Phase C 第一版**先不做 reorder 對稱**（與 Watch→iPhone 的 Q2 代價對齊、保持雙向一致），只做「新增動作 / 備註 / 標題 / set 值」的對稱即時渲染；reorder 對稱列為 follow-up，屆時選 option C（侵入小）。**動工前在 grill 拍板此 fork。**

**Cross-link**：ADR-0019 § 2026-06-01「遞減組 reconcile：拿掉 producer ordinal permute」（Q1=B、Q2 接受 reorder 不同步、列明 option A/C 升級路徑）+ § 2026-06-01「Live-mirror fast lane」（transport）。⚠️ 兩段 ADR amendment 目前在 `slice/13d-livemirror-fastlane`，隨該 branch 進 main。`watch-setlogger-overlay-gesture` skill「iPhone reconcile ordinal 配對鐵律」。
