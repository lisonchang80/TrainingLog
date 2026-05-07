# ADR-0011: Backup and Sync Strategy for v1

## TL;DR

v1 採 **iCloud Drive 自動備份整個 SQLite 檔** 作為換手機 / 災難恢復機制；輔以 **JSON export** 給 user 自我控制權。**多裝置即時 sync (iPad / 雙手機) 排除**，所以**不採 CloudKit row-level sync**。Settings 從 AsyncStorage 搬進 SQLite，跟 backup 一起被涵蓋。Watch sync 跟 backup 用 **5min timeout 機制**保證順序（解 ADR-0008 best-effort 邊界）。

## Context

ADR-0008 處理了 Watch ↔ iPhone 的 multi-device 模型（Path C：iPhone source of truth + Watch in-memory + transferUserInfo），但留下兩個未解：

1. **iPhone 本身壞 / 換手機**：source of truth 歸零 = 整套訓練資料消失。Q14 grill 對象。
2. **Settings 在 AsyncStorage**：跟 SQLite 不同生命週期 → restore 後 unit_preference 等偏好設定會反同步（user 慣 lb 變 kg 會炸）

本 ADR 處理 v1 的**備份策略**範圍。

## Decision

### 1. Scope（Q14.1）

**v1 必做：**
- (a) **換手機**（每 3-5 年常見場景）
- (b) **災難恢復**（手機壞 / 遺失）

**v1 加分：**
- (d) **JSON export**（user 自我控制權 + disaster fallback）

**排除：**
- (c) **多裝置即時 sync**（iPad app / 雙手機並用）→ 自用 + 沒 iPad app + Watch 已透過 ADR-0008 處理 → c = scope creep，延 v2+

**rationale**：a + b 本質同一個 mechanism（cloud 自動備份就同時解兩者）；c 排除大幅簡化，可走「整檔 SQLite 備份」單向模型，不需 row-level sync + conflict resolution。

### 2. Mechanism（Q14.2）

**採 A 方案：iCloud Drive 自動備份整個 SQLite 檔**

- App 在 iCloud ubiquity container 開 folder：「TrainingLog」
- folder 內放 `backup.sqlite`（最新）+ `backup.previous.sqlite`（上一份）
- User 在 iCloud Drive 看得到該 folder + .sqlite 檔，可手動下載 / share
- 復原時機：App 啟動時偵測「local 無檔 + ubiquity 有檔」→ 拉下來
- Schema 影響 = 0（純檔層備份）

**Expo 實作要點：**
- Expo SDK 54 沒原生 iCloud Drive API
- 採用 `react-native-cloud-storage` 或自寫 native module（NSFileManager + `url(forUbiquityContainerIdentifier:)`）
- **預估工程 +1-2 週**（Expo native module 配置 + ubiquity container 整合是主要 risk 點）

### 3. Trigger + Retention（Q14.3）

**觸發時機（採 a3）：**
- **Session 結束時** — 最穩定 checkpoint
- **App 進 background 時** — cover 非 Session 操作（改 Template / 輸體重）
- **Debounce 5 分鐘** — 避免「Session 結束緊接著切 background」連觸發兩次

**保留策略（採 b2）：**
- **最新 + 上一份 = 2 份 rotate**
- Backup 前先 atomic rename `backup.sqlite` → `backup.previous.sqlite`，再寫新 `backup.sqlite`
- Corruption fallback：v1 dev 階段 SQLite migration / app 寫壞風險真實存在；2 份 rotate 是最低成本的雙保險

### 4. Restore + Edge Cases（Q14.4）

**Restore UX（a2）：**
- 第一次啟動 detect 到 iCloud 有 `backup.sqlite` → 跳確認框
- 訊息含「備份日期 + 內容預覽」（例：「備份內含 142 個 Session，最後一筆 2026-04-30」）
- User 二選：「還原」/「全新開始」

**iCloud 帳號狀態（b2）：**
- **沒登 iCloud / iCloud Drive 關閉**：警告但允許進 app
- Settings 顯示永久紅色狀態「未啟用 iCloud 備份」
- Onboarding 結尾溫和提醒一次

**Restore 後 onboarding（c1）：**
- Restore 完成 → 直接進主畫面（skip onboarding）
- 因 restore 內容已含 user 資料，再走 onboarding 是 friction

