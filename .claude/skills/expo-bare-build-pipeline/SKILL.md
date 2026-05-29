---
name: expo-bare-build-pipeline
description: >
  TrainingLog leaving Expo Go for Bare workflow (since slice 13b 2026-05-25):
  expo prebuild → CocoaPods → Xcode signing → Metro → real-device install
  pipeline + 10 specific gotchas. **For Watch app real-device install
  traps (xcodebuild install fake-succeed / incremental skip Watch target /
  Apple Watch sync cache) see sibling skill `xcodebuild-watchos-realdevice-install`.**
  Use when adding any native module
  (HealthKit, WatchConnectivity, file system, etc.), regenerating ios/
  via prebuild, adding a watchOS target via Xcode, or debugging a dev
  build that won't launch / crashes on HK / Native module call. Trigger
  words: "expo prebuild", "pod install 失敗", "NativeModules undefined",
  "initHealthKit is not a function", "RCT_NEW_ARCH_ENABLED", "Build
  Succeeded but app crashes", "No script URL provided", "Xcode signing
  requires development team", "Encoding CompatibilityError",
  "newArchEnabled false / true", "objectVersion 70", "Unable to find
  compatibility version", "Apple Watch disconnected in Xcode",
  "Copying shared cache symbols from Apple Watch", "Developer Mode
  Watch", "Could not install at this time" Watch app, "Timed out
  while attempting to establish tunnel using negotiated network
  parameters", "Type X does not conform to protocol ObservableObject",
  "init(wrappedValue:) is not available due to missing import",
  "HK auth dialog 出現在 Watch 不是 iPhone". Validated 1× slice 13b
  (2026-05-25 → 26) + 1× slice 13d D0 spike C + D4 Watch target add
  + 1× slice 13d D0 spike A native Swift harness (2026-05-27).
---

# Expo Bare Build Pipeline — TrainingLog

## TL;DR

TrainingLog 從 slice 13b 起切到 **Expo Bare workflow**：
- `app.json` 仍是 source of truth（plugins / entitlements / infoPlist / bundleId）
- `npx expo prebuild --platform ios` 從 app.json 生成 `ios/` 目錄（**進 git**、Pods/ + build/ + xcuserdata 不進）
- Build 改走 Xcode（local 本機 build IPA、簽 ADP team）
- 仍跑 Metro packager serve JS bundle（dev build / debug config）
- 之後加 native module → `npx expo install <pkg>` → 編輯 app.json plugins → `npx expo prebuild --platform ios` 或 `--clean` → Xcode rebuild

## When TO use

- 加新 native module（HealthKit、WatchConnectivity、file system 等）
- 改 bundleId / entitlement / infoPlist
- 改 plugin config（任何 `app.json` plugins array 變動）
- 升 Expo SDK 或核心 RN/Reanimated 版本
- 真機 build 失敗 / app crash 找不到 bridge module

## Setup state (slice 13b ship 2026-05-26)

| 項目 | 值 |
|------|-----|
| Expo SDK | 54 |
| newArchEnabled | **true**（不能關，react-native-reanimated Podspec 強制）|
| bundleId | `com.lisonchang.TrainingLog` |
| ADP App ID | 已註冊 + HealthKit + iCloud capabilities enabled |
| HealthKit 套件 | `@kingstinct/react-native-healthkit@14.x`（NOT react-native-health）|
| Provisioning Profile | Xcode Managed |
| Signing Team | TING-HAO CHANG |

## Pipeline 5 step 標準流程

### 1. 確認 app.json + plugin 設定

修 `app.json`：
- `expo.ios.bundleIdentifier`
- `expo.plugins` array（加新 plugin 或改 config）

### 2. 裝 SDK-managed package

```bash
npx expo install <package>   # ← 絕對不用 npm install <package>，per overnight-parallel-agents skill #19
```

`expo install` 會：
- 解析該 package 在當前 SDK 的相容版本
- 寫進 `package.json`
- 自動加 plugin entry 到 `app.json`（如果該 package 有 config plugin）

