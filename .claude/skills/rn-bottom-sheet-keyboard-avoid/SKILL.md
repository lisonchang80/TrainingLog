---
name: rn-bottom-sheet-keyboard-avoid
description: Fix React Native bottom-sheet TextInput hidden by iOS keyboard. Trigger words 'TextField 鍵盤擋住'、'sheet 鍵盤遮住'、'inline 新增 TextField 看不到'、'keyboard cover input'、'底部 sheet 鍵盤'、'另存模板 sheet 鍵盤'、'儲存模板 鍵盤'. Covers Modal+slide animation+justifyContent flex-end pattern (TrainingLog 慣例) 為何 iOS 不會自動 shift、KeyboardAvoidingView wrap 位置 (Modal 內第一層、包住 backdrop)、ScrollView keyboardShouldPersistTaps='handled' 為何必要、avoider flex:1 style、Platform.OS iOS/Android behavior 差異。涉及檔案 pattern: components/**/*-sheet.tsx with inline TextInput at bottom of ScrollView.
---

# RN Bottom-Sheet Keyboard-Avoid Pattern

## 問題

TrainingLog 的 bottom sheet 慣例是：

```tsx
<Modal transparent animationType="slide" onRequestClose={onCancel}>
  <Pressable style={styles.backdrop} onPress={onCancel}>
    <Pressable style={styles.sheet} onPress={() => {}}>
      ...inline TextInput...
    </Pressable>
  </Pressable>
</Modal>
```

`backdrop: { flex: 1, justifyContent: 'flex-end' }` + `sheet: { maxHeight: '85%' }` 把 sheet 黏在底部。當用戶 focus 一個位在 sheet 底部的 `TextInput`（例如「+ 新增計畫」inline TextInput）、iOS 鍵盤跳起來會**直接擋住整個輸入區 + 旁邊的建立按鈕**。

**RN 在這個結構下不會自動 shift**：
- `presentationStyle="formSheet"` 才有原生 avoid，但 transparent + slide 沒有
- 沒有 `KeyboardAvoidingView` 就沒人去聽 keyboard event 來調整 padding/height

## 修法（套用後實測過 OK）

包一層 `KeyboardAvoidingView`，放在 Modal 內、包住 backdrop。**不要放在 backdrop 內包 sheet**（會失去 backdrop tap-out 區域的行為）：

```tsx
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  ...
} from 'react-native';

<Modal transparent animationType="slide" onRequestClose={onCancel}>
  <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    style={styles.avoider}
  >
    <Pressable style={styles.backdrop} onPress={onCancel}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        ...
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"  {/* ← 必加 */}
        >
          ...inline TextInput + 建立按鈕...
        </ScrollView>
      </Pressable>
    </Pressable>
  </KeyboardAvoidingView>
</Modal>
```

加 style：
```ts
avoider: { flex: 1 },
```

**三個關鍵點**：

1. **KAV 包 backdrop、不要包 sheet**。KAV 的 `behavior="padding"` 給容器加底部 padding，等於把 backdrop 撐起一段；backdrop `flex:1 + justifyContent:'flex-end'` 會自然把 sheet 推到鍵盤上方。包 sheet 反而失效（sheet 沒 flex 撐開、padding 加在自己外圍沒地方塞）。

2. **`keyboardShouldPersistTaps="handled"` 必加**在 ScrollView 上。否則 inline TextInput focus 後、用戶要點旁邊的「建立」按鈕、會被 ScrollView 攔截 (rule：當鍵盤展開時、ScrollView 預設第一下 tap 只關鍵盤、不傳給子元件)。`"handled"` 讓子元件（Pressable）優先消化 tap。

3. **iOS 用 `'padding'`、Android 用 `'height'`**。`undefined` 在 Android 就停作用、所以給 `'height'` 比較保險。

## 套過的檔案 (2026-05-29)

- `components/templates/start-template-sheet.tsx` — 「新增計畫」+ 「新增強度」inline TextInput
- `components/session/template-meta-sheet.tsx` — 「另存模板 / 儲存模板」sheet 內「新增計畫」+「新增強度」chip

兩個 sheet pattern 完全一致、修法 1:1 套用。

## 何時不用這個 pattern

- 用 `@gorhom/bottom-sheet` 或其他第三方 sheet lib → 那些 lib 通常有自己的 keyboard handling props（`keyboardBehavior` 等）
- Sheet 本身高度很短（< 50% 螢幕）且 TextInput 在頂部 → 鍵盤可能不會擋
- Modal 用 `presentationStyle="formSheet"`（iOS 原生 sheet）→ 已自帶 avoid 行為

## 驗證流程

1. `npx tsc --noEmit` 確認沒 import 錯
2. `npm test` 跑 UI 測（這類修改不會動 domain/repo 測 — 但若 sheet 有 behavior split test 要確認綠）
3. iOS 真機 / Simulator focus 該 TextInput、看建立按鈕是否在鍵盤上方可見且可點

## Anti-pattern

- ❌ 改成 center modal（user 第一直覺常想到）— 重寫 animation、改變 sheet UX、過度
- ❌ 在 onFocus 手動 `scrollTo` — 跟 KAV 重複作用容易跳動、且要算 keyboard height
- ❌ `Modal` 換成 `presentationStyle="formSheet"` — 改變 visual identity、其他 sheet pattern 不一致
