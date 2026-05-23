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
2. 加新 key 進 `strings.ts`（**APPEND-ONLY**、勿動既有 key 順序）
3. zh + en 兩 locale 同步加
4. call site 換 `t(namespace, key)` 或 dynamic helper
5. 跑 `npx tsc --noEmit && npm test -- i18n`

## Anti-pattern

- ❌ 把 Alert.alert title 用 inline ternary `t('common','locale') === 'zh' ? '失敗' : 'Failed'` — 違反 namespace 集中原則
- ❌ 把 dev-only console.log / Error message i18n — 過度設計
- ❌ 跨 sweep agent 之間 strings.ts append 撞 same key — append-only 不防 same-key dup，要靠 file-level allow-list（per overnight-parallel-agents skill）

## 歷史 baseline

slice 10e i18n agent #4（branch `i18n/tab-bar-catchup` tip `4341576`）一次掃補了 **57 個漏網**：tab labels / Today header / Pre-session copy / **24 個 Alert.alert title**（最大 cluster）/ Stack header titles / session detail muted states + alerts / database init / body-data-sheet。

下次 sweep 預期會抓到更少（量降）但 pattern 同。
