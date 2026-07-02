# 0030 — Apple Watch 首啟引導（two-part just-in-time guide）

Status: accepted (2026-07-02、設計定案 + 落地實作)

關聯：ADR-0029（iPhone 新使用者 onboarding 5 步精靈——本 ADR 的姊妹決策，但形態/內容幾乎不共用）、ADR-0019（Slice 13d Watch 端 picker / set-logger / finish / ⚙ 全套）、ADR-0026（極簡模式——Watch picker 讀 `isMinimal` 藏「計劃訓練」區）、ADR-0028（cast 編輯鎖——首個 session 若為 iPhone 投影，Part B 仍照觸發）、ADR-0008（HealthKit v1 分工：Watch 跑 HKWorkoutSession，授權 point-of-use 首次 start 時系統跳）。

Apple Watch 端第一次使用時，以一支**輕量、watch-native 的全螢幕卡片導覽**教會使用者「怎麼開始訓練」與「手腕上怎麼記錄」。分兩段 just-in-time 顯示，各自只自動出現一次；picker 上加一顆 ⓘ 可隨時重看全部。不新增任何 native 管線、不動任何同步語意，只加兩個 `@AppStorage` 旗標。

## Context

動工前 2 個探索 agent 攤出 Watch 端全部相關現況：

- **零 onboarding 基礎建設**：整個 `ios/TrainingLog Watch Watch App/`（~30 檔）grep 不到任何 onboarding / coach / help / tutorial / first-run。唯一的「指引性」字串是空狀態文案（「請在手機創建模板」「請至 iPhone 設定計劃」）。iPhone 有 ADR-0029 精靈 + coach/help 遮罩系統；Watch 什麼都沒有。
- **iPhone 的 onboarding 幾乎不可移植**：ADR-0029 五步是「歡迎→經驗→模式推薦→身體數據→連結 Health」，全是 iPhone 端概念——Watch 不設 app mode（讀 iPhone 同步的 `isMinimal`）、不收身體數據、HK 授權情境也不同。Watch 的價值在別處。
- **Watch 的真正難點＝手勢與流程**：記錄畫面是 3 頁 TabView（`完成頁 ◀ 記錄 ▶ 音樂`），極不直覺；set 記錄靠「點列選取（綠框）→ 打勾 / 點數字改值 / 左右滑加刪 / 長按橘框拖曳」一整套隱形手勢。這些是新使用者最容易卡住、也最該教的。
- **沒有 spotlight / coach-mark 基礎建設，且螢幕極小**：iPhone 的聚光遮罩在 Watch 上不可行（覆蓋範圍太大、infra 沒有）。**全螢幕教學卡片**才是 watch-native 形態。
- **無 i18n 層**：Watch 全部字串都是 zh literal（`WatchSettingsView` 的「彈窗」「關閉」等），本導覽同樣走 zh 硬編。
- **可持久化旗標**：Watch 無 SQLite，但 `@AppStorage`（UserDefaults）可用；現有 5 個 in-session 設定即用此。

需求（使用者 2026-07-02）：做「手錶引導」，與 iPhone onboarding 對稱。使用者無視覺參考 → 以 ASCII mock 兩輪迭代定稿；過程明確追加/修訂：Part A **不提「在 iPhone 開始」**；Part B 增加「①點選變綠框、綠框才可編輯 ②長按變橘框、可移動位置＋顯示備註」。

## Decision

### D1 — 形態：watch-native 全螢幕卡片 carousel，不做 coach/spotlight

一支 `WatchOnboardingView`（`TabView` + `.page` style），全螢幕分頁卡片，可**滑動**或按卡上 **CTA 按鈕**前進，底部原生頁點指示。每張卡＝一個概念（大 glyph／短句／迷你示意）。**不做聚光遮罩**——Watch 螢幕太小、無 overlay infra，且卡片本身即引導（對齊 `feedback_help_no_overlay_on_wizards` 的精神）。

