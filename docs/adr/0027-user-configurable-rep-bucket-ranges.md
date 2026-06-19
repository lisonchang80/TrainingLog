# ADR-0027 — 使用者可編輯的 rep-bucket 次數範圍

- **狀態**: Accepted（slice 17, 2026-06-16）
- **關聯**: ADR-0006/0007（PR identity = (Exercise, rep bucket)）、ADR-0009（5 桶 + 成就系統）、ADR-0017（rep bucket chip filter）、ADR-0026（app-mode，同期 slice 16）

## 背景

5 個訓練目的桶（最大力量 / 力量 / 增肌 / 肌耐力 / 耐力）的次數邊界在 v1 是 `src/domain/pr/buckets.ts` 的 `readonly const BUCKETS`，固定為 1–3 / 4–6 / 7–10 / 11–15 / 16+。使用者要能在「設定」自行調整這些次數範圍（例：把最大力量從 1–3 改成 1–5），且即時套用到全 App（PR 判定、歷史/圖表分類、Watch）。

`classifyBucket` / `BUCKETS` 是**單一真相源**，被 ~18 個消費點使用（PR 引擎、歷史 repo、rep-bucket filter、成就 replay、seed、Watch history）。

## 決策

### D1 — 可變模組快取（原地 splice），而非穿參數

`BUCKETS` 由 `readonly const` 改成**模組層級可變陣列**，由 `applyBucketRanges()` **原地 `splice` 變更**（陣列 identity 不變）。`getBucketBoundaries()` / `resetBucketRanges()` / `validateBucketBoundaries()` 為配套 API。

**為何原地變更而非「把 config 穿過 18 個呼叫點」**：18 個消費點全在**呼叫時**讀範圍（`classifyBucket(reps)` 或 `BUCKETS.find(...)`）。原地變更同一個陣列物件 → 全部呼叫點零修改即看到新邊界；identity 穩定 → 持有 reference 的點也安全。唯一的 top-level 捕獲（`repBucketFilter` 的 chip key 列）只取 `key`，而 key 永不變、只有範圍變，故不受影響。

**取捨**：原地變更一個 exported const 是非典型寫法（surprising），但對「不破壞 18 消費點」是最穩健的；以重註解 + 本 ADR 記錄。

### D2 — 啟動 hydrate + 每次編輯即套用（無 Context）

- Boot：`components/bucket-ranges-hydrator.tsx`（掛 `DatabaseProvider` 內）讀 `app_settings.bucket_ranges` → `applyBucketRanges`。
- 編輯：設定頁每按一次 stepper 即 `applyBucketRanges(新邊界)`（更新快取）＋ `setBucketRanges(db, …)`（持久化）。
- **不做 React Context**：快取是呼叫時讀的模組變數，不需推 re-render。各頁面本來就在 focus 時 `useFocusEffect` 重載資料 → 改完範圍後切到該頁即反映「即時套用」＝下次 focus（無需 relaunch）。

### D3 — 持久化形狀 + 驗證

- `app_settings.bucket_ranges` = `BucketBoundary[]`（`{ key, min, max }`，**不含 label**；label 為 canonical、不可編輯）。無新 migration。
- 合法 ⇔ 5 個 canonical key 依序、連續覆蓋 1..∞：`[0].min===1`、整數、`min≤max`、`[i].min===[i-1].max+1`、末桶 `max===null`。
- `getBucketRanges` 對 unset / 不合法 → 回 `null`（hydrator 保留 DEFAULT）。`setBucketRanges` 對不合法 → throw（編輯器只會產生合法邊界；UI 用 stepper + clamp 保證連續）。

### D4 — 回溯重新分類（無法避免，且符合預期）

因分類是**即時算**的，改範圍會即時改變所有歷史的桶歸屬（PR 桶、圖表 chip、Watch 頂組標籤）。**已解鎖的成就保留不動**：成就定義用 bucket **key**（非範圍），seed 不需重跑，`achievement_unlock` 列不受影響。

### D5 — Watch 同步

**真因：Watch 不在本機分類 rep bucket。** 頂組桶標籤（如「頂組：80kg×8（增肌）」）是 iPhone 用**當前（已編輯）的 `BUCKETS` 快取**算好、以**display-ready 字串**經 wire（`topSetLine` / snapshot / history records）送到 Watch 顯示的；Watch 端沒有任何 `classifyBucket` 等價邏輯（grep `ios/TrainingLog Watch Watch App/` 零命中）。**因此使用者改範圍後，Watch 的桶標籤已透過「iPhone 算字串」這條路徑自動跟上 → slice 17 零 Swift 變更即達成 parity。**

Stage1 handshake reply 仍夾帶 `bucketRanges`（`Stage1BucketRange` DTO + `bucketRangesToWire()`，鏡像 ADR-0026 app-mode 的 `appMode` flag 做法），但**目前 Watch 端未消費此欄位**——它是**保留的 future-proofing**，供「未來 Watch 真的要在本機分類 rep bucket（例：本機即時顯示剛輸入 set 的桶）」時才解析套用。在那之前，wire 上的 `bucketRanges` 是無害的冗餘資料（每次 handshake ~5 個小物件）。

> **2026-06-16 修訂（overnight 整合稽核翻盤）**：本段原文寫「Watch 端解析後套用到自己的分類」，與實際架構不符（Watch 無本機分類可套用）。已對齊真相：parity 走 iPhone-computed label string、`bucketRanges` 欄位為未消費的 future-proofing，**非 bug、非 device-gate 阻塞**。

## 影響

- `src/domain/pr/buckets.ts`：`BUCKETS` 可變化 + 新 API；`classifyBucket`/`bucketLabel` 讀快取。
- `settingsRepository`：`bucket_ranges` getter/setter（含驗證）。
- `app/(tabs)/settings.tsx`：「訓練目的次數範圍」編輯器（5 列 stepper + 恢復預設）。
- `app/_layout.tsx` + `components/bucket-ranges-hydrator.tsx`：boot hydrate。
- `src/adapters/watch/handshake.ts` + Watch Swift：`bucketRanges` 同步。
- 18 個消費點：**零修改**（呼叫時讀快取）。
