# Branch triage — pre-archive (2026-07-07)

> **Read-only triage.** Produced by overnight agent H (wave-3) against `main @ 2574061`
> (= `origin/main` tip). Method per `.claude/skills/merge-backlog-triage`:
> `git cherry main <ref>` for **patch-id survival** (`+` = unique unlanded commit;
> `-` = equivalent already in main) and `git merge-tree --write-tree --name-only main <ref>`
> for **conflict prediction** (exit 0 = CLEAN, nonzero = CONFLICT). **No branch was
> merged, rebased, cherry-picked, or deleted.** This doc gives can/can't + a
> recommendation only; the user executes.
>
> Companion: [`submission-readiness-2026-07-07.md`](./submission-readiness-2026-07-07.md)
> (packaging punch-list), [`first-archive-runbook-2026-07-07.md`](./first-archive-runbook-2026-07-07.md)
> (the archive step-by-step).

---

## TL;DR — pre-archive landing set

**Nothing needs to merge before the first archive.** The archive proves the
signing/packaging path and depends only on the native project files already on
`main` — none of the off-main branches touch `.pbxproj`, `Info.plist`,
entitlements, or AppIcon.

**Recommended pre-archive landing set (optional, low-risk):**

| Branch | Why land it now | Cost |
|---|---|---|
| `feat/exercise-kneeling-cable-pulldown` | Clean **FF** onto main tip, adds v030 exercise + migration. JS/DB/i18n/docs only, **zero native**. Gets one more built-in exercise into v1. | `git merge --ff-only` — trivial. Equally fine to defer to 1.0.1. |
| The 6 `overnight/*-2026-07-07` **doc** branches (see table) | All FF-able, all touch **only `docs/`** (no code), each writes a distinct filename → they don't conflict with each other. Landing them snapshots the submission paperwork onto main before archive. | Batch FF; run no gate (docs skip the pre-commit hook). |

**Everything else is post-archive or deletable.** The real code branches (HK
device-gated fixes, JS-UI conflicts on the god-files, unlanded dropset spikes)
are **not submission gates** — they're feature/bugfix backlog that lands on the
normal device-merge cadence *after* v1 is in TestFlight. A large cohort is
already fully in main by patch-id and is pure **delete**.

> ⚠️ **Do not block the archive on any branch.** The single highest-risk unknown
> (first-ever Release archive proving the iCloud signing path) is independent of
> all of these.

---

## Full triage table

Legend — **Rel to main**: CLEAN = `merge-tree` no conflict / CONFLICT = predicted conflict (files listed) / FF = main is an ancestor, fast-forwardable. **Survive** = `git cherry` unique-`+` count (patch-id). **Class**: DOC / JS-UI / native-device-gated / spike / landed. **Action**: `land-pre-archive` / `post-archive` / `device-gated` / `delete` / `in-flight`.

