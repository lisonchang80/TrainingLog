# 0023 — i18n locale 解析與 persistence（AsyncStorage tri-state + expo-localization fallback）

Status: accepted (2026-05-23 catch-up；landed 2026-05-23 overnight wave Agent B commits `9dcb671..f234593`)

App locale 走 **AsyncStorage-backed tri-state**（`'zh' | 'en' | 'auto'`），`'auto'` 由 `expo-localization` 解析裝置 locale 後映射到 `'zh'` 或 `'en'`。Boot 時 `loadStoredLocale → resolveLocale → setLocale` 三步在 SQLite open 之前完成，確保第一個 `t(...)` 呼叫已有正確 locale。

## Context

i18n Phase 1-4（2026-05-22）把約 511 處 inline string 重構成 `t('namespace', 'key')` + 動態 helper、`src/i18n/strings.ts` 確立 9 namespace × 346 key × 2 locale 的雙語字典結構。Phase 4-5 之間擱了一陣子是因為 toggle UX 細節待拍板（auto vs 強制 binary、locale 該放 SQLite 還是 AsyncStorage、boot 順序怎麼安排）。Phase 5（2026-05-23 overnight Agent B）三個檔交付完整 toggle：

- `src/i18n/locale-persist.ts` — 純 helper（load / save / resolve）
- `app/_layout.tsx` — boot useEffect hydrate
- `app/(tabs)/settings.tsx` — 3-radio Settings row（自動 / 中文 / English）

但 Phase 5 整段沒進 ADR、CONTEXT.md 也沒 locale 詞彙，後續 agent 不知道為什麼 locale **不在** `app_settings` (ADR-0011 預期的 settings 容器)。本 ADR 為此鎖定。

## Decision

### Tri-state storage value

`StoredLocaleValue = 'zh' | 'en' | 'auto'`：

- `'zh'` / `'en'` — 使用者 explicit 選；resolver 直接返回
- `'auto'` — 跟裝置 locale；resolver 走 `expo-localization`

預設值 = `'auto'`（首次安裝 / 任何讀取失敗 fallback 到 auto，**不**直接落入某個具體 locale）— 讓裝置語系決定優先於 i18n 預設值。

### Storage location: AsyncStorage NOT `app_settings`

**為什麼不用 ADR-0011 規劃的 `app_settings` SQLite 表**：

i18n locale 必須在「第一個 `t(...)` 呼叫**之前**」就 resolved 完畢。如果走 `app_settings`：

1. App 啟動 → `database-provider.tsx` 初始化 SQLite
2. 跑 migration（v001-v022 全跑一次）— 此時 migration UI 文字、錯誤訊息都已經渲染
3. 第一個 SELECT `app_settings` 拿 locale
4. 才能 `setLocale(...)`

意思是 migration 階段的所有 `t(...)` 都會落在「未 hydrate」的預設 locale。AsyncStorage 路徑：

1. App 啟動 → `_layout.tsx` useEffect 先跑 `loadStoredLocale + resolveLocale + setLocale`
2. AsyncStorage 讀取無 SQLite 依賴、純 KV
3. SQLite open + migration 在 locale 已 hydrate 之後才動

→ AsyncStorage 滿足「boot 順序前置」剛需、`app_settings` 無法。

### Storage key: `app.locale.preference`

AsyncStorage key namespace = `app.<area>.<setting>`。本 setting 走 `app.locale.preference`。

### Fallback chain

```
explicit 'zh' or 'en'         → use as-is
'auto' + device locale 'zh*'  → 'zh'  (含 zh, zh-TW, zh-Hant, zh-HK, zh-CN, …)
'auto' + device locale 其他    → 'en'
AsyncStorage read error       → 'auto' (defensive — never crash boot)
malformed stored value        → 'auto' (defensive — never accept garbage)
```

**Why binary 'zh' / 'en' 而非完整 locale code**：產品內部字典只有 2 個 locale (zh-Hant + en)，任何 zh-* 變體（簡中、港粵、繁中）都映射到同一份 zh 字典；en 是 fallback。日後若加 ja / ko / 簡中分版，再擴 resolver。

### 9 namespace × 346 key × 2 locale shape

`src/i18n/strings.ts` export `{ zh: {...}, en: {...} }` 兩塊鏡像物件。9 namespace（`page` / `button` / `status` / `label` / `field` / `placeholder` / `error` / `common` / `domain`）由 Phase 3 拍板。`tNamespace` literal type + `keyof` 校驗 → 任何 typo / 漏 key 在 tsc 階段被抓。

### Dynamic helpers separation

非靜態文字（含 number / date / DB-row → display string round-trip）走 `src/i18n/dynamic.ts`：

