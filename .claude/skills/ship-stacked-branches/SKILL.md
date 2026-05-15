---
name: ship-stacked-branches
description: Sequentially rebase and ship a chain of stacked git branches via one PR per branch. Trigger phrases include "merge stacked branches", "stack 的 branches PR", "把 9.X chain 推進 main", "依 slice 拆 PR". Used and validated 2026-05-15 on TrainingLog (5 PRs: slices 9.6 → 9.8c shipped in one session).
---

# Ship stacked branches — per-slice PR chain

When user has 2+ stacked git branches that all need to land on `main`, and prefers **one PR per branch** (vs one mega PR), this is the recipe.

## When to use this

- ≥ 2 branches where each is built on top of the previous (`git log main..HEAD` shows incremental commits per branch)
- User wants per-slice review / per-slice rollback / per-slice clean git history
- TrainingLog's convention (matches slices 1–9.5 historic PR style — each slice = 1 merge commit on main)

## When NOT to use this

- 1 branch → just open a PR, no chaining needed
- User explicitly wants one mega-PR (option A) — different recipe, just `gh pr create` from the tip
- User wants squash-merge (then rebase is dangerous — squashed commits won't be recognized as "already applied" → manual cherry-pick territory)

## The chain reaction

For each branch in stacking order (oldest → newest):

```
┌─────────────────────────────────────────────────────────┐
│ 1. git fetch --prune origin                             │
│ 2. git checkout main && git pull --ff-only origin main  │
│ 3. cd <worktree-or-checkout-branch>                     │
│ 4. git rebase main                                      │
│    └─ expect: previously-applied-commits SKIPPED        │
│       (warning is normal; means cherry-pick detection   │
│        works; only this slice's NEW commits replay)     │
│ 5. git push --force-with-lease origin <branch>          │
│ 6. gh pr create --base main --head <branch> --title …   │
│ 7. ⏸  STOP. Wait for user merge confirmation.           │
│ 8. After user confirms merge → loop back to step 1.     │
└─────────────────────────────────────────────────────────┘
```

**Critical**: do NOT batch the chain — each rebase needs main's NEW HEAD (from previous merge) to find the right merge-base. Trying to pre-rebase all 5 against the OLD main causes conflict cascades.

## Conventions captured (TrainingLog specific)

- **Merge mode**: `gh pr merge <N> --merge` (preserves merge commit; matches slices 1–9.5 history). Squash + rebase modes break the cherry-pick-detection on subsequent stacked rebases.
- **Commit footer**: every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` — must be in the rebased commits, not added at PR-create time.
- **Issue linkage**: if a tracking issue exists (`gh issue list --search "<slice>"`), use `Closes #N` in PR body. If no tracking issue, write a one-line stack-rationale instead ("Stacks on #M — UI half of <feature>").
- **PR body**: keep tight — `## Summary` bullets + `## Schema changes` (if any v0XX migration) + `## Test plan` checklist. Match style of last 3 merged PRs (read with `gh pr view <last-N> --json title,body`).

## Validated gotchas (DO NOT skip)

1. **`--force-with-lease` not `--force`** — the rebased branch may have been touched by an overnight agent or another worktree. lease catches divergence.

2. **Rebase skips cherry-picks warning is GOOD** — `warning: skipped previously applied commit <hash>` means git correctly detected your predecessor's commits already in main. Don't `--reapply-cherry-picks` to "fix" it; that creates duplicates.

3. **Worktree state matters** — if the user has the branch checked out in a separate worktree (common when stacked branches were built that way), rebase in THAT worktree, not in the main repo's checkout. Otherwise force-push lease check will fail because the worktree's local ref is stale.

4. **expo-router typed-route lag** — for slices that add new file-routes (`app/X-Y/[id].tsx`), TS errors for `router.push(\`/X-Y/${id}\`)` will persist until next `npx expo start` regenerates `.expo/types/router.d.ts`. Don't add casts to silence them; the runtime works, just the IDE is behind.

5. **`gh pr create` from a worktree CWD fails** — `cd <repo-root> && gh pr create …` works; running `gh` from inside the worktree subdirectory hits `fatal: not a git repository` from the path-walk. Always `cd /<absolute/repo/root> &&` prefix.

6. **Final cleanup checklist** — after the LAST PR merges:
   - `git worktree remove --force <each-shipped-worktree>`
   - `git branch -d <each-shipped-branch>` (use `-D` only for unmerged audit branches like overnight read-only ones)
   - `git push origin --delete <each-remote-branch>` (5 remote slice branches expected after a 5-stack chain)
   - Retain worktrees / branches that are out of scope (e.g. `slice/10-watch-scaffold` waiting on visual references).

## Anti-patterns

- Rebasing all 5 branches against current main BEFORE the first one merges → cascading conflicts; the predecessors' commits aren't in main yet.
- Pushing all 5 PRs to GitHub at once → reviewer can't tell what depends on what; CI runs same commits 5x.
- Using `git push --force` (no lease) → loses overnight-agent commits if the branch was concurrently touched.
- Skipping the wait-for-merge step between PRs → assumes user will batch-merge in order, but they may want to spot-check / smoke-test each.
- Inlining the merge step yourself (`gh pr merge`) → that's the user's destructive-action call to make, not the agent's. Open the PR, hand them the CLI command, stop.

## Companion skills

- `ship-slice` for the actual code-shipping per branch (this skill is the cross-slice orchestration on top)
- `overnight-parallel-agents` (user-level) for the case where the BRANCHES themselves were built by autonomous agents and now need shipping
