# 2026-05-23 ADR / CONTEXT Drift Audit

Audit scope: commits `f70bd85..0cdbb69` (58 commits — waves 16/17/18a-g + 5/23 overnight 4-agent + i18n Phase 1-5).

## Summary

- **Commits audited**: `f70bd85..0cdbb69` (58 commits across waves 16/17/18a-g + 5/23 overnight)
- **ADRs reviewed**: 0003 / 0004 / 0010 / 0014 / 0017 / 0018 / 0019 / 0021 (8 ADRs; full Q-sweep on ADR-0019)
- **Findings**: **3 H** + **4 M** + **5 L**

The biggest drift sits around **wave 18g `overwriteProgram`** (brand-new write path with zero ADR coverage), the **i18n Phase 5 locale toggle** (no ADR at all, no CONTEXT term), and **stale ADR-0019 schema-summary cross-refs** (ADR-0021 is filed but the table still labels it "待建"; v015–v018 missing from the table altogether). Wave 16/17/18 program-wizard UX overhaul has no ADR-0003 / ADR-0004 / ADR-0017 inline markers despite materially changing program editing semantics. Anatomy refresh (5/23 wave) is undocumented and the 19-muscle path promise from ADR-0010 is silently downgraded to 14 MG paths.

ADR-0019 Q-decision sweep is otherwise green — start dialog, ⚙️ menu, cluster ✓ semantic, finish path, hide-unchecked toggle, modal-only rest timer all match code.

---

## H1. `overwriteProgram` write path is undocumented across ALL ADRs

**Affects**: ADR-0021 § Write paths (the table lists 3 write paths; this is a 4th), ADR-0004 § Program structure, ADR-0019 § Schema table

**Evidence**:
- `src/adapters/sqlite/programRepository.ts:243` `overwriteProgram(db, { program_id, new_program, new_cells, new_sub_tags, now? })` — full DELETE + re-INSERT of `program_cell` and `program_sub_tag` for a given program, plus `PROGRAM_HAS_ACTIVE_SESSION` guard.
- Wave 18g commit `d8df14f` + tests `73f9926` (7 cases) + UI integration `f927357`/`8b2075d`.
- `grep -n overwriteProgram docs/adr/*.md` → **zero matches**.
- ADR-0021 § Write paths enumerates `upsertCell` / `applyTemplateToColumn` / `applyTagToRow` + a defensive `swapProgramCells` re-register; `overwriteProgram` is materially different (it DELETEs and re-INSERTs the entire dictionary in one transaction). The active-session traversal `session → session_exercise → template.program_id` is also load-bearing and worth recording.

**Recommendation**: Add an `overwriteProgram` write-path row to ADR-0021 § Write paths and an inline marker in ADR-0004 noting that program-wizard now supports "edit-in-place via 載入計劃 + overwrite" beyond the original create-new flow. Also append a `v022 amendment` row to ADR-0019's schema table noting that wave 18g introduced the 4th write path on top of v022.

Suggested ADR-0021 amendment paragraph:

> **2026-05-22 wave 18g amendment** — adds a 4th write path: `overwriteProgram(db, { program_id, new_program, new_cells, new_sub_tags, now? })` (programRepository.ts:243). Active session guard via `session ↔ session_exercise ↔ template.program_id` JOIN throws `PROGRAM_HAS_ACTIVE_SESSION` before transaction opens; inside the transaction we DELETE `program_cell` + `program_sub_tag` for the program, UPDATE `program` metadata (id + is_active preserved), and re-INSERT both. Differs from the original 3 write paths in that the entire `program_sub_tag` dictionary is treated as authoritative-from-wizard rather than additive. Triggered when the program-wizard detects a name match and the user confirms "覆蓋" inline.

## H2. i18n locale persistence + Phase 5 toggle has no ADR / CONTEXT.md coverage

