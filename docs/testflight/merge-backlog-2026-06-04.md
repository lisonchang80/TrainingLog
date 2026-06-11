# Consolidated Merge-Backlog Runbook (2026-06-04)

> One coherent end-to-end merge plan for **all unmerged branches** awaiting
> a device-smoke + merge session, generated on the docs-only branch
> `docs/merge-backlog-2026-06-04`, based on main **`ecef29e`**.
>
> **Supersedes / folds in** [`submission-readiness-2026-06-03.md`](./submission-readiness-2026-06-03.md)
> (the "device-marathon" runbook). Read that doc for the per-branch *change
> detail + golden-constraint derivation*; this doc is the **current truth** of
> what is still unmerged after main advanced `58bce04 → ecef29e`, plus the 4
> new overnight branches and 1 error-boundary branch produced since.
>
> Cross-links (do not duplicate): [`app-store-metadata-draft.md`](./app-store-metadata-draft.md),
> [`build-bump.md`](./build-bump.md), [`icon-spec.md`](./icon-spec.md),
> `submission-questionnaire.md` (arrives on `chore/appstore-watch-readiness`).

---

## 0. What changed since the 2026-06-03 runbook (read this first)

The 2026-06-03 runbook listed **8 mergeable** branches off main `58bce04`.
Since then **main advanced 25 commits to `ecef29e`**, and **2 of those 8
already landed and were deleted from remote**:

- ✅ `chore/skills-2026-06-03` — landed (commit `93bb416`, the
  `add-accessibility-props` SKILL.md). **Branch gone from origin.** Done.
- ✅ `overnight/coverage-fill-r2-2026-06-03` — landed (the 7 test commits
  `83c0a94`…`8973dae`; verified `7d6681c` and `83c0a94` are ancestors of
  `ecef29e`). **Branch gone from origin.** The non-r2 `overnight/coverage-fill-2026-06-03`
  is also gone — superseded as planned. Done.

Also landed in that 25-commit window: **template-overwrite `#3 ①`** (`df3ef7d`
"另存模板「覆蓋」" + repo `da338f3`) and a batch of template-editor / program-wizard
fixes. So the new `slice/template-overwrite` branch (below) holds only `#3 ②③④`.

**Net result: 6 device-marathon branches still pending, + 5 new branches
(one of which is not yet pushed) = up to 11 unmerged branches.**

---

## 1. Situation summary

Eleven branches are queued for a single device-smoke + merge session, all
forked off various points behind main `ecef29e`, all `tsc`-0 / jest-green
**at their own tip** but **all device-smoke-gated** (none merged). The merge
is dominated by **three contention files** — `src/i18n/strings.ts` (appended
by up to four branches), `app/(tabs)/index.tsx` (edited by template-overwrite
+ three device-marathon branches), and `components/template-editor/template-editor-view.tsx`
(edited by template-overwrite + i18n) — plus the **golden patch-id-dedup
constraint** governing the device-marathon stack. The plan below merges
**one branch at a time**, advancing main and re-basing the rest after each,
ordered to (a) preserve the device-marathon golden constraint and (b) drain
the low-risk independent overnight branches in a sequence that minimises the
three-file contention.

### All unmerged branches

