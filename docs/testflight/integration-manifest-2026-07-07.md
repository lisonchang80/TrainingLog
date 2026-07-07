# Overnight integration manifest — 2026-07-07 (wave-5)

**Integration branch**: `overnight/integration-2026-07-07`
**Base**: `main @ 2574061` (unchanged — this branch fast-forwards main)
**Gate**: `tsc --noEmit` clean · `npm test` = **314 suites / 3686 tests, all green**
**Status**: ready for a **one-command FF into main** (see bottom). No conflicts, no manual reconcile needed.

This branch pre-integrates tonight's ready, safe branches so the morning FF is trivial.
It does **not** touch `main` — it is a reviewable superset waiting for the user's FF.

---

## Included branches (11 branches, 10 non-empty → all merged)

Every branch was merged `--no-ff` so each line stays reviewable / revertable.
All file sets are **disjoint** — `git merge-tree` predicted zero textual conflicts for all 10,
and none occurred.

### Docs-only (zero code risk — merged first)

| Branch | Tip SHA | Adds |
|---|---|---|
| `overnight/submission-readiness-2026-07-07` | `75daa2c` | `docs/testflight/submission-readiness-2026-07-07.md` |
| `overnight/asc-metadata-2026-07-07` | `f786ba4` | app-store-metadata / privacy-policy-draft / screenshot-shotlist |
| `overnight/privacy-compliance-2026-07-07` | `65d1e5e` | app-privacy-answers / privacy-manifest-audit |
| `overnight/watch-hk-plist-2026-07-07` | `ed2950a` | `docs/overnight/2026-07-07-watch-hk-plist-findings.md` (HK plist "blocker" = false alarm) |
| `overnight/doc-verify-2026-07-07` | `63beb8c` | `docs/testflight/doc-verify-corrections-2026-07-07.md` |
| `overnight/branch-triage-2026-07-07` | `41227dd` | branch-triage / first-archive-runbook |
| `overnight/review-notes-2026-07-07` | `00ba30c` | `docs/testflight/app-review-notes-2026-07-07.md` |

### Code (gated — merged after docs, over the manual tsc+jest gate)

| Branch | Tip SHA | Content |
|---|---|---|
| `feat/exercise-kneeling-cable-pulldown` | `a816f59` | v030 migration adds built-in 跪姿滑輪下拉 (placeholder back pulldown); **updates its own test-count assertions 233→234 and user_version 29→30** in `migrateChain.test.ts` / `exerciseLibrary.test.ts` / etc. + `add-library-exercise` skill |
| `overnight/launch-tests-2026-07-07` | `5763fc2` | +2 test files: `migrateChainForeignKeyIntegrity.test.ts` (FK `foreign_key_check` end-to-end invariant) + `healthkitSessionSyncNoThrow.test.ts` (HK-sync no-throw matrix) |
| `overnight/orange-findings-2026-07-07` | `49dbe82` | 🟠-B fix: `src/services/startSessionGuard.ts` guards freestyle start against a pre-existing active session (+ wiring in `app/(tabs)/index.tsx`) + tests; 🟠-A demonstration test `orangeA_partialTruncation.test.ts` (**a failing-scenario demo, NOT a fix** — documents the partial-truncation data-loss path) |

### Interaction analysis (the one thing that could have gone wrong)

- `feat` raises max `user_version` to **30** and bumps the active built-in library to **234**.
- `feat` **already** updates every version/count assertion inside the files **it** owns
  (`migrateChain.test.ts` 29→30, library-count tests 233→234). Self-contained.
- `launch-tests`' new `migrateChainForeignKeyIntegrity.test.ts` is **version-agnostic**:
  it stamps `PRAGMA user_version = 18` and re-applies the tail migrations (v019…head),
  asserting only `foreign_key_check` returns empty — it hard-codes **no** target version.
  So v030 landing does not break it. Confirmed by grep: no `toBe(29|30)` / `LATEST` in that file.
- Result: the three code branches touch **disjoint files** and their assertions stay consistent
  after stacking. jest 3686 green proves it end-to-end.

### Extra cleanup commit (on integration branch, not from any source branch)

- `fe03b51` — removed the dead `const NONE_PROGRAM` (line 30 of
  `migrateChainForeignKeyIntegrity.test.ts`; wave-3-known unused, tsc didn't flag it).

---

## Excluded branches (deliberately NOT in this integration)

**0-commit read-only (nothing to merge)** — wave-5 read-only siblings that produced reports, not commits:

- `overnight/data-integrity-hunt` — 0 commits ahead of main
- `overnight/launch-bughunt` — 0 commits
- `overnight/i18n-en-complete` — 0 commits
- `overnight/perf-audit` — 0 commits (wave-5 sibling)

**Still running / held for a later wave:**

- `overnight/a11y-fixes` — wave-5 sibling, still in flight at integration time; **not included** this round.

---

## jest count: before → after

| | suites | tests |
|---|---|---|
| main @ 2574061 (per prior session) | — | ~3666 |
| integration `overnight/integration-2026-07-07` | 314 | **3686** |

Delta ≈ +20 (feat test additions net of assertion edits + launch-tests +2 files + orange +3 test files),
in line with the expected ~3685.

---

## Morning: one-command FF into main

The whole point of this branch. After a glance at the graph / this manifest:

```bash
cd /Users/hao800922/code/TrainingLog
git fetch origin
git checkout main
git merge --ff-only overnight/integration-2026-07-07
git push origin main
```

`--ff-only` is safe: it refuses (does nothing) if `main` moved past `2574061` overnight —
in that case fall back to `git merge --no-ff overnight/integration-2026-07-07` after re-running
`npx tsc --noEmit && npm test`.

### Cleanup after the FF (optional, once main is pushed)

```bash
cd /Users/hao800922/code/TrainingLog
# remove the integration worktree first (a worktree blocks branch -d)
git worktree remove /Users/hao800922/code/TrainingLog-worktrees/overnight-integration
git branch -d overnight/integration-2026-07-07
# the 10 source branches are now fully contained in main → safe to delete
for b in \
  overnight/submission-readiness-2026-07-07 overnight/asc-metadata-2026-07-07 \
  overnight/privacy-compliance-2026-07-07 overnight/watch-hk-plist-2026-07-07 \
  overnight/doc-verify-2026-07-07 overnight/branch-triage-2026-07-07 \
  overnight/review-notes-2026-07-07 feat/exercise-kneeling-cable-pulldown \
  overnight/launch-tests-2026-07-07 overnight/orange-findings-2026-07-07; do
  git branch -d "$b"
done
git worktree prune -v
```

Leave the excluded 0-commit / still-running wave-5 branches alone — separate triage.
