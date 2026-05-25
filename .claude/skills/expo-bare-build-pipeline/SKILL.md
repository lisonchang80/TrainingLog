---
name: expo-bare-build-pipeline
description: >
  TrainingLog leaving Expo Go for Bare workflow (since slice 13b 2026-05-25):
  expo prebuild → CocoaPods → Xcode signing → Metro → real-device install
  pipeline + 5 specific gotchas. Use when adding any native module
  (HealthKit, WatchConnectivity, file system, etc.), regenerating ios/
  via prebuild, or debugging a dev build that won't launch / crashes on
  HK / Native module call. Trigger words: "expo prebuild", "pod install
  失敗", "NativeModules undefined", "initHealthKit is not a function",
  "RCT_NEW_ARCH_ENABLED", "Build Succeeded but app crashes", "No script
  URL provided", "Xcode signing requires development team", "Encoding
  CompatibilityError", "newArchEnabled false / true". Validated 1× slice
  13b (2026-05-25 → 26).
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

## 5 個必踩 gotcha

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

## Phase A → B 轉換速查

| 之前（Phase A / Expo Go）| 之後（Phase B+ / Bare）|
|---|---|
| `npx expo start --ios` → 在 sim 打開 | `npx expo start`（Metro only）+ Xcode build & run on device |
| `expo-` 套件 OK | `react-native-*` 套件需驗 New Arch 相容性 |
| QR scan from Expo Go | 真機已 install dev build、直接點 icon |
| `app.json` 改完直接 reload | 改 native config 需要 prebuild + pod install + Xcode rebuild |

## Anti-patterns

- ❌ `npm install <native-package>`（不會吃 SDK 版本對齊、會 break）
- ❌ `pod install` 不帶 LANG（會炸 encoding bug）
- ❌ flip `newArchEnabled: false` 嘗試解 New Arch 不相容（reanimated assertion 會擋）
- ❌ 跑 `expo start --ios` 嘗試打開 sim（已脫離 Expo Go 不適用）
- ❌ 用 `.xcodeproj` 開 Xcode（pod-managed project 必須走 `.xcworkspace`）
- ❌ 看到一堆 warning 就以為 build 失敗（看 toolbar 的 "Build Succeeded"）

## Slice 13b lessons (2026-05-25 → 26)

1. **真機 smoke 必須在 PR 之前跑**：slice 13b 是離開 Expo Go 第一個 slice、code-level test green ≠ 能 build。真機 build 才發現 react-native-health New Arch 不相容、要 hotfix swap 套件。**Rule**：foundation/native-pipeline 改動的 slice 一律 manual real-device smoke 之後才 PR。
2. **`hk_authorization_requested` flag 只代表 "asked"、不代表 "granted"**：iOS HK API 為 privacy 不暴露 per-scope grant 狀態。Settings UI 顯「已連結」也只是「彈過 dialog」、不代表能讀資料。slice 13c 真讀 HK 資料時要靠 empty result 推斷 grant 狀態。
3. **"開啟系統設定" deep link 不可靠**：`App-Prefs:Privacy&path=HEALTH` iOS 16+ 被 Apple 鎖、`canOpenURL` 回 false、走 fallback `app-settings:` 開 app 自己設定頁（不是隱私→健康）。Apple 沒給 reliable 直跳 path。
