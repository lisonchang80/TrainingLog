# 0008 — Multi-device 策略 + Watch v1 範圍

v1 多裝置 = iPhone (RN/Expo) + Apple Watch (SwiftUI native)，**全程 Watch 主，iPhone 不掏**（α 模型）。Mac mini M4 Pro 環境就位後解鎖 watchOS 開發，原本「Watch deferred to post-v1」決策推翻，Watch 進 v1 範圍。（**Slice 13d 修訂**：「全程 Watch 主、iPhone 不掏」改為**雙向 initiator**，見 § 2026-05-26 Slice 13d Amendment）

## 路徑 C: prefetch + event queue

**iPhone = SQLite source of truth；Watch = in-memory + UserDefaults backup（不做 Watch 端 SQLite）**

Sync 兩階段：
1. **Stage 1**（Watch app launch）：iPhone 算所有 Template metadata + active Program + unit_preference → `WCSession.updateApplicationContext` 推給 Watch
2. **Stage 2**（pre-session，使用者選定 Template）：iPhone 算該 Template 完整結構 + chip 預計算（上次 / 重量峰 / 容量峰）+ bw_snapshot → `WCSession.sendMessage` 推給 Watch（必須 reachable）

Watch → iPhone events 走 `WCSession.transferUserInfo`（OS-managed reliable delivery；iPhone 不在範圍時自動 cache、連上自動補送）。

**Conflict 模型 = 架構上不存在 conflict**：Watch 只新增 Set，不修 Template / Exercise / Program。Pre-session payload **永不過期**（transient state；cancel 重 prefetch 是 1~2 tap 自助）。

## Pre-session vs in-session 兩態

| 狀態 | 觸發點 | 系統行為 |
|---|---|---|
| **Pre-session** | 選定 Template entity 後 | iPhone 推 Stage 2 payload；Watch 顯示「▶ 開始訓練」按鈕；**HKWorkoutSession 未啟、Session row 未創建** |
| **In-session** | 點「開始訓練」 | 原子操作：① `HKWorkoutSession.start()` ② Session row 創建 (UUID + started_at = now + bw_snapshot 用 prefetch 帶來的值) ③ 計時開跑 |

**bw_snapshot 鎖定時機 = pre-session 階段**（不是 in-session 啟動那一刻）— 因為 in-session 時 iPhone 可能已不在範圍。（**Slice 13d 修訂**：改為 **session-start moment 鎖定**，雙向 initiator 後 iPhone 必在 start moment reachable；見 § 2026-05-26 Slice 13d Amendment）

## Schema 影響（最小）

**UUID 主鍵範圍 = 僅 Session / Set / body_metric** 三張表（兩端都新增 → autoincrement int 會搶 id）。其他表（Program / Template / Exercise / Settings）保留 autoincrement int。**不需要** `updated_at` / `last_modified_device` 欄位。

新增欄位：
- `set.is_skipped BOOLEAN DEFAULT FALSE`（Watch #11 跳過 Exercise UI；跳過的 sets 不算 PR / 不入容量但 row 仍存）
- `session.healthkit_workout_uuid TEXT NULL`（HKWorkout link，由 Watch 結束 session 寫 HKWorkout 後回填）

## Watch v1 功能範圍（17 條）

主畫面 = **垂直 list view，整場 Session 一路展開**（Exercise headers + Set rows）；水平 swipe 三分頁 [list view ↔ NowPlaying ↔ metrics]。