| # | Branch | Class | What it does | Jest | Device-smoke surface | Merge risk |
|---|---|---|---|---|---|---|
| D1 | `refactor/bigfile-pure-extract` | device-gated | Pure-logic extraction (PR snapshot, set filters, session-detail items, localYmd, delete-warning) out of 3 big screens; 5 new domain modules + 5 test files | (base) | History list + Session-detail read mode + Exercise-history; Today regression | **Low.** Clean ff off `58bce04`; behavior-preserving. **MERGE FIRST** (golden constraint). |
| D2 | `overnight/crash-hardening-2026-06-02` | device-gated | 4 unique crash/unmount fixes (cancel refresh on blur; guard drag `get()`; reduce-min/max in TrendChart; hoist `!id` guard) **on top of** the 5 D1 extracts | (base) | Exercise chart 0/1/N pts; nav-away mid-load; drag-reorder sets; bad `[id]` route | **Med.** Stacked: rebase after D1 drops 5 dup extracts (patch-id). Touches `index.tsx`. |
| D3 | `overnight/resolve-set-defaults-2026-06-02` | device-gated | `resolveSetDefaults.ts` + routes `onAddSet` defaults through it; stacks on D2's 4 fixes too | (base) | Add Set defaults from Today **and** Session-detail; dropset/cluster add | **Med.** Stacked on D1+D2; rebase drops 5+4 dup commits, leaves 3. Touches `index.tsx`. |
| D4 | `overnight/programs-formatter-2026-06-02` | device-gated | 1 commit: rewire `programs.tsx` formatter to shared `localYmd` | (base) | Programs tab dates / "edited at" (TZ boundary); create/activate flow | **Low.** Stacked on D1; rebase drops 5 extracts, leaves 1. Own file `programs.tsx` mostly isolated. |
| D5 | `chore/a11y-sheets-charts` | device-gated | a11y focus-trap + role/label on 6 sheets; label 5 charts to VoiceOver; **+14 keys to `strings.ts`** | (base) | VoiceOver ON: 6 sheets trap focus; 5 charts announce; both locales; non-VO regression | **Med.** Clean off `58bce04` but **`strings.ts` append-region** clashes with O-i18n / O-a11y-setrow / (O-eb). |
| D6 | `chore/appstore-watch-readiness` | device-gated (archive) | Watch AppIcon + iOS project version/category bump + ASC `submission-questionnaire.md` | (base) | **Archive gate**: Watch icon no-warning + on-wrist; `agvtool` version/category; Release archive dry-run | **High base hazard.** Merge-base `89fbbed` is **27 behind `ecef29e`** — **MUST `git rebase main`**; expect `project.pbxproj`/`Info.plist` conflicts. |
| O1 | `slice/template-overwrite` @ `af444de` | overnight-code | #3 「覆蓋」②③④: `overwriteTemplateBody` repo primitive; wizard-save ②; editor re-classify merge X→Y+delete X ③; clone overwrite ④ + parent wiring | 207/2323 | ④ clone / ② wizard-save / ③ editor re-classify — verify Y body replaced, X removed, Y identity (id/name/program/sub_tag) intact, history + program-cells resolve | **High contention.** Edits `index.tsx` (vs D2/D3) **and** `template-editor-view.tsx` (vs O2). |
| O2 | `chore/i18n-single-locale-leaks` @ `c23d198` | overnight-code | Fixes 16 single-locale i18n leaks across 8 files; **appends `strings.ts`** | 206/2317 | Toggle locale: Settings 體重 block / wizard alert / root nav titles / template-list empty+rows / stats footnote all switch | **Med.** `strings.ts` append clash; `template-editor-view.tsx` clash (vs O1). Do-not-touch deferred: 7 en-only in `app/session/[id].tsx`. |
| O3 | `perf/history-list-aggregate` @ `375210d` | overnight-code | History N+1 (1+3N → 3 aggregate reads) + **migration v026** (`session.started_at` index, head 25→26) | 207/2321 | History with many sessions: list renders identically + faster; pull-to-refresh; no missing/wrong rows | **Low.** Migration v026 is **unique + additive** (no other branch adds a migration). Isolated files. |
| O4 | `chore/a11y-setrow-keypad` @ `17fa6d1` | overnight-code | VoiceOver labels for shared set-row + numeric keypad; focus-trap keypad; **appends `strings.ts`** | 206/2317 | VoiceOver ON: set-row controls + keypad keys announce role+label; keypad traps focus | **Low–Med.** Only `strings.ts` is contended; the 2 component files are isolated. |
| O5 | `fix/app-error-boundary` | overnight-code | Top-level React ErrorBoundary: new `components/error-boundary.tsx`, wires `_layout.tsx` **or** `database-provider.tsx`, **appends `strings.ts`**, 1 test | n/a | Force a render throw → fallback + Retry recovers (hard to trigger; mostly code-review + a deliberate dev throw) | **N/A — NOT PUSHED** as of this writing. `strings.ts` + `_layout.tsx`/`database-provider.tsx` clash (vs O2) **if it lands**. |

> **⚠️ `fix/app-error-boundary` (O5) was NOT on origin** when this doc was
> written (`git ls-remote --heads origin fix/app-error-boundary` → empty).
> Re-check at merge time; if absent, **drop O5 from the plan** and its
> `strings.ts`/`_layout.tsx` rows below become moot.

---

## 2. Recommended end-to-end merge order

The order below is **one list**, not two. It honours the device-marathon
golden constraint verbatim, then drains the independent overnight branches in
a sequence chosen to defuse the three contention files **before** they pile up.

```
 1. refactor/bigfile-pure-extract        (D1, clean ff)   → smoke: History/Session-detail/Exercise-history read mode
 2. overnight/crash-hardening-2026-06-02  (D2, rebase)     → smoke: chart 0/1/N pts, nav-away mid-load, drag sets, bad [id]
 3. overnight/resolve-set-defaults-...    (D3, rebase)     → smoke: Add Set defaults from Today + Session-detail
 4. overnight/programs-formatter-...      (D4, rebase)     → smoke: Programs tab dates (TZ boundary)
 5. slice/template-overwrite              (O1, rebase)     → smoke: ④ clone / ② wizard / ③ re-classify (Y body swap, X gone, Y identity intact)
 6. perf/history-list-aggregate           (O3, rebase)     → smoke: History many-sessions render + pull-to-refresh; verify v026 head=26
 7. chore/a11y-setrow-keypad              (O4, rebase)     → smoke: VoiceOver set-row + keypad
 8. chore/a11y-sheets-charts              (D5, rebase)     → smoke: VoiceOver 6 sheets + 5 charts, both locales
 9. chore/i18n-single-locale-leaks        (O2, rebase)     → smoke: toggle locale across the 5 surfaces
10. fix/app-error-boundary               (O5, rebase)     → smoke: dev throw → fallback + Retry  [SKIP if not pushed]
11. chore/appstore-watch-readiness        (D6, REBASE+resolve) → archive gate: Watch icon, version/category, Release archive
```

