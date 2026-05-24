# 2026-05-24 — Dead-Code Sweep Round 2

**Branch:** `agent-C-dead-code-round2` (worktree base `slice/10c-set-logger-and-menu` @ `01a0a62`).
**Baseline:** 1409 tests green, tsc clean.
**Final:** 1409 tests green, tsc clean. Net −403 LOC dropped.

Round 1 (Agent D, 5/24 overnight, commit `41bc5fc`) removed the Expo
scaffold trio + demoted `insertUnlocks` for −174 LOC. This round 2 picks
up post-Round-1 leftovers and the post-`c03670b` additions.

---

## § 1. Scan methodology

1. **`npx ts-prune`** for the full module-import graph false-positive list
   (89 entries — most are React components consumed by JSX or by expo-router's
   file-system routing).
2. **Manual grep cross-check** for each ts-prune candidate, ignoring own-file
   refs + node_modules. Categorised into:
   - HAS-CALLER (false positive — drop from candidate list)
   - TESTS-ONLY (defer per Agent D rule: tests are valid consumers)
   - ZERO-REF (true dead candidate)
3. **Scripted scan of `src/domain/` + `src/adapters/sqlite/`** — 480 exported
   symbols audited. Limitation noted: the script doesn't catch internal
   references within the SAME file (e.g. `RestTimerStatus` appears as a
   field of `RestTimerState` inside the same module), so each ZERO-REF
   candidate was hand-verified before dropping.
4. **Pre-priority candidates from task brief:**
   - `overwriteTemplateFromSession` — ALREADY removed in commit `5170539`
     (5/19 morning). N/A.
   - `createTemplateFromSession` — ALREADY removed in commit `5170539`. N/A.

---

## § 2. Dead code DROPPED (this round)

| File | Symbol / scope | LOC | ADR ref status | Commit |
| --- | --- | --- | --- | --- |
| `components/exercise/muscle-diagram-tagged.tsx` | whole file (`MuscleDiagramTagged`) | 384 | Not in any ADR. Replaced overnight 5/24 by `components/exercise/muscle-body-tagger.tsx` (library-based, see its file header `MuscleBodyTagger — library-based replacement for MuscleDiagramTagged`). All non-comment refs gone. | `002ef37` |
| `src/domain/body/types.ts` | `UnitPreferenceState` interface | 4 | Never imported anywhere. `settings.tsx` consumes `UnitPreference` (the union) directly via `getUnitPreference`. | `e8736e6` |
| `src/domain/body/types.ts` | `BodyTrendPoint` interface | 7 | Never imported anywhere. `BodyTrendChart` works directly off `BodyMetric` rows. | `e8736e6` |
| `src/domain/stats/types.ts` | `Period` interface | 7 | Never imported anywhere. Stats engine takes raw `start_ms`/`end_ms` or uses the more specific `PeriodBucketBoundary` (kept — actively used). | `e8736e6` |

**Total LOC removed: 402 (file deletion + 19 from interface bodies).**

### Verification protocol (per drop)

1. `grep -rn "<symbol>" --include="*.ts" --include="*.tsx"` excluding `node_modules`
   and own file. **Zero hits.**
2. `grep -rn "<symbol>" docs/` to confirm not referenced by any of the 23 ADRs.
   **Zero hits.**
3. After each batch: `npx tsc --noEmit` (clean) + `npx jest` (1409/1409 → 1409/1409, no test
   regression).

---

## § 3. Candidates PRESERVED (with reason)

### Tests-only — kept per Agent D rule (tests are valid consumers)

These exports have callers ONLY in `tests/` — dropping would force test
rewrites without API surface gain. Same rule that kept the 5/24 deferred list:

| Symbol | File |
| --- | --- |
| `setSessionBwSnapshot` | `src/adapters/sqlite/sessionRepository.ts:23` |
| `recordSetAsAutoSession` | `src/adapters/sqlite/setRepository.ts:1727` |
| `listAllSets` / `listAllSetsWithExercise` | `src/adapters/sqlite/setRepository.ts` |
| `listSlotsForSuperset` / `listReusableSupersets` / `incrementUseCount` | `src/adapters/sqlite/supersetRepository.ts` |
| `getBodyMetric` / `deleteBodyMetric` | `src/adapters/sqlite/bodyMetricRepository.ts` |
| `classifyTemplate` / `applyRenameSiblings` / `applyRecolorSiblings` / `updateTemplateName` / `removeTemplateExercise` | `src/adapters/sqlite/templateRepository.ts` |
| `updateCell` / `deleteProgram` / `clearActiveProgram` | `src/adapters/sqlite/programRepository.ts` |

