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

**用戶報 UI 顯示異常 / 資料消失 / 兩處不一致時** → 先用 `simulator-db-query` skill 直查 simulator SQLite 對症（5-10 min），確認是 code bug 還是 data/spec 問題，**再決定是否 launch overnight**。2026-05-18 wave round 4 學到的教訓：歷史頁顯示 0 而 library 顯示 19 結果是兩 query 對「次數」定義不同（spec 不一致），不是 code regression — 若直接 launch overnight 修「歷史 query bug」會走錯方向。

### 4. Draft prompt + show to user BEFORE launching

**用戶可能要求簡化呈現**（TrainingLog 用戶 2026-05-18 立 rule）：
- 預設**不要貼 prompt 全文給用戶**
- 改用**≤100 字自然語言描述**：簡短交代「修哪個 bug / 加什麼 feature / 幾個 commits」，end with「OK 就 launch」
- Prompt 全文自己處理，內部仍要 self-contained（給 agent 用）
- 用戶 OK 就 launch；用戶要看細節再貼

範例自然語言 spec（≤100 字）：
> **Overnight #N — 一句 task 名**
>
> 修 bug / 加 feature 描述（1-2 句帶 root cause 或 spec）。改 X 檔，加 Y test。N commits、background 跑。
>
> **OK 就 launch。**

如果用戶沒有設此 rule，預設仍可貼 prompt template 給用戶 review：

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
- **Different file 真獨立?** → 可 parallel（見下方 same-worktree parallel pattern）
- **1-2 line 小改?** → 等本輪完，foreground 手做

每個 queue item 用 1-line table update 確認收到。

### 6b. Same-worktree parallel launch（disjoint files only）

當 ≥ 2 個 task **真的不動同檔**（grep 確認），可以同一個 message 內 launch 多個 background agent。但兩個 agent 共用同 branch / 同 remote，會有 `git push` race（後完成的需要 rebase）。

**在每個 prompt 開頭加 ⚠️ 並行注意 section**：

```
## ⚠️ 並行注意

本任務與 Overnight #NX「<其他 task 名>」並行跑（不同檔，不該衝突）。
- 本任務只動 <file A>
- 不要動 <file B>（那是 #NX 的範圍）
- 推時若 `git push` 因 remote ahead 失敗 → `git pull --rebase` → 解衝突（理論上無）→ 再推
- 若 rebase 遇衝突（不該發生）→ STOP 並列在 report
```

驗證 2026-05-18 #14A + #14C 並行成功（5ca63dd/94b821d/034ca4b/7b8f911 全綠 push）。後完成的那個 agent fast-forward 沒衝突。

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

**Flaky test 處理**：偶爾 `npm test` 第 1 次跑 1-2 個 suite fail、re-run 全綠（jest cache / better-sqlite3 timing / async race 等 transient 因素）。2026-05-19 #47 verify 踩過：第一次 `1 failed, 1100 passed, 1101 total`、第二次 `1101 passed`。**規則**：fail 數 ≤ 3 → re-run **一次**確認；仍 fail 才查；fail 數 ≥ 5 → 直接查（一定是 real bug）。不要瞎 re-run 五次當 noise 過濾。

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
- ❌ **跳過 agent 標的「留尾」/「dead code candidate」**→ 那條通常會 bite back（用戶 reload smoke 就踩到）。2026-05-19 slice 10c wave #37 落地時 agent 標「留尾 #1：既有 sub_tag-pick path mismatch 未解」+「onEdit 沒做 lookup-or-spawn」；當下沒立即處理 → #38 用戶 reload 又報 bug，加 #41/#42 才補完。**規則**：每輪 agent report 收尾時，把「留尾」list 跟用戶 review 一次，決定是否併入下一輪 scope 而非等到 user 抱怨。**反向 case (2026-05-20 #55)**：留尾本身也會 stale — 「ActionSheet idx 0 仍是 stub」實際上 #28 已落地、memory 沒同步更新。Agent 收到留尾任務時應先 grep / Read 確認現況、stale 就 pivot 到真正 gap（#55 pivot 到 dup guard / prefill / catch flow）。**Prompt 寫法**：留尾描述加「先驗 X 是否仍 stub，若已實作則找真正 gap」一句、避免 agent 浪費 attempts 重複既有實作。
- ❌ **多 wave 同一 feature evolve 沒鎖 ADR/glossary**→ 規格隨用戶 feedback 漂移、回頭 implement 已動的 code 三次（#37 spawn-on-create → #38 lookup-or-spawn → #39 revert spawn → #41 dedupe+revert revert → #42 onEdit parity）。**規則**：每 2-3 wave 後若同 feature 仍在演化，stop 跑一輪 grill 把核心 spec / ADR amendment 鎖住再續 launch。
- ❌ **Partial-fix 包成 full-fix commit message** → 2026-05-19 #42 commit message 寫「修「不管選什麼最後都是 representative」bug」、但實際只解非通用 case；通用 program (`wantedProgramId === null`) 路徑仍 short-circuit 跳過 lookup → #48 才補完。**規則**：(a) 寫 prompt 時，**spec 段**明列 edge case scenarios（通用 / NULL / empty / 跨 section etc.）讓 agent 知道要涵蓋哪些 path；(b) verify report 時不只看「commit message claim」，grep 修過的 function 找其他 caller / 其他 branch 確認 fix 覆蓋完整；(c) 用戶 reload smoke 報「同一 bug」回來時，先懷疑「上次 fix 是 partial」而不是「regression」。
- ❌ **Prompt 同時有具體範例 + 抽象文字 spec、兩者不一致** → 2026-05-19 #47 Point 4 範例寫 `0' 00"`/`1' 05"`（MM 不 padded），但文字寫「MM 兩位 padded」自相矛盾。Agent 自決「以範例為準」沒事，但若衝突嚴重會走錯方向。**規則**：prompt 寫法明示 fallback「**範例為準**」或「**文字為準**」、或範例 / 文字至少其一統一明確。Best practice — **多寫具體範例、少寫抽象文字描述**（範例本身就是 spec），讓 agent 只用 example-driven 推斷。
- ❌ **Agent flag 的 risk 用戶 reload 命中時、再起新 agent fine-tune** → 2026-05-20 #52 統一動作卡規格 wave、agent report flag「跨手機 cell 寬度容納度」risk；用戶 reload 截圖確認 cluster row 撐爆。當下選擇 **parent inline fine-tune**（單檔 ~4 處數值縮、單個 commit）而非 launch #52.1 agent — 省 agent setup overhead + 沒等待時間。**規則**：若 fine-tune 範圍 < 50 LOC + 純數值/樣式調整 + 既有 test 不打到 → parent inline；若範圍 > 50 LOC 或涉及 logic / 新 helper / test 變動 → 才再 launch agent。

## Related skills

- `overnight-parallel-agents` (user-level) — 多任務真並行
- `phase-precheck` (project) — ADR / ledger / memory 衝突先 precheck
- `ship-slice` (project) — 完整 slice ship，不適合單點 polish
- `feature-decision-sweep` (project) — 決策落地後 sweep PRD / memory / ADR
- `mirror-template-from-session` (project) — 用戶報 template editor 跟 session 不一致時的 5-step UI consistency SOP