### Rationale (why this order, not just "list")

1. **Steps 1–4 are the device-marathon stack, unchanged from the 06-03
   runbook — and the golden constraint is unchanged.** D1
   (`bigfile-pure-extract`) goes **first** so that when D2/D3/D4 are later
   `git rebase main`'d, git **drops the 5 duplicate extract commits** via
   `patch-id` dedup (verified content-identical in the prior runbook),
   shrinking the 9/12/6-commit rebases to 4/7/1 with near-zero conflict.
   D2 before D3 because **D3 stacks on D2's 4 crash fixes** (its
   `369ffc0..` log contains them); D4 is independent-of-D2 but also a
   D1-stacked single commit. Keep this quartet contiguous and in this order.

2. **`template-overwrite` (O1) goes at step 5 — right after the device-marathon
   stack drains `index.tsx`.** This is the central sequencing tension:
   O1 edits `app/(tabs)/index.tsx` (④ parent wiring) **and** D2/D3 edit the
   same file (crash guards + add-set defaults). Merging the device-marathon
   `index.tsx` churn **first** means O1's rebase faces a *stable, finalised*
   `index.tsx` — one rebase, one conflict resolution, instead of O1's edits
   being re-litigated on every subsequent device-marathon merge. O1 also owns
   `template-editor-view.tsx`, which only clashes with O2 (i18n) — handled by
   ordering O1 **before** O2 (step 9), so the i18n `t()`-wrap rebase lands on
   O1's already-merged logic.

3. **`history-list-aggregate` (O3) at step 6 is fully independent** (own
   repo/ListView/migrate files; migration **v026** is unique — no other
   branch adds a migration). Slot it early-ish so its **migration head 25→26**
   is locked in before later branches rebase; nothing else touches `migrate.ts`,
   so it never conflicts, but doing it before the late branches keeps the
   migration head monotonic and obvious during the session.

4. **The three `strings.ts` appenders are clustered at steps 7–9 (O4 → D5 → O2)**
   and merged **last among the code branches** so the append-region conflict is
   resolved **once**, against an otherwise-final `strings.ts`. Order within the
   cluster is least-contended first: O4 (keypad/set-row, 2 isolated component
   files + strings) → D5 (a11y sheets/charts, +14 keys, otherwise-isolated
   component files) → O2 (i18n, also touches `template-editor-view.tsx` +
   `_layout.tsx`/`database-provider.tsx`, so it benefits most from going last).
   Each rebase will conflict in the `strings.ts` **append region**; resolve
   "keep both", then **`npx tsc --noEmit`** to catch a TS1117 duplicate key
   (see §3). Verified: the three branches' appended keys are **disjoint**
   (`cannotContinue`/`secondsUnit`; `a11y…Dropset`/`a11yKeypadBackspace`;
   `a11yBarChart`/`a11yBodyTrendChart`/…), so "keep both" is safe — but tsc is
   still the gate.

5. **`error-boundary` (O5) at step 10, if it exists.** It appends `strings.ts`
   (so it belongs near the cluster) and edits one of `_layout.tsx` /
   `database-provider.tsx` (clashing only with O2). Putting it **after** O2
   means its small `_layout.tsx`/`database-provider.tsx` edit rebases onto
   O2's already-merged i18n wraps. If not pushed, skip entirely.

6. **`appstore-watch-readiness` (D6) stays dead last** — it's the **archive
   gate**, its mandatory rebase should run against a **nearly-final main**, and
   it's the only branch expected to need real conflict resolution
   (`project.pbxproj` / `Info.plist`). Bump the build number
   ([`build-bump.md`](./build-bump.md)) **once**, just before the final archive,
   after D6 lands the version/category changes.

---

## 3. Per-conflict-file resolution playbook

| File | Branches that touch it | Resolution |
|---|---|---|
| **`src/i18n/strings.ts`** | O4 (a11y-setrow), D5 (a11y-sheets-charts), O2 (i18n), **O5 (error-boundary, if pushed)** | All **append** to the same key-table region → append-region conflicts when ≥2 are merged. **Resolve "keep both" for every conflicting append**, then run **`npx tsc --noEmit`** — a TS1117 *"An object literal cannot have multiple properties with the same name"* means a duplicate key slipped in; **dedupe, keep the first**. Verified the four appenders' keys are currently disjoint, so keep-both is safe, but **tsc is the mandatory gate** because any future re-touch could collide. |
| **`components/template-editor/template-editor-view.tsx`** | O1 (template-overwrite ②③, logic at lines ~74–753), O2 (i18n, many small `t()`-wraps at lines ~112–2704) | Different regions (logic-add vs scattered `t()` wraps) → conflicts should be **small**. Merge **O1 before O2** (per §2): then O2's `git rebase main` re-applies the `t()` wraps onto O1's already-merged logic. Resolve by keeping O1's structural lines **and** O2's `t()` wraps; re-run `tsc` + jest. |
| **`app/(tabs)/index.tsx`** | O1 (template-overwrite ④ wiring), D2 (crash guards), D3 (add-set defaults). *(D1 also rewires it but lands first, ff.)* | **Highest-contention file.** Sequence is the defence: D2 → D3 land their `index.tsx` churn first (steps 2–3), then O1 (step 5) rebases onto the finalised file — **one** conflict resolution. When resolving O1's rebase here, keep the device-marathon guards/defaults **and** O1's ④ clone-overwrite parent wiring. |
| **`app/_layout.tsx`** / **`components/database-provider.tsx`** | O2 (i18n nav-title wraps in `_layout.tsx`; DB-init error wrap in `database-provider.tsx`), **O5 (error-boundary wraps one of these, if pushed)** | Small, different regions (i18n `t()` wraps vs ErrorBoundary mount). Merge **O2 before O5** (per §2); resolve keep-both. |
| **migration `v026`** (`src/db/schema/v026_session_started_at_index.ts` + `src/db/migrate.ts`) | **O3 only** | **No conflict** — unique + additive, no other branch adds a migration. Just confirm post-merge that the migrate head is **26** and `migrateChain.test.ts` is green (the branch updated it). |
| `project.pbxproj` / `Info.plist` | **D6 only** (but base is 27 behind) | The conflict is **base-staleness**, not co-edit: a plain merge looks like a multi-thousand-line deletion. **`git rebase main` is mandatory.** Resolve toward **main's current build/version baseline** + D6's category/icon additions. Then archive-check. |

