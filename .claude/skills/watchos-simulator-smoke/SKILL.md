---
name: watchos-simulator-smoke
description: Live-verify TrainingLog's native watchOS UI on the watch Simulator — build the Watch-only target, install/launch on a watch sim, drive it with idb tap/swipe, screenshot, and read the shot. Use when eyeballing Watch SwiftUI (onboarding carousel, picker, set logger, finish page, ⚙ settings) after a Swift change. NOT for the iPhone/Expo RN app (that's ios-simulator-smoke) and NOT for real-device (that's xcodebuild-watchos-realdevice-install). Touches ios/TrainingLog Watch Watch App/*.swift.
---

# watchOS Simulator smoke (TrainingLog Watch)

Validated 2026-07-02 iterating the Watch first-launch guide (ADR-0030) ~10 cycles.
This is the FAST loop for eyeballing native Watch SwiftUI without a device.

## When NOT to use
- iPhone / Expo RN screens → `ios-simulator-smoke` (Metro + the ios-simulator MCP).
- Real Apple Watch install → `xcodebuild-watchos-realdevice-install` (devicectl,
  Trap 1-4). Only the device gives HR/kcal + a *populated* live session.
- Headless logic → `npm test`; Swift compile only → the build step below then stop.

## The build: `WatchPreview` scheme (no RN host = fast)

The workspace has a **`WatchPreview`** scheme = the `TrainingLog Watch Watch App`
target ALONE (watchOS SDK, NO React-Native host). It compiles in ~10-60s vs the
full app's minutes, and covers every Watch `.swift` file.

```bash
cd /Users/hao800922/code/TrainingLog/ios
xcodebuild -workspace TrainingLog.xcworkspace -scheme WatchPreview \
  -configuration Debug -destination 'generic/platform=watchOS Simulator' \
  build 2>&1 | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" | head
```

- New `.swift` files in `ios/TrainingLog Watch Watch App/` are **auto-included**
  (the folder is a `PBXFileSystemSynchronizedRootGroup` — pbxproj lists no Watch
  file by name; `grep -c PBXFileSystemSynchronizedRootGroup project.pbxproj` = 3).
  So: drop the file in the folder, no pbxproj edit needed.
- Built product: `<DerivedData>/Build/Products/Debug-watchsimulator/TrainingLog Watch Watch App.app`
  (find `<DerivedData>` = `~/Library/Developer/Xcode/DerivedData/TrainingLog-*`).
- Bash `cd` does NOT persist reliably between tool calls — always `cd .../ios &&`
  in the same command, or use absolute `-workspace` paths.

## Install + launch on a watch sim

```bash
WATCH=<watch-udid>            # xcrun simctl list devices available | grep -i "apple watch"
APP="<DerivedData>/Build/Products/Debug-watchsimulator/TrainingLog Watch Watch App.app"
xcrun simctl boot "$WATCH" 2>/dev/null; xcrun simctl bootstatus "$WATCH" -b   # blocks until booted
xcrun simctl install  "$WATCH" "$APP"
xcrun simctl launch   "$WATCH" com.lisonchang.TrainingLog.watchkitapp
xcrun simctl io "$WATCH" screenshot /tmp/w.png       # then Read /tmp/w.png
```

- Bundle id = `com.lisonchang.TrainingLog.watchkitapp`.
- `bootstatus -b` is the clean boot wait (foreground `sleep` is blocked by the
  harness; `bootstatus` blocks legitimately). Short `sleep N` inside a chained
  `cmd; sleep 2; cmd` compound has worked in practice for post-launch settle.
- **Reset seen-once `@AppStorage` flags** (first-launch flows): `simctl uninstall`
  then `install` wipes the app container. Read current flags with
  `xcrun simctl spawn "$WATCH" defaults read com.lisonchang.TrainingLog.watchkitapp | grep -i <key>`.

## Driving the UI: `idb`, NOT the ios-simulator MCP

The `mcp__ios-simulator__*` tools target the booted *iPhone* sim, not the watch.
Use **`idb`** (already installed at `/opt/homebrew/bin/idb`) with the `--udid`:

```bash
idb ui tap   --udid "$WATCH" <x> <y>
idb ui swipe --udid "$WATCH" <x1> <y1> <x2> <y2>
idb ui describe-point --udid "$WATCH" <x> <y>     # what element is here (label/type/frame)
```

- **Coordinates are POINTS, not pixels.** `simctl io screenshot` outputs PIXELS.
  40mm (SE 3) = **324×394 px → 162×197 pt** (scale 2.0). Divide screenshot px by 2
  to get tap pt. e.g. a full-width button centred at image (162, 290) → tap (81, 145).
  `idb ui describe-point` returns frames in pt — trust those over eyeballing.
- **idb `tap` on a SwiftUI `Button` is UNRELIABLE on watchOS** — the synthetic tap's
  hit-test often doesn't fire the action (confirmed: `describe-point` showed the tap
  landed dead-centre on the button, yet it didn't advance). **Workaround: page a
  `TabView` with `idb ui swipe`** (e.g. `130 90 30 90` = swipe left → next page).
  Swipe reliably pages; tap the toolbar chrome (⚙/ⓘ at screen corners) is fine.
- Vertical scroll inside a `ScrollView`: `idb ui swipe <x> <lowerY> <x> <upperY>`.

## watchOS layout gotchas (validated)

- **Present-cover-in-`.onAppear`-after-push is SWALLOWED.** Setting a
  `@State` that drives `.fullScreenCover`/`.sheet` synchronously in `.onAppear`
  right after a `navigationDestination` push → the cover never appears. **Fix:**
  trigger from `.task { … try? await Task.sleep(nanoseconds: 500_000_000); show = true }`
  so the push transition settles first. (ADR-0030 Part B trigger.)
- **`.fullScreenCover` has a system ✕** (top-leading) — use `onDismiss:` to run
  side-effects (e.g. set a seen flag) so the ✕ escape isn't missed, not just the
  in-content "done" button.
- **40mm is the tightest face** (~150pt usable width, ~110pt content height above a
  bottom control). A faithful card + title + caption + CTA won't all fit → wrap
  content in a `ScrollView` and add generous **bottom padding (~30pt)** so the last
  line can scroll fully clear of the pinned button ("滑到底還是被蓋住" fix).
- Shrink a `.borderedProminent` CTA with `.controlSize(.mini/.small)`; multi-line
  zh `Text` needs `.fixedSize(horizontal:false, vertical:true)` or it truncates
  with "…" instead of wrapping when squeezed by sibling Spacers.

## Reaching the real set logger on sim = EMPTY session

Tapping a picker template/plan row DOES reach `SetLoggerView` on the sim (the
`#if targetEnvironment(simulator)` `PickerViewModel.mockDefault()` path), BUT the
mock `startFromWatch` returns a snapshot with **no exercises** → you land on the
empty state ("尚無動作 / 請至 iPhone 加動作"). So you **cannot screenshot populated
set rows on the sim** — only the real device (or a SwiftUI `#Preview` with
`SetLoggerMockData`, which isn't simctl-screenshottable) shows a full card. When a
guide/mock must look "跟實際一樣", faithfully re-draw from source (read
`ExerciseCard.swift` / `CellBox.swift`) rather than trying to capture it.

## …UNLESS you inject a mock snapshot via a temp `@main` harness (2026-07-03)

The "empty session" limit above is beatable when you need to screenshot a
POPULATED set logger + drive its interactions (e.g. verifying the rest-timer
popup fires on ✓). Temporarily point the app entry at a mock set logger:

```swift
// TrainingLog_WatchApp.swift — TEMP, revert to ContentView() after verify
WindowGroup { RestTimerSimHarness() }

private struct RestTimerSimHarness: View {
    @StateObject private var hk: HealthKitController
    @StateObject private var sc: SessionController
    @StateObject private var wc: WatchConnectivityCoordinator
    init() {
        let h = HealthKitController(); let s = SessionController(healthKit: h)
        _hk = .init(wrappedValue: h); _sc = .init(wrappedValue: s)
        _wc = .init(wrappedValue: WatchConnectivityCoordinator(sessionController: s))
    }
    var body: some View {
        NavigationStack { SetLoggerView(snapshot: SetLoggerMockData.mockSnapshot()) }
            .environmentObject(wc).environmentObject(sc)   // ← REQUIRED
    }
}
```

⚠️ **Trap**: `SetLoggerView` declares `@EnvironmentObject coordinator` +
`@EnvironmentObject sessionController`. Launching it BARE (just
`SetLoggerView(snapshot:)`) crashes on first render — `EXC_BREAKPOINT` in
`EnvironmentObject.error()` (grep the `.ips` in `~/Library/Logs/DiagnosticReports`,
frame = `SetLoggerView.body.getter`). The harness must `.environmentObject(...)`
BOTH, mirroring `ContentView`'s init. Then `SetLoggerMockData.mockSnapshot()`
gives real 深蹲/臥推 cards with `restSec` 120/90 sets you can ✓-tap.
`idb ui tap` a set-row's ◯ (right edge) → the ✓ logs + fires downstream UI.
**REVERT the `@main` entry to `ContentView()` before committing.**

## watchOS haptic: closely-spaced `play()` MERGE — a DOUBLE isn't enough, use ≥3

`WKInterfaceDevice.current().play(type)` fired twice ~0.22s apart reads as a
SINGLE buzz on the real wrist (device smoke 2026-07-03: user「感覺只有震一下」)
— watchOS coalesces closely-spaced haptics, and `.notification` / `.success`
are themselves multi-pulse patterns ~0.5s long that blur together.

**Escalation ladder (device-validated, don't restart from the bottom):**
- 0.22s double → felt as ONE (2026-07-03).
- **0.5s double → STILL felt as ONE** (2026-07-04). A wider gap on a 2-pulse
  count is NOT enough — the two multi-pulse patterns still smear.
- **3 pulses at 0.6s → felt as ~TWO, user-accepted** (2026-07-04). Three
  crossings the 「不只一下」threshold reliably; 0.6s exceeds the pattern's own
  ~0.5s duration so there's real silence between plays.

So for a rest-done / attention haptic that must read as「不只一下」: fire **≥3
times at ≥0.6s spacing** (fire off `self`-free `let device`/`type` locals so
they land even after the view auto-dismisses; extend the auto-dismiss so all
pulses land while the view is up). Sim / `xcodebuild` can't verify haptics at
all → device-smoke-only. Next lever if 3×0.6s ever proves insufficient: a
distinct-pattern type (`.retry` = 3 discrete taps, `.failure` = long strong)
rather than N copies of the same coalescing type; and check for HKWorkoutSession
haptic throttling during an active workout.

## Loop summary
1. `xcodebuild ... -scheme WatchPreview ... build` → grep for `BUILD SUCCEEDED`.
2. `simctl uninstall` (if resetting flags) → `install` → `launch`.
3. `idb ui swipe/tap --udid` to navigate (swipe to page; tap corners).
4. `simctl io screenshot /tmp/x.png` → Read it.
5. Repeat. Iterate builds are incremental (~15-30s) if only one file changed.

## PAIRED-SIM real WCSession smoke（2026-07-04 validated：雙向全通）

Watch↔iPhone 的**真 WCSession 流量可以在 paired simulators 上 smoke**（Xcode 14+
支援；本機 Xcode 26.4 驗過雙向）。驗過的清單：Stage1 handshake（真模板列表）、
Watch-led start（真 snapshot）、live-mirror set-logged / hr-tick（sim 會產生
**假 HR ~55-62 bpm** 餵 HKWorkoutSession → iPhone tile 會跳）、✓→rest timer 彈窗、
ADR-0028 編輯鎖整套（Watch-led 自動鎖、逾時 fallback、Take control、鎖鏡像、
活體 3 步解鎖）、iPhone→Watch cast 投影 + 冷啟領養、durable(TUI) 車道。

### Setup（順序是關鍵）
1. `xcrun simctl pair <watch-udid> <phone-udid>`（一次性；`simctl list pairs`）。
2. Watch build 加旗標，否則 sim 走 mock picker（`ContentView.swift` 的
   `SIM_PAIRED_WC` 逃生門）：
   ```bash
   xcodebuild -workspace TrainingLog.xcworkspace -scheme WatchPreview \
     -configuration Debug -destination 'generic/platform=watchOS Simulator' \
     -derivedDataPath build/simsmoke-watch \
     SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) SIM_PAIRED_WC' build
   ```
3. iPhone 端照舊（`ios-simulator-smoke` 的 dev-client + Metro）。
4. ⭐ **裝錶 app → 關掉兩台 → 重開 pair → 再裝/啟 phone app**。錶 app 用
   `simctl install` 直裝後，phone 端 wcd 的 counterpart 登記是舊的 →
   `transferUserInfo` 全報 **WCErrorDomain 7006 "Watch app is not installed"**、
   phone 發起的推送全死。**重開整組 pair 才會刷新登記**（`simctl install` 不會
   做 Xcode 那種 embedded-Watch 傳播，7006 ≠ 程式 bug）。
5. ⚠️ **絕不單獨重開 watch sim**——單邊 reboot 會把 phone 端 wcd 登記洗掉，
   7006 復發且**之後光重開 pair 修不回來**（over-install 同版不觸發登記事件）。
   症狀＝錶面出現 📵 紅圖示、start/HR（錶→機）照常但 unlock/cast（機→錶）全
   timeout「No response」。**復原配方（2026-07-04 13:41 驗證）＝必須 uninstall
   再 install 錶 app、兩台一起重開、錶 app 先啟動**：
   ```bash
   PHONE=<phone-udid>; WATCH=<watch-udid>; APP=".../Debug-watchsimulator/TrainingLog Watch Watch App.app"
   xcrun simctl uninstall "$WATCH" com.lisonchang.TrainingLog.watchkitapp
   xcrun simctl install "$WATCH" "$APP"
   xcrun simctl shutdown "$PHONE"; xcrun simctl shutdown "$WATCH"
   xcrun simctl boot "$PHONE"; xcrun simctl boot "$WATCH"
   xcrun simctl launch "$WATCH" com.lisonchang.TrainingLog.watchkitapp
   xcrun simctl launch "$PHONE" com.lisonchang.TrainingLog
   ```
   （uninstall 會洗掉錶端 seen-once 旗標 → 首啟導覽會再出，✕ 掉即可。）

### Sim-only 陷阱
- **7006 nil-crash（已 patch）**：`react-native-watch-connectivity` 的
  `didFinishUserInfoTransfer` 在 error 時把 nil userInfo 塞進 `@{}` → SIGABRT。
  patch-package 已加 nil-guard（`patches/react-native-watch-connectivity+2.0.0.patch`）。
  同型地雷未修：同檔 L383（file transfer）、L431（app context）error path。
- pair 剛 boot 會顯示 `(active, disconnected)` 幾十秒 → 等 `connected` 再測，
  太早發的 handshake 只會 timeout（重啟錶 app 即重試）。
- HealthKit 授權對話框在錶 sim 第一次 start 會出現 → idb 點得掉（檢視→全開
  toggle→下一步→完成）；`simctl privacy` 管不到 HK。
- 仍然 device-only：真 HR/kcal 數值、haptics（三連震）、腕勢/錶冠、效能。

### 「手錶端結束 session 沒同步」二因（2026-07-04 下午 log 實證）
- **A｜錶端 HK 退化 → end 封包根本沒送**（同一次 sim boot 反覆 start/discard
  幾輪後 HK 壞掉，症狀＝logger 開著但 HR 一直 `--`）。此時 `stopAndDiscard()`
  的 `await builder.endCollection(at:)` completion 永不回呼 →
  `sendEndToiPhone` 卡在 `await sessionController.end()` → **envelope 從未
  發出**（tap 時只會看到 emitFinal 的 live-mirror）。**復原＝重開 watch sim**
  （`simctl shutdown/boot`）→ HR 恢復即 end() 秒回、全鏈路綠（13:15 驗證：
  tap→native→JS→DB ended_at 3 秒內完成）。潛在 backlog：sendEndToiPhone
  改先送 WC 再 await HK teardown（或 endCollection 包 timeout race）。
- **B｜手機 JS 偶發聾（#287 族）**：end 封包 native `didReceiveMessage` 有到、
  JS intake 無聲（同 process 稍早 handshake/live-mirror 都正常）。跨 lock
  UI 轉換（Unlock/Take control）後的舊 process 觀察到兩次；phone app
  terminate+launch 後消失。診斷法＝pod `didReceiveMessage`/`dispatchEvent`
  加 NSLog + adapter intake 加 console.log 三層對照。**smoke SOP：驗 end
  類 flow 前先重啟 phone app**；若 end 掉了，錶端重啟→領養→再 end 可救。
- 判讀速查：只見 live-mirror 沒見 end-session ＝ A（錶沒送）；native 有
  end-session 但 metro 無 ＝ B（JS 聾）；兩者 DB `ended_at` 都是 NULL。
