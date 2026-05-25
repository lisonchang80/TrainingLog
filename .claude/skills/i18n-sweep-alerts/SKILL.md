---
name: i18n-sweep-alerts
description: Sweep for i18n gaps in non-Text hardcoded English patterns — Alert.alert titles, accessibilityLabel, headerTitle, ActionSheet labels, Stack.Screen options, etc. Earlier sweeps (Phase 4, 4.5) systematically missed these because greps for <Text>literal</Text> don't catch them. Use when adding new screens or after smoke reveals mixed locale.
---

# i18n Sweep — Alert / a11y / headerTitle 隱形漏網

`<Text>literal</Text>` 是顯眼的、grep 一搜就到。**真正會漏掉的是非 JSX 字串字面值**：

- `Alert.alert('Save failed', '...')` ← 第一個 arg 是 title、純字串、不過 `<Text>` 渲染
- `Alert.alert.prompt(...)`、`ActionSheetIOS.showActionSheetWithOptions({title: 'X', options: ['A', ...]})`
- `accessibilityLabel="Session menu"`、`accessibilityHint="..."`
- `<Stack.Screen options={{title: 'Program', headerTitle: 'X'}}/>`
- `Tabs.Screen options={{title: 'Today', tabBarLabel: 'X'}}`
- `useNavigation().setOptions({title: '...'})`
- 動態 throw：`throw new Error('English message')`、catch 後 alert 顯示
- 純 string state：`setStatus('Loading')`、`setError('Invalid input')`

## When to use

- 加新 screen 完成、commit 前先掃一輪
- Smoke 報告某 tab / sheet「字混了」(中英文混雜)
- 跨大塊改動後 follow-up sweep（如 slice ship 前）

## When NOT to use

- 純內部 dev-only 字（console.log / test fixture / schema seed name）
- 程式設計類常數（`'kg'`、`'cm'`、ISO date format token）
- comment 字串

## 走法（pattern 順序、由 invisible 到 visible）

### Pattern 1 — Alert.alert title（最常漏）

```bash
grep -rn --include='*.tsx' --include='*.ts' "Alert\.alert('[A-Z]" app/ components/ src/ | \
  grep -vE "alert\('(失敗|無|請|建立|警告|提示)" | head -30
```

匹配 `Alert.alert('English Title'`。中文起頭的 title 自動排除。每筆都查：

```typescript
// ❌
Alert.alert('Save failed', '...');

// ✅
Alert.alert(t('alert', 'saveFailed'), '...');
```

新 key 進 `src/i18n/strings.ts` 的 `alert` namespace（兩 locale 同步）。

### Pattern 2 — accessibilityLabel / accessibilityHint

```bash
grep -rnE --include='*.tsx' 'accessibility(Label|Hint)="[A-Z]' app/ components/ | head -20
```

### Pattern 3 — Stack.Screen / Tabs.Screen options

```bash
grep -rnE --include='*.tsx' "(Stack|Tabs)\.Screen[^/]*options=\{\{[^}]*(title|headerTitle|tabBarLabel)" app/ | head -20
```

注意 `app/_layout.tsx` 靜態註冊的 Stack.Screen（per ADR-0019 / wave 18g `ce3ca5a` lesson — modal route 內不該動態 mount Stack.Screen options）。

### Pattern 4 — ActionSheet labels

```bash
grep -rnE --include='*.tsx' "ActionSheet.*(options|title)" app/ components/ | head -20
```

```typescript
ActionSheetIOS.showActionSheetWithOptions({
  options: ['Cancel', 'Body data', 'Delete'],  // ← all need t()
  title: 'Choose action',  // ← needs t()
  ...
});
```

### Pattern 5 — throw new Error / setError / setStatus

```bash
grep -rnE --include='*.tsx' --include='*.ts' "throw new Error\('[A-Z]" app/ components/ src/ | head -20
grep -rnE --include='*.tsx' "(setError|setStatus|setMessage)\('[A-Z]" app/ components/ | head -20
```

決策：
- 走 i18n → `throw new Error(t('error', 'X'))` — 但 Error message 通常給 dev 看，不一定要 i18n
- 純 dev throw → 保持英文、無需 i18n
- catch 後 `Alert.alert(e.message)` 直接顯給 user → MUST i18n（去抓 catch site、做 `Alert.alert(t(...))`）

### Pattern 6 — date format / placeholder