---

## 4. Re-verify gate — every branch, after every prior merge

**Every branch is jest-green at its own tip off its own base — but that base
is now behind `ecef29e`, and each `--ff-only` merge advances main further.**
So before merging any branch N, after branch N−1 has advanced main:

```
git checkout <branch-N>
git rebase main          # stacked device-marathon branches: dup commits drop via patch-id
# ...resolve conflicts per §3...
npx tsc --noEmit         # catches TS1117 strings.ts dupes + any rebase breakage
npm test                 # full jest must be green on the REBASED tip, not the old tip
# build to device → run branch-N's device-smoke surface below → only then merge
git checkout main
git merge --ff-only <branch-N>
```

The pre-commit hook runs `tsc + jest` on `.ts/.tsx` commits, but **do not rely
on it for the rebase** — run `tsc`+`jest` manually on the rebased tip first.
If a rebase applies 0 commits for a stacked device-marathon branch, that is the
expected patch-id dedup.

### Device-smoke surface per branch (all gated — do not merge without)

- **D1 bigfile-pure-extract** — History list + Session-detail (read mode) clusters/ordered-items render identically, PR badges correct, hide-unchecked toggle filters, delete-warning count correct; Exercise-history PR list + date labels; Today regression.
- **D2 crash-hardening** — Exercise chart 0/1/many points (no crash, axes correct); background history/chart mid-refresh (no "setState on unmounted"); drag-reorder sets in-session; deep-link a bad `[id]` (graceful, no hook-order crash).
- **D3 resolve-set-defaults** — Add Set from **both** Today in-session and Session-detail editor; verify default weight/reps/kind prefill (last-set carryover, warmup vs working); dropset / cluster add-set.
- **D4 programs-formatter** — Programs tab cell dates / "edited at" in correct local `YYYY-MM-DD` (test a late-night TZ boundary); create/activate unaffected.
- **D5 a11y-sheets-charts** — VoiceOver ON: each of 6 sheets traps focus + speaks role/label; each of 5 charts announces a meaningful image label; both locales speak the right language; non-VO sheets open/close + charts draw normally.
- **D6 appstore-watch-readiness** — **archive gate**: Watch `AppIcon` set no warning badge + shows on-wrist; `agvtool what-version` / `what-marketing-version` + category match the intended release; Release **archive** dry-run.
- **O1 template-overwrite** — ④ clone overwrite / ② wizard-save / ③ editor re-classify: verify **Y body replaced**, **X removed**, **Y identity (id / name / program / sub_tag) intact**, and history + program-cells still resolve to Y.
- **O2 i18n-single-locale-leaks** — toggle locale; confirm Settings 體重 block, program-wizard alert, root nav titles, template-list empty + rows, and stats footnote **all switch language**. (Deferred / do-not-touch: 7 en-only strings in `app/session/[id].tsx`.)
- **O3 history-list-aggregate** — open History with many sessions: list renders **identically** + faster, pull-to-refresh works, **no missing/wrong rows**; confirm migration head = 26 on a fresh DB.
- **O4 a11y-setrow-keypad** — VoiceOver ON: set-row controls + keypad keys announce role + label; keypad **traps focus**.
- **O5 app-error-boundary** *(if pushed)* — force a render throw → fallback screen shows + **Retry recovers**. Hard to trigger; lean on code-review + a deliberate dev throw.

---

## 5. Discrepancies found vs the brief (git-verified)

1. **O5 `fix/app-error-boundary` is NOT pushed** as of doc-write time
   (`git ls-remote --heads origin fix/app-error-boundary` → empty). The brief
   anticipated this ("may or may not be pushed"). Treat O5 as **conditional**:
   re-check at merge time; if absent, skip steps relating to it.
