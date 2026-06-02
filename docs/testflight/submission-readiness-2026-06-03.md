# Submission-Readiness Scorecard + Pending-Branch Merge Runbook (2026-06-03)

> Synthesis of the 2026-06-03 overnight read-only audits + a device-session
> merge/smoke runbook for the off-main branch queue. Generated on the
> docs-only branch `chore/submission-readiness-doc-2026-06-03`, based on
> main `58bce04`.
>
> **Cross-links (do not duplicate — read alongside):**
> - [`app-store-metadata-draft.md`](./app-store-metadata-draft.md) — ASC field drafts (name/subtitle/keywords/screenshots/review notes).
> - [`build-bump.md`](./build-bump.md) — `agvtool` build-number bump + pre-archive checklist (`ITMS-90478` avoidance).
> - [`icon-spec.md`](./icon-spec.md) — iOS AppIcon size table + `gen-ios-icons.sh` workflow.
> - `submission-questionnaire.md` — ASC submission-time answers, **arrives on `chore/appstore-watch-readiness`** (see Part 2); not yet on main.
>
> **Audit reports** (ephemeral, in `/tmp/overnight-reports-2026-06-03/`):
> `A-migration-schema-audit.md`, `B-coverage-fill.md`, `C-release-hygiene.md`,
> `D-empty-state-audit.md`, `F-i18n-inventory.md`. (`E-coverage-r2` — not produced
> this wave; see note below. No wave-3 `G-leak` / `H-typesafety` reports exist yet.)

---

## Part 1 — Submission-readiness scorecard

| Area | Verdict | Blockers | Source |
|---|---|---|---|
| Migration / schema data-safety (v001→v025) | 🟢 no blocker | 0 | A-migration |
| Release source hygiene (secrets / dev backdoors / logging) | 🟢 ship-ready | 0 | C-release-hygiene |
| First-run / empty-state / permission-denied / no-Watch | 🟢 no crash | 0 | D-empty-state |
| i18n single-locale leaks | 🟡 16 true leaks across 8 files (render-gated, cosmetic) | 0 | F-i18n (C §5 concurs) |
| Test coverage | 🟢 green — see counts below | — | B-coverage / coverage-fill-r2 branch |
| Coverage round 2 (E) | ⚪ not produced this wave | — | (superseded by `overnight/coverage-fill-r2-2026-06-03`, Part 2) |
| Memory leaks / unmount-safety (G) | ⚪ pending (no wave-3 report) | — | partially pre-empted by `crash-hardening` branch |
| Type-safety sweep (H) | ⚪ pending (no wave-3 report) | — | — |

### Per-area summary

**Migration / schema (A — 🟢).** The v001→v025 chain is monotonic, gap-free, one-to-one mapped in `src/db/migrate.ts`, and each migration + its `PRAGMA user_version` bump is wrapped in a single transaction — so a crash mid-migration rolls back and safely re-runs. **Zero data-destroying operations**: a full grep found no `DROP TABLE` / `DELETE FROM` / `RENAME TO` / table-rebuild; the only two `DROP COLUMN`s (v012 `template_exercise.notes`, v021 `template_exercise.rest_sec`) are guarded and target columns whose data was either migrated to a new home first (v010) or were confirmed orphans with zero readers. v025 `display_rank` backfills `= ordering` so legacy/iPhone-authored rows render byte-identically. `migrateChain.test.ts` (13 tests, incl. populated-DB re-migrate zero-loss + iCloud-restore up-migration) re-run green. Optional hardening only (unguarded early-chain DDL is inert under the transaction wrapper); **none blocks submission.**

**Release hygiene (C — 🟢).** No secrets, no API keys, no hardcoded endpoints, and **zero network-egress primitives** (`fetch`/XHR/axios/WebSocket/sendBeacon → 0 hits) — confirms the local-first / no-backend / no-analytics claim at the source level. No developer section, no spike runner, no simulate toggle, no DB-reset button reachable in Release (`settings.tsx` read in full). No `console.log` debug traces in render paths; the 33 remaining `console.*` are all catch-block `warn`/`error` on failure paths (error object only, no user/Health data) — Apple does not reject for these. One half-shipped TODO (`index.tsx:708`, assisted-exercise bodyweight gate) is a graceful no-op, not a crash. Optional pre-submit polish: `__DEV__`-gate the catch-block logs + the §5 i18n leaks.

