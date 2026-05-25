---
name: screenshot-compare
description: A/B/N variant visual comparison workflow when iterating UI redesigns. Use when multiple agent attempts produce different visual outputs (e.g. anatomy SVG redraw rounds, Programs wizard layout iterations) and need systematic side-by-side review. Pairs with picks-batch for the cherry-pick rotation.
---

# Screenshot Compare — Variant 視覺評選

當一個 UI 變更跑了 multiple parallel attempts（典型 = overnight-parallel-agents + N variants）、要從 N 個 candidate 挑勝者、或合成 hybrid 時用此 skill。手動目視比對 5 個 variant 很容易混淆「上一張 vs 這張」。

## When to use

- N parallel agents 對同檔產出 N 個 variant、要挑勝者
- 一個 UI 改動經過多輪反饋（如 anatomy SVG R1-R4）、要對比哪輪最接近目標
- A/B test 一個 layout 改動（如 Programs tab 編輯 mode 兩種 layout）

## When NOT to use

- 純 logic 改動（無視覺差）— 用 unit test 而非肉眼比
- 視覺差太微小（< 5px）— 改用 visual regression test（screenshot-snapshot）
- 只一個 variant — 直接 review、不需要 compare framework

## Setup

### 1. 命名 convention

每個 variant 對應一個 branch：`<feature>/r<round>-<variant-name>`

- 範例 anatomy redraw：
  - `anatomy/variant-a` (R1, lean)
  - `anatomy/variant-b` (R1, dramatic)
  - `anatomy/r3-faithful` (R3, trace)
  - `anatomy/r3-medical` (R3, medical-precision)
  - `anatomy/r4-vision-trace` (R4, vision-based)

### 2. 截圖 convention

每個 variant 上線後 user 一律走同路徑截圖、同 viewport、同畫面狀態：

- 路徑要寫進 user prompt：「Today → Templates → ... → 截」
- 同一 anchor 條件：同一張 session、同一塊資料、同一 device 角度

### 3. 命名截圖

存到 `/tmp/screenshot-compare/<feature>-<variant>.png`（不入 git）。

```bash
mkdir -p /tmp/screenshot-compare
# user 拍完後 export 命名
```

或讓 user 直接傳給 AI 看（如本 session anatomy）。

## 流程

### Step 1 — Pick variant A → push → user reload → screenshot

```bash
# in main worktree (e.g. slice-10c-set-logger-and-menu)
git cherry-pick <variantA_SHA>
npx tsc --noEmit && npm test  # verify
git push origin <main-branch>
# user: Cmd+R simulator, walk path, screenshot
```

### Step 2 — Score variant A vs target

列 N 個 criteria（每 feature 不同）、對 A 評分：

```
| Criteria             | Target (reference) | Variant A | Pass? |
|----------------------|--------------------|-----------|-------|
| Shoulder width       | ≤110 units         | 92        | ✓     |
| Pec V-notch visible  | yes                | hint only | ⚠     |
| Lat V-taper          | clear              | blob      | ✗     |
| Hands 5-finger       | yes                | mitten    | ✗     |
| 3D depth             | subtle             | flat      | ✗     |
```

5 criteria、3 fail = 不夠好、試下一個。

### Step 3 — Revert + pick next

```bash
git revert --no-edit HEAD  # revert variant A
git cherry-pick <variantB_SHA>  # pick B
npx tsc --noEmit && npm test
git push origin <main-branch>
# user: Cmd+R, screenshot B
```

### Step 4 — Decide

3 outcomes：

1. **某 variant 全綠** → 留它、清掉 revert commits（interactive rebase 或 reset → cherry-pick 乾淨）
2. **沒一個全綠、但有部分強** → Hybrid round：寫新 agent prompt「取 X 的 A、取 Y 的 B、混」
3. **都不夠** → Round N+1：升級 prompt（如 anatomy R3 → R4 加 reference image）

### Step 5 — Cleanup commit history

選定後、避免主 branch 上留下 revert/pick 來回的雜訊 commits：

```bash
# Option A: 直接重起 branch 自 clean baseline + 單一 winner pick
git reset --hard <baseline-SHA>
git cherry-pick <winner-SHA>
git push --force-with-lease origin <main-branch>
# ⚠ force push — 用 --force-with-lease 不 --force、保護 race

# Option B: interactive rebase 把 revert + 對應 pick 對銷
git rebase -i <baseline-SHA>
# 對 revert + 對應 cherry-pick pair 標 drop
```

## Anti-pattern

- ❌ 一次 push 多個 variant、user 不知道哪個 commit 是哪個 — push 訊息明確寫 variant name
- ❌ Variant A/B 沒同畫面狀態截圖 — 比的不是 variant 而是不同資料、無意義
- ❌ 留 5 個 revert commits 在 release branch — ship 前一定清乾淨
- ❌ N > 3 仍跑同質 prompt — 變體間缺乏明確「方向差異」、agent 收斂到同個 mediocre 答案、必要時直接砍掉用更高解析度 reference

## 歷史 baseline

本 session anatomy SVG 走過 5 個 variant：
- R1 A (lean) / B (dramatic) — prose-only prompt、太抽象、A 太平 / B 太膨
- R3 C (faithful) / D (medical) — 加詳細座標 spec、好但仍離 reference 一截
- R4 E (vision-trace) — 加 19 張 reference image 進 prompt、agent 自己 Read 圖、終於 trace 對

每輪都用此 skill 的 picks-batch + revert/cherry-pick 循環、user 同路徑截圖比對。**Round 升級時的 prompt 變更幅度 >> 同一 round 內 variant 之間差異**。

## 相關 skill

- `picks-batch` — 配對 cherry-pick + revert + verify 的下游機械
- `overnight-parallel-agents` — 上游：怎麼起 N 個 parallel agent 跑 variant
- `ui-ux-pro-max` (user-level) — UI/UX 設計判讀框架
