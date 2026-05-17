---
name: polish-loop
description: Sequential overnight pattern for iterative UI polish driven by iOS Simulator smoke-test feedback. User sends screenshot or text complaints round-by-round; you list points, ask clarifying A/B/C questions, draft a self-contained prompt, get OK, launch single agent in background, verify (tsc + tests + git), summarize. Distinct from overnight-parallel-agents (parallel multi-task). Trigger when user is actively giving feedback rounds with screenshots or short bullet complaints like「這裡怪怪的」/「改 X」/「請在 overnight 執行」.
---

# Polish Loop — Sequential Iterative Overnight

**Validated 2026-05-17 on TrainingLog slice 10c**: 8 overnights in one night (cluster card refactor / polish / visual / today polish / layout / set label ordinal / history cluster filter) + 1 手做 + 1 revert. Branch tests 886 → 930.

## When to use

User in iOS Simulator smoke-testing mode:
- Sends screenshots with 1-3 lines of complaints
- Or terse text bullets ("# 應該是數字" / "砍掉 X")
- Expects iterative cadence — one round per overnight, multiple rounds per night
- Each round is small-scope (3-8 points typically)

## When NOT to use

- Single bigger feature → `ship-slice` instead
- ≥2 truly independent tasks → `overnight-parallel-agents` (parallel)
- 1-line fix you can do directly → just do it foreground
- User wants real-time pair programming, not background

## Per-round loop (do this every cycle)

### 1. Read the user input
Parse screenshot + 中文 complaints into discrete points (1, 2, 3...). If unclear → list your interpretation with A/B/C choices.

### 2. Clarify before drafting (max 2-3 Qs)
Recommended answer provided each time. User answers with 1-line replies (`A` / `1` / `OK`).

Common clarification axes:
- UI placement (where exactly?)
- Default state (first-load value?)
- Scope (cluster only / solo only / both?)
- Edge cases (empty state? legacy data?)
- Cycle behavior (skip a value? include all?)

### 3. Quick explore (grep + Read 1-3 files)
Don't write prompt blind. Confirm exact file paths + line numbers. Spot existing patterns to mirror.

### 4. Draft prompt + show to user BEFORE launching

```
**Working dir**: <absolute worktree path>
**Branch base**: <branch>@<sha>
**Output report**: /tmp/overnight-reports-YYYY-MM-DD/NN-<task>.md

## 必讀（先讀再動）
1. <file> — <why>
2. ...

## Scope — N 點（按順序，每點 1 commit）

### 1. <point title>
- 現況：<what now>
- 改：<what should be>
- 公式 / 邏輯 / UI 描述
- 加 unit test：<file, X case>
### 2. ...

## 規則
- 每點 commit + push，commit message 結尾加：
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
- `npm test` 每 commit 前綠（XXX+ → 目標只升不降）
- `npx tsc --noEmit` clean
- LSP false positive (Text/View/String/Number/Date/Promise) **忽略**，tsc 為準
- 不裝新 dep（如需，stop 並列在 report）
- 用戶語言：commit body 可中文，type prefix 英文

## Report format
- 每點：commit hash + 一行 + 改的檔
- 最終 test count（前 X → 後 X）
- tsc 狀態
- 重大實作決策（pattern / hex / lib）
- 遺留問題（特別是該用戶決定的）
- 用戶 reload 該驗的 N 個畫面

## Stop conditions
- 任一點 3 次 attempt 修不掉 → 停回報
- N 點全完 → 全測 + tsc → push → 寫 report
```

User `OK` → launch. 有異議 → 修。

### 5. Launch in background

```typescript
Agent({
  description: "<short task name overnight #N>",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: <prompt>,
})
```

`run_in_background: true` 必填，這樣用戶可以繼續餵 feedback。

### 6. Queue while running