| # | 功能 | 重點 |
|---|---|---|
| 1 | 選 Template 開訓練 | name → (週期, 強度) 兩層 nav（原 (Program, 副標籤)）；active 週期（原 Program）自動套**當期強度**（原副標籤） 1-tap；今日排程一鍵 |
| 2 | Exercise 名下 chip「上次 / 重量峰 / 容量峰」 | 走 inline scope（不是 PR） |
| 3 | 即時心率 | sticky top bar、zone 顏色 |
| 4 | 增 / 刪組數 + 修改 weight × reps | Digital Crown 滾輪 |
| 5 | 完成組打勾 | 完成後 auto-scroll 下一組置中 |
| 6 | 休息倒數計時 | 完成組後該 cell 變「⏱ 0:45」大字倒數 |
| 7 | NowPlayingView 系統內建分頁 | 音樂控制（直接複用，不自刻） |
| 8 | 結束訓練 → 同步歷史 + 寫 HealthKit | 兩通道獨立（**Slice 13d 修訂**：改為「iPhone 寫 HKWorkout + Watch HR/kcal sample 同進 HK store」單通道；Watch 端 `HKLiveWorkoutBuilder.discardWorkout()` 不寫 entry。見 § 2026-05-26 Slice 13d Amendment） |
| 9 | 超級組 | 按執行順序展開：A1 第1 → A2 第1 → A1 第2 → ...；indent + A1/A2 子標籤 |
| 10 | 暫停 / 結束 Session | pause = `HKWorkoutSession.pause()`；end = `.end()` 寫 HKWorkout（**Slice 13d 修訂**：pause defer to v1.5+、Watch v1 ship 不顯 pause button；end 改走 `.end() + discardWorkout()` 不寫 HKWorkout — iPhone 13c writer 為唯一 entry。見 § 2026-05-26 Slice 13d Amendment） |
| 11 | 跳過 Exercise | 長按 header → confirm dialog → collapse 成「動作名（跳過）」一行；可 tap 展開重做 |
| 12 | PR 達成觸覺通知 | 強觸覺 + 1.5s toast |
| 13 | 休息倒數中途操作 | +30s / -30s / 立刻下一組 |
| 14 | Watch face complication（簡單版） | App icon circular complication, 1-tap 啟動 |
| 15 | Session 完成 summary 卡片 | 總組數 / 總容量 / 新 PR / duration / 平均+max HR / 完成度 |
| 16 | Pre-session 兩態 | 選定 Template → ▶ 開始訓練按鈕，不啟 HKWorkoutSession |
| 17 | In-session 啟動點 | 按鈕觸發 HKWorkoutSession + Session row 創建 |

### 2026-05-23 amendment — iPhone `[傳至手錶 ⌚]` button feature-gate

> **Slice 13d 修訂**（2026-05-26）：本段整體推翻 — `FEATURE_WATCH_HANDOFF` flag 退役、按鈕移除；α-model native handoff 由 WC bidirectional initiator 取代。slice 13d D2 commit 砍 button + `features.ts` const + `tests/config/features.test.ts`。本段保留為歷史紀錄，**不再代表 v1 ship 行為**。見 § 2026-05-26 Slice 13d Amendment。

iPhone 端 Today bottom sticky bar 在 slice 10c Phase 5 期間（2026-05-XX）有 forward-port placeholder Pressable `[傳至手錶 ⌚]`，tap → 顯示「將在 slice 13 上線」informational Alert。slice 10e bundle 3 拍板：**按鈕預設**不渲染**，由 build-time flag `FEATURE_WATCH_HANDOFF` 控制**（`src/config/features.ts`、default `false`）。

理由：
- App Store user 不知道「slice 13」是什麼，看到「敬請期待」Alert 會解讀為功能壞掉
- 真正的 WatchConnectivity handoff 要等 slice 11+（watch scaffold + WCSession 真實對接）才有意義
- Build-time flag 是最輕量的 gate，flip true 後 button 出現、無需動 UI 邏輯

當 slice 11+ 真正 ship WatchConnectivity 對接時：
1. `src/config/features.ts` 把 `FEATURE_WATCH_HANDOFF` 改 `true`
2. `app/(tabs)/index.tsx` 的 `onPress` 從目前 informational Alert 換成真正觸發 `WatchConnectivity.send(...)` 呼叫
3. `tests/config/features.test.ts` 的 invariant 更新或刪除（看 watch handoff 是否視為「永遠開」）

