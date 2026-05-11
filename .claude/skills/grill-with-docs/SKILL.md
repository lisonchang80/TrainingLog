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

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

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

### Post-grill: sweep PRD + memory if they exist

If a PRD has already been published (e.g., as issue #1) when this grill round adds a new ADR, the grill round is **not complete** when ADR + CONTEXT.md are updated — PRD body and user-level memory will drift. Use the `feature-decision-sweep` skill to handle the full 4-location update (ADR → CONTEXT.md → PRD body → memory).

This is project-specific to TrainingLog. For other projects without published PRDs, ADR + CONTEXT.md is sufficient.

</supporting-info>