### 3. Regenerate ios/

```bash
npx expo prebuild --platform ios            # 增量、保留 git-tracked manual edits
npx expo prebuild --platform ios --clean    # 完全 wipe + 重生（更乾淨但會洗掉 Xcode 改動）
```

### 4. Pod install 必須帶 LANG

```bash
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

**不能省 LANG**（gotcha #2）。

### 5. Xcode build + install

```bash
open ios/TrainingLog.xcworkspace   # 重要：xcworkspace 不是 xcodeproj
```

Xcode 上：
- Signing & Capabilities → Team 選 TING-HAO CHANG（每次 prebuild --clean 後重選、gotcha #3）
- 接 iPhone USB
- Device picker 選 iPhone
- Cmd+Shift+K → Cmd+R

並行：

```bash
npx expo start   # Metro 必須跑著 serve JS bundle、gotcha #4
```

## 8 個必踩 gotcha

### Gotcha #1 — `react-native-health@1.x` 不支援 New Architecture

**症狀**: build + install 成功、tap 按鈕呼叫 `AppleHealthKit.initHealthKit(...)` → `AppleHealthKit is undefined / initHealthKit is not a function`

**根因**: `react-native-health@1.19.0` (and earlier) 用 legacy bridge `NativeModules.AppleHealthKit`、未 register 成 TurboModule、New Arch 下不可見

**修法**: 永遠選 `@kingstinct/react-native-healthkit@14.x`（Nitro、New Arch native）

**Don't try**: `newArchEnabled: false` flip — `react-native-reanimated` Podspec 的 `assert_new_architecture_enabled` 會直接擋 pod install，TrainingLog 全 stack 強制 New Arch。

### Gotcha #2 — CocoaPods 1.16.2 + Ruby 4.0 unicode_normalize bug

**症狀**: `pod install` 噴 `Encoding::CompatibilityError: Unicode Normalization not appropriate for ASCII-8BIT`

**根因**: Ruby 4.0 改 default string encoding、CocoaPods 1.16 (cur Homebrew default) 未更新

**修法**: 永遠帶環境變數：

```bash
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

`npx expo prebuild` 內部跑 pod install 也踩到 → 跑 prebuild 後手動再跑一次 `cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` 收尾。

### Gotcha #3 — `expo prebuild --clean` 洗掉 Xcode signing Team

**症狀**: prebuild --clean 後 Xcode 開 workspace、Signing & Capabilities Team 變「None」、紅色 `Signing for "TrainingLog" requires a development team`

**根因**: Team 寫在 `project.pbxproj` 的 `DEVELOPMENT_TEAM` 欄位、--clean 重生時清空（這是 per-user 偏好不該入 git、prebuild 拒絕保留）

**修法**: 每次 prebuild --clean 後在 Xcode 重設：
1. TARGETS → TrainingLog → Signing & Capabilities
2. Team 下拉 → TING-HAO CHANG
3. 等 Xcode auto-provision（紅色 ❌ 變綠）

**Bonus**: Xcode 可能跳 dialog 說「workspace file disappeared, Re-save or Close?」→ 永遠選 **Close**（Re-save 會把 stale state 寫回不存在的舊路徑）

### Gotcha #4 — Dev build 需要 Metro 跑著

**症狀**: build install 成功、app launch 紅屏 `No script URL provided. Make sure the packager is running or you have embedded a JS bundle in your application bundle.`

**根因**: Bare workflow Debug config 預設從 Metro 抓 JS bundle、app 啟動時 fetch `http://<lan-ip>:8081/index.bundle`、Metro 沒跑 → 404

**修法**: 確認 Metro 跑著、在 slice worktree 路徑：

```bash
cd /Users/hao800922/code/TrainingLog-worktrees/slice-XX-...
npx expo start
```

LAN IP 必須與 iPhone 同網段（personal hotspot / same WiFi）。

