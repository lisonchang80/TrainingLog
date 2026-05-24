---
name: feature-decision-sweep
description: After a feature decision is finalized (post-grill or direct user confirm), sweep all 4 documentation/memory locations to keep them synchronized. Use when ADR is written, CONTEXT.md updated, PRD already published as issue #1 and needs amendment, or user says "決定鎖定後", "post-grill 收尾", "把這個寫進 ADR / CONTEXT / PRD". Specific to TrainingLog repo workflow where PRD lives at issue #1 and memory at user-level (`~/.claude/projects/-Users-hao800922/memory/`).
---

# Feature Decision Sweep — TrainingLog

When a feature decision crystallizes (typically post-grill) and PRD has already been published, **4 locations must be updated to stay in sync** or they will drift. This skill encodes the exact workflow.

## Trigger conditions

Use this skill when **all** of the below are true:
1. A feature decision has been **locked** (user confirmed the design, all open grill points answered)
2. The decision affects **schema or architecture** (small UX details don't trigger this; they live in implementation issues)
3. PRD (issue #1) has **already been published** (otherwise just edit ADR + CONTEXT.md and wait for `/to-prd` to pick up changes)

If any of the above is false → don't use this skill, just edit the relevant subset.

## Deflationary close-out variant (no ADR written)

Some grill rounds end with **"no new ADR needed"** because:
- The decision is **pure status quo** (e.g., Q8「獎章 sub-tab 維持 ADR-0009」)
- The decision is **pure no-op** (e.g., Q6「iPhone 不引入 paused 第三態」 — locks "don't do this")
- The decision is **deflationary collapse** (e.g., Q10「訓練類型 label = Template name 本身」 — turns out the proposed feature is already covered by existing entity)

In all 3 cases:
- ❌ Skip Step 1 (no ADR file written)
- ✅ Still do Step 2 (CONTEXT.md `Q<N>` close-out block with `無 ADR — 純 status quo / no-op / deflationary` annotation; remove the bullet from `下次 grill 接續` list)
- ✅ Still do Step 3 (PRD Update log entry: `Q<N> grill close-out — **無新 ADR**（純 status quo / no-op / deflationary）` — usually no new stories)
- ✅ Still do Step 4 (memory overview close-out bullet)

The skill's name still applies — sweep is about syncing locations, not about ADR writing per se. A deflationary close-out without sweep would leave PRD's `下次 grill 接續` line stale (still listing the closed backlog item).

## Batched sweep (multiple grills in one sweep)

If grill phase produces multiple close-outs back-to-back (e.g., 3 deflationary Q6/Q8/Q10 + 3 ADR-writing Q7/Q9/Q11), it's fine to batch them:
- Write all ADRs (Step 1 once per ADR)
- One CONTEXT.md edit pass covering all `Q<N>` close-out blocks
- One PRD body edit pass (single `gh issue edit --body-file` push)
- One memory update pass

But the「`下次 grill 接續`」line in memory + CONTEXT.md should reflect **only the final state** — don't write intermediate states that get overwritten.

## Prototype-driven amendment variant (post-grill, pre-ship)

After a Backlog has been grilled + ADR written + PRD synced, **prototype review** (running the UI mock in Simulator) frequently reveals spec gaps the grill didn't surface:
- UX details that only become obvious when you *see* the screen (e.g., "stats panel 大字 1 行不換行 / chip 字級壓 6 字 / 下方分頁欄要露出 / sticky header 滑過標題後顯示 session.title")
- Schema implications hidden during text-only grill (e.g., "Watch HR 5 區段閾值來源 = HealthKit user settings, 不是 hardcode")
- Cross-cutting label rename or rewording (e.g., "List → 表列")

Workflow:
- ❌ **Don't write a new ADR** (the amendment is downstream of an already-locked decision; new ADR would split the source of truth)
- ✅ **Append a `## YYYY-MM-DD Amendment — <reason>` block at the bottom of the existing ADR** documenting what changed + why (mention "prototype review" or similar trigger)
- ✅ Sync the **`How to apply:`** line in memory's domain_decisions section if the amendment changes downstream behavior; otherwise just add a bullet in the same section noting the amendment date + content
- ✅ **Update prototype code in lockstep** so the prototype always reflects the locked spec (one source of truth, two views: ADR = words, Prototype = pixels)
- ❌ Skip PRD edit unless the amendment actually changes a user story (most prototype refinements don't add stories, they refine existing ones — leave PRD alone). **Sub-rule for substantial amendments**: if prototype review evolves into cross-page spec alignment (e.g., Template editor → also locking Session set logger behaviors) and adds **5+ new stories**, PRD sweep can be **split as a separate follow-up task** to avoid scope creep within one sweep cycle — but **must record the deferred PRD sweep in overview memory「下一步候選」or「留尾」** with explicit list of pending new stories so it's not forgotten. Example: TrainingLog 2026-05-12 ADR-0016 amendment added stories for Session 4-action bar / 休息時間 / per-set notes / superset 合併標題 / accordion override — PRD deferred to next sweep, flagged in overview.
- ❌ Skip overview memory update unless「下一步」changed (or the amendment is large enough to warrant a new milestone bullet — large cross-page spec amendments DO trigger overview entry even if 下一步 unchanged, since the milestone marks completion of the prototype review iteration)

This variant tends to **batch multiple small amendments into one ADR section** (e.g., a single「2026-05-12 Amendment」block covering 5-10 visual refinements from one prototype review session), rather than scattering them across the ADR body. Cleaner diff history + easier to read.

**Multiple amendment blocks on the same ADR are fine.** When a *second* prototype iteration (different day, different session) surfaces more refinements on the same ADR, append a **second** `## YYYY-MM-DD Amendment — <reason>` block — do NOT edit the first block. Each block is a frozen snapshot of one iteration's outcome; readers should be able to scan the ADR top-to-bottom and follow the timeline. TrainingLog ADR-0016 example: `2026-05-12 Amendment — Prototype-driven UX 收口` (10 sub-sections from initial prototype build) + `2026-05-13 Amendment — Gesture 行為層落地 + 視覺收口` (10 sub-sections from second iteration adding gesture wiring + visual polish, including spec reversals like label cycle order). The second block explicitly notes which earlier amendment items it overrides.

### Downstream ADR-triggered amendment variant

A second case for amendment blocks: **when a downstream ADR explicitly amends the current ADR's decisions**. Use header format `## YYYY-MM-DD amendment（ADR-XXXX 觸發 — <reason>）` to distinguish from prototype-driven amendments. The amendment block should:
- State which downstream ADR triggered it (e.g., "ADR-0017 Q5 grill 結果")
- List **翻盤的既有拍板 / Reversed decisions** section with `❌` markers pointing at specific bullets in the current ADR being overturned (per ADR-FORMAT.md「Mark revisions explicitly」rule)
- List the new model / decision replacing it
- Cross-reference to the triggering ADR's section number (e.g., "見 ADR-0017 § Schema migration plan v013")

Example (TrainingLog ADR-0010 / 0013 / 0009 / 0016 all got `2026-05-13 amendment（ADR-0017 觸發 — ...）` blocks in one sweep): 4 ADRs each got a single dated block referencing ADR-0017 Q9 / Q5 / Q14 / Q15 respectively. Each block self-contained + auditable + traceable to the trigger.

### PRD core-ADR-table N-versions-stale variant (partial sync OK)

When the PRD's「核心 ADR 對照」table (the one that lists `ADR-0001 → User stories #X-Y, Modules #Z`) is **stale by N versions** (e.g., table ends at ADR-0019 but ADRs 0020/0021/0022/0023 have been written), the natural urge is to「先 catch up the whole table 再加 0024」— but that scope-creeps a grill sweep into a 100-200-line PRD edit. **Don't do it.**

**Recipe**:
- ✅ Add ONLY the current grill's ADR entry to the「Update log」section at top of PRD body (1 dated bullet, ≤200 chars)
- ✅ Inline-flag the staleness in the same log entry: e.g. `「**注意：本 PRD 「核心 ADR 對照」表停在 ADR-0019、未含 0020-0024，catch-up 全表已 deferred backlog**」`
- ❌ Do NOT touch the「核心 ADR 對照」table (entries 0020-0024 missing → leave missing)
- ✅ Record the deferred catch-up in user-level memory's `下一步候選` / `留尾` section with explicit list of pending ADRs

**Rationale**: each missing ADR-entry is ~3-7 lines (story range + modules + schema notes) — catching up 4-5 ADRs in one sweep adds 20-40 lines + risks introducing errors from re-reading 4 ADRs in one pass. Better to flag-and-defer, do the whole table catch-up as a separate dedicated task when user explicitly asks for PRD freshness.

**TrainingLog example (2026-05-24 ADR-0024 sweep)**: PRD #1 Update log got 1 new bullet for ADR-0024 with inline warning that core ADR table 0020-0024 are missing. Total PRD diff: +918 chars (1 log entry only). The 4-ADR catch-up (0020-0023) deferred to backlog. Compare to alternative「sync all 5 ADRs in one sweep」which would have been ~3000 chars + 4 chances to mis-summarize.

## The 4 locations (do in this order)

### 1. Write or update ADR — `docs/adr/000X-<kebab-name>.md`

- Numbering = next available ADR number (check `ls docs/adr/` first)
- Required structure: TL;DR / decision / schema impact / module impact / rejected alternatives / v1 ship 影響
- Cross-reference any ADR being reversed or amended (e.g., ADR-0010 reverses part of ADR-0002)

### 2. Update `CONTEXT.md`

Three typical edit points:
- **Concept section**: add or update the relevant 領域 entity definition
- **Flagged ambiguities**: if the decision resolves or reverses an ambiguity, update the line (or remove)
- **Pending decisions**: add `Q<N> close-out` block at the end with `✅` bullets summarizing each sub-decision + rejected alternatives + ADR reference

If `Q<N>` doesn't exist (because the feature was added without a Q-numbered grill round), add it as a new `Q<N>` block matching the surrounding format.

### 3. Edit issue #1 PRD body

The PRD lives at `https://github.com/lisonchang80/TrainingLog/issues/1` (label: `needs-triage`). Edit workflow:

```bash
cd /Users/hao800922/code/TrainingLog
gh issue view 1 --json body --jq '.body' > /tmp/prd_body.md
# Edit /tmp/prd_body.md with Read + Edit tools
gh issue edit 1 --body-file /tmp/prd_body.md
```

Edit points:
- **Update log** (top of body): add a dated bullet for this decision
- **核心設計支柱** (Solution section): if the decision is foundational (e.g., a 8th support pillar), add it
- **User Stories**: append new stories under the relevant section (or create new section)
- **Implementation Decisions / 模組**: update if new pure logic module added (renumber if needed); update Schema 影響總覽
- **Out of Scope**: add v1.5+ deferred items
- **核心 ADR 對照**: append `ADR-000X` line referencing the new user stories / modules / schema

### 4. Update user-level memory (NOT in repo)

Two files at `/Users/hao800922/.claude/projects/-Users-hao800922/memory/`:

- **`project_traininglog_overview.md`** — add `Q<N>` close-out bullet to "Grill 進度" section; bump ADR count; update "下一步" if it changed
- **`project_traininglog_domain_decisions.md`** — add a numbered `## <N>. <Decision title>(ADR-000X)` block matching surrounding format (with **Why** + **How to apply** at the bottom)

Memory is NOT pushed to repo (lives outside the repo at user-level).

## Output discipline

After all 4 steps complete, summarize as a table:

| 動作 | 結果 |
|---|---|
| 寫 `docs/adr/000X-name.md` | ✅ 新建（含 ...） |
| 更新 `CONTEXT.md` | ✅ ... 段 + Q<N> close-out |
| 更新 issue #1 PRD body | ✅ User stories 從 N 增至 M / Schema 補入 / Out of Scope 補 ... |
| 更新 memory 兩個檔 | ✅ overview + domain decisions |

Then surface "下一步" candidates (typically `/cp`, `/to-issues`, or continue grill).

## Common pitfalls

- **Don't edit PRD body inline via `gh issue edit --body "..."`** — body is too large (400+ lines), heredoc breaks. Always go through `/tmp/prd_body.md` file.
- **Don't forget the Update log entry at top of PRD** — readers need to know the PRD has been amended after initial publish.
- **Don't skip memory update if "下一步" changed** — overview's "下一步" line is the resume point for new conversations.
- **Don't push memory files** — they're at `~/.claude/projects/...`, not in the repo. `git add ~/.claude/...` would fail anyway.
- **ADR numbering**: always `ls docs/adr/` first to confirm next number; collisions are nasty.
- **Rebumping module numbers** when adding pure logic modules: PRD has Pure Domain Logic (#1-#N) then Platform Adapters (starting from #N+1). Adding a new pure logic module shifts the adapter numbering. Update both sections + the Cross-cutting / Schema 影響 references.
- **Verify story numbering integrity BEFORE appending new stories**: run `grep -c "^[0-9]\+\. As a 使用者" /tmp/prd_body.md` and compare with the highest existing number. If they don't match, the PRD has duplicate-numbered sections (例：TrainingLog issue #1 的 Body data section 用 #66-72 跟 Exercise / 詳情頁 #66-72 重複 — 152 nominal stories 對應 159 actual rows). **Don't try to fix the duplicate inside a sweep** — renumbering ripples through every cross-reference in 核心 ADR 對照 + may affect already-published implementation issues that cite story numbers. Instead: continue numbering from the nominal max（本次 sweep 補入時用 nominal max + 1），flag the bug explicitly in the memory update entry, leave the fix as a separate task.
- **Edit 既有 ADR 必須先 Read**: Claude Code's Edit tool refuses to edit a file that hasn't been Read in the current session — even if the file was implicitly inspected via Bash `tail`/`grep`. When batch-amending multiple ADRs (e.g., 4 downstream amendments triggered by a new ADR), the first parallel Edit attempts will ALL fail with `tool_use_error: File has not been read yet`. **Workaround**: send a parallel batch of `Read` calls (offset=1, limit=10 is enough to register) for each ADR file first, then send the parallel batch of `Edit` calls. Don't try `tail -1 | unique-anchor` heuristics as substitute — Read tool tracking is what Edit checks, not whether *you* know the file content.
- **PRD body too large to rewrite (114 KB) → use issue comment instead**: When PRD body exceeds reasonable in-place edit size, post an ADR-NNNN supplement as a `gh issue comment 1 --body-file /tmp/prd_addendum.md` instead of editing body. The supplement should include full 17-question rundown table + schema migration plan + 4 amendment summary + Out of Scope + slice estimate. **Trade-off**: harder to find in issue history (vs. body Update log), but avoids re-fetching + rewriting 114 KB. Verify integrity with `gh issue view 1 --json body --jq '.body' | wc -l` first — if line count > ~600 or KB > ~50, prefer comment approach. TrainingLog ADR-0017 sweep used this (comment 4442616662).

## Why this skill exists

Without the sweep:
- ADR + CONTEXT.md updated but PRD stale → reader of issue #1 sees outdated user stories / modules
- PRD updated but memory stale → next conversation's resume point doesn't reflect new ADR
- All updated but Update log missing → readers don't know which version they're looking at

The 4 locations together form the project's "current state of decisions". Drift between them = source of truth ambiguity.
