---
name: picks-batch
description: Cherry-pick N branches in sequence onto the current branch, with tsc + jest verification + push between each. Use when integrating multiple parallel agent branches (overnight-parallel-agents pattern) or stacked feature branches. Bails on first failure so you can triage before continuing.
---

# Picks Batch — N 個 branch 一次整合

Overnight parallel agents 完成後、常要 5+ 個 branch cherry-pick 進主 worktree、每次都手動敲 `git cherry-pick` → `tsc` → `npm test` → `git push`。這 skill 把流程自動化、**bail on first failure**。

## When to use

- Overnight parallel agents 完工、要把 N 個獨立 branch 合進當前 worktree
- Stacked feature branches 整合（A 改了 base、B 改了 A 之上、C 在 B 之上）
- 你已經單獨驗過每個 branch 各自綠（per agent self-report）、要做 final consolidation pass

## When NOT to use

- Branch 間有預期 conflict（要先解 conflict、不適合 batch）
- 還沒 review 過 branch 內容（先 read diff、再 batch）
- Branch 仍在跑（agent 還沒回報 commit + push）

## 流程

### Step 1 — 列出 branch tips + 順序

確認每個 branch 的 commit SHA + 預期順序。順序可能影響（如 strings.ts append、ADR 引用）。

```bash
git log --oneline anatomy/r4-vision-trace -1
git log --oneline i18n/tab-bar-catchup -1
git log --oneline anatomy/muscle-diagram -1
```

每筆記下 SHA。

### Step 2 — Pre-flight 驗主 worktree 乾淨

```bash
git status --short  # 必須無未 commit 改動
git rev-parse HEAD  # 記住 baseline、bail 時 reset 回來
```

### Step 3 — 跑 batch

對每個 branch：

```bash
git cherry-pick <SHA>
if [ $? -ne 0 ]; then
  echo "❌ cherry-pick failed at <SHA>, aborting"
  git cherry-pick --abort
  exit 1
fi

# Verify
npx tsc --noEmit
if [ $? -ne 0 ]; then
  echo "❌ tsc failed after picking <SHA>, reverting"
  git revert --no-edit HEAD
  exit 1
fi

npm test --silent
if [ $? -ne 0 ]; then
  echo "❌ tests failed after picking <SHA>, reverting"
  git revert --no-edit HEAD
  exit 1
fi

echo "✓ <SHA> integrated cleanly"
```

### Step 4 — Push 最終結果

全部綠才 push：

```bash
git push origin <current branch>
```

Push 失敗（remote 領先）→ `git pull --rebase` 再 push。衝突則停下回報、不要強推。

## 變體：A/B compare pattern

用 picks-batch 做 variant A/B 視覺比對：

```bash
# Pick A → verify → push → user reload simulator → screenshot
# If A NG: revert A → pick B → verify → push → user reload
# Decide → keep winner → clean up reverts via interactive rebase OR fresh branch from baseline
```

本 session anatomy A/B/C/D/E 走過 5 輪、每輪都是 revert → pick → tsc → test → push → user reload。picks-batch 把 revert+pick+verify 三步收成一個 idempotent loop、bail on red。

## Anti-pattern

- ❌ batch 內 commit 失敗仍盲目繼續 — 下一筆 cherry-pick 會基於 broken state、放大問題
- ❌ batch 完才 push 一次 — 中途斷掉沒 push 等於白做、push 應在每筆 verify 後即時
- ❌ 對應該手解 conflict 的 branch 跑 batch — batch 是 happy-path 工具、conflict 該人介入

## 與 overnight-parallel-agents skill 的關係

`overnight-parallel-agents` 規範**寫 agent prompt 的 file-level allow-list / DO NOT TOUCH 紀律**、避免 agent 同檔對撞。

`picks-batch` 是它的下游 — agent 各自完成後、用 batch 拼回主 worktree。兩個一起用最佳。

## 歷史 baseline

本 session 跑了 4 round anatomy variants + 1 round i18n + 1 round muscle-diagram = 6 個 cherry-pick + 5 個 revert + 11 次 tsc/test/push pair。如果有 picks-batch skill 一開始、節省約 30 min 重複敲鍵時間。
