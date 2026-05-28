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

## Anti-patterns

- ❌ 用 scheme build 而不是 target build → iPhone target Expo modulemap 噴錯、汙染 grep
- ❌ 改 Xcode pbxproj 加新檔 → PBXFileSystemSynchronizedRootGroup 自動處理、手動改會 conflict
- ❌ 留 TEMP ContentView mock 在 commit → 進 main 後 picker 變 dev hook
- ❌ 沒 uninstall 直接 install → Sim cache 看不到改動、誤以為 build 沒 link 上
- ❌ Phase 拆太細 (e.g. 一個 commit 只動 1 行) → 反而 review 看不清；Phase 拆太粗 (>1000 行) → review 不動。Sweet spot: 300-800 行 / 3-5 個 file
- ❌ 動 Watch UI 沒 ADR frozen spec → 走 mock iterate (per `feedback_watch_ui_reference.md`) freeze 後再動

## Cross-references

- `~/.claude/projects/-Users-hao800922/memory/feedback_watch_ui_reference.md` — ASCII mock iteration (動工前 spec 凍結階段)
- `watch-view-spec-freeze` skill — 把 mock 凍結進 ADR-0019
- `expo-bare-build-pipeline` skill — iPhone Expo build pipeline（不同層）
- `ship-slice` skill — slice 整體 ship 流程