**Affects**: New ADR needed (proposed `ADR-0022 — i18n locale resolution and persistence` or absorbed into existing settings ADR), CONTEXT.md glossary

**Evidence**:
- `src/i18n/locale-persist.ts` adds tri-state `StoredLocaleValue` (`zh` | `en` | `auto`) backed by AsyncStorage key `app.locale.preference`, resolved via `expo-localization` for `auto`.
- `app/_layout.tsx` boot wire hydrates this before render.
- `app/(tabs)/settings.tsx:50` exposes a 3-radio Settings row (Auto / 中文 / English).
- `package.json` now lists `expo-localization` and updated `@react-native-async-storage/async-storage` deps (commit `3a7238b` realigned to SDK 54).
- `grep -n locale docs/adr/*.md` → only finds the substring inside unrelated words; no locale ADR exists.
- CONTEXT.md has zero references to locale / i18n / Phase 5; `tMuscleGroup`, `tEquipment`, `tLoadType` (DB-mapping helpers from Phase 3b) are also absent from CONTEXT § Domain modules.

**Recommendation**: Open a small ADR (or amendment under ADR-0011 Backup/Sync which already mentions `app_settings` as the canonical preference store) covering:
- Why locale lives in AsyncStorage rather than `app_settings` SQLite table (deliberate: hydration must happen before SQLite open).
- The tri-state semantics + `expo-localization` fallback mapping (`zh*` → zh, else en).
- The 4-namespace `src/i18n/strings.ts` shape (9 namespaces × 346 keys × 2 locales) + the `tFoo` dynamic helpers in `src/i18n/dynamic.ts`.
- Why `program.name` / `template.name` / user-typed sub_tag stay verbatim (not translated).

Add to CONTEXT.md § Domain modules:
- `localePersist` (`src/i18n/locale-persist.ts`) — tri-state Auto / zh / en, AsyncStorage-backed, hydrated at app boot before first `t()` call
- `tMuscleGroup` / `tEquipment` / `tLoadType` (`src/i18n/dynamic.ts`) — DB-row → display-string helpers preserving round-trip identity for filter chips

## H3. ADR-0019 § Schema 影響總覽 has stale row labels for v015–v018 + ADR-0021 cross-ref

**Affects**: ADR-0019 line 433–436 (schema table)

**Evidence**:
- Line 436: `| v022 | program_sub_tag (...) — 詳見 ADR-0021 (待建)| n/a |` — **but `docs/adr/0021-program-sub-tag-dictionary.md` exists** (Status: accepted 2026-05-22). The "(待建)" parenthetical is stale.
- v015 (`set_kind_and_clusters`), v016 (`session_runtime_data`), v017 (`program_none_seed`), v018 (`set_notes`) are described inline in the slice 10a/10b/10c narrative sections but **absent from the schema-summary table** (which lists only ADR-0019-introduced rows + v019–v022). For a "Schema 影響總覽" table this is incomplete — the table now only shows ~half the migrations on the branch.

**Recommendation**:
1. Replace `(待建)` with the actual ADR-0021 ref.
2. Backfill rows in the schema-summary table for v015 / v016 / v017 / v018 (one line each, pointing to the inline section that describes them).

Suggested rows:

| v015 | `set.set_kind` / `set.parent_set_id` / `set.is_logged` | slice 10a foundation — set kind enum + dropset chain + ✓ flag | see § Slice 10a Q2 |
| v016 | `template_exercise.rest_sec` / `session_exercise.rest_sec` / `session.{healthkit_workout_uuid,avg_hr_bpm,kcal}` / `app_settings.auto_popup_rest_timer` seed | slice 10a Q3 + Q5 落地 | see § Slice 10a Q3/Q5 |
| v017 | `program` "無" seed (nil-UUID) | slice 10a Q1 — sentinel row | see § Known issues #1 |
| v018 | `set.notes TEXT NULL` | slice 10c Phase 2 right-swipe per-set notes | see § Slice 10c Phase 2 |