2. **`chore/skills-2026-06-03` and `overnight/coverage-fill-r2-2026-06-03`
   from the 06-03 runbook are already merged + deleted from origin** — they
   landed in main's `58bce04 → ecef29e` advance (`93bb416` skills;
   `83c0a94`…`8973dae` the 7 coverage suites, both confirmed ancestors of
   `ecef29e`). The 06-03 runbook's "8 mergeable" is therefore **6** today.
   The non-r2 `overnight/coverage-fill-2026-06-03` is also gone (superseded as
   planned). This doc omits all three.
3. **Template-overwrite `#3 ①` already landed in main** (`df3ef7d` 另存模板
   「覆蓋」 + repo `da338f3`). The new `slice/template-overwrite` branch
   correctly holds only **②③④** (4 commits) — matches the brief.
4. The **6 device-marathon branches still exist on origin with unchanged
   merge-bases** (`refactor/bigfile-pure-extract` @ `58bce04`; the 3 stacked
   @ `369ffc0`; `chore/a11y-sheets-charts` @ `58bce04`;
   `chore/appstore-watch-readiness` @ `89fbbed`). Note **D6's base is now 27
   commits behind `ecef29e`** (was "25 behind `58bce04`" in the old runbook) —
   the rebase is even more mandatory.
5. **All 4 named new branches' file lists + commit counts + jest counts match
   the brief exactly** (verified via `git log --oneline main..origin/<b>` and
   `git diff --name-only main...origin/<b>`). `slice/template-overwrite` 4
   commits / 5 files; `chore/i18n-single-locale-leaks` 6 commits / 9 files;
   `perf/history-list-aggregate` 2 commits / 6 files incl. v026;
   `chore/a11y-setrow-keypad` 2 commits / 3 files. **No discrepancies.**
6. **D6 still touches exactly 5 files** (Watch icon PNG + Contents.json,
   `project.pbxproj`, `Info.plist`, `submission-questionnaire.md`) — matches
   the 06-03 runbook.

---

_Generated 2026-06-04 on `docs/merge-backlog-2026-06-04`, base main `ecef29e`._
_Branch facts git-verified in worktree `docs-merge-backlog`._

---

## ⚠️ 2026-06-04 w5 CORRECTION — this runbook above is STALE

> The plan above was authored against main **`ecef29e`**. Main has since advanced
> **19 commits** and the entire **D1 "bigfile-pure-extract" stack + the 4 D2
> crash-hardening fixes already landed in main**. That collapses the two big
> stacked overnight branches and changes the merge order. Source: overnight w5
> merge-dossier (`/tmp/overnight-reports-2026-06-04-w5/01-merge-dossier.md`).
> **Follow the order in THIS section, not the one above.** Main is now `7cc805c`
> (after the two test-only merges in this section landed).

### Already merged in this w5 pass (test-only, no device smoke, jest green 212/2415)
- ✅ `slice/13d-history-layout-fix` → `52121e7` (appends `sessionSetLayout` namespaced-id fold cases)
- ✅ `overnight/domain-tests-w5-2026-06-04` → `7cc805c` (asymmetric/guard edge branches, +13 cases)

### Branch shrinkage after rebase onto current main (git cherry verified)
- `overnight/programs-formatter-2026-06-02`: 6 commits → **only 1 survives** (`programs.tsx` localYmd rewire); rest are D1 extracts already in main.
- `overnight/resolve-set-defaults-2026-06-02`: 12 commits → **only 3 survive** (`resolveSetDefaults` module + 2 wire sites).
- `slice/13d-release-wc-fix-c`: 2 commits → **only 1 survives**; the core #287 Fix C (eager-mount WC listener) **already in main** → ⚠️ re-confirm this branch is still needed before merging.