### i18n helpers — owned by Agent B (DO NOT TOUCH)

ts-prune flagged ~13 helpers in `src/i18n/dynamic.ts` as tests-only
(`tDayN`, `tWeekN`, `tMonthOfYear`, `tWeekdayWithDot`, `tCycleHeader`,
`tIntensityFilterCount`, `tMuscleGroupOverlapError`, `tDuplicateRsPairError`,
`setLocale`, `Locale`, `StringsTree`, etc). Owned by another agent's domain
file per the round 2 brief — left untouched. Several are also re-exported via
the `src/i18n/index.ts` barrel and used internally by other helpers.

### React components — false positives

`AchievementsPanel`, `BodyHeatmap`, `BodyHeatmapLegend`, `BodyTrendChart`,
`SERIES_COLORS`, `DatabaseProvider`, `useDatabase`, `HapticTab`,
`MiniBarChart`, `StatsPanel`, `CustomExerciseForm`, `MgEquipmentPicker`,
`MuscleBodyTagger`, `BodyDataSheet`, `ClusterCard`, `RestTimerModal`,
`SessionStatsPanel`, `TemplateMetaSheet`, `NumericKeypad`, `ReorderExercisesSheet`,
`SegmentedProgressBar`, `SetNoteSheet`, `SetRowContent`, `SwipeableSetRow`,
`StartTemplateSheet`, `IconSymbol`, `CalendarGrid` — each verified to have
JSX consumers in `app/` and/or `components/`.

### Framework conventions — false positives

`unstable_settings` in `app/_layout.tsx` — read by expo-router. **Keep.**
`hooks/use-color-scheme.web.ts` — Metro platform-specific resolver pair
with `use-color-scheme.ts`. **Keep both.** Same for `components/ui/icon-symbol.ios.tsx`
+ `icon-symbol.tsx`.

### Type aliases inside same-module usage — false positives from scripted scan

The naive scripted scan flagged these as ZERO-REF because cross-file grep
ignores same-file refs. Each was hand-verified to be used internally:

- `RestTimerStatus` (in `RestTimerState.status`)
- `Quintile` / `BodyHeatmapProps` (consumed by exported defaults in same module)
- `AnchorEntry` (consumed by exported `FRONT_ANCHORS` / `BACK_ANCHORS`)
- `BicepPattern` (consumed by exported `BICEP_PATTERN`)
- `PickerCell` (consumed by `MgEquipmentPicker` props)
- `SetRowItem` / `SwipeAction` (consumed by their exported components)
- `Period` was NOT in this group — verified standalone, hence dropped.

### Function-signature input/output types — keep as documentation

Types like `DetectPRArgs`, `E1RMInput`, `VolumeInput`, `ValidationError`,
`ReplayResult`, `CreateReusableSupersetArgs`, `ExplodeSupersetArgs`,
`WizardDraft`, `SessionStats`, `DetailPageStats`, etc — used to declare the
public function signature even when callers inline-construct via object
literal. Demoting `export` would not change runtime behaviour but loses
type-hover documentation at call sites. Kept as-is.

### Anatomy stack — bicep pattern toggle (active research)

`SPLIT_X_BICEP_L_B_*` / `BicepPattern` / `BICEP_PATTERN` toggle and the four
`B_*` variants in `body-overlay-paths.ts` — actively retained as Pattern B
study fallback per ADR-0010 amendment work in progress this overnight
(per memory note). Owned by anatomy agent — DO NOT TOUCH.

---

## § 4. Deferred follow-up

The same Tests-only DEFERRED list from 5/24 Round 1 remains valid; no new
items added this round.

Future cleanup hooks (LOW-PRIORITY, not actioned here):

- Function-signature input types could be demoted (lose `export`) in bulk if
  team decides type-hover-on-call is not needed.
- `RestTimerStatus` (and similar same-file-only union aliases) could be
  inlined into their owning interface — purely stylistic.

---

## § 5. Commit summary

| SHA | Subject | Files | LOC |
| --- | --- | --- | --- |
| `002ef37` | `chore(dead-code): drop muscle-diagram-tagged.tsx` | 1 | −384 |
| `e8736e6` | `chore(dead-code): drop 3 orphan type declarations` | 2 | −18 |

**Net round 2:** −402 LOC across 3 files. Tests 1409/1409, tsc clean.

Combined with Round 1 (5/24 overnight Agent D, `41bc5fc`): **−576 LOC** of
dead code removed from `slice/10c-set-logger-and-menu` since `c03670b`.