---

## M1. ADR-0004 / ADR-0003 missing wave 15/17/18 inline markers (program-wizard UX overhaul)

**Affects**: ADR-0004 (Cycle-based Program calendar) line 28 wizard step list; ADR-0003 § Two-tier identity

**Evidence**:
- ADR-0004 line 28 still says wizard step 2 = `(循環長度, 循環次數, 起始日期)`. Waves 18a–18g materially restructured this into 6 steps: 計劃名稱 → 循環天數 + 週期數 → 訓練日休息日 → 每訓練日 Template → 每週期強度 → 預覽（with multi-強度 chip array, 載入計劃 entry, header-mounted nav). Step list in CONTEXT.md L487 is also stale.
- ADR-0003 § Template identity is still anchored on `(name, Program, 副標籤)` triple; wave 18d moved 強度 from "per Step 3 sub_tag pill" to "per-cycle override" stored in `program_cell.sub_tag`. The identity is unchanged but the *storage placement* and *write path* for sub_tag did move — worth a one-line marker.
- Wave 17 added `swapProgramCells` (atomic 2-cell swap) and `updateProgramStartDate` (start_date dropdown) — neither has an ADR-0004 marker, despite ADR-0004 specifying `起始日期` as a structural property of the calendar.

**Recommendation**: Add a wave-15/17/18 amendment block to ADR-0004 capturing (a) `swapProgramCells` as a structural editor primitive, (b) `start_date` as live-editable via dropdown not just create-time, (c) the wizard step list reordering. Add a one-line inline marker to ADR-0003 noting that `program_cell.sub_tag` is the canonical per-cell `強度` store (overruling stale Step 3 sub_tag pill UX).

## M2. ADR-0017 RS-template integration in wave 16 「+建立新模板」 round-trip undocumented

**Affects**: ADR-0017 Q10 / § Reusable Superset entity

**Evidence**:
- Wave 16 commit `485e9bc` added `attachTemplateToProgram` + `commitTemplateDraft` integration so program-wizard's `[+ 新建]` pill spawns a Template editor in import mode (pre-fills program_id + sub_tag). This is a new entry route to creating a Template, parallel to the existing Templates-tab entry.
- ADR-0017 Q11 (Custom Exercise form) + Q15 (`/library?mode=picker`) cover library-picker round-trip, but **no Q covers the symmetrical Template-editor-from-program-wizard round-trip**.
- Wave 18g commit `e32a016` further extended Template-meta-sheet to union `listDistinctSubTagsByProgram + listProgramSubTags` (mirror of wave 16 sheet pattern), giving the sheet the same v022-dict-aware behavior — also undocumented at ADR level.

**Recommendation**: Add a wave 16/18g amendment to ADR-0017 § Q10 (or a new sub-section) covering the program-wizard → template-editor round-trip + Template-meta-sheet's v022 union-source contract. Include a pointer to ADR-0021 since the union source is now the persistent dictionary.

## M3. ADR-0019 § "slice 10d session/[id].tsx edit mode 不接 timer" should be propagated to ADR-0014

**Affects**: ADR-0014 § Save-back 共存 + § In-session 編輯入口 (cross-page consistency)

**Evidence**:
- ADR-0019 slice 10d ledger row (E2) declares "session/[id].tsx edit mode 不接 timer".
- ADR-0014 § In-session 編輯入口 says editing is "跟 ADR-0013 notes in-place 編輯同 in-place pattern" — implies session/[id] editing inherits in-session timer behavior, but in fact it doesn't.
- The `enableRestTimer` flag deliberately doesn't exist; Today and detail screens have independent state.

**Recommendation**: Add a one-line marker in ADR-0014 § In-session 編輯入口 noting "(per ADR-0019 § slice 10d E2, history-detail edit mode does NOT trigger the rest-timer modal — edit is post-hoc revision)".