`session/[id].tsx` history detail edit mode 目前**沒有**此按鈕（編輯 post-hoc session 不需要 handoff，per ADR-0019 § slice 10d E2 區分）。

## HealthKit 整合（v1 提前實作）

（**Slice 13d 修訂**：本段「Watch 寫 HKWorkout / HKWorkoutSession Watch-only」整體推翻為 **trigger-only sampling**：Watch HKWorkoutSession 純開 HR/kcal sampling、end 時 `HKLiveWorkoutBuilder.discardWorkout()` 不寫 HKWorkout entry；iPhone 13c writer 為唯一 HKWorkout 寫入點；Watch HR/ActiveEnergyBurned sample 仍進 HK store、iPhone reader 不在乎 source 照撈。見 § 2026-05-26 Slice 13d Amendment）

- **HKWorkoutType** = `traditionalStrengthTraining`
- **Watch 寫 HKWorkout metadata** = duration / 卡路里 / 平均 HR / max HR + custom `trainingLogSessionUUID`（跨 app link）（**Slice 13d 修訂**：移除；iPhone 13c writer 處理 metadata）
- **iPhone READ 拿回 SQLite** = 同 4 metric + HKWorkout.UUID 存進 `session.healthkit_workout_uuid`
- **HKWorkoutSession 啟動點** = Watch 端在 in-session 時啟動（lifting 時 high-frequency wrist HR 只有 Watch 拿得到）；iPhone 端不寫，避免 HealthKit 重複紀錄（**Slice 13d 修訂**：Watch HKWorkoutSession 改為 trigger-only sampling、不寫 entry；iPhone 13c writer 唯一寫入點）

## Engineering 結構

- **Codebase** = Monorepo（現有 `TrainingLog/` repo + watchOS target 進 `ios/` 資料夾，CONTEXT.md / ADR 維持單一 source）
- **Watch framework** = SwiftUI native + WatchConnectivity（React Native for watchOS 不成熟，不選）
- **Schema 跨語言** = TypeScript (iPhone) + Swift (Watch) 各自寫 entity；ADR + CONTEXT.md 是 source of truth
- **Apple Developer Program** = v1 開發 day 1 買 ($99/年)；理由：HealthKit + App Group entitlement 必須有 ADP，30+ hrs/週節奏下沒空靠 free signing 7 天重簽

## v1 ship 時程

**26 週 ship 全範圍**（iPhone full + Watch α 簡易 + HealthKit）；30+ hrs/週投入。ADP 365 天涵蓋整個 26 週開發 + ship 後 26 週 polish / TestFlight。

—— 拒絕的替代方案：

1. **路徑 B（Watch 端完整 SQLite + bidirectional sync engine）**：需要 `updated_at` / `last_modified_device` / row-level LWW conflict resolution；對 i + 偶爾 ii 場景過度設計。Watch cellular-only standalone sync 推 v1.5+。
2. **路徑 A（純 push，Watch 完全不存資料）**：iPhone 必須整場 reachable + 醒著；違反「全程不開啟手機」+ `sendMessage` 每按 100~500ms 延遲；OS background 限制讓 sendMessage 不穩。
3. **Watch 角色 b（快速 set logger）/ c-only（純 workout 啟動器）/ d（觀看模式）**：α 模型已選；都不滿足「全程不開啟手機」。
4. **Pre-session payload TTL / 自動 refresh**：邊角防禦把 95% 正常使用者搞煩；transient state 不該負擔 sync 責任。
5. **Complication 進階版（顯示今日排程資訊）**：Timeline provider 邏輯複雜（跨日 / 跨循環 / 休息日 update）；v1.5+ 純加法升級。
6. **Watch Settings 頁**：unit_preference 由 prefetch 帶；其他由 watchOS system 管；多分頁少訓練操作面積。
7. **Watch 端輸入 body data / Set note 文字 / Template-Program-Exercise 編輯**：UX 過重，違反「α 但簡易」原則。

