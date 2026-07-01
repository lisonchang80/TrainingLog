---
name: merge-stack-to-main
description: Integrate a pile of stacked LOCAL branches into main by direct merge (NO PRs) then push, under the "先合不推" hold. Trigger phrases include "整併 + push", "把堆疊分支合進 main", "整併這些分支", "先合不推後整併", "merge stacked branches locally". Verify topology with `git merge-base --is-ancestor`, dry-run with `git merge-tree`, FF the superset then `--no-ff` the divergent lines, run a MANUAL tsc+jest gate (merge commits skip the pre-commit hook), then safe-cleanup worktrees + branches. Companion to `ship-stacked-branches` (that one is PR-chain; this one is PR-less local merge).
---

# Merge stack → main (local integration, no PR)

When the user has accumulated several stacked LOCAL branches under the **先合不推「先合不推，讓我檢查」hold** and now says「整併 + push」/「要」(after you offered to integrate), this is the recipe. NO PRs — direct merge onto local `main`, then `git push origin main`.

Validated 2026-07-02 on TrainingLog: integrated `feat/history-subtab-help` + `fix/coach-scroll-step1` + `integration/overnight-help-0701b` + `session-count` test onto main (`058efb5`), jest 3359→3574, then cleaned 9 worktrees + 12 branches.

## When to use vs. NOT

- **USE**: branches are LOCAL (mostly unpushed), user's model is「先合不推」→ direct local merge + push, no review PRs. Trusted own work / overnight-agent output.
- **NOT** (use `ship-stacked-branches` instead): user wants per-slice PR review / per-slice rollback / one-PR-per-branch. That's a rebase + `gh pr create` chain, different recipe.
- **NOT** (use `overnight-parallel-agents` #13 cherry-pick recipe): when you only need a few commits off overnight branches, not a full multi-line merge.

## Step 0 — Topology recon (NEVER trust memory's "+N")

Memory hooks record branches as "+15 / +39" relative to their OWN base — those numbers are stale and misleading for planning a merge. Build the DEFINITIVE graph from git:

```bash
# ancestry matrix — 0 = A is ancestor of B (B already contains A); 1 = not
# zsh gotcha: `set -- $p` does NOT word-split; use ${p%% *} / ${p##* } instead.
for p in "main feat/X" "main integration/Y" "integration/Y fix/Z"; do
  a=${p%% *}; b=${p##* }
  git merge-base --is-ancestor "$a" "$b"; echo "$? (0=已含)  $a ⊆ $b"
done
git log --graph --oneline --decorate --topo-order -40 <branch...> | cat   # visual cross-check
```

Identify the **superset branch** — the one that already contains `main` + the most overnight/integration work (often a `fix/…` or `integration/…` tip). `main` FF-s to it for free.

## Step 1 — Predict conflicts BEFORE merging (`merge-tree`)

```bash
# real 3-way dry-run using the true merge-base; exit 0 = clean, 1 = conflicts (prints files)
git merge-tree --write-tree --name-only <branchA> <branchB>; echo "exit=$?"
```

Do this for EACH divergent merge you plan. Present a 可/不可 table to the user (per `feedback_verify-rootcause-table`): branch / content / relation to main / merge method / conflict prediction.

⚠️ **`merge-tree` only checks TEXTUAL conflicts, not semantics.** A test that enumerates modules (see Step 3 gotcha) can reference exports renamed/split on a divergent branch → zero textual conflict but a tsc/jest failure. Only the Step 3 gate catches that.

## Step 2 — Execute (FF superset → `--no-ff` divergent → cherry-pick strays)

```bash
git checkout main
git merge --ff-only <superset-branch>                 # zero-conflict, brings main+overnight+…
git merge --no-ff <divergent-feature-branch> -m "Merge …

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git merge --no-ff <other-divergent-line> -m "Merge …"
git cherry-pick <stray-test-commit>                   # for a 1-off test on a main+1 branch
```

## Step 3 — MANUAL gate (merge commits skip the pre-commit hook!)

**Merge commits do NOT trigger the `tsc + jest` pre-commit hook.** You MUST run it by hand on the unified tree:

```bash
npx tsc --noEmit          # then npm test
npm test                  # jest
```

**The content-invariants reconcile gotcha (canonical failure mode)**: a test file that ENUMERATES modules — e.g. `tests/help/content-invariants.test.ts` imports every `components/help/content/*` export into an `ALL_CONTENT` list — will `import { programsHelp } from …/programs` while a divergent feature branch renamed it to `programsViewHelp`/`programsEditHelp` and split `session-detail` into `-view`/`-edit`. `merge-tree` said clean (different files), but tsc errors `has no exported member` / `Cannot find module`. FIX the test to match the post-merge module structure (update imports + the enumeration list), keeping the invariant COMPLETE (cover the newly-split modules, don't just silence tsc). Commit the reconcile separately as `fix(test): … 對齊 merge 後模組結構` — this commit DOES touch `.ts` so the hook re-runs and re-validates.

## Step 4 — Push (only after gate green + user authorized)

The 先合不推 hold means push needs an explicit user「push」/「要」in response to a push-inclusive offer. Then:

```bash
git push origin main
git rev-list --left-right --count origin/main...main   # expect: 0  0
```

## Step 5 — Safe cleanup (worktrees + branches)

Offer this as a separate confirmed step. Recon BEFORE deleting:

```bash
# a) which local branches are now merged into main
git branch --merged main | grep -vE '^\*|^  main$'
# b) each to-remove worktree must be clean (dirty=0)
for wt in <paths>; do echo "$(git -C "$wt" status --porcelain | wc -l)  $wt"; done
# c) for branches NOT strict-merged but whose CONTENT is in main (redundant dup / cherry-picked):
#    git cherry shows '-' when the patch-id is already upstream → safe to -D
git cherry main <branch>          # all '-' = fully in main
```

Then remove worktrees FIRST (a worktree blocks `git branch -d`), then delete branches:

```bash
git worktree remove <path>              # errors if dirty — that's the guard working
git branch -d <strict-merged-branch>    # refuses if not merged (safety)
git branch -D <patch-equivalent-branch> # only after `git cherry` showed all '-'
git worktree prune -v
```

- Deleting LOCAL-only branches doesn't touch origin. Confirm none are on origin first (`git for-each-ref refs/remotes/origin/`) if unsure; if a branch IS on origin and you want it gone there too, that's a separate `git push origin --delete` the user must OK.
- **Leave out-of-scope / old branches alone** (100s-of-commits-behind stragglers) — separate triage, don't sweep them in.

## Anti-patterns

- ❌ Planning the merge order from memory's "+N" numbers → they're relative to each branch's own base, not main. Always `--is-ancestor`.
- ❌ Trusting a clean `merge-tree` as "safe to skip tests" → it's textual-only; module-enumeration tests fail semantically.
- ❌ Committing merges and assuming the pre-commit hook validated them → it didn't; merge commits bypass it. Run tsc+jest manually.
- ❌ `git branch -d` on a cherry-picked/redundant branch → refuses (not strict-merged); verify with `git cherry` then `-D`.
- ❌ Deleting a branch before removing its worktree → fails with "used by worktree"; remove worktree first.
- ❌ Force-pushing or pushing without the explicit user go under the 先合不推 hold.