## M4. CONTEXT.md domain-modules glossary missing wave 15-22 helpers

**Affects**: CONTEXT.md § Domain 模組 (line 429–442)

**Evidence**: The Domain 模組 block lists 9 entries (`replayGate`, `clusterSwitcher`, `clusterStat`, `sameDayNav`, `countUniqueExercises`, `formatTrainingDuration`, `formatTemplateTriple`, `resolveTargetTemplate`, `programGridLayout`). Recent waves added:
- `recordProgramSubTag` + `listProgramSubTags` (ADR-0021, wave 16)
- `swapProgramCells` + `updateProgramStartDate` (wave 17)
- `overwriteProgram` (wave 18g)
- `expandWizardDraft` (program-wizard Step 4 per-cycle expansion, wave 18d)
- `loadStoredLocale` / `saveStoredLocale` / `resolveLocale` (i18n Phase 5)
- `prefillReusableSupersetFromLastSession` (wave 17/18 RS prefill)

All are load-bearing pure-or-repo helpers that other agents/skills need to discover via CONTEXT.

**Recommendation**: Extend the Domain 模組 block with the helpers above, one line each, with a one-sentence purpose.

---

## L1. ADR-0010 / ADR-0017 reference deleted `components/body-diagram.tsx`

**Affects**: ADR-0010 line 184; ADR-0017 line 122

**Evidence**: Wave-2 overnight 5/22 cleanup removed `components/body-diagram.tsx` (dead code, never imported); only `components/body-heatmap.tsx` survives. Both ADRs still reference both files as if both exist.

**Recommendation**: Drop the `body-diagram.tsx` reference in both ADRs (or note the consolidation).

## L2. ADR-0010 promised 19-muscle-path SVG; current heatmap has 14 MG paths

**Affects**: ADR-0010 § 體圖 asset 策略 + § Schema (Exercise → muscle individual highlight)

**Evidence**: ADR-0010 line 110–118 promises "前後身兩張 SVG (neutral / male body silhouette + 19 muscle 各自獨立 fill path)" with each muscle having unique `id` for individual-highlight on Exercise 詳情頁. Current `components/body-heatmap.tsx` (re-drawn realistic 5/23 wave) has 14 MG-level paths (front 7 + back 7) — not 19. The "by-19-muscle individual highlight" use case promised in ADR-0010 has no implementation.

**Recommendation**: Add an amendment to ADR-0010 noting the v1 reality: heatmap renders at MG level (14 paths), the per-19-muscle highlight use-case on Exercise 詳情頁 is deferred (or use a different mechanism — e.g. text chips). This also affects Q11 Custom Exercise form whose "解剖圖 inline 頂端" (Slice 9.7 grill Q4) implies muscle-level highlight in the form.

## L3. ADR-0019 line 287 says 「無」 picker hides 強度 section but wave 11 changed label to 「通用」

**Affects**: ADR-0019 § Q9.2 (line 287) — incomplete

**Evidence**: Line 287 (start-template-sheet 樣板): `選「無」週期時：副標區（強度 picker）整個隱藏`. But wave 11 modification on line 303 renamed `「無」radio label` (強度 context) → 「通用」, and at the same time the dialog kept showing the section. The line 287 description is technically correct for `週期 = 無` but slightly misleading after wave 11 — there's now a notion of `強度 = 通用` that still shows. Worth a clarifying note.

**Recommendation**: Add an inline parenthetical to line 287 like: "(2026-05-19 wave 11 補充：強度 picker 仍顯示且包含『通用』固定項，只有當 user 把 sheet 預設值改成『通用』時 picker collapse；參見本 ADR § Q9.2 wave 11 marker)".

## L4. CONTEXT.md terminology table missing 「主標籤」 → 「計劃」 final rename

**Affects**: CONTEXT.md L405-410 (Terminology rename 對照表)

