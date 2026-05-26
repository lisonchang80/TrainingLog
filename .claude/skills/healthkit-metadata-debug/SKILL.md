---
name: healthkit-metadata-debug
description: >
  Apple HealthKit metadata gotchas + reverse-engineering 別 app 寫入的
  HKWorkout / sample metadata 慣例。Trigger 詞: "Apple Fitness 顯示預設
  名稱不是 brand name", "HKWorkout 標題不對", "HKMetadataKey 看起來空",
  "查訓記怎麼寫 metadata", "HK 寫入 metadata 沒生效", "metadata key
  string value", "HKWorkoutBrandName / HKMetadataKey ObjC 常數",
  "HK reverse-engineer 別 app". 涉及檔案: src/adapters/healthkit/writer.ts,
  src/adapters/healthkit/reader.ts, finalize handler (e.g. app/(tabs)/index.tsx).
  Validated 1× slice 13c 2026-05-26 — B1 brand name 沒顯示 root cause
  (錯誤 key + empty string 雙重坑) 在 2 個 smoke iteration 內解掉。
---

# HealthKit Metadata Debug — TrainingLog

## TL;DR

寫 HKWorkout / HK sample metadata 時，**ObjC NSString 常數的 serialized 字串值 ≠ 常數名**。例如：

| ObjC 常數（Apple docs 寫的名字）| 實際 serialized NSString 值 |
|---|---|
| `HKMetadataKeyWorkoutBrandName` | `"HKWorkoutBrandName"` |
| `HKMetadataKeyExternalUUID` | `"HKExternalUUID"` |
| `HKMetadataKeyHeartRateMotionContext` | `"HKMetadataKeyHeartRateMotionContext"`（這個沒 strip！）|
| 一般規律 | **多數**會 strip `HKMetadataKey` 前綴、但**不保證** |

`@kingstinct/react-native-healthkit` (Nitro) 的 metadata 是 `AnyMap`，JS 端 key 直接傳到 Apple HK store。**用錯 key Apple 不會報錯**、samples 照樣寫進去、但 Apple Fitness app / 自家 apps 找不到那個 key → silently 退回 fallback（如顯示 activityType 預設名）。

## When TO use

- Apple Fitness app 顯示「傳統肌力訓練」/「功能性肌力訓練」這種**預設 activityType 名稱**、不是你設的 brand name
- 寫入後 `queryWorkoutSamples` dump metadata 看到你寫的 key、但 Apple UI 不顯示
- 想反向 engineer 別 app（訓記、Strong、Hevy 等）怎麼寫 HK
- 第一次設新 metadata key（program name / note / RPE）不確定 string value

## When NOT to use

- HK read 路徑問題（用 `ios-simulator-smoke` 或 expo-bare-build-pipeline）
- HK 權限沒給（用 settings deep link、不是 metadata 問題）
- HKWorkout 寫不進去（用 expo-bare-build-pipeline gotcha #1 — New Arch 相容性）

## Recipe — 3 階段

### 階段 1: 確認 key string 對不對

**先用既有對照表**（上面 TL;DR）。表裡沒列的 key → 跑階段 2 probe 反查。

**永遠避免**：直接把 ObjC 常數名（`HKMetadataKey*`）當 JS string key 用。**多數**會 silently 失效。

寫 metadata 範例（writer.ts pattern）：

```ts
const metadata: Record<string, unknown> = {
  // ✅ stripped prefix — Apple Fitness reads this
  HKWorkoutBrandName: input.title,
  HKExternalUUID: input.sessionId,

  // ❌ full ObjC constant name — Apple stores but ignores
  // HKMetadataKeyWorkoutBrandName: input.title,
};
```

### 階段 2: 反向 engineer probe — dump 別 app 的 metadata

加 one-shot debug 到 reader（**完事後記得 remove**）：

