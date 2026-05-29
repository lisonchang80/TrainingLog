---
name: testflight-changelog
description: Generate a TestFlight "What to Test" note + release-notes summary from the git range between two builds. Triggers — "/testflight-changelog", "TestFlight changelog", "What to Test 文案", "build N 的 release notes", "兩個 build 之間改了什麼". Reads git log + CFBundleVersion, outputs ready-to-paste 中英文 changelog. User-invoked only (it's a release-prep summary, no side effects).
disable-model-invocation: true
---

# TestFlight changelog — 從 git range 產出 What to Test

把「上一個 build → 現在」的 git 變更整理成可直接貼進 App Store Connect 的 TestFlight「What to Test」+ 內部 release notes。中英文各一份。

## When to use
- 準備上傳新 TestFlight build（CFBundleVersion 剛 bump）
- 要給測試者一份「這次改了什麼、要測哪裡」
- 想回顧兩個 build 之間的功能 / 修復清單

## Inputs（呼叫時可帶，沒帶就問或推斷）
- `from`：上一個 build 的 tag / commit（預設：找最近一個 `build-*` tag，或上次上傳點）
- `to`：本次 build 的 commit（預設 `HEAD`）

## 流程

### Step 1 — 定位 range + build number
```bash
git tag --list 'build-*' --sort=-creatordate | head -3   # 找上次 build tag（若有用 tag）
git rev-parse HEAD
# 本次 CFBundleVersion（host）
/usr/libexec/PlistBuddy -c "Print CFBundleVersion" ios/<App>/Info.plist 2>/dev/null \
  || grep -n CURRENT_PROJECT_VERSION ios/*.xcodeproj/project.pbxproj | head
```
若沒有 build tag，請使用者指定 `from`（或用「上次上傳那天的 commit」）。

### Step 2 — 收集 range 內變更
```bash
git log --no-merges --pretty='%h %s' <from>..<to>
git diff --stat <from>..<to>
```

### Step 3 — 分類 + 過濾
把 commit 依 conventional prefix 分桶，**過濾掉測試者看不到的**（chore/docs/test/refactor 內部項、CFBundleVersion bump、CI）：
- ✨ 新功能 — `feat:`
- 🐛 修復 — `fix:`
- ⚡ 體感改善 — perf / UX polish
- 🔒 內部（不進 What to Test，只進內部 notes）— chore/refactor/test/docs

每條改寫成**使用者語言**（不是 commit 訊息原文）：說「使用者會看到/感受到什麼」，不是「改了哪個檔」。

### Step 4 — 產出兩份文案

**A. TestFlight「What to Test」(< 4000 字元、條列、面向測試者)**
- 開頭一句本次重點
- 「請重點測試」3-5 條（對應這次改動的實際操作路徑，例：Set logger inline 編輯、Watch 結束訓練回寫）
- 已知問題（若有 device-gated backlog 相關）

**B. 內部 release notes (給自己留底)**
- 完整分桶清單（含內部項）
- build number、range（`<from>..<to>`）、commit 數

兩份都中英對照（使用者習慣 zh-TW；App Store 審核看得懂英文更穩）。

### Step 5 — 輸出 + 提示
直接把兩份貼在對話裡（**不自動寫檔、不自動 tag、不自動上傳** — 這些使用者自己在獨立工具做）。最後提醒：確認後可自行 `git tag build-<N>` 標這次上傳點，下次 range 就好抓。

## Anti-pattern
- ❌ 把 commit subject 原文當 What to Test（測試者要讀的是「測什麼」不是「改了哪個函式」）
- ❌ 把 chore/refactor/test 放進面向測試者的文案（噪音）
- ❌ 自動 tag / 自動上傳 — 本 skill 只產文案，發布動作使用者自己來