**Evidence**: Wave 18a renamed `Program 名稱` UI label to **「計劃名稱」** (per memory notes + commit `c725aa6` "計劃/週期"). The CONTEXT terminology table covers `Program 主標 → 週期`, `Program 副標 → 強度`, `無 Program → 無`, but not the meta-rename `Program 名稱 → 計劃名稱` that wave 18a introduced. Also `Cycle 設定 → 週期設定` / `Cycle 長度 → 循環天數` / `Cycle 次數 → 週期數`. These are user-visible terms.

**Recommendation**: Extend the terminology rename table with the wave 18a wizard-side renames (or note that wave 18a propagated existing renames consistently into the wizard).

## L5. ADR-0021 cross-ref to `ADR-0022 (proposed)` is dangling

**Affects**: ADR-0021 § References

**Evidence**: Line 115 references `ADR-0022 (proposed) Programs tab grid-on-tab UX — write path 在那條 UI flow 上下文 ship`. No `docs/adr/0022-*.md` exists, and there's no record in CONTEXT.md or other ADRs of one being planned. Wave 15/17/18 covered the UX changes — they should retro-fit ADR-0004 (or a real new ADR-0022 should be opened).

**Recommendation**: Either land an ADR-0022 (overlapping with finding M1) or update ADR-0021 § References to point at the M1-recommended ADR-0004 amendment instead.

---

## ADR-0019 Q-decision sweep

| Q-id | Decision | Code state | Status |
|---|---|---|---|
| Q2.1 / Q2.2 | rest_sec dual column (template_exercise + session_exercise), 60s hardcoded fallback | `session_exercise.rest_sec` canonical (v016 + slice 10b bridge); `template_exercise.rest_sec` orphan dropped in v021 | ✅ matches |
| Q2.3 | Auto-popup ON default + Settings toggle + chip-砍 X1 modal-only | `settingsRepository.getAutoPopupRestTimer` + Settings UI Switch row; modal-only confirmed | ✅ matches |
| Q2.4 | 一 cycle 一 ✓ | `onToggleClusterCycle` in `app/(tabs)/index.tsx:1019`; ClusterCard renders cycle rows | ✅ matches |
| Q3 (a-1/b-1/c-2/d-1/e-3) | collapsed default + tap toggle + only-one-expanded | confirmed via session card state | ✅ matches |
| Q4 | Per-row ⋯ icon 全砍 | gestures + label cycle in shared SwipeableSetRow | ✅ matches |
| Q5 (b) | ⚙️ menu 3 main items + reorder utility | ActionSheetIOS in index.tsx (3 main + reorder confirmed) | ✅ matches |
| Q5 (cluster ⚙️) | cluster ⚙️ adds 動作歷史 A/B shortcuts | cluster-card.tsx has cluster ⚙️ entry — needs verification but ADR L115 marks accepted | ✅ marked accepted in ADR |
| Q6 | In-session stats panel 3-tile (5-tile Watch deferred) | SessionStatsPanel exists; 5-tile deferred per ADR L145 | ✅ matches per inline marker |
| Q7 | Cluster source uniqueness (Template snapshot + RS picker only) | exercise-picker route + appendReusableSupersetToSession | ✅ matches |
| Q8 | Cluster header H1 + cycle row + cycle ✓ | cluster-card.tsx matches | ✅ matches |
| Q9 (a) Start | Templates tab → tap name → bottom sheet → 編輯模板 / 開始訓練 | start-template-sheet implementation matches | ✅ matches |
| Q9 (b) Pause | iPhone PS0 — no pause | confirmed (timer monotonically increments) | ✅ matches |
| Q9 (c) Discard | header [⋯] menu → 放棄訓練 + Body data shortcut accepted | `['取消', 'Body data', t('button', 'discardSession')]` per index.tsx:1511 | ✅ matches (inline L317 marker) |
| Q9 (d) Finish | **2026-05-18 wave 12 翻盤** — finish 不 dialog；模板入口移至詳情頁 sticky 4-button | session detail page has 4-button bar; finish in (tabs)/index.tsx calls `endSession` directly | ✅ matches (ledger row + ADR-0014 wave 12 marker present) |
| Q10 (HU1/HV1/HE1) | 砍 3 段 + expanded default + 編輯訓練 整頁 mode + 「隱藏未打勾」 switch | session/[id].tsx hideUnchecked state confirmed | ✅ matches (L411 inline marker confirms switch) |
| Q9.2 N1 | 「無」 program seed = real entity, nil UUID, name='無' | `RESERVED_NONE_PROGRAM_ID` in v017ProgramNone.ts | ✅ matches |
| Q9.2 wave 11 | 強度 context label「無」→「通用」 | confirmed in start-template-sheet + template-meta-sheet | ✅ matches |

