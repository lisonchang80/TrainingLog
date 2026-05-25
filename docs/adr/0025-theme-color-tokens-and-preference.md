# 0025 — Theme 色彩 token 系統 + preference 持久化（21 token × 2 mode、AsyncStorage tri-state）

Status: accepted (2026-05-26)

App 色彩走 **21 個語意化 token × 2 mode (light + dark)** 的靜態 hex palette（iOS HIG inspired，自訂非 `PlatformColor`），preference 走 **AsyncStorage-backed tri-state** (`'system' | 'light' | 'dark'`)，`'system'` 由 RN `Appearance` API 解析裝置色彩模式。Boot 時 `loadStoredTheme → resolveTheme → setTheme` 三步在第一個 styled component render 之前完成，確保 no flash of unstyled / wrong-color content。

## Context

2026-05-26 iOS 真機 smoke 暴露 dark mode 大範圍對比度問題（截圖 4 頁：settings / training tab idle / session 中 / history 月曆）— 「建立 / 啟用計劃」「查看計劃 / 模板 / 動態紀錄」「自由訓練」「+ 記錄體重」「月曆 weekday header」幾乎不可讀。

Audit：
- 42 個檔案 × **523 處 inline hex hardcode**（散落 `#fff` / `#000` / `#3b82f6` / `#0a7ea4` / `#151718` / `#11181C` / `rgba(...)` 等等）
- 只有 2 個檔案（`app/_layout.tsx`、`app/(tabs)/_layout.tsx`）走現有 `Colors[]` theme
- 現有 `constants/theme.ts` 只有 6 token（`text / background / tint / icon / tabIconDefault / tabIconSelected`）× light / dark — 根本不夠用，沒有 card surface / border / muted text levels / action / disabled / destructive / success / warning

→ 自然導致：每個檔案各自 inline 顏色、跨頁不一致、dark mode 對比度爆掉。

## Decision

### Token 體系：自訂 palette、iOS-inspired（非 PlatformColor）

選 **自訂靜態 hex token**，命名仿 Apple HIG（label / secondaryLabel / surface / separator…）但 hex 自選：

- **跨平台一致**：未來上 Android / web 不需要 fallback hack
- **未來換色容易**：brand 想加 accent color 改一處
- **Storybook-friendly**：純 hex 可在任何 design tool / Figma 對照
- **Apple HIG 仿名**：iOS 用戶 / future 上 App Store 不違和

REJECT 替代方案：
- iOS PlatformColor — 自動跟系統一致但跨平台 fallback 麻煩、無 brand 控制
- Material 3 surface tint — 設計自由度高但 iOS 用戶感覺不對味

### Token shape：21 token × 2 mode

```ts
{
  light: {
    bg: { base: '#FFFFFF', elevated: '#F2F2F7', surface: '#FFFFFF', modal: '#F9F9F9' },
    text: {
      primary: '#000000',
      secondary: 'rgba(60,60,67,0.60)',  // iOS secondaryLabel light
      tertiary: 'rgba(60,60,67,0.30)',   // iOS tertiaryLabel light
      disabled: 'rgba(60,60,67,0.18)',
    },
    border: { default: '#C6C6C8', subtle: '#E5E5EA' },
    action: {
      primary: '#007AFF',
      onPrimary: '#FFFFFF',
      destructive: '#FF3B30',
      success: '#34C759',
      warning: '#FF9500',
    },
    tab: { iconActive: '#007AFF', iconInactive: '#8E8E93', background: '#F9F9F9' },
  },
  dark: {
    bg: { base: '#000000', elevated: '#1C1C1E', surface: '#2C2C2E', modal: '#1C1C1E' },
    text: {
      primary: '#FFFFFF',
      secondary: 'rgba(235,235,245,0.60)',  // iOS secondaryLabel dark
      tertiary: 'rgba(235,235,245,0.30)',
      disabled: 'rgba(235,235,245,0.18)',
    },
    border: { default: '#38383A', subtle: '#2C2C2E' },
    action: {
      primary: '#0A84FF',
      onPrimary: '#FFFFFF',
      destructive: '#FF453A',
      success: '#30D158',
      warning: '#FF9F0A',
    },
    tab: { iconActive: '#0A84FF', iconInactive: '#8E8E93', background: '#1C1C1E' },
  },
}
```

### 設計細則

- **Dark base = `#000`**（OLED 省電 + 對比深度最大）— 現用 `#151718` 是 React Native template 預設、太灰；放回真 black、靠 surface 層級拉開層次
- **Light base = `#FFFFFF`**，card 用 `#F2F2F7` (iOS systemGroupedBackground) 讓 card 浮起來
- **文字用「黑白 + alpha」**而非各色灰，避免色偏（match iOS HIG）
- **Accent 用 iOS system blue** `#007AFF` (light) / `#0A84FF` (dark) — 與 tab bar / 鍵盤 cursor / 連結色融合最好、視覺噪音最少。未來加 brand 強化色另開 `action.brand` token
- **Surface 4 級足夠**：base / elevated (card) / surface (card-in-card) / modal (sheet) — 5 級以上邊際效益遞減
- **tab.* 獨立成 family**：tab bar 是 chrome 不是 content，獨立 token 讓未來改 tab style 不污染整 app