從 iPhone 上 reload：搖晃手機 → "Reload" or 殺 app 重開。

### Gotcha #5 — Build log warning "Pointer is missing a nullability type specifier"

**症狀**: Xcode Issue Navigator 顯示 1000-2000 warnings、看起來像大爆炸

**根因**: 全部從 Expo / RN deps 來的 Obj-C nullability deprecation warning、non-blocking

**修法**: 忽略。「Build Succeeded」就是真的成功。Issue counter 別嚇到。

### Gotcha #6 — Xcode 26 寫 `objectVersion = 70` vs CocoaPods xcodeproj gem 不認

**症狀**: `pod install` 噴 `[Xcodeproj] Unable to find compatibility version string for object version '70'`、跑出來一串 GitHub issues 連結（#12889 / #12840）。**Xcode 修改 project file 後第一次跑 pod install 才會踩到**，例如：加新 target（D4 Watch target）、bump iOS deployment target 等讓 Xcode 重寫 pbxproj 的操作。

**根因**: Xcode 26 預設 `objectVersion = 70`（介於 Xcode 15.3 = 63 和 Xcode 16.0 = 77 之間）。CocoaPods 1.16.2 bundle 的 `xcodeproj` gem 1.27.0 compat table 沒這條目。

**修法**: patch local gem constants 加 `70 => 'Xcode 16.0'`:

```bash
# 編輯 /opt/homebrew/Cellar/cocoapods/1.16.2_2/libexec/gems/xcodeproj-1.27.0/lib/xcodeproj/constants.rb
# 在 COMPATIBILITY_VERSION_BY_OBJECT_VERSION = { 77 => 'Xcode 16.0', ... } 加一行：
70 => 'Xcode 16.0',
```

驗證：`grep -A 3 "objectVersion" ios/TrainingLog.xcodeproj/project.pbxproj` 應該看到 `objectVersion = 70` 然後 pod install 能跑完。

**Per-Mac fix**：不入 git。新 Mac / `brew reinstall cocoapods` 後要再 patch 一次。CocoaPods upstream 1.17+ 會 fix。

### Gotcha #7 — Wireless Mac↔Apple Watch dev 需要 USB-tethered iPhone（**且 Mac 不能走 iPhone 熱點當網路**）

**症狀**:
- Xcode → Window → Devices and Simulators 顯示 Apple Watch 在 **Disconnected** section；iPhone 端「Apple Watch」app 點安裝 Watch app 跳「Could not install at this time」。
- **OR**: Xcode → Devices and Simulators → Watch row 上方黃色 banner 寫「Previous preparation error: A connection to this device could not be established.; **Timed out while attempting to establish tunnel using negotiated network parameters**」+ ERRORS AND WARNINGS section 紅 X 同樣訊息。

**根因**:
- Mac ↔ Watch 走的是 iPhone 中繼、iPhone 必須走 USB 不能走 BT 替代
- iPhone Personal Hotspot 模式下 Mac 透過 iPhone 4G 上網、看起來 Mac 跟 iPhone 在「同網路」、但**熱點是 NAT 後面的 4G IP、不是同一個本地 segment**、dev pairing 走不出 tunnel
- 拓撲：`Watch ←BT→ iPhone ←?→ Mac`、`?` 必須是 USB-C 直連 OR 雙方都連到家用 WiFi router（不能是熱點 routing）

**修法**（兩條路二選一）：
1. **USB-C 直連（推薦）**：iPhone 用 USB-C 線插 Mac、信任、允許 USB Accessory；iPhone 關掉個人熱點；Mac WiFi 連回家用 router 自己上網
2. **同 WiFi 備援**：iPhone 個人熱點關掉、iPhone + Mac 都連到同一個家用 WiFi SSID、Xcode 等 30s 重新發現 Watch（圖示旁會有 🌐 wireless 標記）

