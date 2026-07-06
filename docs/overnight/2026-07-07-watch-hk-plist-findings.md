# Agent D (wave-2) — Watch HealthKit usage-description "blocker"

**Branch**: `overnight/watch-hk-plist-2026-07-07` (base main @ 2574061)
**Verdict**: **FALSE ALARM — no blocker, no native change made.**

## 根因判定：agent C 的 blocker 推翻
Agent C 只看了 checked-in 的**部分** plist（`ios/TrainingLog-Watch-Watch-App-Info.plist`，
內容僅 `UIBackgroundModes`/`WKBackgroundModes`），沒看到 build-settings 供的鍵。

Watch target 兩個 build config（Debug 585–591、Release 641–648）皆有：
- `GENERATE_INFOPLIST_FILE = YES` + `INFOPLIST_FILE = "TrainingLog-Watch-Watch-App-Info.plist"`
- `INFOPLIST_KEY_NSHealthShareUsageDescription = "TrainingLog Watch 讀取訓練心率與消耗熱量、用於本機顯示。"`
- `INFOPLIST_KEY_NSHealthUpdateUsageDescription = "TrainingLog Watch 不直接寫入健康資料，本鍵預留以符合 watchOS HKHealthStore API 要求。"`

`GENERATE_INFOPLIST_FILE=YES` 時 Xcode 會把所有 `INFOPLIST_KEY_*` **merge 進** custom
`INFOPLIST_FILE` 產出最終 Info.plist → 出貨的 Watch Info.plist **已含**兩個 HK usage 字串。
Watch entitlements（`ios/TrainingLog Watch Watch App/TrainingLog Watch Watch App.entitlements`）
也已有 `com.apple.developer.healthkit`。授權框有說明、送審不缺。

## 為何「不」直接改 plist（否則是假修/製造 bug）
若照原任務往部分 plist 加同名 NSHealth 鍵，會與 `INFOPLIST_KEY_*` 造成**重複鍵**衝突，
是退步不是修正。且移除 `INFOPLIST_KEY_*` 需改 pbxproj — 本輪硬性約束禁止動 pbxproj。
故**不動任何 native 檔**。

## Persist 結論（回答任務第 2 題）
- Expo bare workflow，`ios/` 已 checked-in，`.gitignore` 只排 `ios/Pods|build|xcuserdata`，
  未排 Watch plist。**app.json plugins 無任何管 Watch target 的 config plugin**
  （`@kingstinct/react-native-healthkit` 只灌 host `ios/TrainingLog/Info.plist`，不碰 Watch）。
- Watch target 是手動加進 Xcode 的，`expo prebuild` 不會覆蓋它 → agent C「prebuild 會沖掉」
  對手動 Watch target **過度保守、可推翻**。但此處已無須改 plist，moot。

## host 端對照（第 3 題）
host `ios/TrainingLog/Info.plist` 兩個 HK 字串為**真實文案非 placeholder**
（memory 提的 placeholder 疑慮在此不成立）：
- Share: 「TrainingLog 需要讀取 Apple Watch 訓練心率與消耗熱量、用於詳情頁統計。」
- Update: 「TrainingLog 會在無 Apple Watch 紀錄時、把訓練 session 寫入健康資料…」

## 剩餘人工驗證（可選、非 blocker）
- 下次 archive 後可用 `plutil -p` 檢視 build 出的 `.app/Info.plist` 確認兩鍵在最終產物內
  （build-settings merge 為標準 Xcode 行為，信心高）。
- 本 agent **未跑 build/archive** → merge 行為標「unverified until next archive」，但屬既有設定、非本輪新增。

## 交付
Branch 僅含本報告 doc，**零 native 變更**。無 blocker 需修。