**Settings 搬進 SQLite（s2）：**
- 新增 `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` 表
- unit_preference / dark mode / 預設休息時間 / backup_mode 等偏好全在這
- AsyncStorage 不適合 — restore 後會跟 SQLite 反同步

### 5. JSON Export（Q14.5）

- **範圍**：完整 dump（Exercise / Template / Session / Set / body_metric / app_settings 全表）
- **Format**：JSON（user 看得懂、跨平台 portable、跟 SQLite version 解耦）
- **方向**：v1 export only，import 延 v1.5+（避免跟 A 方案 SQLite restore 衝突）
- **加密**：不加密（自用無個資；user 要加密自己用 7zip 包）
- **觸發點**：Settings「匯出資料 (JSON)」按鈕 → iOS Share Sheet（AirDrop / Mail / Files / Notes）

### 6. Watch sync vs Backup 順序保證（Q14.6）

**邊界 case：**
ADR-0008 規定 Watch transferUserInfo = best-effort。Session 結束時 backup trigger 立即執行，但最後 1-2 組 set 可能還在 Watch in-memory queue 沒到 iPhone → backup file 不完整 → 換手機 restore 後丟失。

**採 A3 方案：條件式延遲 + 5min timeout**

- iPhone 維護 `pending_watch_sync: bool` 旗標
- Watch 每送一個 event 進 transferUserInfo → iPhone 收到 → flag 暫設 true
- iPhone 確認 Watch 端 queue 全空 → flag 設 false
- Backup trigger callback：
  ```
  if !pending_watch_sync:
      execute_backup()  // 95% 場景，無感
  else:
      schedule_backup_after_sync_or_5min()  // 5% 場景，等 sync 或 5min force
  ```
- 5 分鐘 force 是 escape hatch（避免 Watch 出 BLE 範圍 = 永遠等不到）
- backup metadata 紀錄 sync 完整度 → 若 force backup（缺漏）：Settings 顯示警告「上次備份缺最後 X 個 set」

**Schema 影響**：新增 `session.last_watch_sync_at TIMESTAMP NULL`（記錄 Watch confirm 完整度）

### 7. Failure Escalation（Q14.7）

| 場景 | 行為 |
|---|---|
| iCloud 寫入失敗（容量滿 / 網路錯誤）| Settings 紅警示 + push notification |
| 連續 3 天（auto 模式）/ 7 天（manual 模式）沒成功 backup | push + Settings 紅警示 + 主畫面頂部 banner（dismissable 1 天）|
| Restore 時 `backup.sqlite` open 失敗 | 自動 fallback 到 `backup.previous.sqlite` |
| 兩份 backup 都壞 | 顯示「兩份備份都損毀」，提示 user 用 JSON export 手動 recovery（v1 沒 import → 「請聯絡 dev」）|
| iCloud Drive 不可用 / 換 Apple ID | 啟動 detect 不可用 → Settings 永久紅警示 + 首次 detect 時推一次 alert |

**Push notification 前提**：onboarding 階段需請求 push permission（v1 onboarding 加這條）

### 8. Backup Mode Toggle（Q14.8）

**Settings 提供「自動備份 ON / OFF」toggle（預設 ON）**

- **ON（auto）**：a3 兩個 trigger 都觸發
- **OFF（manual）**：純手動 — 只有「立刻備份」按鈕觸發
- Manual 模式下 7 條 escalation threshold 從 3 → 7 天（避免騷擾，因為手動是 expected behavior）
- a1 寫入失敗 / d1 iCloud 不可用警示**不論 auto/manual 都適用**

**目的**：給 iCloud 容量焦慮 / 控制狂 user 退路；預設 auto 保護 dummy user。

**Settings UI（v1 ship）：**
```
備份
─────────────────────────────────
[●━━ ] 自動備份                      ON
       Session 結束、App 切換時自動
       備份到 iCloud

立即備份               [按鈕]
還原上一份備份         [按鈕]
匯出資料 (JSON)        [按鈕]

上次備份：2026-05-07 14:32
備份位置：iCloud Drive › TrainingLog
```

## Schema Impact

| 變更 | 用途 |
|---|---|
| 新增 `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` | Settings 從 AsyncStorage 搬進 SQLite，跟 backup 一起涵蓋 |
| 新增 `session.last_watch_sync_at TIMESTAMP NULL` | 記錄 Watch confirm 完整度，給 Q14.6 5min timeout 邏輯用 |
| 新增 `backup_log` 表（**或**用 `app_settings` key 紀錄）| backup metadata（成功時間 / sync 完整度 / 失敗 reason）|
| **不需要** row-level `last_modified` / `soft_delete` | c 場景排除，不做 row-level sync |
| **不需要** schema 大改 | A 方案是檔層備份，sync layer 對 schema 透明 |