確認順序：
1. 看 Mac 螢幕右上角 WiFi 圖示連到哪個 SSID。如果是 iPhone 熱點名稱（鏈條 icon）→ ❌ 模式不對
2. iPhone → 設定 → 個人熱點 → 允許其他人加入 = OFF
3. iPhone USB-C 線真的插著 Mac
4. Xcode → Devices and Simulators 等 Watch 從 Disconnected 移到 Connected

**Bonus — Watch Developer Mode 觸發順序**: Watch 上 Settings → 隱私權與安全性 → 開發人員模式 **option 預設隱藏**、要 Xcode 先 ping 過 Watch（透過 USB iPhone）才會出現。順序：先插 USB → Xcode 嘗試 build/connect Watch（會 fail 但觸發）→ 回 Watch Settings → option 應該出現 → toggle ON → Watch 重開機。

**驗證 2 次**（2026-05-27）：D4 Watch target install 時第一次踩、spike A real-device run 第二次踩（spike C 後沒拔 USB / 沒關熱點 → spike A 重建環境）— 每次切實機 workflow 都要重檢一次拓撲。

### Gotcha #8 — Xcode 第一次連 Watch 跑 "Copying shared cache symbols" 10-30 min

**症狀**: Devices and Simulators 視窗、Watch 條目上方黃色 banner「Copying shared cache symbols from Apple Watch (X%)」、進度極慢（每分鐘可能只跑 1-3%）。

**根因**: 1-2 GB Watch system symbols（debugger 用、能讀 stack trace 方法名）必須 transfer 到 Mac。走 Watch ↔ iPhone BT bridge → iPhone ↔ Mac USB。BT 是真正的瓶頸（理論 ~3 Mbps、實測常更慢）。Mac 端 process（`AppleMobileDeviceHelper`）幾乎 idle、實際在等 chunk。

**修法**: 等。10-30 min 是常態。期間：
- 不要拔 USB-C 線（拔了 transfer 從頭來）
- Watch 戴在手腕 / 放充電 + 偶爾輕拍螢幕（避免進 deep sleep）
- 兩台裝置距離 < 50cm
- 不能省：transfer 沒跑完之前 deploy Watch app 一定失敗

驗證方法：`ps aux | grep AppleMobileDeviceHelper` 看 elapsed time + RSS、+ `xcrun devicectl list devices` 看 Watch 是否 connected。

**也適用**: 換新 Watch、Watch 升級 watchOS major version、Xcode 升級後。

### Gotcha #9 — Swift `@MainActor ObservableObject` + `@Published` 在 Watch target 漏 `import Combine` 會出 4 個錯一起

**症狀** (Build Failed, 4 errors in same file):
```
Type 'X' does not conform to protocol 'ObservableObject'
Initializer 'init(wrappedValue:)' is not available due to missing import of defining module  (×N for the N @Published properties)
```

**根因**: `ObservableObject` 協定 + `@Published` property wrapper 都來自 **Combine**、不是 Foundation 也不是 SwiftUI。SwiftUI 在 main app target 會透過 import 鏈條把 Combine 帶進來、但純 model class（沒 import SwiftUI）就會漏。

**修法**: 加 `import Combine` 到 model 檔最上面：

```swift
import Foundation
import HealthKit
import Combine  // ← 漏這行

@MainActor
final class SpikeAHarness: ObservableObject {
    @Published var isRunning: Bool = false
    // ...
}
```

**判別技巧**: 4 個錯**全在同一檔**、ObservableObject + init(wrappedValue:) 同時出現 → 99% 是漏 Combine。如果是不同檔錯一個 init(wrappedValue:)、可能是其他 property wrapper（`@State` / `@Binding` 漏 SwiftUI）— 但這個情境較少在 model layer 發生。

**Validated**: D0 spike A 第一次 ⌘B 踩、加 import 後一次過。

### Gotcha #10 — Watch process 呼叫 `HKHealthStore.requestAuthorization()`、HK auth dialog 出現在 **Watch 不是 iPhone**

