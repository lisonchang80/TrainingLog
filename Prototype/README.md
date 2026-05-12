# TrainingLog UI Prototype

互動式原型，覆蓋三個 v1 待實作畫面：

| 檔案 | ADR | 用途 |
|---|---|---|
| `CalendarMonthView.tsx` | ADR-0015 | 歷史月曆視圖（Q9）：7-col grid、三行 chip stack（容量/title/副標）、per Template name 12 色、+N 多場標記、freestyle 灰塊 ⚠️ |
| `HistoryDetailView.tsx` | ADR-0014 | 歷史詳情頁（Q7）：editable session.title、三按鈕 action bar（儲存模板/另存模板/刪除本訓練）、同日 ←/→ 切場 |
| `TemplateEditorView.tsx` | ADR-0016 | Template 編輯器（Q11）：三段式 layout、in-memory draft + 儲存/取消雙 button、bottom-sheet 12 色 picker、一般/常設 section header、per-set 預設值 inputs |
| `MockTrainingStore.tsx` | — | React Context + useReducer mock store；2 個月 mock dataset（含 freestyle、同日多場、有/無 title 邊界）；palette / actions |
| `PrototypeRoot.tsx` | — | 三 view 切換 + Reset Mock Data 按鈕 |
| `../app/prototype.tsx` | — | expo-router thin route |

## Scope

- 純 UI 原型；**不**碰 expo-sqlite / `useDatabase` / production code
- 所有變動寫 in-memory `useReducer` state；reload 即還原（亦可手動按右上「↺」重置）

## How to run

```bash
cd /Users/hao800922/code/TrainingLog
npx expo start
# 按 i 開啟 iOS Simulator
# 在 simulator 內導航到 http://localhost:8081/prototype
# 或於 Expo Go / Dev Client 用 deep link: exp://...:8081/prototype
```

預設進「月曆」分頁，tap 任一有訓練的日格進入詳情；上方 tab bar 可切換「月曆 / 詳情 / 編輯器（預設開「推日 A」）」。

## Mock dataset 概要

- 範圍：2026-03-13 ～ 2026-05-12（anchor TODAY = 2026-05-12）
- ~12 sessions / 月 × 2.x 個月
- 4 個 templates：推日 A / 拉日 B / 腿日 C / 上肢 D
- Edge cases:
  - **2026-04-16**: freestyle (`template_id = null`, `title = ''` → fallback `自由訓練`)
  - **2026-05-10**: 同日兩場（腿日 C 容量較大為主場 / 上肢 D 為副場，cell 右上顯示 `+1`）
  - **2026-05-12 (today)**: `title = ''` 但有 template → UI 用 template name fallback
  - 多場其他 sessions 已具備手動命名（如「推日 A (重訓加強)」「腿日 C (加重)」）

## 已知簡化

- Detail page 列表顯示的是 **template 預設 sets**（reps × weight），非 session 實打值 — 因 mock store 未生成 per-session sets table；對於展示 session.title 編輯 + 三按鈕入口已足
- Template editor `⚙ per-exercise menu`、move/reorder、刪除動作流程未實作（4-action bar 上的「⋯ 更多」也只 Alert.alert 提示）
- Calendar 月份 picker、swipe gesture 未實作（僅 ←/→ 按鈕）
- 「儲存模板」「另存模板」「⋯ 更多」「刪除模板」皆走 `Alert.alert` 確認框；不實際寫 DB
- `RECOLOR_TEMPLATE` action 在 editor 「儲存」時一併 fire（group-wide write 行為 demo）；本 prototype 4 個 template 各自獨立 name，無 sibling 可連動