```bash
grep -rnE --include='*.tsx' "(placeholder)=\"[A-Z]" app/ components/ | head -10
```

`<TextInput placeholder="Search">` ← user-facing input placeholder、要 t()。

## Fix protocol

對每一筆：

1. 決定 namespace（一般 alert title → `alert`、screen title → `page`、status → `status`、CTA → `button`）
2. **先 grep `strings.ts` 看是否既存 key** — sweep target 常常 zh + en 都已有但 call site 部分 migrate（mixed `t()` + raw literal）。若既存 → 直接重用，不要 dup。本次驗證：2026-05-25 wave 2 audit B 28 處替換中 4 個 alert key 是「reuse 既有」、3 個 alert + 2 個 button.a11y 才是真新增。
3. 加新 key 進 `strings.ts`（**APPEND-ONLY**、勿動既有 key 順序）
4. zh + en 兩 locale 同步加
5. call site 換 `t(namespace, key)` 或 dynamic helper
6. 跑 `npx tsc --noEmit && npm test -- i18n`

## 編輯技巧

### `replace_all` 批次最快 — 但要先驗證 literal 全域唯一

當同一個 literal（連單引號）在檔案內出現 N 次而 N 都是同樣的替換目標（典型：`Alert.alert('Save failed', e.message)` 模式重複 8 次），用 `Edit` tool 帶 `replace_all: true` 一次替換掉全部。

```typescript
// Edit tool with replace_all: true
old_string: 'Save failed'        // 含單引號
new_string: t('alert', 'saveFailed')
```

**前提**：該 literal token 在檔案內僅出現於同類 context（例如所有 `'Save failed'` 都在 Alert.alert title 位）。先 `grep -n "'Save failed'" <file>` 看所有出現，目測都是同類再 replace_all。

省時驗證：wave 2 audit B 8 個 `'Save failed'` 出現位 + 6 個 `'Delete failed'` 出現位 — 各一個 replace_all call 完事，省 12× 個別 Edit。

### accessibilityLabel JSX attr → expr 強制轉換

```typescript
// ❌ 直接替換會壞掉（attr= 形式不接 expr 的 t() return）
accessibilityLabel="Session menu"

// ✅ 必須轉成 expr={} 形式
accessibilityLabel={t('button', 'a11ySessionMenu')}
```

不能用 replace_all（因為兩側形式不同：attr 形式是 `="..."`、expr 形式是 `={...}`），逐個用 targeted Edit。

### 驗證 0 殘留

最後一定要 grep 確認 0 hit：

```bash
grep -n "'Save failed'\|'Delete failed'\|'Invalid input'\|accessibilityLabel=\"Session menu\"" <files>
```

exit 1 = no match = 0 殘留 = ship 條件達成。任何殘留代表 replace_all 漏抓 case（通常是格式微差，例如 trailing comma 或 JSX vs JS context 不同）。

## Anti-pattern

- ❌ 把 Alert.alert title 用 inline ternary `t('common','locale') === 'zh' ? '失敗' : 'Failed'` — 違反 namespace 集中原則
- ❌ 把 dev-only console.log / Error message i18n — 過度設計
- ❌ 跨 sweep agent 之間 strings.ts append 撞 same key — append-only 不防 same-key dup，要靠 file-level allow-list（per overnight-parallel-agents skill）

## 歷史 baseline

| Run | Tip SHA | 漏網數 | 主要 cluster |
|---|---|---|---|
| slice 10e i18n agent #4（`i18n/tab-bar-catchup`） | `4341576` | **57** | 24 個 Alert.alert title 為最大 cluster |
| 2026-05-25 wave 2 audit B #1 sweep（`slice/10c-set-logger-and-menu`） | `fa002ae` | **28** | 18 raw Alert title + 2 寫死 a11y label + 8 mixed-migration call sites（key 已存在但部分 raw） |

「量降但 pattern 同」預測在 wave 2 應驗。量級從 57 降到 28 = 約半量，且 cluster 分佈仍以 Alert title 為主。

**下次 sweep 經驗法則**：
- 預期量級 ~15-25（持續下降但不會歸零；新加的 screen 會帶 1-3 個漏網）
- 主 cluster：Alert.alert title + accessibilityLabel + Stack/Tabs.Screen title
- 一次 sweep 應在 1 hour 內完成（含 grep / strings.ts edit / replace_all / verify / commit），靠 `replace_all` 批次。