**症狀**: Watch 上 app 跑到呼叫 `store.requestAuthorization(toShare:read:)` 那行、本來預期 iPhone 跳 dialog（因為 13b/13c 都是 iPhone 跳）— 結果 iPhone 沒動、Watch 上跳 dialog。

**根因**: HK auth dialog 出現在**發起 request 的 process** 上、不是「永遠 iPhone」。Watch app 自己呼叫 `requestAuthorization` 時、HK 把 dialog 排到 Watch process 的 UI scene。

**含意（不是「bug」、是設計）**：
- **Q22 paired-share path** = iPhone 先 grant → Watch query 不需要再 request、自動繼承（這是 ADR-0019 Q22 假設）
- **Watch-side request path** = Watch app 自己 `requestAuthorization` → Watch 上跳 dialog（這是 Q22 失敗時的 fallback）
- Spike A 跑「Watch-side request」、所以走的是 fallback 路徑、**不能 piggyback 當作 paired-share 的驗證**
- Spike B 要單獨驗：iPhone 先 grant → launch Watch app → Watch query HR **不**呼叫 `requestAuthorization` 看能不能拿到資料

**Validated**: D0 spike A 2026-05-27 19:51 真機跑、Watch 跳 dialog（user 報「iphone沒跳 watch有跳」）— 直接推翻「spike A 順便驗 spike B」的隱含假設。

**設計參考**: D5 SessionController.swift 在 `requestAuthorization()` 呼叫前要有條件判斷（如果 paired-share fail / Q22 spike B fail、才走 Watch-side fallback）— 否則無條件呼叫等於放棄 paired-share UX 優勢、每次 Watch app launch 都跳 dialog。

## Phase A → B 轉換速查

| 之前（Phase A / Expo Go）| 之後（Phase B+ / Bare）|
|---|---|
| `npx expo start --ios` → 在 sim 打開 | `npx expo start`（Metro only）+ Xcode build & run on device |
| `expo-` 套件 OK | `react-native-*` 套件需驗 New Arch 相容性 |
| QR scan from Expo Go | 真機已 install dev build、直接點 icon |
| `app.json` 改完直接 reload | 改 native config 需要 prebuild + pod install + Xcode rebuild |

## Anti-patterns

- ❌ `npm install <native-package>`（不會吃 SDK 版本對齊、會 break）
  - **例外**: ADR-0019 § Q5 拍板 `react-native-watch-connectivity@2.0.0` 用 **`npm install` pinned major**（不是 `npx expo install`）— 該 lib 非 SDK-managed、版本對齊由 ADR 明確指定。其他 native module 仍走 `npx expo install`。
- ❌ `pod install` 不帶 LANG（會炸 encoding bug）
- ❌ flip `newArchEnabled: false` 嘗試解 New Arch 不相容（reanimated assertion 會擋）
- ❌ 跑 `expo start --ios` 嘗試打開 sim（已脫離 Expo Go 不適用）
- ❌ 用 `.xcodeproj` 開 Xcode（pod-managed project 必須走 `.xcworkspace`）
- ❌ 看到一堆 warning 就以為 build 失敗（看 toolbar 的 "Build Succeeded"）

## Slice 13b lessons (2026-05-25 → 26)

1. **真機 smoke 必須在 PR 之前跑**：slice 13b 是離開 Expo Go 第一個 slice、code-level test green ≠ 能 build。真機 build 才發現 react-native-health New Arch 不相容、要 hotfix swap 套件。**Rule**：foundation/native-pipeline 改動的 slice 一律 manual real-device smoke 之後才 PR。
2. **`hk_authorization_requested` flag 只代表 "asked"、不代表 "granted"**：iOS HK API 為 privacy 不暴露 per-scope grant 狀態。Settings UI 顯「已連結」也只是「彈過 dialog」、不代表能讀資料。slice 13c 真讀 HK 資料時要靠 empty result 推斷 grant 狀態。

## Slice 13d D0 spike C + D4 + spike A lessons (2026-05-27)

