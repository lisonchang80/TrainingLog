# 0026 — App Mode：計劃模式 vs 極簡模式（app-wide presentation mode）

Status: accepted (2026-06-15)

Settings 新增一個 app-wide 模式切換 **計劃模式（`plan`）/ 極簡模式（`minimal`）**：

- **計劃模式** = 目前完整 App，零改變（預設值）。
- **極簡模式** = 整個「計劃（program）」概念從 UI 消失：使用者只看到模板名稱，**不選計劃、不選強度**，開始任何模板一律解析為「通用」（program=NULL、sub_tag=NULL）。iPhone 與 Apple Watch 兩端同步。

模式存於 `app_settings.app_mode`（plain string enum，**無 migration**，讀不到時預設 `'plan'`），透過新的 `AppModeProvider` / `useAppMode()`（SQLite-backed、放在 `DatabaseProvider` 內）reactively 餵給整棵樹，切換即時生效、完全可逆。

## Context

使用者只用「通用」訓練，計劃/強度的兩段選擇器（StartTemplateSheet、TemplateMetaSheet、Watch 兩層 sheet）對他是純負擔。需求：一個開關把「計劃」整套藏掉，讓 App 退化成「模板清單 → 點一下就開練」。

動工前以 4 個探索 agent 攤出全部受影響面（iPhone 13 處 + Watch picker 鏈 + Stage1 pipeline + Settings/preferences）。關鍵發現：**Y-dup 的 variant 解析機制本來就 通用-safe** —— `planResolveTarget`（iPhone）與 `resolveVariant`（Watch）傳 `(null,null)` 就會「優先命中通用 variant、否則 fallback 到 representative（最新）」。因此極簡模式核心邏輯不需重寫，只是「藏選擇器 + 自動帶 (null,null) + 靜音 miss 提示」。

## Decision

### D1 — 範圍：整個「計劃」概念在極簡模式下隱藏

不只藏選擇器。極簡模式下隱藏：
- Programs 分頁（`app/(tabs)/_layout.tsx` 該 tab `href: null`）＋計劃精靈/詳情所有入口
- 首頁今日計劃 section、進行中計劃 banner、「無計劃」CTA（`app/(tabs)/index.tsx`）
- 開始訓練 / 另存模板 / 另存強度的計劃+強度選擇器
- 過去 session 詳情的「計劃·強度」副標題、刪除模板的 variant 預覽（**歷史顯示也藏**，徹底看不到計劃概念）

### D2 — Watch 同步（explicit flag，非空資料）

Stage1 handshake reply 的 `prefetch` 多帶一個 `appMode: 'plan' | 'minimal'` 欄位（**不是新 envelope kind**，只擴既有 prefetch payload；Swift 端 tolerant decode，缺欄位 default `'plan'`）。Watch 讀它：隱藏「計劃訓練」section、點模板直接進訓練（跳過 ProgramPickerSheet + IntensityPickerSheet）。

REJECT 替代方案「iPhone 送空 programs/variants 陣列讓 Watch 自然退化」：implicit contract（空陣列 = 載入中？還是極簡？歧義），且「計劃訓練」section 的消失要靠 todayPlanned 缺席間接達成，脆弱。explicit flag 單一真相、可逆、future-proof。

### D3 — 既有 variant 解析：優先通用、否則最新、靜音 alert

極簡模式下開始任何模板 = 把 `(program=null, sub_tag=null)` 丟進**現有** resolver：
- 該模板群有 (NULL,NULL) 通用 variant → 用它
- 沒有通用 variant → miss → fallback 到 representative（MAX updated_at = 最新）

唯一差異：極簡模式下**抑制** miss 的「尚未建立模板」alert（iPhone）/ 1.5s 橘色 miss 提示（Watch）。解析邏輯（`planResolveTarget` / `resolveVariant`）本身**完全不動**。這剛好 = 不重犯 #48（通用×通用 命中 (NULL,NULL) 非 representative short-circuit）。

### D4 — 可逆

計劃 / variant / program_cell 資料原封不動，極簡模式只是 UI 層隱藏 + 解析帶 null。切回計劃模式立刻全恢復。無破壞性 migration。

### D5 — 設定儲存 + 反應式

`app_settings.app_mode`（getAppMode 預設 `'plan'`）。`AppModeProvider` 放 `DatabaseProvider` 內（需 `useDatabase()`，無 boot-order 顧慮 —— 它只 gate DB 開好之後才 render 的 UI，hydrate 前的短暫窗口用安全預設 `'plan'` 覆蓋），mirror `ThemeProvider` 的 hydrate-on-mount + optimistic-write pattern。Settings 用既有 `RadioRow` 兩選一（同 語言 / 色彩主題）。

## Consequences

- 新增：`src/app-mode/`（context + barrel）、`settingsRepository.getAppMode/setAppMode`、`AppMode` type、Settings 一段 radio、i18n `page.appModeSection/appModeHint` + `status.appModePlan/appModeMinimal`、Stage1 `appMode` 欄位（TS + Swift）。
- iPhone 各藏面以 `const { isMinimal } = useAppMode()` gate（`isMinimal && return null` / 條件 render）。
- 風險：`app/(tabs)/index.tsx` 同時被「藏首頁三塊」與「開始訓練 skip sheet」觸及 → 落地時由單一 agent 擁有該檔避免衝突。