### Branch cleanup
- 🗑️ **`slice/13d-sync-bc-plan` — DROP, do not merge.** Its single commit `b0e0335` is a strict subset of `overnight/syncplan-refresh-2026-06-01` (identical SHA = syncplan's first commit). Merge `syncplan-refresh` instead; merging both double-applies the ADR-0019 三車道 edit.

### Corrected merge order (11 remaining branches)
```
1. perf/history-list-aggregate       v026 migration, isolated → lock migration head 25→26 early
2. overnight/programs-formatter       only programs.tsx survives → drains index.tsx footprint cheap
3. overnight/resolve-set-defaults     3 surviving commits, index.tsx churn
4. slice/template-overwrite           lands on stabilised index.tsx, before i18n touches tev
5. chore/a11y-setrow-keypad           least-contended strings.ts appender → first
6. chore/a11y-sheets-charts           strings.ts appender
7. fix/app-error-boundary             strings.ts + _layout (before i18n/wc)
8. chore/i18n-single-locale-leaks     most-entangled strings appender → last; + tev + _layout
9. slice/13d-release-wc-fix-c         ⚠️ NATIVE/WC, device-gated; re-confirm still needed; onto final _layout
10. chore/appstore-watch-readiness    NATIVE archive gate, dead last; bump build once; includes Watch AppIcon (P1)
11. overnight/syncplan-refresh        docs-only; resolve ADR-0019 conflict keep-both (supersedes dropped sync-bc-plan)
```

### Conflict status: 11 CLEAN / 2 CONFLICT (both only `docs/adr/0019.md`)
Three contention clusters (each branch CLEAN vs current main, but merging one forces a rebase-resolve on the next in its cluster — order above lands each resolution once on a stabilised file):
- **Cluster A — `app/(tabs)/index.tsx`:** template-overwrite + resolve-set-defaults + programs-formatter
- **Cluster B — `src/i18n/strings.ts` (4-way):** i18n + a11y-setrow + a11y-sheets + error-boundary (keys git-verified disjoint → keep-both then `tsc --noEmit` for TS1117)
- **Cluster C — `app/_layout.tsx` (3-way):** i18n + error-boundary + release-wc-fix-c

### 🔴 2 NEW P0 Watch blockers (from w5 submission-delta, tasks #311/#312) — ✅ 已解除 2026-06-11

> ✅ **2026-06-12 修訂：兩條皆已 device-verified ship main** — #311 真實
> pull-on-tap（`ExerciseHistoryView` 接 `requestExerciseHistory` WC envelope）
> merge `6ed3d8f`；#312 FinishPage 接真 `HKLiveWorkoutBuilder` 數據 merge
> `cba8925`。placeholder-rejection 風險消除。以下保留為歷史紀錄。

- `ios/TrainingLog Watch Watch App/ExerciseHistoryView.swift:124-145` — renders `ExerciseHistoryMock.fetch()` fake data in live session (📊 dots-menu).
- `ios/TrainingLog Watch Watch App/FinishPageView.swift:246-256` — hardcoded `142 bpm` / `285 kcal` finish tiles (SessionSnapshot has no HR/kcal field).
Both are non-`#if DEBUG`, reachable in Release Watch UI → App Review placeholder-content rejection class. Device-gated Swift fixes; do before archive.

_w5 correction appended 2026-06-04, base main `7cc805c` (post test-only merges)._

---

## ✅✅ 2026-06-06 REFRESH — device-marathon stack DONE; re-verified vs main `876ee0e`

> The w5 order above is **stale**: main advanced `7cc805c → 876ee0e` and the
> **entire D1/D2/D3/D4 device-marathon stack + O3 perf landed**. Every fact
> below is git-verified (`git cherry` patch-id + `git merge-tree --write-tree`)
> against main **`876ee0e`** on 2026-06-06. **Follow THIS section.**

### Landed since w5 (now in main — branches deleted from origin)
- **D1** `refactor/bigfile-pure-extract`, **D2** `crash-hardening`, **D3** `resolve-set-defaults`
  (`2661960`/`06d52df`/`1fc6499`), **D4** `programs-formatter` (`7dddfe3`+`2f9adbe`)
  — all merged, all gone from origin. The whole stacked quartet + bigfile is **DONE**.
- **O3** `perf/history-list-aggregate` — `86dee26` N+1→3-reads + `a72d821` **v026** index.
  **Migration head is now 26.** Branch gone from origin.
- 3 WC-reconcile prod fixes: `47b8c6c` dup-ordinal fail-closed, `32996ca` cascade-delete
  dropset, `3c0df38` order-independent reconcile. Plus `189cf42` HK ended_at clamp,
  `c5711c4` 頂組 warmup/dropset exclusion.
- This session's 5 grill fixes (`2f28756` v022 brick-guard, `228db18` DST week,
  `e62513a` C1 dup-triple, `7265757` C2 dangling-link, `a8d899d` F4 lb units).

### Remaining unmerged — git-verified table (main `876ee0e`)

> ⚠️ **None is `--ff-only`-able** (all bases are behind main). Each needs
> `git rebase main` (or a true merge) first. `merge-tree` = 3-way **content**
> cleanliness only — **still run `tsc --noEmit` + `npm test` on the rebased tip**.