REJECT「移植 iPhone coach 聚光系統到 Watch」：infra 不存在、螢幕放不下、投資報酬低。REJECT「bottom-sheet 序列」：watchOS sheet 疊 sheet 體驗差、進度/返回難表達。

### D2 — 兩段 just-in-time 觸發 + 兩個 seen-once 旗標

- **Part A（picker 導覽）**：`PickerRootView` 首次 `.onAppear` 且旗標未設時自動顯示一次；旗標 `watch_onboarding_picker_seen`。守衛：僅在 `path.isEmpty && pendingCast == nil` 時觸發，避開「首啟同時收到 iPhone 投影→已 push 到 set logger」的 race。
- **Part B（手勢導覽）**：**第一次任何 `SetLoggerView` 掛載**時自動顯示一次（Watch-led 或 iPhone 投影皆算——手勢對兩條路都適用）；旗標 `watch_onboarding_gestures_seen`。以 per-mount latch 防同一次掛載內重複觸發（如從 ⚙ 返回）。
- **無「有無資料」bypass**（與 ADR-0029 的 `hasAnySession` 不同）：iPhone 端既有使用者升級「有資料就跳過」，因為 onboarding 是收偏好；但 Watch 導覽是教**手錶 UI**，既有 iPhone 使用者第一次戴錶用本 App 從沒看過這套手勢，**應該**要看到。故 Watch 只認旗標，不查資料。

REJECT「單一首啟一次看完 9 張」：手勢卡在沒有真實 session 時抽象；just-in-time 讓 Part B 貼近使用者真的要記錄的當下。

### D3 — Part A 內容（3 張），不提 iPhone 開始

| # | 卡 | 內容 |
|---|---|---|
| A1 | 歡迎 | 💪 + 「TrainingLog 手錶版」+「在手腕上記錄每一組」 |
| A2 | 怎麼開始 | 點「計劃訓練」→今天排的課；點「模板訓練」→你存的範本；選下去直接開始 |
| A3 | 清單哪裡來 | 計劃與模板都在 iPhone 建好會自動同步；空的→先去手機建模板 |

**不提「在 iPhone 開始訓練會投影到手錶」**（使用者 2026-07-02 明確拿掉）。A3 只講「清單資料來自 iPhone」（＝資料來源，非 session 起手式），與空狀態文案「請在手機創建模板」一致。

### D4 — Part B 內容（6 張），含綠框編輯前提 + 長按橘框

Part B 的 set 列卡（B1-B4 + 編號）**忠實重繪真實 `ExerciseCard`**（header 動作名＋⋯／進度條 green/gray 段／`CellBox` kg·次 格子／rounded-4 綠(選取)/橘(reorder) 邊框／◯→✓／leading `plus.circle.fill`），非簡化 mock（使用者 2026-07-02「畫得跟實際一樣」，對照 ExerciseCard.swift/CellBox.swift 落實＝`RealCardMock`）。

| # | 卡 | 內容（真實卡 + 狀態 + caption） |
|---|---|---|
| B1 | 選取 | 綠框卡＋◯；「點一下→綠框，才能編輯」 |
| B2 | 打勾/改值 | 綠框卡、進度條首段轉綠、✓ 綠勾；「點 ◯ 記錄；點 80 或 8 跳鍵盤改值」 |
| B3 | 編號切換 | 綠框卡、號碼綠底高亮；「點左側號碼循環：工作→暖身→遞減 D」（使用者 2026-07-02 追加） |
| B4 | 左右滑 | 綠框卡、leading 綠 ＋ 露出；「右滑綠＋加一組；左滑紅🗑刪這組」 |
| B5 | 長按橘框 | 橘框卡；「長按→橘色可拖曳換順序；有備註會顯示」 |
| B6 | 三頁 | `完成 ◀ 記錄 ▶ 音樂` 示意；最左＝結束、最右＝音樂 |
| B7 | 完成 | 滑到最左「完成頁」看統計→按〔完成〕；⚙ 設定在記錄頁右上角 |