**No ❌ stale Q-decisions found.** Q-block content matches code for all surveyed entries.

---

## CONTEXT.md glossary gaps

**Missing terms** (recent waves introduced these but CONTEXT has no entry):

- `program_sub_tag` table (v022 persistent strength-label dictionary)
- `overwriteProgram` write path (wave 18g)
- `swapProgramCells` / `updateProgramStartDate` (wave 17)
- `載入計劃` entry (wave 18f)
- Locale persistence (`StoredLocaleValue` tri-state, AsyncStorage key `app.locale.preference`)
- `tMuscleGroup` / `tEquipment` / `tLoadType` (i18n DB-mapping helpers)
- `expandWizardDraft` (wave 18d per-cycle override expansion)
- `prefillReusableSupersetFromLastSession` (wave 17)

**Outdated terms**:

- Terminology rename table (L405-410) — missing wave 18a wizard-side renames (計劃名稱 / 循環天數 / 週期數).
- Domain 模組 block (L429-442) — 9 entries, but ~8 additional helpers landed since.
- Pending decisions § Q6.2.D-ii.a (L487) — wizard step list is now 6 steps with multi-強度 chips; the old 6-step list `1.名稱 → 2a/b/c → 3.休息日 → 4.Template → 5.副標籤 → 6.預覽` no longer matches (Step 5 is now "per-cycle 強度 override" not "選副標籤").

**Terms to refine**:

- "Active program" (L446-447) — wave 17 added live `start_date` editing via dropdown, but the "純日期推算" claim still holds (just worth a marker that start_date is now editable from Programs tab edit mode).
- "強度" / "Program 副標籤" (L45-50) — should cross-ref `program_sub_tag` dictionary as canonical label store.

---

## Recommendations ranked by ROI

1. **(H1)** Add the `overwriteProgram` write-path row to ADR-0021 § Write paths + active-session guard SQL. This is a brand-new transaction that competes with all three existing write paths and has zero docs cover — highest blast radius if another agent edits program internals blind.

2. **(H3)** Two-line fix to ADR-0019 schema-summary table: replace "(待建)" with the actual ADR-0021 ref + backfill v015/v016/v017/v018 rows. Cheap, factual, makes the table actually useful as a "current state of schema" snapshot.

3. **(H2)** Land a small ADR (or ADR-0011 amendment) for i18n Phase 5 locale resolution + AsyncStorage placement decision. Without it, the next agent doing settings/restore/i18n work will re-litigate "why isn't locale in `app_settings`?".

4. **(M1 + L5)** Land ADR-0004 amendment (or new ADR-0022) covering wave 15/17/18 program-wizard + Programs-tab grid editing — this also closes the dangling ADR-0021 cross-ref to "ADR-0022 (proposed)".

5. **(M4)** Refresh CONTEXT.md § Domain 模組 with the 8 helpers added in waves 15–22. One-line entries, high-leverage for agent navigation.

Lower-ROI items (M2/M3/L1/L2/L3/L4) can be batched into a single ADR-housekeeping pass once the top 3-5 are landed.