- **Round-trip DB helpers**：`tMuscleGroup(mgId)` / `tEquipment(eq)` / `tLoadType(lt)` — 拿 DB row 字串，回 localized 顯示文字。對 filter chip 必要：chip text 走 localized 顯示、回 DB 比對時用原始 row 字串、不會因為 locale 切換而 chip selection state lost。
- **數字 / 日期 interpolation**：`tNExerciseCount(n)` / `tYearMonthTitle(year, m)` / `tNDaysAgo(n)` / `tSetXOfY(x, y)` 等 — 跨 locale 在 helper 內 branch，呼叫端不需 import locale 狀態。
- **DB seed name 不翻譯**：`program.name` / `template.name` / 使用者 typed sub_tag 永遠 verbatim 顯示。理由：這些是 user-content、翻譯會破壞 user 在使用者世界裡記住的字串身份。Filter chip / 選單顯示 program name 時直接 render `prog.name`、不過 `t(...)`。

### Settings UI

`app/(tabs)/settings.tsx` 加「語言 / Language」section，3 個 Pressable radio：

```
○ 自動  (跟系統)
○ 中文
○ English
```

`onPress` → `await saveStoredLocale(v)` + `setLocale(resolveLocale(v))` + re-render（透過 i18n event subscription / context 觸發整 app 刷新）。

### Boot order

`app/_layout.tsx` 頂層 useEffect (deps `[]`)：

```tsx
useEffect(() => {
  (async () => {
    const stored = await loadStoredLocale();
    setLocale(resolveLocale(stored));
    setReady(true);
  })();
}, []);
```

`setReady(true)` 前 render 一個極簡 splash / 空白避免 flash unstyled text。Splash 內**不**呼叫 `t(...)`（純 logo / spinner）— 此時 locale 還沒 hydrate。

## Alternatives considered

- **(a) 用 `app_settings` SQLite key** — 已分析、boot order 不合；REJECT。
- **(b) 用 `Localization.getLocales()` 純檢測無 user override** — user 想看英文但裝置設中文（或反之）就完全無解；REJECT，必須有 explicit override。
- **(c) `'auto'` 解析直接寫死成 `'zh'`** — `expo-localization` 帶的裝置 locale 是真資料、扔了浪費；REJECT。
- **(d) Native module / OS-level locale 切換**（如 `i18n-js` 整合 NSLocale）— 過度工程、AsyncStorage tri-state 已涵蓋 95% 場景；DEFER 至日後若需要 per-app 系統級 locale 覆蓋再開 ADR。
- **(e) 把字典分拆成多個小 JSON、lazy load per namespace** — 9 namespace × 346 key × 2 locale 整個 zip 後 < 60KB，runtime cost 可忽略；過早 optimisation；REJECT。

## Consequences

- **Boot order 約束已落實** — locale hydrate 在 SQLite migration 跑之前，第一個 `t(...)` 已有正確 locale。
- **AsyncStorage 不進 backup / sync** — ADR-0011 backup 策略涵蓋 SQLite db（含 `app_settings`），AsyncStorage 屬於使用者本地偏好、不跨裝置 sync（合理：locale 是裝置層偏好、跨裝置 sync 無意義）。
- **DB seed name 永遠 verbatim** — user typed program / template / sub_tag 不翻譯。CONTEXT.md 強度 / Program 副 詞彙跨 locale 不變。
- **CONTEXT.md 需要增補**（per audit M4）— `localePersist` / `tMuscleGroup` / `tEquipment` / `tLoadType` 4 個 helper 加入 Domain 模組塊；rename 對照表保持中性語言不必跟 locale 走。
- **Dependencies 對齊 SDK 54** — `expo-localization` 必須走 `npx expo install`（非 `npm install`）以拿到 SDK-managed `~17.0.8`；`@react-native-async-storage/async-storage` 同理 `~2.2.0`。已在 wave commit `3a7238b` 校正。

## References

- **Wave commits** — `9dcb671` `edea6ba` `f234593`（locale-persist 模組 + boot wire + settings UI）、`3a7238b`（SDK 54 deps 校正）
- **Source code** —
  - `src/i18n/locale-persist.ts` (67 行)
  - `src/i18n/strings.ts` (~1000 行，9 namespace × 2 locale)
  - `src/i18n/dynamic.ts` (helpers `tMuscle` / `tMuscleGroup` / `tEquipment` / `tLoadType` / `tNExerciseCount` / `tYearMonthTitle` / 等等)
  - `app/_layout.tsx` boot useEffect (around line 50)
  - `app/(tabs)/settings.tsx` 語言 section
- **Tests** —
  - `tests/i18n/locale-persist.test.ts` (7 case — roundtrip / zh-Hant 映射 / non-zh→en / explicit override / malformed defensive)
  - `tests/i18n/strings.test.ts` (shape invariant — zh / en blocks key 集合相等)
  - `tests/i18n/dynamic.test.ts` (helper round-trip + locale switch)
  - `tests/i18n/dynamicOverwrite.test.ts` (wave 18g overwrite helpers)
- **Related ADRs** —
  - ADR-0011 § app_settings — 本 ADR 解釋為何 locale 不走那條路徑
  - ADR-0017 § Q9 muscle naming revise — i18n round-trip 保留 DB row 文字 identity，本 ADR 鞏固那個設計
- **Skill** —
  - `overnight-parallel-agents` 加入 item #18 (append-only protocol 不防 same-key dup) + #19 (npx expo install fallback 風險) + #20 (python keep-both conflict resolver) + #21 (cherry-pick range 左閉右閉)