3. **Spike harness 應該 build-into-the-app 而不是 standalone script**：spike C 把驗證邏輯寫進 `src/adapters/watch/spike/connectivitySpike.ts` + Settings tab 加一個「執行 WC spike」row → 用戶在實機點按鈕 + 結果 console.log 出 JSON、貼進 D0 commit body。spike A 同模式但 Watch native 層：`ios/<Watch App>/SpikeAHarness.swift` + ContentView 加 Run button + result panel + Console JSON dump。對比「寫個 CLI 跑驗證」要簡單得多 — 反正都需要 build 到實機才能驗 native bridge、不如借力 app 本身的部署流程。已 extract 成 `spike-d0-partial-pattern` project skill、spike B 直接套用。
4. **Spike code 不 cherry-pick 到 main**：spike harness 留在獨立 branch `slice/13d-d0-spike-X`、D0 partial doc commit 把結果寫進 ADR、spike code 等到 D-commit ship 時或刪或吸收（spike C → D3 connectivity.ts；spike A → D5 SessionController.swift）。避免 throwaway code 污染 main history。
5. **dev-env volatility 別誤判成 lib 問題**：spike C 過程中切 iPhone 鏡像→熱點時、出現 `TurboModuleManager: Timed out waiting for modules to be invalidated` 紅屏 — 看起來像 WatchConnectivity 2.0.0 + New Arch 衝突、實際是 Metro 連線斷的副作用。第一反應應該是「Metro 在嗎？同網路嗎？」再去懷疑 lib。
6. **Watch target via Xcode 不要試圖手刻 pbxproj**：D4 走 Xcode File → New → Target → watchOS App 的 GUI 流程。Xcode 改動 pbxproj 太複雜（UUID-keyed binary-ish）、手刻必崩。Branch C per ADR-0019 Q1 就是這個意思。
7. **`Watch App for Existing iOS App` radio 仍生 `.watchkitapp` BI**：Xcode 26 對話框 BI 預覽顯示 `com.lisonchang.TrainingLog-Watch`（看起來是 dash-suffix modern convention）、但實際選 "Watch App for Existing iOS App" + 選 iOS app 之後存的 BI 是 `com.lisonchang.TrainingLog.watchkitapp`（ADR Q2 拍板的 dot-suffix 舊慣例）。對話框是 placeholder、不是 final value。**驗證方法**：建好 target 後 General → Identity → Bundle Identifier 看實際值。
8. **Spike 結果一定要 cross-check 第二條獨立路徑**：spike A 自己的 `HKSampleQuery(workoutType)` 回 0 entries — 但這可能是 query predicate 寫錯。直到開 iPhone Health app **體能訓練** tab 親眼看「今天無新條目」、+ **心率** tab 19:51-19:53 有 sample 點、才算 verdict ground truth。spike harness 是「自己證自己」、容易 confirmation bias；第二條路徑（user-visible app / system UI）才是 oracle。
9. **每個 spike 都會冒出 unexpected finding 影響下個 spike**：spike A 跑完才發現 HK auth dialog 出現在 Watch、不是 iPhone（gotcha #10）— 這推翻了「spike A 順便 cover spike B 的 paired-share assumption」。直接寫進 ADR 翻盤 ledger top row + 「剩下未 land」段補上 spike B 不能 piggyback。Lesson：spike 跑完不只記 verdict、也要主動掃「跑這個 spike 時假設了什麼？我看到了那些假設是真是假？」
10. **Native Swift @ObservableObject 4-error cluster = import Combine（gotcha #9）**：spike A 第一次 ⌘B 失敗 4 個 errors 都在 SpikeAHarness.swift；初看像 protocol conformance 問題、實際是漏 `import Combine` 一個 fix 解掉全部。Type / init(wrappedValue:) 訊息**全聚在同一檔**是判別線索。
11. **Watch dev tunnel 「Timed out」error = 熱點 routing**（gotcha #7 升級）：spike A 跑前 Watch 一直 disconnect、Xcode banner 顯示「Timed out while attempting to establish tunnel using negotiated network parameters」— 根因是 iPhone 個人熱點開著 Mac 透過熱點上網。修法：iPhone 熱點關掉 + USB-C 線接 Mac + Mac WiFi 連回家用 router。**每次切換 dev 工作 session 都檢查一次**（spike C → spike A 換 session 就踩、別以為「上次 OK 這次也 OK」）。
12. **"開啟系統設定" deep link 不可靠**：`App-Prefs:Privacy&path=HEALTH` iOS 16+ 被 Apple 鎖、`canOpenURL` 回 false、走 fallback `app-settings:` 開 app 自己設定頁（不是隱私→健康）。Apple 沒給 reliable 直跳 path。