B1「綠框＝可編輯前提」、B5「長按橘框＝移動＋備註」、**B3 編號切換**皆為使用者 2026-07-02 追加/強調；對齊實際互動（swipe / cell-edit 只作用在 Active 綠框列；長按綠框→橘色觸發 reorder + `longPressNoteSetId` 顯示備註；tap 號碼 `cycleSetKind` 循環組型）。

### D5 — 重看入口：picker ⓘ 只重播 Part A；手勢步驟在 session 內

`PickerRootView` toolbar 的 `info.circle`（top-leading）點了以 **`.pickerIntro`** 模式重播 **Part A（1-3：歡迎/怎麼開始/清單）**。手勢步驟（Part B、4+）**只在「開始訓練」第一次進 `SetLoggerView` 時自動出現一次**（使用者 2026-07-02「第4步到後面移到手錶開始訓練裡頭」）——不在 picker 層重播。

理由：手勢是 session 內的操作，貼近真實記錄當下才好懂；picker 只保留「起手式」層級的 intro。Watch 的 ⚙ 設定 sheet 只在 session 內、無法承載 picker 重看入口；跨裝置觸發過複雜。手勢無專屬重看入口（learned-by-doing；日後需要可加到 session ⚙）。

### D6 — HealthKit：不放進導覽，維持 point-of-use

Watch 跑 HKWorkoutSession 需自己的 HK 授權（與 iPhone 端分開）。**不在導覽加授權卡**；維持首次 `SetLoggerView` 掛載時 `sessionController.start()` 由系統跳授權（權限在使用當下要最自然）。與 ADR-0019 §Q22「Watch-side 授權 fallback 不 block picker→set logger 流程」一致。

## Consequences

- 新增：`WatchOnboarding.swift`（`WatchOnboardingView` carousel + Part A 3 張 + Part B **7** 張 + `RealCardMock` 忠實 ExerciseCard 迷你複製 + `WatchOnboardingKey` 兩個 `@AppStorage` key + `WatchGuideMode`）。
- 改：`PickerRootView.swift`（`@AppStorage` picker 旗標 + `guide` state + top-leading ⓘ〔重播 **`.pickerIntro`** 僅 Part A〕 + 首啟 `.onAppear` 觸發 Part A + `.fullScreenCover(onDismiss:設旗標)`）。
- 改：`SetLoggerView.swift`（`@AppStorage` gestures 旗標 + 首次掛載 **`.task`＋0.5s 延遲** 觸發 Part B〔避 watchOS「push 當下 present cover 被吞」〕 + `.fullScreenCover(onDismiss:設旗標)`）。
- **零新 native 管線、零 schema、零同步語意變動**；只讀寫兩個 UserDefaults 旗標。
- 檔案自動納入 Watch target（`ios/` 是 file-system synchronized group，不需手改 pbxproj）。
- 驗證面：純 SwiftUI + UserDefaults，無 jest/TS 面；watchOS Simulator 可自驗兩段 carousel 渲染 + ⓘ 重看（用重看入口免清旗標）；實機 smoke 為唯一 device-gated（HK 授權彈窗在 sim 可能無反應，但那不屬本 ADR）。

## Rejected Alternatives（彙整）

1. **形態**：移植 iPhone coach 聚光 / bottom-sheet 序列 — 見 D1。
2. **觸發**：單一首啟一次看完全部 — 見 D2；加「有無資料」bypass — 見 D2（Watch 該教手勢，不比照 iPhone 收偏好的 skip 邏輯）。
3. **Part A**：保留「在 iPhone 開始→投影」說明 — 使用者 2026-07-02 拿掉（見 D3）。
4. **Part B**：加「點數字換組型 / 進階手勢」卡 — 避過載，defer 到自行發現（見 D4）。
5. **重看入口**：塞進 Watch ⚙ 設定（in-session-only，放不了）/ iPhone 跨裝置觸發（過複雜）— 見 D5。
6. **HealthKit**：導覽加授權卡 — 權限 point-of-use 較自然（見 D6）。