### Preference 持久化：AsyncStorage tri-state（同 ADR-0023 pattern）

`StoredThemeValue = 'system' | 'light' | 'dark'`：
- `'light'` / `'dark'` — 使用者 explicit 選；resolver 直接返回
- `'system'` — 跟裝置色彩模式；resolver 走 RN `Appearance.getColorScheme()`

預設值 = `'system'`（首次安裝 / 任何讀取失敗 fallback 到 system，**不**直接落入某個具體 mode）— 讓裝置設定決定優先於 app 預設值。

**為什麼用 AsyncStorage 而非 `app_settings` SQLite**：和 ADR-0023 完全同 reasoning — theme 必須在「第一個 styled component render **之前**」就 resolved 完畢，否則 flash of wrong-color content。AsyncStorage 路徑無 SQLite 依賴、純 KV、滿足 boot order 前置剛需。

Storage key = `app.theme.preference`（沿用 ADR-0023 確立的 `app.<area>.<setting>` namespace）。

### Boot order

`app/_layout.tsx` 頂層 useEffect 在 i18n hydrate 之後 / SQLite open 之前：

```tsx
useEffect(() => {
  (async () => {
    const storedLocale = await loadStoredLocale();
    setLocale(resolveLocale(storedLocale));
    const storedTheme = await loadStoredTheme();
    setTheme(resolveTheme(storedTheme));
    setReady(true);
  })();
}, []);
```

`setReady(true)` 前 render 空白（已有 i18n splash，theme 一起 hydrate）。

### `'system'` 模式的 live update

裝置色彩模式中途改變（user 滑控制中心切換 dark / light）時，`'system'` 模式必須 live update。`useColorScheme()` hook 本身會 re-render，但需要 `ThemeProvider` 把當前 resolved theme 暴露成 Context value：

```tsx
function ThemeProvider({ children }) {
  const sysScheme = useColorScheme();  // RN hook, re-renders on system change
  const [stored, setStored] = useState<StoredThemeValue>('system');
  const resolved = stored === 'system' ? (sysScheme ?? 'light') : stored;
  return <ThemeContext.Provider value={{ stored, setStored, resolved, tokens: tokens[resolved] }}>{children}</ThemeContext.Provider>;
}
```

任何 component `useTheme()` 拿 `tokens` 直接用。`'light'` / `'dark'` explicit 選時 ignore `sysScheme`。

### Settings UI

`app/(tabs)/settings.tsx` 加「色彩主題 / Color theme」section，3 個 Pressable radio（**與「語言」row 完全同樣 pattern**，i18n key 走 `t('common', 'theme...')`）：

```
○ 自動 (跟隨系統)
○ 淺色
○ 深色
```

`onPress` → `await saveStoredTheme(v)` + `setTheme(v)` + Context re-render。

放在「語言」section 上方（語言 = 文字偏好，色彩 = 視覺偏好，視覺優先）。

## Sweep 策略：2 波

### Wave 1（slice/theme-infra）

人工做：
- 擴 `constants/theme.ts` 為 21 token shape
- 新建 `src/theme/theme-persist.ts`（mirror `src/i18n/locale-persist.ts`）
- 新建 `src/theme/ThemeContext.tsx`（Context + Provider + `useTheme()` hook）
- 改 `app/_layout.tsx` boot wire + 包 ThemeProvider
- 改 `app/(tabs)/settings.tsx` 加 3-radio row
- Sweep 4 個截圖出問題的頁面：`app/(tabs)/settings.tsx` / `app/(tabs)/index.tsx` / `app/session/[id].tsx` / `app/(tabs)/history.tsx`
- 補 jest test：`tests/theme/theme-persist.test.ts`（mirror i18n locale-persist test 7 case）

立刻見效：4 個重災區先變得可讀。

### Wave 2（slice/theme-sweep-rest）

overnight parallel agents 跑剩 ~38 檔，按 file allow-list + DO NOT TOUCH discipline（per `overnight-parallel-agents` skill #17）。建議 4 agent 切分：
- Agent A：`app/(tabs)/programs.tsx` + `app/program/**` + `app/program-wizard/**`
- Agent B：`app/(tabs)/library.tsx` + `app/exercise/**` + `app/exercise-history/**` + `app/exercise-chart/**`
- Agent C：`components/template-editor/**` + `app/template/**` + `app/superset/**`
- Agent D：`components/session/**` + `components/shared/**` + `components/ui/**` (cross-cutting 小元件)

附 **cheat sheet** 給 agent（hex → token mapping cheat sheet，降低判斷成本）：

