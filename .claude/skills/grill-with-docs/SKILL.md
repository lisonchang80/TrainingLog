---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Visualize on demand — ASCII before/after + comparison table

When the user prompts「視覺化」/「視覺化這段」/「draw it」/「show me」mid-grill, **don't fall back to bullet-list trade-offs** — they're asking for spatial reasoning. Render:

1. **Initial state** — ASCII art of the current UI / data structure
2. **After-state per option** — one ASCII art block per option showing what changes (highlight ★ / ⚠️ / ← arrows for transitions)
3. **Comparison table** — invariant count, code surface, edge-case behavior, alignment with prior ADR decisions
4. **Re-ask the same question** — repeat `AskUserQuestion` with the same options but updated descriptions reflecting the viz reveal

Why this matters: 視覺化 prompts repeatedly land at decision points where text-only options look symmetric but a diagram reveals which option is "1-tap mutates 4 rows" vs "0 rows". TrainingLog Round B Q1 (cluster root cycle): user picked A' (children DELETE + toast) over my plan's recommendation B (block + toast) ONLY after seeing the ASCII viz showed B was "2-tap 1 cluster" vs A' was "1-tap visible toast" — text trade-offs alone would have left B as the default.

**Diff structure** (the part that matters): each option's ASCII should show the **column / row that changes**. Don't redraw unchanged regions — focus reader attention on the delta.

**Anti-pattern**: pasting a generic "before/after" block then giving text-only trade-offs underneath. The viz is the trade-off; the table sharpens it; the bullet list is redundant.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Treat plan / audit recommendations as stale-by-default

When grilling against an implementation plan or design audit doc, **never accept a Q's recommendation without grepping the actual impl first**. Plans get written from snapshot-in-time audits; audits get written from grep at one point in time. Between then and your grill, commits land. The plan's recommendation may now contradict reality.

**Recipe per Q**:
1. Identify the impl surface the Q touches (file paths, function names, URL params, schema columns).
2. Grep / read those before drafting options.
3. If plan rec contradicts impl, surface the contradiction explicitly in your options table — "Plan推薦 X, code 已落定 Y" — and recommend Y.

Example (TrainingLog 2026-05-24 Round D, 4 Q):
- Q1: plan rec `targetSessionId=` URL param. Code in `app/session/[id].tsx:1850` already uses `sessionId=`. Rec翻盤 → A.
- Q2: plan rec「不 block dup RS in session」. Code in `sessionRepository.ts:381-395` has `throw 'duplicate RS in session'` + `library.tsx` picker UI dims used RS + Agent D test `.rejects.toThrow(/duplicate RS/i)`. Three-layer lock-in. Rec翻盤 → A.
- Q3: plan rec「tap RS 立刻 explode + router.back」per ADR-0019 Q7. Re-reading Q7: "tap RS card → 整 RS explode" describes data transformation, NOT UI timing. Existing `library.tsx` is multi-select uniform across solo + RS via `pickerBridge.reusableSupersetIds: string[]`. Rec翻盤 → A (keep multi-select).
- Q4: plan rec「auto-expand new card」. Code in `index.tsx:347-413` consumePick drain doesn't touch `setExpandedExerciseId`. Plan-aligned UX argument wins this one. Rec aligned → B.

**3 of 4 plan recs contradicted code.** Pattern: when the plan was authored before the current grill round, assume 50%+ of its recs need overturning. The grill exists to catch this drift before implementation locks it in.

### When user pins to existing pattern, scan that pattern's code BEFORE proposing options

If the user says "match X's pattern" / "reference X" / "X 怎麼做的就照辦" / "後續優先參考 X" — that's a meta-rule binding all subsequent answers. Aggressively grep / read X's code BEFORE answering the next question.

Wrong move: propose generic options that contradict the existing implementation. The user will keep correcting you until you do scan it. Each round of correction = wasted tokens + erodes user trust in your recommendations.

Example (TrainingLog 2026-05-16 slice 10c grill round Q16): user said「後續優先參考模板」 mid-grill. I should have grep'd template editor's cluster card pattern before proposing Q16 cluster row "read-only display + per-row ✓" — which contradicted template's "整 cycle row in one SwipeableSetRow + shared ✓". Cost: 2 round-trips of correction before the recommendation aligned with reality.

**Pattern**: when the meta-pin lands, immediately do a focused read of the referenced component (top-level structure, key handlers, gesture wiring), then base every subsequent option on what's actually there.

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

Don't couple `CONTEXT.md` to implementation details. Only include terms that are meaningful to domain experts.

### Ground schema notation in actual fields, not concepts

When writing a decision involving schema (e.g., progress chip formula, query predicates), use field names that **actually exist** in the schema. Don't use convenient placeholder notation like `planned_X × planned_Y` if the table only has one set of `X` + `Y` columns — even if "planned" reads conceptually clearer.

Sloppy notation looks fine at write time but **lies dormant** until a later grill round trips on it. Example (TrainingLog Q15): Q15.2 / Q15.4 wrote `Σ (planned_reps × planned_weight)` for the chip denominator while the `set` table only has one `reps`/`weight` pair. Two rounds later in Q15.5 the user asked "how would the chip ever exceed 100%?" and the whole grammar broke — the implicit "planned vs actual two-column model" was never the real schema. Cost: retroactive patch across multiple sub-questions + a schema-model clarification block.