## Slice 13d D7-Swift lessons (2026-05-27 night)

13. **Watch target 用 `PBXFileSystemSynchronizedRootGroup` (Xcode 16+ sync folder)、新 .swift 檔丟進資料夾就自動編入**：D4 wave 建好 Watch target 後、`ios/TrainingLog Watch Watch App/` 是 sync folder（pbxproj 中 `isa = PBXFileSystemSynchronizedRootGroup`、`exceptions` 只 list `Info.plist`）。**加新 .swift 檔（如 D7-Swift 的 `WatchConnectivityCoordinator.swift`）**：直接 `Write` 進資料夾即可，**不用 Xcode GUI File → Add、不用手刻 pbxproj**。第 5 點 lesson 「不要手刻 pbxproj」沒過時、但「Xcode GUI 加新檔」對 sync folder target 也不必要。**驗證**：`grep "isa = PBXFileSystemSynchronizedRootGroup" ios/TrainingLog.xcodeproj/project.pbxproj` 看到該 target 就走 sync folder 模式；若該 target 還是 `PBXGroup` + 逐 .swift `PBXFileReference` 則回到 5 點走 Xcode GUI。

14. **xcodebuild 驗 Watch target 編譯：用 `-target` 不要用 `-scheme`**：`xcodebuild -scheme "TrainingLog Watch Watch App"` 會帶上 iPhone target 依賴（因為 Watch app 是 embedded in iOS app）、需要 `pod install` 產物（ExpoSystemUI / NitroModules / ReactNativeHealthkit modulemaps）齊全才能跑。改用 `xcodebuild -target "TrainingLog Watch Watch App" -project TrainingLog.xcodeproj -destination 'generic/platform=watchOS' -configuration Debug build` 就**只編 Watch target**、跳過 iPhone deps、純 Swift 改動驗證快得多。**用法時機**：Watch native code 改完想快速確認 syntactic/type-check OK（不關心 iPhone 端能不能 install），這是首選。但**最終 ship 前**仍需要跑完整 `-scheme` build 才知道整個 watch app 能 install 到實機（embed phase 需要 iPhone target 產物）。

15. **`@Published` 在 watchOS Swift 檔漏 `import Combine` = 「'init(wrappedValue:)' is not available」cluster**：gotcha #9 + 第 10 點是同一個坑、再記一次：寫新 `ObservableObject` 子類時 import 三件套要齊 — `import Foundation` + `import Combine` + 任何特定 framework (`import HealthKit` / `import WatchConnectivity`)。D7-Swift 第一次 build 就漏 `import Combine`、立刻 4 個錯。如果 Watch 端要寫的 class 有 `@Published` 或 conform `ObservableObject`、第一行就把 Combine 寫進去再開始。