**SQLite 版本管理**：採 `PRAGMA user_version` + numbered migration scripts（標準做法）；v1 ship 後每個 schema 變更必須有 migration script，向下相容至少 1 major version。

## Module Impact

**新增 Pure Domain Logic 模組（第 11 個）：**

#### #11 — Backup Manager
純邏輯，**測試對象**：
- Backup trigger debounce
- Watch sync 旗標檢查邏輯
- 5min timeout escape
- Backup file rotate 順序
- Failure detection + escalation policy（3/7 天 threshold）
- Mode toggle behavior

**新增 Platform Adapters（從 #12 開始重編號）：**

- **iCloud Drive Adapter**（NSFileManager + ubiquityContainerURL，Expo native module 或 react-native-cloud-storage）
- **JSON Export Adapter**（SQLite → JSON serialization + iOS Share Sheet）
- **Push Notification Adapter**（local notification for failure escalation）

**既有 Settings UI 加 backup 區段**：status display / 立即備份按鈕 / rollback 按鈕 / mode toggle / 匯出 JSON。

## Rejected Alternatives

1. **CloudKit private database (row-level sync)** — 為 c (多裝置 sync) 設計，c 已排除 = overkill；工程成本 +4 週 + 永遠的 conflict 邊界 case 維護
2. **純 manual export，無 auto cloud** — User 必然會忘，上架後第一波負評來源
3. **依賴 iOS 系統 iCloud Backup** — Best-effort 不可靠（user 可關閉、SQLite 大檔可能跳過、不能手動觸發）
4. **A1 - Backup 等 Watch 完整 confirm** — Watch 出 BLE 範圍時 = 永遠等不到（user 練完離開健身房開車回家 30 分鐘什麼都做不了）
5. **A2 - Backup 立即不管 Watch** — 「丟失最後幾組 set」是高發 + 高痛場景
6. **A4 - Backup 觸發兩次（Session 結束 + Watch confirmed）** — iCloud 寫流量 2x，rotate 邏輯被打亂
7. **Settings 留在 AsyncStorage** — Restore 後 settings 跟 SQLite 反同步，user 慣 lb 變 kg 會炸
8. **JSON v1 雙向 export + import** — 跟 A 方案 SQLite restore 衝突，UX 兩條路混亂；工程 +2 週；v1 沒急迫需求
9. **Backup encryption** — 自用無個資；user 忘密碼風險 > 洩漏風險；增加 onboarding 複雜度
10. **三段式 backup mode (auto / manual / 完全停用)** — 「完全停用」可用 manual + 不點按鈕達成，第三段冗餘
11. **多版本保留 (b3 = 7 天 / b4 = 3 keypoint)** — 對自用 over-engineering；2 份 rotate 已 cover 主要 corruption fallback；UX 無「版本選擇焦慮」需求
12. **b1 - 只保留最新 1 份** — 任何 corruption 全沒救；對 v1 dev 不夠 robust
13. **Force user 登 iCloud 才能用 app** — 違反 iOS HIG（HealthKit-only / financial 才能 force）
14. **Restore 自動執行不問 user** — Dev / 測試 / 借朋友手機等場景 user 會「啊我不要這個」

## v1 ship 影響

- **Schema 影響小**（新增 1 表 `app_settings` + 1 欄位 `session.last_watch_sync_at` + backup metadata）
- **新增 1 pure logic 模組**（Backup Manager → 第 11 個模組）
- **新增 3 platform adapters**（iCloud Drive / JSON Export / Push Notification）
- **Settings 頁需擴充** backup 區段（5 個 UI 元素）
- **預計工程 +1.5-2 週**（iCloud Drive Expo native module 是主要 risk 點）
- **Onboarding 結尾加 push permission prompt**（讓失敗 escalation 能推 notification）
- **整合 ADR-0008**：5min timeout 機制是對 Watch best-effort sync 的補強

## Cross-references

- 整合 [ADR-0008](./0008-multi-device-strategy-and-watch-v1-scope.md)（Path C + UUID PK + Watch transferUserInfo best-effort 邊界）
- 補強 Q14 grill round 全部子問題（Q14.1 ~ Q14.8）