```ts
// 在某個 useEffect-triggered reader call 裡塞 probe
try {
  const mod = require('@kingstinct/react-native-healthkit');
  const workouts = await mod.queryWorkoutSamples({ limit: 10, ascending: false });
  for (const w of workouts) {
    const json = w.toJSON ? w.toJSON() : w;
    const src = json.sourceRevision?.source?.name ?? '?';
    // 篩出非我們寫的（也可不篩、全 dump）
    console.log(
      '[hk-meta-probe] source=', src,
      'activityType=', json.workoutActivityType,
      'metadata=', JSON.stringify(json.metadata),
    );
  }
} catch (e) {
  console.warn('[hk-meta-probe] failed:', e);
}
```

**注意**: `sourceRevision.source.name` 在 Kingstinct toJSON 後可能回 `"SourceProxy"`（未展開的 proxy 名稱）、不是 app name。所以**不要靠 string match filter**、直接 dump 全部、肉眼判斷。

iPhone reload → 開任意詳情頁 → Metro log 看 `[hk-meta-probe]` 行。可以看到：
- 自己寫的 metadata（驗證 key 正確生效）
- 別 app 寫的 metadata（學他們的 convention）

### 階段 3: 抓 empty string / null 邊界

即使 key 對、**value 是空字串** Apple Fitness 仍會 silently 退回 fallback。

對 TrainingLog 特定坑（**slice 13c B1 fix 第 2 步**）：
- `session.title = ''` 是 freestyle session 的 DB convention（UI 顯示時才 fallback i18n placeholder）
- 直接傳 `session.title` 給 HKWorkoutBrandName → 空字串進 metadata → Apple Fitness 退顯 activityType 預設名（「傳統肌力訓練」）
- **修法**：caller side resolve 到 placeholder：
  ```ts
  const displayTitle = session.title || t('page', 'sessionTitlePlaceholder');
  saveTrainingLogWorkout({ title: displayTitle, ... });
  ```
- Writer 內**不要**做這個 fallback（會把「UI placeholder 是什麼」概念漏進 adapter 層）

## Slice 13c lessons (2026-05-26)

1. **First-smoke evidence trumps Apple docs.** Apple developer forums / docs 多次說「TestFlight vs Xcode dev build」對 Fitness app icon / metadata 沒差別。**真機 smoke 反證**：dev build single-size icon 不顯（B4）、metadata key 寫錯不報錯但靜默失效。Smoke 之後再 reasoning。
2. **Key 對 ≠ 寫對**：B1 fix 分兩步。第 1 步把 `HKMetadataKeyWorkoutBrandName` 改 `HKWorkoutBrandName`、smoke 還是顯預設名 → 用 probe 才發現 value 是 `""`。
3. **訓記用 traditionalStrengthTraining、不是 functional**：第一次看到 訓記 entry 在「體能訓練」filter tab 以為是 functional，後來看到 訓記也用 traditional + 自訂 brand name。Q6 grill 拍 functional 是看 第一張截圖誤判、第二張全 traditional 截圖才更正。**Lesson**: 不要只看一張截圖就拍板 activityType。
4. **probe 結果可能全是自己的**: `sourceRevision.source.name` 在 Kingstinct toJSON 後常回 `"SourceProxy"` proxy 名稱、`filter if src.includes('TrainingLog')` 不會排掉自己寫的。最好直接 dump 全部、肉眼分。

## Anti-patterns

- ❌ 直接用 ObjC 常數名（`HKMetadataKeyXxx`）當 JS string key — silently 失效
- ❌ writer adapter 內做 i18n placeholder fallback — UI 概念漏進 adapter 層、test 也難寫
- ❌ 只 commit metadata key fix 卻沒 verify Apple Fitness 真的顯示 — 永遠先 probe 確認 key 對 + value 非空
- ❌ 用 `sourceRevision.source.name` filter probe 結果 — Kingstinct proxy 名稱不是 app name
- ❌ 看 1 張別 app 截圖就拍板 activityType — 多看幾張、跨 tab 看
- ❌ 忘了 remove probe 就 commit — probe 是 one-shot debug、commit 前刪掉
