---
name: merge-backlog-triage
description: Re-verify a stale multi-branch merge-backlog against an advanced main, produce a can/can't (CLEAN/CONFLICT) table WITHOUT mutating any branch, then drain the no-device track. Trigger — "對齊 merge runbook", "哪些分支還能合 / 還剩什麼", "refresh merge backlog", "merge backlog 過時了", "清掉 no-device 分支", "device-merge marathon prep", or any time `docs/testflight/merge-backlog-*.md` is stale because main advanced. Read-only triage uses `git cherry` (patch-id survival) + `git merge-tree --write-tree` (conflict prediction). Files — docs/testflight/merge-backlog-*.md, docs/testflight/submission-readiness-*.md.
---

# Merge-backlog triage + drain

TrainingLog accumulates many off-main branches (overnight agents, device-gated
slices, doc branches). main advances fast → any runbook is **stale within days**
and whole stacks silently land. This skill is the **method to regenerate the
runbook** (distinct from the runbook doc, which is the *output*). Serves the
「非小修先給可/不可統一表、別跳去打 patch」preference.

Companion skills: `picks-batch` (cherry-pick loop, bail-on-fail), `ship-stacked-branches`
(PR-per-branch chain), `ship-partial-pure-logic` (single pure commit). This skill
is the **triage + ff-merge drain** that precedes them.

## Phase 0 — grok the stale runbook + fetch truth

```bash
cd /Users/hao800922/code/TrainingLog
git fetch --prune origin
git rev-parse --short HEAD                          # current main
# Read the latest docs/testflight/merge-backlog-*.md — note its base SHA, then:
git log --oneline <runbook-base>..HEAD              # what landed since it was written
```

The `<base>..HEAD` log is the highest-signal step: scan it for commit subjects
that match backlog branch work → **those branches already landed**. (2026-06-06:
the entire D1/D2/D3/D4 + O3 perf stack had landed; the runbook still listed them.)

## Phase 1 — per-branch triage (READ-ONLY, never checks out / rebases)

Two git primitives do all the work:

- **`git cherry main origin/<b>`** — surviving unique commits by **patch-id**.
  `+` = not in main (will replay on rebase); `-` = equivalent already in main
  (drops via patch-id dedup on rebase). `unique=0` → branch fully landed, delete it.
- **`git merge-tree --write-tree --name-only main origin/<b>`** — 3-way merge in
  memory. **exit 0 = CLEAN; nonzero = CONFLICT** (line 1 is a tree OID, the rest
  are conflicted paths + `CONFLICT (...)` lines). **Mutates nothing.**

```bash
# Survival + raw-ahead per branch. NOTE: use `while read`, NOT `for b in $VAR`
# — a multi-line var unquoted does NOT word-split reliably here (hit 2026-06-06).
while IFS= read -r b; do
  [ -z "$b" ] && continue
  git rev-parse --verify -q "origin/$b" >/dev/null 2>&1 || { printf '%-44s ❌ gone\n' "$b"; continue; }
  uniq=$(git cherry main "origin/$b" | grep -c '^+')
  printf '%-44s unique=%s raw=%s\n' "$b" "$uniq" "$(git rev-list --count main..origin/$b)"
  [ "$uniq" -gt 0 ] && git cherry -v main "origin/$b" | grep '^+' | sed 's/^/   /'
done <<'EOF'
<branch>
<branch>
EOF

# Conflict prediction per branch (same while-read shape):
out=$(git merge-tree --write-tree --name-only main "origin/$b"); rc=$?
[ $rc -eq 0 ] && echo "✅ CLEAN $b" || { echo "⚠️ CONFLICT $b"; printf '%s\n' "$out" | tail -n +2; }
```

