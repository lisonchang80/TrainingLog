---
name: phase-precheck
description: Pre-Phase decision-drift audit. Spawns a fresh read-only sub-agent to grep ADR / spec / MEMORY for revisions / 翻盤 / 砍除 affecting the upcoming Phase, reports structural conflicts BEFORE any code lands. Trigger phrases - "phase precheck", "audit Phase N", "drift check", or auto-invoked at every Phase boundary by ship-slice. Files involved - docs/adr/*.md, /tmp/*-ship-spec-*.md, ~/.claude/projects/<slug>/memory/*.md.
---

# Phase precheck — decision-drift audit before Phase commits

## Why this exists

Multi-source decision state (grill conversation → spec doc → ADR amend → MEMORY hook) drifts. Executing from a stale source produces revert commits.

**Motivating case** (TrainingLog slice 10c Phase 4, 2026-05-16):
- Spec L45 wrote「10b 砍 🔄 後重新加 🔀」
- ADR-0019 amend wrote「slice 10b 砍除「🔄 換動作」, flow 改走 🗑️+⊕」
- MEMORY hook wrote「Q11 ⚙️ menu 4 項 含 🔀」
- User had verbally re-砍 🔀 post-spec but never updated any of the three
- Agent trusted the most-recent filename (spec @ 2026-05-16) → implemented 🔀 in commit `18ea66d`
- User caught drift → forced revert in commit `4b89d63` (4 files, -270 lines)

The fix is **structural**, not "remember harder": before any Phase ships commits, spawn a fresh sub-agent to surface contradictions.

## When to trigger

- **Auto** — at the start of every Phase commit batch in ship-slice
- **Explicit** — user types `/phase-precheck Phase N` or "audit Phase N decisions"
- **Defensive** — when about to implement anything written in spec L≥30 (anything not header/summary): re-precheck if last precheck was >1 Phase ago

NOT when:
- Trivial Phase (single file <50 lines) where decisions are obvious
- Right after another Phase precheck < 30 min ago (same Phase)
- Manual smoke test phase (no code lands)

## The standard sub-agent prompt template

Spawn via `Agent` tool with `subagent_type: "Explore"` (read-only, fast). Prompt verbatim:

```
You are a decision auditor for a multi-day grill-then-execute software project.

TASK: For the upcoming Phase, find every revision / 翻盤 / 砍除 affecting it.
Do NOT implement anything. Only read + report.

UPCOMING PHASE: [paste from current context — Phase number + 1-line description]

STEPS:
1. grep -rE "修訂|翻盤|砍除|廢案|revised|reversed|moot|去除|drop" docs/adr/*.md
   → Note every match line with file:line
2. Read the most relevant ADR file from start to END (don't skim middle).
   Pay extra attention to amend sections, ledger appendix, and the bottom 30%.
3. cat /tmp/<slice>-ship-spec-*.md (if exists) — but treat as ADVISORY only.
   Compare its claims about the upcoming Phase against ADR.
4. Read ~/.claude/projects/<slug>/memory/MEMORY.md hook line for this project.
5. Cross-reference: for each functional area the Phase touches, list each source's claim.

REPORT FORMAT (max 300 words):
✅ Consistent decisions (1 line each):
  - [topic]: [decision] (all sources agree)

❌ Conflicts (3 lines each):
  - [topic]
    Sources: ADR says "X" (path:line). Spec says "Y" (path:line). MEMORY says "Z".
    Recommendation: ADR wins by precedence (confidence: high/med/low). Reason: ...

⚠️ Suspicious silences (1 line each):
  - [topic]: spec mentions but ADR doesn't acknowledge — possible verbal-only drift

Output: just the report. No code, no implementation suggestions beyond
"which source wins". Under 300 words.
```

## Handling the audit report

After the sub-agent returns:

- **All ✅, no ❌ / ⚠️**: proceed with implementation. Note in commit message "phase-precheck clean".
- **Any ❌**: STOP. Surface each conflict to user with the recommendation. Wait for user pick. Do NOT pick the most recent filename — always prefer ADR by precedence.
- **Any ⚠️**: surface to user, ask "verbal-only update?" If yes → write to ledger before proceeding (per ADR ledger discipline). If no → assume spec's stance.

After resolution: append a brief ledger entry if any user-driven decision came out of the audit. Format:
```
| YYYY-MM-DD | [topic] | [old] | [new] | phase-precheck @ Phase N | (no commit yet) |
```

## Precedence rules

When multiple sources conflict, default ordering (high → low):
1. **ADR ledger table** (greppable, structured)
2. **ADR amend section** (latest dated subsection wins; read bottom-up)
3. **User-level MEMORY hook line** (frequent updates, freshest snapshot)
4. **Conversation transcript** (latest message; only if explicit ledger write happened)
5. **`/tmp/*-ship-spec-*.md`** (snapshot, may be stale — ADVISORY only)

If two #1-equal sources conflict (e.g. two ledger entries on same topic), the **later-dated entry wins** and the earlier should have a "superseded by" marker. If it doesn't, surface as ❌ and ask user.

## Anti-pattern

**「I'll just trust the spec, it's the most recent file」**:
This is the exact failure mode that produced the 🔀 drift. `/tmp/*-ship-spec-*.md` is a SNAPSHOT — written once, never auto-updated as decisions evolve. ADR is the living document. Re-read ADR with bottom-up bias before trusting any spec section beyond the table-of-contents area.

**「Precheck takes too long, skip」**:
A precheck is one Explore sub-agent call (≈ 5-15 sec wallclock). Compare to one revert commit (multi-file, 200+ lines deleted). Skipping precheck is negative-EV every single time it would have caught a drift.

**「No conflicts found, proceed」without reading the actual report**:
Some conflicts surface as ⚠️ suspicious silences (sub-agent can't 100% rule out a verbal-only revision). Read the report fully, including ⚠️ section, before declaring clean.

## Failure modes NOT caught (be honest with user)

phase-precheck attacks ~70% of drift. Remaining 30% requires complementary discipline:

- **Verbal-only decisions**: not written = not findable. → fix via `grill-with-docs` closing ritual (ledger writeback BEFORE grill ends).
- **Mid-flight preference change**: precheck ran at Phase start; you change mind mid-implementation. → unavoidable, user must speak up.
- **Implicit cross-ADR impact**: e.g. ADR-0019 砍 🔀 also makes ADR-0014 sibling propagation moot. Sub-agent can't deduce. → discipline of ALWAYS noting "this revision also affects [other ADR]".
- **Semantic equivalence**: spec uses "swap" and "替換" interchangeably; agent doesn't link them. → discipline at write-time to use the canonical term.

If precheck reports clean but reality drifts anyway, the failure mode is almost always one of the above four. Diagnose which class before re-running precheck.