| # | Branch | Unique commits | merge-tree vs main | Class | Gate |
|---|---|---|---|---|---|
| 1 | ✅ `slice/template-overwrite` **(remote `af444de`)** — **2026-06-11 已 drain 進 main**（JS-only 免 rebuild、branch 已刪） | 4 (#3 ②③④) | ✅ CLEAN | JS | ~~device-smoke ④②③~~ ✅ done |
| 2 | `fix/set-drag-gesture-highlight` | 1 | ✅ CLEAN | UI | device-smoke drag highlight |
| 3 | `chore/a11y-setrow-keypad` | 2 | ✅ CLEAN | a11y | VoiceOver |
| 4 | `chore/a11y-sheets-charts` | 2 | ✅ CLEAN | a11y | VoiceOver |
| 5 | `fix/app-error-boundary` | 2 | ✅ CLEAN | JS | dev-throw |
| 6 | `chore/i18n-single-locale-leaks` | 6 | ✅ CLEAN | i18n | locale toggle |
| 7 | `overnight/wc-reconcile-tests-2026-06-05` | 1 | ✅ CLEAN | **test-only** | none (tsc/jest) |
| 8 | `overnight/nonwc-coverage-r2-2026-05-31` | 5 | ⚠️ CONFLICT `tests/db/achievementRepositoryDefaults.test.ts` (add/add) | **test-only** | none (tsc/jest) |
| 9 | `overnight/nonwc-test-coverage-2026-05-31` | 4 | ⚠️ CONFLICT `tests/repository/templateConvertFromSession.test.ts` (content — collides w/ this session's **C2** test) | **test-only** | none (tsc/jest) |
| 10 | `overnight/syncplan-refresh-2026-06-01` | 2 | ⚠️ CONFLICT `docs/adr/0019…md` (keep-both) | **docs-only** | none |
| 11 | `slice/13d-release-wc-fix-c` | 1 | ✅ CLEAN | NATIVE/WC | ⚠️ **re-confirm needed** (core #287 Fix C already in main; survivor = `442cc1e` native fallback + diagnostics) |
| 12 | `slice/grill-8-bugfixes-2026-06-05` **(LOCAL `ec11674`, NOT pushed)** | 2 HK | n/a | NATIVE/HK | device-smoke; push before merge |
| 13 | `chore/appstore-watch-readiness` | 2 | ✅ CLEAN (3-way auto; not ff-only) | NATIVE archive | **archive gate, dead last** |

### DROP
- 🗑️ **`slice/13d-sync-bc-plan`** — its only commit `b0e0335` is **byte-identical**
  to `overnight/syncplan-refresh-2026-06-01~1` (same SHA). Strict subset → delete,
  merge syncplan-refresh (#10) instead. `git branch -D slice/13d-sync-bc-plan && git push origin --delete slice/13d-sync-bc-plan`.

### DO NOT TOUCH

> ✅ **2026-06-12 修訂：本段已失效** — `slice/template-overwrite` 已於 2026-06-11
> drain 進 main（#3 ②③④ 全 ship、device-verified），local WIP 與 remote branch
> 皆已刪除，下述警告不再適用。保留為歷史紀錄。

- **`slice/template-overwrite` LOCAL tip `3986f3b`** is **47 commits ahead** of its
  remote — un-pushable mid-slice WIP. Merge the **REMOTE `af444de`** only
  (the clean 4 #3②③④). **Never push/force-push the local branch.**

### Recommended order — split into two tracks

**Track A — keyboard-only, NO device (can drain anytime):** the 3 test branches
+ 1 docs branch. Each merge advances main → rebase the next.
```
A1. overnight/wc-reconcile-tests-2026-06-05   (clean test-only)
A2. overnight/nonwc-test-coverage-2026-05-31  (resolve templateConvertFromSession.test.ts — keep both describe blocks)
A3. overnight/nonwc-coverage-r2-2026-05-31    (resolve achievementRepositoryDefaults add/add — keep both)
A4. overnight/syncplan-refresh-2026-06-01     (resolve docs/adr/0019 keep-both); then DROP sync-bc-plan
```
**Track B — device session (smoke each per its gate):**
```
B1. ✅ DONE 2026-06-11 — slice/template-overwrite drained 進 main (JS-only, branch 已刪)
B2. fix/set-drag-gesture-highlight             → drag-active set highlight clear in light+dark
B3. chore/a11y-setrow-keypad   ┐ strings.ts appenders — merge consecutively;
B4. chore/a11y-sheets-charts   │ each rebase re-conflicts strings.ts APPEND region →
B5. fix/app-error-boundary     │ "keep both" then `tsc --noEmit` (TS1117 = dup key, keep first).
B6. chore/i18n-single-locale-leaks ┘ i18n LAST (also touches _layout + template-editor-view).
B7. slice/13d-release-wc-fix-c    → ⚠️ FIRST re-confirm still needed; if yes, WC regression smoke
B8. slice/grill-8-bugfixes-2026-06-05 (push first) → HK kcal-attribution + re-sync-after-time-edit smoke
B9. chore/appstore-watch-readiness → archive gate; bump build once (build-bump.md); Watch AppIcon on-wrist
```

> **Before B9 archive: fix the 2 P0 Watch blockers (#311/#312)** — they're in
> main's Watch Swift now (`ExerciseHistoryView.swift` mock data, `FinishPageView.swift`
> hardcoded 142bpm/285kcal), reachable in Release → placeholder-rejection class.
>
> ✅ **2026-06-12 修訂：#311/#312 已解除**（#311 `6ed3d8f`、#312 `cba8925`，
> 皆 device-verified ship main 2026-06-11）— B9 archive 前置條件不再卡這兩條。

### Conflict playbook (only 3 conflicts now, all trivial)
| File | Branch | Resolution |
|---|---|---|
| `tests/repository/templateConvertFromSession.test.ts` | #9 | Keep both `describe`/`it` blocks (this session's C2 test + branch's dropset-chain cases); `tsc`+`jest`. |
| `tests/db/achievementRepositoryDefaults.test.ts` | #8 | add/add — keep both; dedupe any same-name `it()` if jest complains. |
| `docs/adr/0019-…md` | #10 | keep-both narrative (三車道 段 vs live-mirror fast-lane refresh). |
| `src/i18n/strings.ts` | #3/#4/#5/#6 (sequential) | Clean vs main individually, but the 4 appenders collide in the **append region** as each lands → keep-both then `tsc` (TS1117 → dedupe keep-first). |

_2026-06-06 refresh appended, base main `876ee0e`. Branch facts git-verified (`git cherry` + `git merge-tree --write-tree`) in the main worktree._

---

## ✅ 2026-06-06 — Track A DRAINED (main `cbfa953 → 698b6d7`, pushed)

All 4 keyboard-only branches rebased → resolved → `tsc`+`jest` green → ff-merged → pushed; branches deleted (local+remote); `slice/13d-sync-bc-plan` dropped.

- **A1** `wc-reconcile-tests` → `f4129e6` (clean).
- **A2** `nonwc-test-coverage` (templateDraft/templateOps/setRepository/convertSessionToTemplate) → resolved `templateConvertFromSession.test.ts` keep-both (my C2 `overwriteTemplateId` block + branch dropset-chain block).
- **A3** `nonwc-coverage-r2` (settings/exerciseLib/superset/sessionRepo edge coverage) → **skipped** the redundant `achievementRepositoryDefaults.test.ts` commit (main `9ecedf2` already a strict superset).
- **A4** `syncplan-refresh` (2 docs) → resolved `docs/adr/0019` keep-both (Live-mirror fast-lane § + 三車道 §, `---` separated).

Gate: **tsc 0 · jest 224 suites / 2533 tests** (was 2463, +70).
（2026-06-12 註：現行 main 基準已為 **2561** tests — 2026-06-11 #311/#312 + 模板編輯器重做批落地後。）

### Then `slice/13d-release-wc-fix-c` DROPPED (row 11 — not device-gated, obsolete)
Re-confirm verdict: its only surviving commit `442cc1e` was the **`release-wc-patches/`
staging kit** (README + diagnostic NSLog patch + `fixA-remove-hasObservers-gate.patch`)
— a "morning device-fallback IF Fix C fails" contingency for #287. But that premise
is moot: **both fixes already shipped to main** — Fix C `c651a04` (eager-mount, `app/_layout.tsx:87`)
AND Fix A `5778775` (`patches/react-native-watch-connectivity+2.0.0.patch` via patch-package).
#287 closed. The kit is superseded + version-brittle (rnwc@2.0.0 line-locked) → branch
deleted (worktree + local + remote, 2026-06-06). Diagnostic patch recoverable from
reflog if WC ever regresses.

**Remaining backlog = ~~8~~ 7 Track-B device-gated branches** (table rows 2–6 + 12–13;
row 11 dropped; row 1 `template-overwrite` ✅ 2026-06-11 drained — 見 2026-06-12 REFRESH).

---

## ✅ 2026-06-12 REFRESH — 殘枝 triage 完成（刪除待人工執行）；re-verified vs main `cba8925`

> 夜跑殘枝 triage（依 `merge-backlog-triage` skill、`git cherry` patch-id +
> 逐 commit 抽驗）對 **21 條指名 remote + 2 條 local + 15 條 unlisted remote**
> 完成全量盤點。完整報告 + 證據 + 刪除 script 在
> `/tmp/overnight-reports-2026-06-12/03-branch-triage.md`
> （持久副本 `~/code/TrainingLog-overnight-reports/2026-06-12/03-branch-triage.md`）。

### Triage 結論摘要

- **21/21 指名 remote 殘枝全數可刪**（17 DELETE-landed + 4 DELETE-obsolete）、
  **零 SALVAGE** — 每條 unique commit 皆驗出內容已在 main（byte-identical /
  超集 / 演化版）或前提已消失（檔案被刪、pattern 被否決、spike 結論已入 ADR）。
  無需 cherry-pick 計畫。
- **Bonus：15 條 unlisted remote 殘枝 `git cherry` 全為 unique=0**（patch-id
  全等已落地），一併列入刪除清單。
- **⚠️ 刪除 script 尚未執行 — 待日間人工確認後跑**（script 本體只在報告 03，
  本 runbook 刻意不收錄以免誤跑）。spike 枝（`slice/13d-d0-spike-a`/`-c`）
  刪前先打 archive tag（`archive/13d-d0-spike-a`、`archive/13d-d0-spike-c`）
  — ADR-0019 保留條件到期 amend 已補（見同日 ADR-0019 翻盤 ledger 附近 amend）。
- **`dryrun-strings`（local）**：非 i18n 實驗 — 是 3 條 Track-B 分支的
  dry-run merge 枝（2026-06-05）、零獨有內容 → **Track-B drain 完成後再刪**。
- **`slice/grill-8-bugfixes-2026-06-05`（local `ec11674`、NOT pushed）**：
  **KEEP** — 2 個 HK device-gated fix 等實機驗，維持上表 row 12 結論。

### 全部刪完後 remote 應只剩

`main` + 6 條 Track-B 勿碰枝（`chore/a11y-setrow-keypad`、`chore/a11y-sheets-charts`、
`chore/appstore-watch-readiness`、`chore/i18n-single-locale-leaks`、
`fix/app-error-boundary`、`fix/set-drag-gesture-highlight`）；
加 local `grill-8-bugfixes` = 7 條 Track-B device-gated backlog 不變。

_2026-06-12 refresh appended on `docs/runbook-drift-2026-06-12`, base main `cba8925`（jest 基準 2561）。_