### Gotchas that change the verdict
- **`merge-tree` CLEAN ≠ `--ff-only`-able.** Once main passed a branch's base, ff
  is impossible regardless — you still `git rebase main` (or true-merge). CLEAN
  only means the 3-way *content* merge has no conflict. **Always run `tsc --noEmit`
  + full `npm test` on the REBASED tip** — merge-tree doesn't catch TS1117 dup
  keys, dup `it()` names, or semantic breakage.
  - ⚠️ **`--no-ff` merge commits do NOT trigger the pre-commit `tsc`+`jest` hook**
    (the hook fires on `git commit`, not on the auto-created merge commit) → you
    MUST run the gate manually after the merge, before push. (2026-06-24: both the
    media-slice merge `3c60a13` and the slice16 re-integration needed a manual
    `tsc --noEmit && npm test` — the hook stayed silent.)
- **A 3-way merge that adds NEW files makes the editor/harness LSP emit PHANTOM
  errors** — `Cannot find module '@/…'` / `'…' has no exported member 'X'` for the
  just-merged files (and even for files on the OTHER branch after a `git switch`),
  because the language server indexed the pre-merge tree and hasn't re-indexed.
  **`npx tsc --noEmit` is ground truth, NOT the inline diagnostics.** (2026-06-24:
  post-merge `useLocale`/`exerciseMediaMap`/`app-mode` "cannot find" diagnostics
  were all stale — tsc was clean. Don't "fix" phantom imports; just run tsc.)
- **local tip ≠ remote tip.** A mid-slice WIP branch can be ahead of its own
  remote by N un-pushable commits (2026-06-06 `slice/template-overwrite`: local
  `3986f3b` +47 vs remote `af444de` = clean 4). **Merge the REMOTE ref; never
  push/force-push the local WIP.** Check: `git rev-list --count origin/<b>..<b>`.
- **subset branches.** If branch X's only commit SHA == branch Y's first commit
  SHA, X ⊂ Y → DROP X, merge Y (2026-06-06 `slice/13d-sync-bc-plan` ⊂ `syncplan-refresh`).
- Stale `git branch -r --no-merged main` is noisy: cherry-picked-but-never-deleted
  branches show as un-merged by ancestry though their content is in main. Triage
  by `git cherry` (patch-id), not by `--no-merged`.

## Phase 2 — split into tracks + write the table

Classify each surviving branch:
- **Track A — no device (test-only / docs-only):** rebase + resolve + tsc/jest. I
  can drain these myself (push pre-authorized). Ask the user first (cross-cutting).
- **Track B — device-gated (JS-UI / native / archive):** the user smokes on device.
  Order: defuse contended files (e.g. `app/(tabs)/index.tsx`) earliest; cluster the
  `src/i18n/strings.ts` appenders consecutively (each rebase re-conflicts the append
  region → keep-both then `tsc` for TS1117); `appstore-watch-readiness` dead last
  (archive gate, bump build once). Fix P0 placeholder-content Watch bugs before archive.

Append a dated `## ✅✅ YYYY-MM-DD REFRESH` section to the runbook (this repo's
convention — corrections are appended, not rewritten; see the w5 + 2026-06-06
sections). Include: what-landed list, git-verified table (`# | branch | unique |
merge-tree | class | gate`), DROP list, DO-NOT-TOUCH list, two-track order,
conflict playbook. Commit `docs(testflight): ...` (pre-commit skips tsc/jest for
non-`.ts`), push (pre-authorized).

## Phase 3 — drain Track A (no-device), one branch at a time

Batch the verify: ff-merge all locally, ONE tsc+jest gate, ONE push.

**A "device-gated" branch that turns out to be JS/TS-only is drainable TODAY**
(validated 2026-06-11, `slice/template-overwrite` 17 commits): check
`git diff --name-only main...<b> | grep -c "^ios/"` — if 0, no Xcode rebuild is
needed; merge into LOCAL main (don't push), have the user **Reload JS** to smoke
the merged working tree against the original拍板 checklist, push only after
green. Honors a smoke-before-merge gate without a device build slot. Two
gotchas: (1) if the branch adds `patches/*.patch`, run **`npx patch-package`**
right after the merge or Metro serves the unpatched lib; (2) `git branch -d`
refuses post-merge-commit deletion ("not fully merged" vs the remote ref) even
though content IS in main — verify with the merge commit then `-D` + delete
remote.

```bash
git checkout -B <b> origin/<b>     # reset local to remote canonical
git rebase main                     # resolve per below
# tsc/jest deferred to the end-of-batch gate
git checkout main && git merge --ff-only <b>
# ...repeat for each Track A branch (main advances; next rebase lands on it)...
npx tsc --noEmit && npm test        # the ONE gate before push
git push origin main
# cleanup: git branch -D <b...> ; git push origin --delete <b...> ; drop subset branches
```

### Conflict-resolution patterns (all keep-both unless a superset exists)
- **append-region (strings.ts / ADR sections / test `describe` blocks):** keep BOTH
  sides; insert the missing closing braces if one side's block was truncated by the
  marker (2026-06-06 `templateConvertFromSession.test.ts`: my C2 `overwriteTemplateId`
  describe needed its `});` `});` restored before the branch's `dropset chain` describe).
  Markers gone → `git add` → `GIT_EDITOR=true git rebase --continue`.
- **add/add where main already has a SUPERSET:** `git rebase --skip` the redundant
  commit (don't union near-duplicate tests). Verify first that the skipped commit
  touches ONLY the dup file (`git show --stat <sha>`) so you don't drop other work
  (2026-06-06 `achievementRepositoryDefaults.test.ts`: main `9ecedf2` ⊇ branch `8bdf79f`).
- Sanity: `grep -c -E '^(<<<<<<<|=======|>>>>>>>)' <file>` must be 0 before continue.

## Stale-branch deep-clean（unique>0 ≠ 有救；2026-06-12 驗證、36 條一輪刪光）

The 2026-06-06 sweep deleted the unique=0 buckets and left "21 條 unique>0 需逐條審".
The deep-clean round proved three things:

- **`unique>0` branches can still be 100% deletable.** patch-id only catches *exact*
  equivalence; **semantic supersession** needs per-commit `git show --stat` + grep of
  main's CURRENT code (did a later rewrite/superset land the same behavior?). 2026-06-12:
  all 21 unique>0 branches → 17 landed-equivalent + 4 premise-expired, **zero salvage**.
  Default expectation for old overnight/agent branches: delete, not salvage.
- **ADR-protected branches**: before deleting, grep `docs/adr/` for the branch name. If
  an ADR says「不刪除、等 X 落地參考」, check whether X has landed (condition expired) —
  if so: `git tag archive/<b> origin/<b>` + push the tag, add an inline ADR amend
  （「保留條件已到期、可從 tag 回收」）, THEN delete. (13d-d0-spike-a/c case.)
- **Sweep beyond the runbook's list**: also run `git cherry` over EVERY
  `--no-merged` remote not in the runbook — found 15 bonus unique=0 leftovers. Output a
  copy-paste deletion script in the report but **never execute it in the same read-only
  pass** — user confirms, then a `for b in ...; do git push origin --delete "$b"; done`
  loop drains it in one shot.

## Validated
2026-06-06 — refreshed `merge-backlog-2026-06-04.md` vs main `876ee0e` (13 of the
runbook's ~11+ branches re-verified; whole D-stack found already-landed), then
drained Track A (4 branches: wc-reconcile-tests / nonwc-test-coverage / nonwc-coverage-r2
[1 commit skipped as redundant] / syncplan-refresh) → main `698b6d7`, jest 2463→2533,
zero leftover conflicts, 5 branches deleted.
2026-06-12 — overnight read-only triage (21 listed + 15 bonus) → morning confirm →
36 remote branches deleted + 2 archive tags; origin reduced to main + 6 Track-B.