| # | Branch (ref) | Rel to main | Survive (patch-id) | Class | Action | Reason |
|---|---|---|---|---|---|---|
| 1 | `feat/exercise-kneeling-cable-pulldown` | **FF / CLEAN** | 2 (`9e19916` v030 exercise, `a816f59` skill doc) | JS/DB/i18n/docs | **land-pre-archive (optional)** | Clean FF onto main tip; adds `v030_kneeling_cable_pulldown` (main is at v029, no collision). Zero native. Content, **not a gate** — merge for v1 or fold into 1.0.1. |
| 2 | `overnight/asc-metadata-2026-07-07` | **FF / CLEAN** | 3 (metadata pack, screenshot shotlist, privacy-policy draft) | DOC | **land-pre-archive** | Docs only (`docs/testflight/{app-store-metadata,privacy-policy-draft,screenshot-shotlist}-2026-07-07.md`). Distinct filenames → no cross-conflict. |
| 3 | `overnight/privacy-compliance-2026-07-07` | **FF / CLEAN** | 2 (privacy-manifest audit, App-Privacy answer sheet) | DOC | **land-pre-archive** | Docs only (`docs/testflight/{privacy-manifest-audit,app-privacy-answers}-2026-07-07.md`). |
| 4 | `overnight/submission-readiness-2026-07-07` | **FF / CLEAN** | 1 (`75daa2c` punch-list refresh) | DOC | **land-pre-archive** | The wave-1 packaging punch-list; single file `submission-readiness-2026-07-07.md`. |
| 5 | `overnight/doc-verify-2026-07-07` | **FF / CLEAN** | 1 (`63beb8c` adversarial fact-check) | DOC | **land-pre-archive** | Single file `doc-verify-corrections-2026-07-07.md`. |
| 6 | `overnight/watch-hk-plist-2026-07-07` | **FF / CLEAN** | 1 (`ed2950a` "false alarm" finding) | DOC | **land-pre-archive** | Single file `docs/overnight/2026-07-07-watch-hk-plist-findings.md`. Concludes the Watch HK usage-string is a non-blocker (matches punch-list item 21). |
| 7 | `overnight/launch-bughunt-2026-07-07` (LOCAL) | at main tip | 0 | in-flight | **in-flight (wave-3 sibling)** | Local-only, points exactly at `main @ 2574061`, not yet pushed → sibling agent still running. Re-triage after it commits/pushes. |
| 8 | `overnight/launch-tests-2026-07-07` (LOCAL) | at main tip | 0 | in-flight | **in-flight (wave-3 sibling)** | Same as above. |
| 9 | `overnight/orange-findings-2026-07-07` (LOCAL) | at main tip | 0 | in-flight | **in-flight (wave-3 sibling)** | Same as above. |
| 10 | `slice/grill-8-bugfixes-2026-06-05` | CONFLICT (`sessionRepository.ts`, `healthkitSessionSync.ts`, `healthkitSessionSync.test.ts`) | 2 (`a9e56b4` kcal→Watch source, `ec11674` re-sync HKWorkout after time edit) | native-device-gated (HK) | **device-gated (task #292)** | Two real HK fixes needing a device to verify. Known 3-file conflict vs main (matches CLAUDE-memory task #292). Not a submission gate — post-archive on the device-merge track. |
| 11 | `refactor/use-watch-sync` | CONFLICT (`app/(tabs)/index.tsx`) | 1 (`8ff1304` lift WC listener → `useWatchSync` hook) | JS-UI (god-file) | **post-archive** | Pure refactor (report-09 #2). Conflicts on the ~4.6k-line `index.tsx` god-file → needs careful rebase + tsc/jest. No user-facing behavior change; low priority, defer. |
| 12 | `fix/set-drag-gesture-highlight` | CONFLICT (`app/(tabs)/index.tsx`) | 1 (`370bff8` drag-active set highlight) | JS-UI (god-file) | **post-archive** | Small UI polish, conflicts on `index.tsx`. Not a gate. |
| 13 | `fix/conversion-fidelity` | CONFLICT (`app/(tabs)/settings.tsx`, `programs.tsx`, `sessionFromTemplate.ts` auto-merge) | 1 (`88e4926` KAV bodyweight sheet) | JS-UI | **post-archive** | **Superset** of #14 on the KAV fix (its `88e4926` is patch-equal to #14's `20ba88c`), plus display_rank conversion-fidelity work + tests. Prefer this over #14 if landing the KAV fix. Conflicts on `settings.tsx`. |
| 14 | `fix/keyboard-occlusion-sweep` | CONFLICT (`app/(tabs)/settings.tsx`) | 1 (`20ba88c` KAV bodyweight sheet) | JS-UI | **post-archive → likely delete (subset)** | Its only surviving commit is **patch-equal** to #13's KAV commit (`git cherry conversion-fidelity keyboard-occlusion` marks it `-`). #13 ⊇ #14 on that fix → land #13 instead, drop #14. |
| 15 | `overnight/a1-noshift-spike-2026-06-28` | CONFLICT (`SessionInteractionState.swift`, `reverse-sync-apply-surfaces` SKILL, `reverseDropsetWireStability.test.ts`) | 3 (`ada8ea6` precondition-A test, `da5ad5b` A1 no-shift spike, `8b83d54` spike test) | spike (native+test) | **post-archive / review-then-delete** | Reverse-sync dropset **spike**. Reverse-sync Phase C landed in main via a different implementation → premise likely expired. Conflicts on Watch Swift. Review whether `ada8ea6` precondition test is worth salvaging; otherwise delete. |
| 16 | `overnight/ts-dropset-roundtrip-2026-06-28` | CONFLICT (`SessionInteractionState.swift`, `reverse-sync-apply-surfaces` SKILL) | 1 (`ada8ea6` — same precondition-A test as #15) | spike (test) | **post-archive / review-then-delete** | Only surviving commit is the shared `ada8ea6` (also in #15). Subset of the #15 spike cluster. |
| 17 | `overnight/watch-rank-fix-2026-06-28` | CONFLICT (`SessionInteractionState.swift`, `reverse-sync-apply-surfaces` SKILL) | **0** | landed | **delete** | Patch-id says all 4 raw-ahead commits are equivalent-in-main (`-`). Fully landed; conflict is only stale-ancestry noise. Safe delete after user confirm. |
| 18 | `slice/13d-reverse-sync-phase-b` | CONFLICT (`iphoneLiveMirrorProducer.ts`, its test, `watchLiveMirrorReceiver.test.ts`) | **0** | landed | **delete** | Both raw-ahead commits patch-equal-in-main. Phase B reverse-sync landed. Delete. |
| 19 | `slice/13d-reverse-dropset-idmatch` | CONFLICT (`achievementRepository.ts`, `SessionInteractionState.swift`, 2 SKILLs) | 1 (`ec971b3` count only ✓-tapped in `totalSessionCount`) | JS (achievements) | **post-archive** | The `is_logged` achievements fix. **Likely already superseded** by the `countLoggedSessions` `is_logged=1` fix that landed in main (see #20 which is the same class, now `-`) — verify by grep before salvage; if `totalSessionCount` already filters `is_logged=1` on main, delete. Otherwise a small post-archive fix. |
| 20 | `overnight/is-logged-sweep-2026-06-28` | CLEAN | **0** (`6034c72` marked `-`) | landed | **delete** | `countLoggedSessions filters is_logged=1` is already in main by patch-id. Delete. |
| 21 | `integration/dropset-cast-smoke-2026-06-28` | CLEAN | **0** (186 behind, 0 ahead) | landed | **delete** | Pure old integration snapshot, entirely subsumed by main. Delete. |
| 22 | `slice/page-help-overlay` | CLEAN | **0** (`e8941b8` marked `-`) | landed | **delete** | Page-help / coach-mark system shipped to main (`058efb5` per memory). Delete. |
| 23 | `fix/template-set-note-carryover` | CLEAN | **0** | landed | **delete** | Fully in main by patch-id. Delete. |
| 24 | `origin` (stray **local** branch) | — | **0** (== `main @ 2574061`) | artifact | **delete (local)** | A local branch literally named `origin` that just points at main. Harmless leftover; `git branch -D origin` locally (it is not a remote — do not touch `refs/remotes/origin`). |

---

## Grouped verdict

### Land before archive (optional, all FF-able, zero risk)
- **Content:** `feat/exercise-kneeling-cable-pulldown` (#1) — `git merge --ff-only`.
- **Paperwork (docs-only, FF):** #2 `asc-metadata`, #3 `privacy-compliance`, #4 `submission-readiness`, #5 `doc-verify`, #6 `watch-hk-plist`. Each is a distinct file → batch-mergeable in any order.

> None of these is a hard gate. The value is (a) one more exercise in v1 and
> (b) the submission docs living on `main` instead of scattered across worktrees.

### In-flight — re-triage in the morning
- #7 `launch-bughunt`, #8 `launch-tests`, #9 `orange-findings` — local-only, still at main tip. Wave-3 siblings not yet pushed. Do NOT delete; re-run `git cherry` once they commit.

### Post-archive — real backlog, device or god-file merge cadence
- **Device-gated (HK):** #10 `grill-8-bugfixes` (task #292, 3-file conflict).
- **JS-UI on god-files (careful rebase + gate):** #11 `use-watch-sync`, #12 `set-drag-gesture-highlight`, #13 `conversion-fidelity`.
- **Achievements:** #19 `reverse-dropset-idmatch` (verify not already superseded).

### Delete after user confirm — fully landed or expired
- **Landed (patch-id `-`, unique=0):** #17 `watch-rank-fix`, #18 `reverse-sync-phase-b`, #20 `is-logged-sweep`, #21 `dropset-cast-smoke`, #22 `page-help-overlay`, #23 `template-set-note-carryover`.
- **Subset/superseded:** #14 `keyboard-occlusion-sweep` (⊂ #13), #16 `ts-dropset-roundtrip` (⊂ #15).
- **Expired spike (review `ada8ea6` first):** #15 `a1-noshift-spike`.
- **Local artifact:** #24 `origin`.

> Per `merge-backlog-triage` §Stale-branch deep-clean: **unique>0 ≠ salvageable** —
> confirm semantic supersession (grep main's current code) before treating a
> `+`-surviving branch as a real backlog item; and **never execute deletions in a
> read-only pass** — this doc lists candidates; the user runs the delete loop.

### DO-NOT-TOUCH
- `main`, `origin/main`.
- Any `refs/remotes/origin/*` (this pass is local-read-only; deleting remote branches is a separate, user-confirmed `git push origin --delete` loop).
- The 3 in-flight wave-3 local branches (#7–#9).

---

## Suggested deletion script (⚠️ DO NOT RUN in this pass — user confirms first)

```bash
# LANDED / SUPERSEDED remotes — verify each with `git cherry main origin/<b>` first
for b in \
  overnight/watch-rank-fix-2026-06-28 \
  slice/13d-reverse-sync-phase-b \
  overnight/is-logged-sweep-2026-06-28 \
  integration/dropset-cast-smoke-2026-06-28 \
  slice/page-help-overlay \
  fix/template-set-note-carryover \
  fix/keyboard-occlusion-sweep \
  overnight/ts-dropset-roundtrip-2026-06-28 \
; do git push origin --delete "$b"; done

# Local artifact
git branch -D origin      # the stray local branch, NOT the remote

# a1-noshift-spike: review ada8ea6 (precondition-A test) BEFORE deleting.
# grill-8-bugfixes / conversion-fidelity / use-watch-sync / set-drag /
# reverse-dropset-idmatch: KEEP — post-archive backlog.
```
