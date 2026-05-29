# Slice 13d D29 — Watch live-mirror producer · 實機 smoke checklist

**Backlog**: task #269 · **Commit under test**: `0223869`
**Spec**: ADR-0019 § NEW-Q50 Q6=a + 「新增 D-chain commits (D28+)」D29 row
**Goal**: 證明 Watch log set → iPhone 中途畫面即時鏡像（D32 receiver 在 D29 之前是死的、沒人餵 applicationContext；這份驗證它活了）。

## 在驗什麼

| Case | 驗證點 |
|------|--------|
| A | 初始 force-push（掛載即推全樹）+ live 鏡像（logged ✓ / 改重量次數 ≤15s 反映 iPhone）+ absent→null round-trip（有資料上得去就代表 parser 沒整包 reject）|
| B | [完成] `emitFinal()` 補推最後一筆（final-batch ordering 觀察點）|
| C | [放棄] 不被晚到的 mirror 重建已硬刪的 row（emitFinal 不能誤觸 discard）|

> **15s 是節流窗**：log 完別急，等滿 ~15s 再判 A4，別 t=3s 就喊壞。掛載時的第一筆是 force-push（即時）。

---

## 前置（必做）

- [ ] **0a.** build + 裝最新 main (`0223869`) 到「實機」iPhone + Watch
      - ⚠ Swift 有改 → 走 `xcodebuild-watchos-realdevice-install` skill，記得 **nuclear delete cycle**，否則 incremental 會 skip Watch target、裝到舊 binary 看不到 D29
- [ ] **0b.** iPhone 先建一個「≥1 動作、每動作 ≥2 組」的模板（要有東西可 log）
- [ ] **0c.** iPhone 停在「訓練」tab 前景放著（① 看 live 更新 ② 確保 reachable）
- [ ] **0d.** Watch 開 App、停在 picker 起始頁

---

## CASE A — 初始推送 + live 鏡像（D29 核心，最重要）

```
┌─ Apple Watch ─────────┐        ┌─ iPhone「訓練」tab（示意）─┐
│ 推日（A）·通用·通用    │        │ 進行中：推日（A）          │
│ ───────────────────── │        │  臥推                      │
│ 臥推                   │        │   1. 80 × 8    ◻          │
│  ① 80kg × 8   ◯  ◄tap │        │   2. 80 × 8    ◻          │
│  ② 80kg × 8   ◯       │        │  深蹲 …                    │
│  ③ 80kg × 8   ◯       │        └────────────────────────────┘
│  ‹完成頁 ● 音樂›       │
└────────────────────────┘
```

- [ ] **A1.** Watch：tap 模板 → 進 SetLogger（in-session 卡片頁）
      - ⇒ 預期：~幾秒內 iPhone「訓練」tab 出現「進行中：<同一 title>」+ 動作/組數樹（**initial force-push** 生效）
- [ ] **A2.** Watch：tap 第①組的 ◯ → 變 ✓（logged）
- [ ] **A3.** Watch：tap ①組的重量 cell → 改成 `100` → commit；次數改成 `5`
- [ ] **A4.** 等最多 ~15s（throttle）盯 iPhone
      - ✅ 過 = iPhone ①組反映「✓ + 100 × 5」→ live mirror 全鏈通（含 absent→null round-trip）
      - ❌ iPhone 永遠只有空殼、log 後不動 = mirror 被 reject（回報，看 lastOutbound）

---

## CASE B — [完成] 補推最後一筆（final-batch 觀察點）

```
┌─ 完成頁 ─────────┐
│   [放棄]  [完成]  │ ◄ tap [完成]
└────────────────────┘
```

- [ ] **B1.** Watch：再 log 第②組（✓ + 改個重量），**≤15s 內「立刻」**往右滑到完成頁
- [ ] **B2.** tap **[完成]** → session 結束、Watch 回 picker、iPhone 也結束
- [ ] **B3.** iPhone：開「歷史」→ 該筆 session 詳情頁
      - ✅ 過 = 第②組（最後一筆、在 15s 窗內 log 的）有進去 → `emitFinal()` 有效
      - ❌ 第②組漏掉 = final-batch race 真的會發生 → 觸發**穩健解：end-session TUI 帶最終 snapshot**（會先 grill，動 D7/end-session envelope）

---

## CASE C — [放棄] 不重建 row

- [ ] **C1.** Watch：新開一個 session、log 1~2 組
- [ ] **C2.** 往右滑完成頁 → tap **[放棄]**
      - ✅ 過 = iPhone「訓練」tab 該 session 消失、「歷史」也查無此筆（沒被晚到的 mirror 重建）
      - ❌ iPhone 殘留一筆空/孤兒 session = emitFinal 誤觸 or 別處有漏推

---

## 附｜診斷訊號（卡住時看）

- Watch 端 `coordinator.lastOutbound` 每推一筆會寫 `live-mirror sent sess=XXXXXXXX ex=N`
  - 顯 `live-mirror skip: not activated` / `...error: ...` → WC 沒通
  - 若 ⚙ 設定頁 / dev 區沒露這字串，就以 iPhone 畫面為準
- 程式對照：`ios/TrainingLog Watch Watch App/LiveMirrorProducer.swift`（producer）、`WatchConnectivityCoordinator.updateLiveMirror`（送）、`src/services/watchLiveMirrorReceiver.ts`（iPhone 收 + parse）

## 回報格式

```
A1 ✓/✗  A4 ✓/✗  ｜ B3 ✓/✗  ｜ C2 ✓/✗
lastOutbound: <貼任何看到的字串>
```

通過 → D29 端到端 production-verified、可在 ADR D29 row 補「real-device smoke PASS」。
B3 失敗 → 開 final-batch 穩健解的 grill。