16. **watchOS 是 arm64_32、Swift `Int` 是 32-bit、epoch ms 強轉必 crash**：watchOS 跑 arm64_32 架構（不是 arm64！是給 Apple Watch 設計的 32-bit 指標 + 64-bit 暫存器）。Swift `Int` 在 watchOS 等於 `Int32`、`Int.max = 2,147,483,647`（2.1e9）。但 epoch ms = `Date().timeIntervalSince1970 * 1000` 在 2026 是 1.78e12、整整大 3 個量級。`Int(epochMs)` 強轉就是 runtime fatal：`Fatal error: Double value cannot be converted to Int because the result would be greater than Int.max`、stack trace 落在 `Swift/arm64_32-apple-watchos.swiftinterface`。**xcodebuild 不會抓到**（runtime overflow、compile-time 看不出來）、要實機跑才會炸。**修法**：所有 epoch ms / 大整數 cast 一律用 `Int64`（永遠 64-bit、跨 iPhone/Watch 都安全）。`"ts": Int64(Date().timeIntervalSince1970 * 1000)`。**檢查**：寫 Watch Swift 之前先 `grep -rn 'Int(' "ios/TrainingLog Watch Watch App/" | grep -iE "time|date|epoch|ms|interval"` 看有沒有 `Int()` 包 Double / TimeInterval 的地方、有就改 `Int64`。**驗證**：在 D7-Swift `2026-05-27 night` 真機 smoke 第一次 tap outbound button 立刻炸出來、debugger pause 在 `Int(...)` 那行；改 `Int64` 後 build + relaunch、smoke PASS。

17. **`react-native-watch-connectivity` 的 reply-variant delegate 永遠贏、3-arg sendMessage 從 Watch 出永遠 timeout**：library iPhone 側（`node_modules/react-native-watch-connectivity/ios/WatchConnectivity.mm`）**同時實作** `session:didReceiveMessage:` 跟 `session:didReceiveMessage:replyHandler:` 兩個 delegate method。Apple WC framework 永遠優先 dispatch 到 reply-variant、即使 sender（Watch）給的 replyHandler 是 nil。Library 把 framework 給的 reply block 存進 `replyHandlers` NSCache + 在 message 注入 `id` field、然後 JS 必須 call `replyToMessageWithId(id, reply)` 才會 invoke 那個 block。**如果 JS 沒 expose 那個 API**（D7-TS 的 `addMessageListener` 就沒）、reply 永遠不送、Watch 端 3-arg sendMessage 卡 `withCheckedContinuation` 永遠不 resume；改 2-arg `replyHandler: nil` 也救不了 — Apple framework 在 ~5s 後吐 `WCError code 7016 WCErrorCodeMessageReplyTimedOut` 從 errorHandler 進來、但**訊息其實已經送到 iPhone 並執行**（receiver delegate 跑了）。**修法兩條**：(a) **快**：Watch Coordinator errorHandler 偵測 `nsError.domain == WCErrorDomain && nsError.code == WCError.Code.messageReplyTimedOut.rawValue`、treat 為「sent, no ack expected」顯示 `sent sess=… (no-ack)` 不顯示 err；(b) **慢但正確**：extend `src/adapters/watch/connectivity.ts` 加 `replyToMessageWithId` 暴露 + `addMessageListener` 簽名讓 handler 拿到 message id + 一個 reply callback、D7-TS handler 真的 reply。**Trade-off**：(a) 改 1 個 Swift 檔 10 行、(b) 改 3 個 TS 檔 + 重寫 jest mock + 寫新 case。**Default 走 (a)**，因為 D7 Watch→iPhone 方向本來就是 notification-shaped（iPhone reconcile via idempotent gate、不需要 ack）；只有 iPhone→Watch 那個方向真的用 ack（D7-TS `pushEndToWatch` 拿 ack flip `is_watch_tracked`、Watch Coordinator 的 inbound handler 明確 call `replyHandler(["ok": true])`）。**驗證 case**：D7-Swift 真機 smoke `2026-05-27 night`、改 2-arg 還是 stuck err、加 7016 swallow 之後 Outbound 立刻 `sent sess=Test-3` 不再卡。**Long-term**：寫新 WC channel 之前先決定方向是 notification 還是 RPC、notification 走 (a)、RPC 走 (b)、別兩邊都用 3-arg 寫然後撞 timeout。
