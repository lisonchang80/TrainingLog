---
name: Watch SwiftUI view phase implementation + Sim verify + cherry-pick
description: 把 Watch view ASCII-mock-frozen spec 的某個 phase（A skeleton / B 互動 / C cell edit / ...）落地成 SwiftUI、Watch Sim 驗證、commit + cherry-pick 到 main。Trigger 詞：「D11 Phase B 動」「D14 完成頁 SwiftUI impl」「Watch view {X} Phase {N} 動工」。涉及檔案：ios/TrainingLog Watch Watch App/*.swift
---

# Watch SwiftUI view phase ship

當 D11 / D14 / D15 / D16 / D10 等 frozen-spec Watch view 已凍結進 ADR-0019、要把某個 phase 的 SwiftUI 實作 land 時、用這個 recipe。

## When to trigger

User 明確說：
- 「D{N} Phase {X} 動」（e.g.「D11 Phase B 動」/「D14 SwiftUI impl」）
- 「動 Watch SwiftUI」
- 「{D-view} 動工」

通常前置條件：
- ADR-0019 已有對應 D{N} freeze section（per `watch-view-spec-freeze` skill）
- 上一個 phase 已 ship 到 main（或同 branch 累計）
- 不適用：純 logic / wire（沒 UI）— 用 `ship-partial-pure-logic` 較適合

## When NOT to use

- Phase 還沒 spec frozen → 先 ASCII mock iterate（per `feedback_watch_ui_reference.md`），freeze 後再回來
- iPhone view 變動 → 跟 RN/Expo 流程，用 `ship-slice`
- 多 view 同時動 → 一次只動一個 view 一個 phase；多 view 拆 branch
- **Real-device install 到實機 Watch（cherry-pick 落 main 之後想戴上手腕 smoke）→ 走 `xcodebuild-watchos-realdevice-install` skill**。這個 skill 本身只到 Sim verify + cherry-pick，不負責 real device install（有 3 個會吃 45 min 的 booby trap）。

## Recipe (8 步)

### Step 1 — Create branch

```bash
git checkout -b slice/13d-d{N}-{view-kebab}-phase-{x}
```

命名範例：`slice/13d-d11-set-logger-phase-b` / `slice/13d-d14-finish-phase-a`。

### Step 2 — Write SwiftUI files

Drop new `.swift` files into `ios/TrainingLog Watch Watch App/` directly. **不用改 Xcode pbxproj** — Watch target 用 `PBXFileSystemSynchronizedRootGroup` (Xcode 16+)、folder 內檔案自動進 build。

常見檔案 layout（per phase 通常 2-5 個檔）：

```
ios/TrainingLog Watch Watch App/
├── {View}.swift         — 主 view（root + body）
├── {View}Component.swift — sub-view（e.g. ExerciseCard）
├── {View}MockData.swift  — Phase A 硬編 mock
├── {ModelName}.swift     — Codable wire model（若涉及 WC）
```

Phase A 通常 4 個檔；Phase B+ 通常 1-3 個檔（修現有 + 1 新 sub-view）。

### Step 3 — xcodebuild Watch target isolated

**不要用 scheme build**（會連 iPhone target、Expo modulemap 報錯）：

```bash
cd ios && xcodebuild -target "TrainingLog Watch Watch App" \
  -configuration Debug -sdk watchsimulator -arch arm64 build \
  2>&1 | grep -E "error:|\\*\\* BUILD" | head -5
```

預期看到 `** BUILD SUCCEEDED **`。常見 error 類型：

1. **Hashable conformance**：navigation destination enum 帶 associated value（如 `case setLogger(selection: PickerSelection)`）、associated type 必須 Hashable。把對應 struct 從 `Equatable` 改為 `Hashable`。
2. **ForEach Identifiable**：`ForEach(items) { ... }` 要求 `Identifiable`、否則 `ForEach(items, id: \.someKey)`。
3. **Switch double-Optional pattern**：`@Published var x: T??` 在 `if let outer = vm.x` 已 unwrap 一層、`outer` 是 `T?`、不能再 `.some(.some(...))`。
4. **NSNull bridging**：`[String: Any]` 字典中傳 `nil` 會丟 key；要 round-trip null 必須 `NSNull()`。
5. **`@Published` 需要 import Combine**（D11 PB 踩）：純 `import Foundation` 的 ObservableObject 檔、`@Published var x: T = ...` 會噴 `type does not conform to protocol 'ObservableObject'` + `initializer 'init(wrappedValue:)' is not available due to missing import of defining module 'Combine'`。Fix：`import Combine` 或改 `import SwiftUI`（已 re-export Combine）。

### Step 4 — Sim 視覺驗證

```bash
# 1. Boot Watch Ultra 3 49mm (or 對應 spec watch size)
xcrun simctl list devices | grep "Apple Watch Ultra 3"  # 找 UDID
xcrun simctl boot <UDID>
open -a Simulator

# 2. Install + launch
xcrun simctl install <UDID> \
  "/Users/hao800922/code/TrainingLog/ios/build/Debug-watchsimulator/TrainingLog Watch Watch App.app"
xcrun simctl launch <UDID> com.lisonchang.TrainingLog.watchkitapp

# 3. Screenshot
sleep 2 && xcrun simctl io <UDID> screenshot /tmp/d{N}-p{X}-{state}.png
```

**Watch Sim 限制**：沒 iPhone WC pairing、handshake 5s timeout 後走 noActiveProgram empty state。看 D11 / D14 等需要 SessionSnapshot 的 view 時、Sim 走不到 → 需暫時 hack ContentView 直接 mount target view with mock snapshot。**完成後 revert + commit 前 verify reverted**。

```swift
// TEMP for Phase {X} visual verify — bypass picker, mount D{N} directly
SetLoggerView(snapshot: SetLoggerMockData.mockSnapshot())
// PickerRootView(viewModel: pickerVM)
```

**Sim cache 坑**：改 ContentView 重 build、`simctl install` 可能不 refresh。完整 `uninstall` → `install` → `launch` 才 reliable：

```bash
xcrun simctl uninstall <UDID> com.lisonchang.TrainingLog.watchkitapp
xcrun simctl install <UDID> "/path/to/app"
xcrun simctl launch <UDID> com.lisonchang.TrainingLog.watchkitapp
```

**截 cluster 卡（在 scroll 下方）**：simctl 沒 scroll API。改 mock 順序 / 或 SetLoggerView 接受 `snapshot.exercises` 過濾、把 cluster 卡放第一。

**watchOS Sim 互動驗證的兩個天花板**（D11 PB 踩）：

1. **AX tree 在 watchOS Sim 是空的** — `mcp__ios-simulator__ui_describe_point` / `ui_find_element` 對 Watch Sim 一律回 `{AXFrame: {0,0,0,0}, AXLabel: null, ...}` / `[]`。意味 element-aware 互動驗證**做不到**——你不知道某個 (x, y) 是 Button、Text、還是空白。
2. **Tap event 本身 work**（`ui_tap` / `simctl io tap` 都會送出 synthetic touch）但 hit detection 對 tiny Button 不穩。Caption2-size SF Symbol Button（~14pt label）即便 tap 落在視覺中心、SwiftUI 也可能 miss。

**Recipe**：
- Phase B+ 互動驗證**只跑視覺 idle screenshot 確認 layout**（border / dim / 排版）+ build green = ship-ready
- ✓ toggle / cell edit / type cycling 這些 tap 互動的真互動驗證**延後到實機 picker → D11 整鏈 smoke**（Phase H 後）
- 不要因為「sim 看不到 toggle」就改 logic — code 對就 ship
- Watch Button hit area 一律 **`.frame(width: 28, height: 28)` + `.contentShape(Rectangle())` + `.font(.body)`**（Apple HIG ≥44pt 推薦、Watch 螢幕小用 28 折衷）；caption2 size 只用在 Text，不用在 Button label。

### Step 5 — Visual fix-pass

常見 layout bug：
- **Column width 太窄 wrap**：`Text("D1")` 在 `.frame(width: 16)` 會 wrap → 用 `.frame(width: 20)` + `.lineLimit(1)` + `.minimumScaleFactor(0.7)`
- **Hairline divider 不夠細**：watchOS 預設 Divider 太粗、用 `Rectangle().fill(Color.secondary.opacity(0.3)).frame(height: 0.5)` 客製
- **TabView page dots 不顯示**：需 `.tabViewStyle(.page)` (watchOS 10+)；確認 SDK 對得上

Fix 完重 build + 重 screenshot 驗證、再走 Step 6。

### Step 6 — Revert temp hacks before commit

```bash
git diff "ios/TrainingLog Watch Watch App/ContentView.swift"  # 確認沒留 TEMP 註解
```

若改 ContentView 為 dev mock、必須 revert 回 `PickerRootView(viewModel: pickerVM)` 才 commit。

### Step 7 — Commit + push

```bash
git add "ios/TrainingLog Watch Watch App/{...新檔...}" "ios/TrainingLog Watch Watch App/{...改檔...}"
git commit -m "$(cat <<'EOF'
feat(slice-13d): D{N} {view 名} Phase {X} — {短描述}

{1-2 段 context：本 phase 落地什麼、out of scope 什麼、per ADR-0019 § Slice 13d D{N} spec}

Changes:
  {file1}.swift (new, +N) — {一行說明}
  {file2}.swift (refactor) — {一行說明}
  ...

Visual verified on Watch Ultra 3 49mm Sim:
  - {state 1}: {對齊 spec 哪幾項}
  - {state 2}: {...}

xcodebuild Watch target Debug watchsimulator arm64: ** BUILD SUCCEEDED **.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin {branch-name}
```

### Step 8 — Cherry-pick to main + branch cleanup

```bash
git checkout main
git cherry-pick {commit-sha}
cd ios && xcodebuild -target "TrainingLog Watch Watch App" \
  -configuration Debug -sdk watchsimulator -arch arm64 build \
  2>&1 | grep -E "\\*\\* BUILD" | head -1   # verify main 仍綠
cd .. && git push
git branch -d slice/13d-d{N}-{view-kebab}-phase-{x}
git push origin --delete slice/13d-d{N}-{view-kebab}-phase-{x}
```

## Validated invocations

- 2026-05-28 D8 Phase 1 (skeleton) `4d1ce2f` (+838 / -172、5 new .swift)
- 2026-05-28 D8 Phase 2 (Stage 1 handshake wire) `fc844ec` (+295 / -69、1 new .swift)
- 2026-05-28 D8 Phase 3 (start-from-watch wire) `cdc6897` (+346 / -9、1 new .swift)
- 2026-05-28 D11 Phase A (visual skeleton) `01ccb50` (+700 / -74、3 new .swift)
- 2026-05-28 D11 Phase B (`{}` Active + ✓ toggle + progress recalc) `71a34ba` (+304 / -68、1 new .swift)
- 2026-05-28 D11 Phase B polish (CellBox + page swap + green progress) `dd0e01c` (+195 / -31、1 new .swift)
- 2026-05-28 D11 Phase C (`[]` Active cell edit + keypad + crown) `2c9d197` (+654 / -78、1 new .swift)
- 2026-05-29 D11 Phase C polish 1+2 (opaque + fullscreen backdrop) `6ee7500` + `34e9b8e`
- 2026-05-29 D11 unify Active borders → green `e43e850`
- 2026-05-29 D11 re-Active bug fix + cell-clear-on-row-switch `5059dda` + `394a62f` + `48cdf5e`
- 2026-05-29 D11 Phase C polish 4 (inline crown + warmup CellBox + first-digit-replace) `a7c8f85`
- 2026-05-29 Watch Sim dev mock convenience `fbcc73d`
- 2026-05-29 **D14 完成頁 SwiftUI impl** (overnight Wave 1 Agent A) `2e326d8` + `5abf7be` — FinishPageView new (+335) + SetLoggerView TabView page 0 wire; 4-state sync mock (idle → ⟳ → ✓ 0.5s → success / ⟳ → ⚠ retry) + 5 tiles fixed order; HR/kcal real values deferred to Phase 2.5 schema
- 2026-05-29 **D15 ⋯ menu SwiftUI impl** (overnight Wave 1 Agent B) `d53cc3c` + `0d34aae` — DotsMenuView / DotsMenuConfirmView / ExerciseHistoryView (3 new) + ExerciseCard header `[⋯]` wire; solo 4-item / superset 5-item (歷史拆 A/B) variants
- 2026-05-29 **D16 ⚙ settings SwiftUI impl** (overnight Wave 1 Agent C) `b2a5a4e` + `ab4c0d9` — WatchSettingsKeys + WatchSettingsView (2 new) + SetLoggerView toolbar 暫位 `⚙`; 5 @AppStorage key (inputMode reuses existing CellEditOverlay key) + 3 picker sub-page + WatchSettingsSyncPayload Codable stub for D7/D9

## Step 9 — Sim dev convenience pattern（多 phase 反覆驗證時用）

當 picker → set logger 整鏈要在 Sim 跑、但 Sim 沒 paired iPhone 走不通 handshake / start-from-watch、原本 timeout 後落 noActiveProgram empty state，每次 phase impl 後又要靠 TEMP ContentView swap 才看得到 SetLoggerView。重複 4-5 次後值得加 sim 永久 dev mock。

### Recipe

兩處 `#if targetEnvironment(simulator)` gate：

1. **`ContentView.init()`** — sim 用 `PickerViewModel.mockDefault()`（pre-load templates / programs / intensities）。實機走 `PickerViewModel(coordinator: wc)` production path。

```swift
#if targetEnvironment(simulator)
let vm = PickerViewModel.mockDefault()
#else
let vm = PickerViewModel(coordinator: wc)
#endif
```

2. **`PickerViewModel.startFromWatch(...)`** — coordinator == nil branch 改 mock SUCCESS reply（之前是 `.some(nil)` 失敗形狀、會卡 retry view）：

```swift
guard let coordinator else {
    isStartingSession = true
    try? await Task.sleep(nanoseconds: 500_000_000)
    isStartingSession = false
    startResult = .some(StartFromWatchReply(
        sessionId: "mock-session-1",
        snapshot: SetLoggerMockData.mockSnapshot()
    ))
    return
}
```

實機 build 走 `#else` / 走 coordinator 真路徑、不受 dev mock 影響。Validated `fbcc73d` 2026-05-29。

## Anti-patterns

- ❌ 用 scheme build 而不是 target build → iPhone target Expo modulemap 噴錯、汙染 grep
- ❌ 改 Xcode pbxproj 加新檔 → PBXFileSystemSynchronizedRootGroup 自動處理、手動改會 conflict
- ❌ 留 TEMP ContentView mock 在 commit → 進 main 後 picker 變 dev hook
- ❌ 沒 uninstall 直接 install → Sim cache 看不到改動、誤以為 build 沒 link 上
- ❌ Phase 拆太細 (e.g. 一個 commit 只動 1 行) → 反而 review 看不清；Phase 拆太粗 (>1000 行) → review 不動。Sweet spot: 300-800 行 / 3-5 個 file
- ❌ 動 Watch UI 沒 ADR frozen spec → 走 mock iterate (per `feedback_watch_ui_reference.md`) freeze 後再動
- ❌ **空 `.onTapGesture { closure }` 不是 no-op、會吞 tap**（D11 PC re-Active fix `5059dda`）— 即使 closure body 是 `onTap?()` (onTap=nil) 也會 consume tap、外層 row tap gesture 永遠收不到。CellBox 等可選 tappable view 要用 `if let onTap { ... .onTapGesture { onTap() } } else { baseView }` 條件式 attach、不要無條件加。
- ❌ **跨 row state 不一致**（D11 PC fix `48cdf5e`）— `activeSetId` 跟 `activeCell.setId` 是兩個 @Published、可能不同步。切 row 時要在 `activate(setId:)` 裡 commit + clear `activeCell` 避免「舊 row 的 [] Active 綠框 + 新 row 的 {} Active 綠框」同時顯示。
- ❌ **Keypad 預載 buffer 但 first-digit append 而非 replace**（D11 PC polish 4 `a7c8f85`）— tap cell 進 keypad 顯示「80 kg」是 nice、但用戶按 `5` 想換成 5、不是想得 805。要 `hasUserInput: Bool` 旗標、首次 digit press 直接 replace。
- ❌ **Crown overlay 用 popup view 抓不到 focus**（D11 PC polish 4 `a7c8f85`）— `.focusable() + .digitalCrownRotation()` 放在 popup 內常拿不到 focus（被 ScrollView/TabView 搶）、用戶轉表冠完全沒反應。改 inline 把 modifier chain 接到 SessionCardListPage 層級 + `@FocusState` + `.onChange(of: state.activeCell)` 主動 grab focus 才穩。
- ❌ **同顏色 state semantics 三處不一致** — ✓ checkmark / progress bar filled / row Active border / cell Active border 全部表「engaged / done」概念、要全用同 `Color.green`。混 `.accentColor` / `.primary` / `.green` 視覺讀不出 system。
- ❌ **`ScrollViewReader` 包 `List(.listStyle(.carousel))` → watchOS 無窮 re-layout、watchdog kill**（2026-05-30 picker hang、修 `36dbfc4`）。UI-F #8 為了「結束/放棄回 root 捲頂」把 `PickerRootView` 的 carousel List 包進 `ScrollViewReader { proxy in List {...} }`。在 `NavigationStack` push（模板訓練 → 計劃 → 選真實計劃 drill）時，root List（仍 alive）+ ScrollViewReader 進入無窮 scene-update re-layout、main thread 燒 ~9.5s CPU → 10s `scene-update` watchdog `0x8badf00d` 把 app 砍掉（**hang 不是 crash、無 stack trace 那種**）。watchOS 上 **ScrollViewReader 與 `.carousel` List 不相容**——要捲頂改用 loop-safe 機制或乾脆不做（純 `List` 即可）。**注意 unsmoke 的 UI polish（如本 #8）可能潛伏這類 render-loop，cherry-pick 進 main 後第一次實機走到才爆**。診斷流程見 `xcodebuild-watchos-realdevice-install` skill 的「Diagnosing a post-install Watch hang / crash」段。

## Cross-references

- `~/.claude/projects/-Users-hao800922/memory/feedback_watch_ui_reference.md` — ASCII mock iteration (動工前 spec 凍結階段)
- `watch-view-spec-freeze` skill — 把 mock 凍結進 ADR-0019
- `expo-bare-build-pipeline` skill — iPhone Expo build pipeline（不同層）
- `ship-slice` skill — slice 整體 ship 流程