**First-run / empty-state (D — 🟢).** No first-run crash. Every reachable screen/list/chart/aggregate has an explicit empty-state guard or null-seeded/length-checked computation — no unseeded `reduce`, no `Math.max(...[])`, no div-by-zero, no null-deref on missing session/template/header. Migrations seed 66 built-in exercises + 255 achievement defs + 1 reserved "無" program on a clean DB, so the library is never truly empty. HealthKit-denied and no-Watch-paired paths both degrade to `[]`/'—'/3-tile without throwing. Three findings are all 🟢 quality nits (stale `MonthGridView` `title=''`; a defensive `?? null`; one zh-only empty-template literal — the last overlaps F-i18n).

**i18n (F — 🟡, cosmetic).** **16 true single-locale leaks across 8 files** — render-gated strings that show one language to all users (Alerts, accessibilityLabels, nav titles, empty/loading placeholders). Worst offenders confirmed: `settings.tsx` 體重/body-weight block (6 zh-only literals), `program-wizard/new.tsx:235` `'Cannot continue'` (en-only), and 5 en-only `Stack.Screen` nav titles in **`app/_layout.tsx:121-137`** (the brief's `(tabs)/_layout.tsx` cite was wrong — that file is already 100% `t()`-clean). The ~9 inline `getLocale()`-ternary sites render correctly in both locales and are optional cleanups, not bugs. **None blocks submission** — they are polish, fixable with `t()` table additions (most reuse existing keys; the `chore/a11y-sheets-charts` branch already adds 14 a11y i18n keys, see Part 2). The `chore/appstore-watch-readiness` branch's ASC notes can declare zh-Hant primary + en-US secondary regardless.

**Test coverage (B / coverage-fill-r2).** B's TESTS-ONLY pass (`overnight/coverage-fill-2026-06-03`) added +2 suites / +7 tests over a 198-suite / 2271-test green baseline (final 200 / 2278), and documented that most "uncovered" lines are genuinely-unreachable defensive branches (nullish `?? 0` fallbacks better-sqlite3 never triggers, `never`-typed exhaustiveness defaults, dead error catches in impure bridge orchestrators). **That branch is SUPERSEDED** by `overnight/coverage-fill-r2-2026-06-03`, which includes B's two commits verbatim plus 5 more repo-guard / sessionRepo / setRepo / templateRepo / convertSessionToTemplate suites (7 files, +1086 lines). **Fold r2 only** (Part 2).

**E / G / H (⚪ pending).** No `E-coverage-r2` report file was produced in this wave — coverage round-2 work materialized as the `coverage-fill-r2` test branch instead. No wave-3 `G-leak` (memory/unmount) or `H-typesafety` audit reports exist yet; note that the `overnight/crash-hardening-2026-06-02` branch already pre-empts part of the leak surface (it cancels `refresh()` setState on blur/unmount mid-fetch — Part 2). Re-run those audits if a wave-3 pass is desired before submit.

### Bottom line — any 🔴 submission BLOCKERS?

**No.** Migration is data-safe, source hygiene is clean (no secrets / no egress / no dev backdoors), and there is no first-run / permission-denied / no-Watch crash. The only open items are 🟡 **render-gated cosmetic polish** (16 i18n single-locale leaks) and optional hygiene (`__DEV__`-gating catch-block logs) — all shippable as-is and improvable in a follow-up. The remaining gates are operational, not code: bump the build number ([`build-bump.md`](./build-bump.md)), ship final icon art ([`icon-spec.md`](./icon-spec.md)), and fill the ASC questionnaire (arriving on `chore/appstore-watch-readiness`).

---

## Part 2 — Pending-branch device-session merge runbook

**Live branch list verified in this worktree (2026-06-03, main = `58bce04`):**

| Branch | Class | merge-base | Own commits | ff-only-able now? |
|---|---|---|---|---|
| `refactor/bigfile-pure-extract` | device-gated | `58bce04` ✅ | 5 | ✅ yes (clean off main) |
| `overnight/crash-hardening-2026-06-02` | device-gated | `369ffc0` (in main) | 9 (5 dup-extract + 4 fixes) | ⚠️ replays extracts |
| `overnight/resolve-set-defaults-2026-06-02` | device-gated | `369ffc0` | 12 (5 dup + 4 + 3) | ⚠️ replays extracts |
| `overnight/programs-formatter-2026-06-02` | device-gated | `369ffc0` | 6 (5 dup + 1) | ⚠️ replays extracts |
| `chore/a11y-sheets-charts` | device-gated | `58bce04` ✅ | 2 | ✅ yes |
| `chore/appstore-watch-readiness` | device-gated | `89fbbed` (25 behind) | 2 | ❌ MUST rebase |
| `chore/skills-2026-06-03` | trivial (docs) | `58bce04` ✅ | 1 | ✅ yes |
| `overnight/coverage-fill-2026-06-03` | trivial (tests) | `58bce04` ✅ | 2 | — **SKIP (superseded)** |
| `overnight/coverage-fill-r2-2026-06-03` | trivial (tests) | `58bce04` ✅ | 7 | ✅ yes (includes the first's 2 commits) |

> **THE GOLDEN CONSTRAINT.** All eight mergeable branches are currently
> off main `58bce04`. **Merging ANY one advances main**, after which every
> *other* branch is no longer `git merge --ff-only`-able — each must be
> `git rebase main`'d onto the new tip first, then re-smoked, then merged.
> Do them ONE AT A TIME in the order below; never batch.

> **KEY STRUCTURAL FACT (drives the order).** The three "stacked"
> branches (crash-hardening, resolve-set-defaults, programs-formatter) each
> **replay the exact 5 pure-extract commits** that `refactor/bigfile-pure-extract`
> holds — verified content-identical (matching `git patch-id`s for all 5).
> So if **bigfile-pure-extract is merged FIRST**, then when each stacked
> branch is later `git rebase main`'d, git **drops the 5 duplicate extract
> commits automatically** (patch-id dedup) and leaves only that branch's
> unique work — turning a scary 9/12/6-commit rebase into a 4/7/1-commit
> one with near-zero conflict surface. **This is why bigfile goes first.**

### Branch-by-branch

#### 1. `refactor/bigfile-pure-extract` (device-gated, 5 commits, clean off `58bce04`)
- **Changes:** Pure-logic extraction from the three biggest screens. Pulls `computePRs` → `src/domain/pr/historyPrSnapshot.ts`, hide-unchecked filters → `src/domain/set/hideUncheckedFilter.ts`, read-mode cluster/ordered-item builders → `src/domain/set/sessionDetailItems.ts`, local `YYYY-MM-DD` formatter → `src/domain/date/localYmd.ts`, delete-warning suffix → `src/domain/session/deleteWarningSuffix.ts`; rewires `app/(tabs)/index.tsx`, `app/exercise-history/[id].tsx`, `app/session/[id].tsx`, `historyListHelpers.ts` to call them. +5 new domain modules + 5 new test files (~1000 lines net add, ~338 lines removed from the screens). Behavior-preserving refactor.
- **Smoke surface (device):** **History list + Session detail (read mode) + Exercise history**. Open History → tap a past session → confirm clusters / ordered items render identically, PR badges correct, hide-unchecked toggle still filters, delete-warning text still shows the right exercise count; confirm exercise-history page PR list + date labels render. Today tab regression (it shares the extracted formatters).
- **Merge:** `git checkout main && git merge --ff-only refactor/bigfile-pure-extract`

#### 2. `overnight/crash-hardening-2026-06-02` (device-gated, 4 unique fixes after rebase)
- **Changes (unique, above the shared extracts):** Defensive crash/unmount hardening — cancel `refresh()` setState on blur/unmount mid-fetch in history+chart; guard `setsById.get()` in drag `renderItems` (drop the non-null assert); reduce-based min/max in `TrendChart` (no spread over possibly-empty array); hoist `!id` guard above hooks + normalize array `id` param. Touches `app/(tabs)/index.tsx`, `app/exercise-chart/[id].tsx`, `app/exercise-history/[id].tsx`, `app/session/[id].tsx`. (Also restores 30 lines in `extract-pure-logic` SKILL.md that diverge from main — verify that diff post-rebase.)
- **Smoke surface (device):** **Exercise chart** (open a chart with 0/1/many points — confirm no crash, axes correct), **navigate away mid-load** from history/chart (background the screen during refresh — confirm no "setState on unmounted" warning), **drag-reorder sets** in an in-session exercise (confirm no crash), and deep-link an invalid `[id]` route (confirm graceful, not a hook-order crash).
- **Merge:** rebase first (drops the 5 dup extracts), smoke, then `git merge --ff-only`.

#### 3. `overnight/resolve-set-defaults-2026-06-02` (device-gated, 3 unique commits after rebase)
- **Changes (unique):** Extracts `src/domain/set/resolveSetDefaults.ts` and routes `onAddSet` defaults through it from both the Today tab and Session-detail. Touches `app/(tabs)/index.tsx` + `app/session/[id].tsx`. (NOTE: this branch ALSO stacks on the crash-hardening fixes — its `369ffc0..` log contains the 4 crash fixes too; after #2 merges, those drop out via rebase as well, leaving only the 3 resolve-set commits.)
- **Smoke surface (device):** **Add Set** in an active session from BOTH entry points — Today tab in-session AND the Session-detail editor. Confirm the new set's default weight/reps/kind prefill matches the prior behavior (last-set carryover, warmup vs working defaults). Dropset / cluster add-set paths.
- **Merge:** rebase first (drops 5 extracts + the 4 crash fixes once #2 is in main), smoke, then `git merge --ff-only`.

#### 4. `overnight/programs-formatter-2026-06-02` (device-gated, 1 unique commit after rebase)
- **Changes (unique):** Rewires `app/(tabs)/programs.tsx`'s local `formatLocalDateToIso` to the shared `localYmd` helper. Single commit `513b06b` on top of the 5 shared extracts.
- **Smoke surface (device):** **Programs tab** — confirm program cell dates / "edited at" timestamps render in correct local `YYYY-MM-DD` (esp. across a timezone-sensitive boundary like late-night), and program create/activate flow unaffected.
- **Merge:** rebase first (drops the 5 extracts), smoke, then `git merge --ff-only`.

#### 5. `chore/a11y-sheets-charts` (device-gated, 2 commits, clean off `58bce04`)
- **Changes:** Accessibility props — focus-trap + role/label the 6 in-session sheets/modals (body-data, rest-timer, session-time-editor, template-meta, reorder-exercises, set-note); expose data-viz charts (body-heatmap, body-trend, mini-bar, hr-zone, exercise-chart) as labeled images to VoiceOver. Adds 14 i18n keys to `src/i18n/strings.ts` (partially overlaps F-i18n's a11y-label backlog).
- **Smoke surface (device):** **VoiceOver ON.** Open each of the 6 sheets — confirm focus lands inside and is trapped, each has a spoken role/label. Swipe to each chart — confirm it announces a meaningful image label (not "image" alone). Verify both locales speak the right language for the new keys. Non-VO visual regression: sheets still open/close + charts still draw normally.
- **Merge:** rebase first (it's clean off `58bce04` but main will have advanced), smoke, then `git merge --ff-only`.

#### 6. `chore/appstore-watch-readiness` (device-gated, 2 commits, **stale-based — MUST rebase**)
- **⚠️ Base hazard:** merge-base is `89fbbed`, **25 commits behind** main. A plain merge would look like a 3279-line deletion (it would try to revert everything that landed after `89fbbed`). Its OWN two commits touch only **5 files**: `ios/.../TrainingLog Watch.../Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` (new Watch app icon, 402 KB), its `Contents.json`, `ios/TrainingLog.xcodeproj/project.pbxproj` (version/category), `ios/TrainingLog/Info.plist`, and **`docs/testflight/submission-questionnaire.md`** (new, 168 lines of ASC submission-time answers).
- **Changes:** Watch-target AppIcon for App Store + iOS project version/category bump + the ASC questionnaire doc.
- **Smoke surface (device + Xcode):** This is the **archive-gate** branch. After rebase: open `ios/TrainingLog.xcworkspace`, confirm the Watch `AppIcon` set has no warning badge and the Watch app shows the icon on-wrist; confirm `agvtool what-version` / `what-marketing-version` + category in `project.pbxproj`/`Info.plist` match the intended release (per [`build-bump.md`](./build-bump.md) pre-archive checklist). Then a Release **archive** dry-run.
- **Merge:** **rebase is mandatory** — `git checkout chore/appstore-watch-readiness && git rebase main`. Expect possible conflicts in `project.pbxproj` / `Info.plist` (resolve toward main's current build/version baseline + this branch's category/icon additions). Then smoke/archive-check, then `git checkout main && git merge --ff-only chore/appstore-watch-readiness`.

#### 7. `chore/skills-2026-06-03` (trivial — docs only, 1 commit)
- **Changes:** Adds `.claude/skills/add-accessibility-props/SKILL.md` (105 lines). No code, no tests.
- **Smoke surface:** none (docs). Pre-commit hook is a no-op for non-`.ts`/`.tsx`.
- **Merge:** rebase (trivial) then `git merge --ff-only`.

#### 8. `overnight/coverage-fill-r2-2026-06-03` (trivial — tests only, 7 commits) — **fold this, SKIP the non-r2**
- **Changes:** TESTS-ONLY, zero production edits. 7 new coverage suites: repo-guard / sessionRepo / setRepo / templateRepo / convertSessionToTemplate-dropset, plus the displayRank tie-break + reconcile-tombstone suites. **Includes `overnight/coverage-fill-2026-06-03`'s two commits verbatim** (`83c0a94`, `7d6681c`) — so `overnight/coverage-fill-2026-06-03` is fully superseded; **do NOT merge the non-r2 branch** (delete it after r2 lands).
- **Smoke surface:** none on device. Verify via `npm test` (jest green) post-rebase — the pre-commit hook runs tsc + full jest.
- **Merge:** rebase (trivial — additive new test files) then `git merge --ff-only`. Then `git branch -D overnight/coverage-fill-2026-06-03`.

### Recommended order (biggest/riskiest device-gated first; docs+tests last)

Rationale: merge `bigfile-pure-extract` first so the 3 stacked branches shed their duplicate extract commits on rebase (smaller, near-conflict-free). Then the dependent stack in dependency order (crash-hardening → resolve-set-defaults, since resolve-set stacks on crash-hardening → programs-formatter). Then the two independent clean branches. The stale `appstore-watch-readiness` goes near the end so its mandatory rebase happens against a nearly-final main (and it's the archive gate anyway). Docs + tests fold last (cheapest rebases, zero device risk).

```
1. refactor/bigfile-pure-extract          (clean ff)  → smoke: History/Session-detail/Exercise-history read mode
2. overnight/crash-hardening-2026-06-02    (rebase)    → smoke: chart 0/1/N pts, nav-away mid-load, drag sets, bad [id]
3. overnight/resolve-set-defaults-2026-06-02 (rebase)  → smoke: Add Set defaults from Today + Session-detail
4. overnight/programs-formatter-2026-06-02 (rebase)    → smoke: Programs tab dates (TZ boundary)
5. chore/a11y-sheets-charts                (rebase)    → smoke: VoiceOver on 6 sheets + 5 charts, both locales
6. chore/appstore-watch-readiness          (REBASE+resolve) → archive-gate: Watch icon, version/category, Release archive
7. chore/skills-2026-06-03                 (rebase)    → no smoke (docs)
8. overnight/coverage-fill-r2-2026-06-03   (rebase)    → no smoke (npm test green), then delete the non-r2 branch
```

**Per-step recipe** (run from this/any clean worktree on the repo):

```bash
# Step 1 — bigfile is already off the current main, no rebase needed:
git checkout main
git merge --ff-only refactor/bigfile-pure-extract
# (build to device → run the step-1 smoke surface → only proceed if green)

# Steps 2-8 — main has advanced, so EACH must rebase onto the new main first:
git checkout <next-branch>
git rebase main            # stacked branches: dup extract commits drop out via patch-id
# ...resolve any conflicts (only appstore-watch-readiness is expected to need it)...
# build to device → run that branch's smoke surface → only proceed if green
git checkout main
git merge --ff-only <next-branch>
# repeat for the next branch in the list
```

> After each `--ff-only` merge, `main` moves; re-run `git rebase main` on the
> *next* branch before touching it. If a rebase reports "everything up to date"
> or applies 0 commits for a stacked branch, that is the expected patch-id
> dedup — its unique commits are already represented or were the only ones left.
> Bump the build number ([`build-bump.md`](./build-bump.md)) once, just before
> the final archive (after step 6 lands the version/category changes).
