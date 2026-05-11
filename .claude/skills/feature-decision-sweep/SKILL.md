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

## Why this skill exists

Without the sweep:
- ADR + CONTEXT.md updated but PRD stale → reader of issue #1 sees outdated user stories / modules
- PRD updated but memory stale → next conversation's resume point doesn't reflect new ADR
- All updated but Update log missing → readers don't know which version they're looking at

The 4 locations together form the project's "current state of decisions". Drift between them = source of truth ambiguity.