**Rule:** before pasting a formula into a decision, scan the schema. If your formula references columns that don't exist, rewrite using real columns + filter predicates. The grill is the right time to catch this — later rounds will assume the formula is ground truth.

### Mark revisions explicitly when later rounds overturn earlier decisions

A long grill (Q15 was ~6 sub-rounds) will routinely revisit and reverse earlier decisions. When this happens, **don't silently delete the old wording** — readers of the doc need to see what changed.

Pattern:
- On the **old** decision: add an inline marker `（**Q15.X 修訂**：<summary>，見 Q15.X 段）` right in its bullet
- In the **new** decision section: add an explicit "翻盤的既有拍板" / "Reversed decisions" sub-bullet that lists each prior decision being overturned with `❌` / `⚠️` markers
- Don't try to keep old bullets pristine — they need to point forward to the revision

This protects against the reader picking up the doc mid-stream, reading an early `✅` decision, and not realising it's been superseded. Example pattern (TrainingLog): Q15.5 段 has a "翻盤的既有拍板" list with 4 ❌ items pointing back at Q15.1 / Q15.3 / Q15.4; meanwhile each of those original bullets has inline `（Q15.5 修訂：...）` marker.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

### Closing ritual — ledger writeback BEFORE grill ends (drift prevention)

The "Mark revisions" rule above protects against silent overwrites WITHIN the ADR. But the larger drift hazard is **verbal-only decisions that never make it into any document**. The 🔀 換動作 incident in TrainingLog slice 10c is the canonical case: user grilled and 砍 🔀 in mid-conversation, but nothing got written down → spec stayed at "重新加 🔀" → execution drifted → revert commit (4 files, -270 lines).

**The rule**: BEFORE announcing grill complete, run this 3-step closing ritual:

1. **Diff conversation vs existing ADR / ledger / spec**:
   - Scroll up. For every decision the user has made (especially anything containing 「砍」「廢」「不要」「翻盤」「改」「OK」 + a noun), check: is it already written in ADR amend or ledger?
   - For every "I'll just verify" / "let me think" moment that resolved into a decision: same check.

2. **List new decisions + revisions in a single message to the user**:
   - Format:
     ```
     本場 grill 新拍板 / 翻盤（將寫入 ADR ledger）：
     1. [topic]: [old → new]
     2. ...
     確認落筆？
     ```
   - Wait for explicit confirmation. Don't auto-write if user says "等一下" or asks a clarifying question.

3. **Write to BOTH ADR amend (narrative) AND ADR ledger table (greppable)**:
   - Amend section: prose explanation of the revision + reasoning + which old decisions are now superseded.
   - Ledger table (see "ADR ledger appendix format" below): one row per revision, machine-greppable, sorted by date DESC at top.
   - Update MEMORY hook line if the slice's "next step" / "current state" changed.

If grill ends without ritual, the next execution phase is guaranteed to drift. The `phase-precheck` skill catches structural drift (spec ≠ ADR), but it can't catch decisions that exist only in conversation.

### ADR ledger appendix format

Every ADR with ≥ 1 revision SHOULD have a "翻盤 ledger" section at the END (after all amend sections, before any "Out of scope" footer). Format:

```markdown
## 翻盤 ledger（greppable）

| 日期 | 翻盤項 | 原拍板 | 新拍板 | 觸發 | 關聯 commit |
|---|---|---|---|---|---|
| 2026-05-16 ultra-late | Q11 menu | 🔀 重新加 | 砍 🔀，走 🗑️+⊕ | user post-spec | 4b89d63 revert |
| 2026-05-15 | Q15.5 容量公式 | planned_X × planned_Y | Σ working/non-warmup | grill Q15.5 | n/a (pre-impl) |
```

Why this matters: `phase-precheck` skill's sub-agent's FIRST grep is for this ledger table. If a revision exists only in narrative amend text, sub-agent may miss it (long ADRs, mid-paragraph). Ledger table is the structured fallback. **Without ledger, drift catch rate drops from 90% → 70%**.

Rules for ledger entries:
- Add at TOP (newest first) so bottom-up readers hit fresh entries first.
- "原拍板" = the wording from the previous grill round / ADR section that's now overruled.
- "新拍板" = the current accepted decision in ≤15 chars.
- "觸發" = how the revision came about (grill round / spec-floor / user-post-impl / sub-agent-spec-drift / etc.).
- "關聯 commit" = if the revision triggered an impl change, list the commit SHA. If pre-impl, write `n/a (pre-impl)`. If reverted, list both the bad-impl AND the revert commit.

### Post-grill: sweep PRD + memory if they exist

If a PRD has already been published (e.g., as issue #1) when this grill round adds a new ADR, the grill round is **not complete** when ADR + CONTEXT.md are updated — PRD body and user-level memory will drift. Use the `feature-decision-sweep` skill to handle the full 4-location update (ADR → CONTEXT.md → PRD body → memory).

This is project-specific to TrainingLog. For other projects without published PRDs, ADR + CONTEXT.md is sufficient.

</supporting-info>