## Q11 HealthKit 範圍重新分配

- **v1（已提前）**：Session WRITE 到 HealthKit `traditionalStrengthTraining`（被 Q10 吃掉）
- **v1.5+**：cardio workouts READ（顯示有氧摘要）— 原本 v1 範圍延後
- **v2+**：body data READ（bodyweight / HRV / 睡眠）

ADR-0008 取代 Q11 的 v1 / v1.5+ 部分；Q11 v2+ 仍保留。

---

## 2026-05-26 Slice 13d Amendment — α-model 擴張 + HK 分工 trigger-only

**主軸**：原 ADR-0008 路徑 C「全程 Watch 主、iPhone 不掏」α 模型在 slice 13d grill 中被使用者調整為**雙向 initiator + bidirectional live mirror**。同時 HK 整合分工從「Watch 寫 HKWorkout」改為「Watch HKWorkoutSession 純 trigger-only sampling、iPhone 13c writer 為唯一 HKWorkout 寫入點」。本 amendment 記錄 13d ship 時 ADR-0008 受影響的決議翻盤點，full detail 見 ADR-0019 § Slice 13d Amendment。

### 翻盤點

- ❌ **line 3「全程 Watch 主，iPhone 不掏」** → 改為**雙向 initiator**：iPhone 訓練 tab + Watch picker root 兩端 UI 都有 [開始訓練] 入口；user 隨手挑哪端 initiate；SQLite 寫在 iPhone（唯一 SoT）、另一端 WC push 進 in-session view live mirror。原 α 模型「iPhone 不掏」是 Watch-leadership 假設；現實使用者期待雙向彈性。
- ❌ **line 24「bw_snapshot 鎖定時機 = pre-session 階段」** → 改為 **session-start moment 鎖定**：雙向 initiator 後 iPhone 在 session start moment 一定 reachable（WC roundtrip 必經 iPhone）、不需 pre-session 提前鎖。
- ❌ **line 76-79 HKWorkoutSession 分工** → 改為 **trigger-only sampling pattern**：
  - Watch 端 `HKWorkoutSession.startActivity()` 開 HR / kcal sampling（watchOS 在 in-session 時把 HR sampling 提到 1Hz + ActiveEnergyBurned 用 workout-grade algorithm）
  - Watch 端 end 時 `HKLiveWorkoutBuilder.discardWorkout()` **不寫** HKWorkout entry（per [Stack Overflow + Apple docs](https://developer.apple.com/documentation/healthkit/hkliveworkoutbuilder)，`discardWorkout()` 是 Apple supported API）
  - iPhone 13c `saveTrainingLogWorkout` 為**唯一** HKWorkout 寫入點（沿用 13c writer、metadata 結構不動）
  - HR / ActiveEnergyBurned sample 仍進 HealthKit store（sample 與 builder 分離、Apple 設計上 source-agnostic）；iPhone 13c reader 不在乎 source、照撈
  - **效果**：dual-write race 整個消失；`session.is_watch_tracked` flag 純粹是 5-tile UI predicate、不參與 writer dedupe
  - **未驗的 invariant**：watchOS 11+ 對 `discardWorkout()` 的 deprecation status；slice 13d D0 commit 用 5-line Swift snippet 實機 spike 驗（3 invariant: HR > ambient ×5 / Fitness 無 entry / 無 deprecation warning）；失敗則退 Branch A（Watch 寫 HKWorkout + iPhone 加 is_watch_tracked skip 邏輯）
- ❌ **line 87-88「Watch 寫 HKWorkout metadata」** → 移除；Watch 不寫 metadata、不寫 HKWorkout（per Q28 Branch C）。
- ❌ **17 條 row 10「暫停 / 結束 Session: pause = HKWorkoutSession.pause()」** pause 部分 deferred to v1.5+；Watch v1 ship 時不顯 pause button（align ADR-0019 § Q9 (b) line 497 no-pause 紀律）。end 仍走 `.end() + discardWorkout()`、不寫 HKWorkout。
- ❌ **2026-05-23 amendment line 58-72「FEATURE_WATCH_HANDOFF gate」** → **移除按鈕、flag 退役**。α-model native handoff = WC bidirectional initiator；原按鈕「iPhone 交接 Watch」語意過時、保留只會誤導 user。slice 13d D2 commit 砍 button + features.ts const + tests/config/features.test.ts。

### 不翻盤、繼續成立

- ✅ **路徑 C 核心模型**（`iPhone = SQLite SoT；Watch = in-memory mirror`）— 仍成立；但 Stage 1 / 2 mapping 在 13d 擴張為完整 13 message-kind 表（見 ADR-0019 § Slice 13d Amendment WC channel mapping table）
- ✅ **UUID 主鍵範圍**（Session / Set / body_metric 三表）— 不變
- ✅ **Schema 影響最小**（新增僅 `set.is_skipped` + `session.healthkit_workout_uuid`）— 13d 再加 v024 `session.is_watch_tracked INTEGER DEFAULT 0`、總計 3 個 13d-affected column
- ✅ **Watch v1 17 條** 大部分仍適用（picker / 即時心率 / 增刪組 / 完成勾 / 休息倒數 / 超級組 / 跳過 Exercise / Pre-session 兩態 / In-session 啟動點 / NowPlaying 系統內建）；deferred items：#12 PR 觸覺通知、#14 complication、#15 結束 summary 卡片
- ✅ **Watch 端輸入限制**（不做 body data 輸入 / 不編 Template / 不編 Program）— 13d 進一步**user 主動限制 Watch 不可 +動作**；要 +動作 → iPhone +動作、Watch via WC sync 自然看到（per ADR-0019 § Slice 13d Amendment § Slice 13e+ preview / known issues 「Watch 上 +動作（user 主動限制）— 永不」line 1283）

### 13d 新增 (α-model 補完)

- **雙向 initiator** — 兩端皆可發起 session、initiator side 寫 session row + bw_snapshot、另一端 WC push live mirror
- **Bidirectional live mirror** — set events / exercise events 雙向 WC sync；iPhone +動作 → Watch 同步看；Watch ✓ set → iPhone 同步看；conflict resolution = diff + per-field LWW ts (in-memory map)
- **Watch picker root 三步 UI** — [計劃訓練 (一鍵)] / [模板訓練 (dropdown)] → 模板 name → 計劃方塊 → 強度方塊（兩 step 分開）
- **iPhone Live Activity** — ActivityKit native widget extension、Watch-led session 期間鎖屏 / Dynamic Island 持續顯 elapsed + HR + kcal
- **Watch 端 ⚙ settings** — per-session settings popover（輸入方式 / 自動跳下組 / Rest timer 模式 / HR alert / 觸覺回饋）；違反 ADR-0008 line 99「Watch Settings 頁 = 不做」原則、但 scope 是 per-session transient state（非全域 user pref）、所以視為 narrow exception
- **Watch 端 ⋯ menu** — per-exercise context menu（刪除 / 重置 / 跳過 / 查看歷史）；與 17 條 row 11 「跳過 Exercise」對齊、擴展為四項

### Cross-references

- 完整 grill decision + commit chain + smoke matrix + test count delta — ADR-0019 § 2026-05-26 Slice 13d Amendment（Q1-Q28 + NEW-Q29-Q47 = 47 decisions total）
- HK reader / writer 13c shipped — ADR-0019 § Slice 13c Amendment
- Pause 紀律 — ADR-0019 § Q9 (b) line 497（不翻盤）
- 5-tile predicate — ADR-0019 § Q6 + Slice 13d Amendment Q24
- Cluster 視覺一致性 — ADR-0012 dropset / ADR-0017 Reusable Superset / ADR-0018 session-side cluster