```
背景：
  '#fff' / '#FFFFFF' (作 card 底)      → bg.surface
  '#fff' (作 page 底, light only)      → bg.base
  '#000' / '#000000' (page 底)          → bg.base (dark only — 確認 mode)
  '#151718' (page 底, dark template)    → bg.base
  '#f2f2f7' / '#F2F2F7'                 → bg.elevated
  '#1c1c1e' / '#1C1C1E'                 → bg.elevated (dark) or bg.modal
  '#2c2c2e' / '#2C2C2E'                 → bg.surface (dark)

文字：
  '#000' / '#000000' (作文字)           → text.primary
  '#11181C' / '#ECEDEE'                 → text.primary
  '#687076' / '#9BA1A6' / '#8E8E93'    → text.tertiary or tab.iconInactive
  'rgba(*60)' / '60%'                   → text.secondary
  'rgba(*30)' / '30%'                   → text.tertiary

Border：
  '#C6C6C8' / '#38383A'                 → border.default
  '#E5E5EA' / '#2C2C2E'                 → border.subtle

Action：
  '#0a7ea4' (現 tint light)             → action.primary
  '#3b82f6' (按鈕底)                    → action.primary
  '#007AFF' / '#0A84FF'                 → action.primary
  '#FF3B30' / '#FF453A' (刪除 / 紅)     → action.destructive
  '#34C759' / '#30D158' (PR / 完成綠)   → action.success
  '#FF9500' / '#FF9F0A' (警告 / 橘)     → action.warning

不確定 → 留 TODO 註解、報告中列出，wave 3 統一拍。
```

## Alternatives considered

- **(a) PlatformColor / iOS native semantic color** — REJECT，跨平台 fallback 麻煩、無 brand 控制（見上文）
- **(b) Material 3 surface tint** — REJECT，iOS 用戶感覺不對味
- **(c) 只做 dark / 強制 dark** — REJECT，使用者明確 spec「至少 light + dark 兩模式 + 預設跟系統一致」
- **(d) 用 SQLite `app_settings` 存 theme pref** — REJECT，boot order 不合（同 ADR-0023 已分析）
- **(e) Tailwind CSS / Unistyles / Tamagui 等 styling lib** — REJECT，現用 RN StyleSheet 已穩、引入新 lib 是大手術、本 ADR 範圍只解決顏色不解決 styling 架構
- **(f) 一次大波 sweep 完 523 處** — REJECT，PR 巨大 / cherry-pick 風險 / 回滾粒度差；2 波切分（infra + 4 重災頁立刻見效、其餘 overnight）

## Consequences

- **Boot order 約束** — theme hydrate 在 i18n 之後 / SQLite 之前。`app/_layout.tsx` `useEffect` 順序固定
- **`Appearance` change live update** — 'system' 模式自動跟隨；explicit pick 模式 ignore
- **AsyncStorage 不進 backup / sync** — 同 ADR-0023，theme 屬裝置層偏好、跨裝置 sync 無意義
- **Tab bar 獨立 token** — 未來改 tab style 不污染 content tokens
- **Action color 4 級** (primary / destructive / success / warning) — `success` 同時涵蓋 PR badge / 完成綠 / 各種 done state，避免再加 `pr.color` `done.color` 等濫生 token
- **新 component / 既有 component** — 一律 `const { tokens } = useTheme()`、不直接 import `Colors`。Wave 2 結束後 `constants/theme.ts` legacy `Colors` 物件可刪
- **CONTEXT.md 需要增補** — 新增 Domain 模組塊 `theme-persist` / `ThemeContext` / `useTheme` 3 個 API
- **未來加 brand accent** — 不破壞此 ADR；新加 `action.brand` token、其餘維持
- **未來加 high-contrast mode** — 不破壞此 ADR；擴 tri-state 成 quad-state（`'system' | 'light' | 'dark' | 'high-contrast'`）即可

## References

- **Source code** (planned)：
  - `constants/theme.ts` — 21 token × 2 mode palette（擴 existing 6 token）
  - `src/theme/theme-persist.ts` — load / save / resolve helpers
  - `src/theme/ThemeContext.tsx` — Provider + `useTheme()` hook
  - `app/_layout.tsx` — boot wire + ThemeProvider 包裹
  - `app/(tabs)/settings.tsx` — 色彩 section 3 radio
- **Tests** (planned)：
  - `tests/theme/theme-persist.test.ts` — load / save / resolve / fallback（mirror i18n locale-persist test）
- **Related ADRs**：
  - ADR-0011 § app_settings — 本 ADR 解釋為何 theme 不走 SQLite（同 ADR-0023 reasoning）
  - ADR-0023 § i18n locale persistence — 本 ADR mirror 其結構（tri-state / AsyncStorage / boot order / Settings UI pattern）
  - ADR-0024 § 訓練 tab 三區塊 — 本 ADR sweep 會調整 idle view 顏色
- **Skill** — `overnight-parallel-agents` item #17 (file allow-list + DO NOT TOUCH discipline) 適用於 Wave 2 切分
- **真機 smoke** — 2026-05-26 iPhone 真機截圖 4 頁面為 ADR trigger（settings 體重 row / training idle / 自由訓練 session / history 月曆）