新 request 進來時：
- **Same file in scope?** → queue 給下一輪 overnight。**禁止 parallel-launch**（file conflict）
- **Different file 真獨立?** → 可 parallel，但 polish 很少有真獨立
- **1-2 line 小改?** → 等本輪完，foreground 手做

每個 queue item 用 1-line table update 確認收到。

### 7. Verify on completion（**不信 agent 自報**）

收到 completion notification 時：

```bash
cd <worktree>
npx tsc --noEmit 2>&1 | tail -3    # 應該空 output
npm test -- --silent 2>&1 | tail -5  # X/X passed
git log --oneline <base>..HEAD       # 確認 commits
git status                           # working tree clean
git rev-parse HEAD origin/<branch>   # local == remote
```

任何不對 → 調查，不要急著回報。

### 8. Summarize

```
✅ Overnight #N 全綠：tsc clean, X/X (+N), push 至 <sha>

| 點 | Commit | 效果 |
|---|---|---|
| 1 | abc1234 | ... |
| 2 | ... | ... |

## 早上 reload 該驗 N 個畫面
1. ...
```

Report path 附上。

## Critical gotchas

### LSP false positives in RN/Expo worktree（**每個 prompt 都要提醒 agent**）

新 worktree（或某些 IDE LSP 狀態）會 throw：
- `Cannot find name 'Promise' / 'Map' / 'Set' / 'Date' / 'Math' / 'Number' / 'String' / 'Array' / 'Error' / 'Record' / 'Partial' / 'ReadonlyArray' / 'ReadonlyMap'`
- `'Text' / 'View' / 'TextInput' / 'KeyboardAvoidingView' cannot be used as a JSX component`
- `Cannot use JSX unless the '--jsx' flag is provided`
- `Property 'trim' / 'replace' / 'sort' / 'map' / 'filter' / 'length' does not exist on type 'string' / '{}'`
- `Parameter implicitly has 'any' type`
- `Module ... was resolved to ... but '--jsx' is not set`

**全是 LSP noise。`npx tsc --noEmit` 為唯一 ground truth**。

Verify 時也要堅持用 tsc，不要被 LSP diagnostics 影響判斷。

### CWD discipline

`npm test` 可能在錯 cwd 報 `ENOENT /Users/.../package.json`。Bash 永遠 prefix `cd <worktree-absolute-path>` 或用 Bash 的 working dir。

### Commit-per-point + push-each-commit

不要 batch commit。每點一 commit 一 push：
- 失敗時容易回滾單點
- 用戶可以 mid-way 看到進度（git log）
- 解決衝突時 grain 細

### 不裝新 dep

用戶 explicit 過：装 dep 是用戶的事。Agent 需要新 dep → STOP，document，user 手動裝。

### Revert pattern when 改錯方向

用戶會 mid-flight 改主意。`git revert <sha>` 可能因 conflict 失敗（後續 commit 動了同檔）→ 手動 resolve conflict marker，git add，`git revert --continue --no-edit`，跑 tsc + test，push。

別硬 `git reset --hard`（會 lose 之後的 commits）。

## Anti-patterns

- ❌ 不秀 prompt 就 launch → 用戶抓不到 scope 錯
- ❌ 跳過 clarifying questions「省時間」→ 方向錯，大返工
- ❌ 信 agent 自報不 tsc verify → 出包機率高
- ❌ Same-file parallel launch → merge conflict 自己擦屁股
- ❌ 連跑 6-8 overnight 沒 `/cp` → context 爆掉
- ❌ Prompt 沒提 LSP false positive → agent 浪費 attempts 跟 noise 鬥
- ❌ 不寫 stop conditions → agent 卡死也不停

## Related skills

- `overnight-parallel-agents` (user-level) — 多任務真並行
- `phase-precheck` (project) — ADR / ledger / memory 衝突先 precheck
- `ship-slice` (project) — 完整 slice ship，不適合單點 polish
- `feature-decision-sweep` (project) — 決策落地後 sweep PRD / memory / ADR
