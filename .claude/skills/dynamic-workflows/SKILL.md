---
name: dynamic-workflows
description: Author + run deterministic multi-agent Workflow-tool scripts on TrainingLog (the in-loop pipeline/parallel/loop orchestrator, distinct from fire-and-forget overnight-parallel-agents). Triggers — "寫 workflow", "dynamic workflow", "跑 pre-ship-gate", "workflow 評估", "fan out agents 確定性編排", or any Workflow tool authoring. Owns `.claude/workflows/*.js` (esp. `pre-ship-gate.js`). Validated 2026-05-30 (assess-workflow-fit + pre-ship-gate, both ran clean first try).
---

# Dynamic workflows on TrainingLog

The Workflow tool = deterministic JS orchestration of subagents (pipeline/parallel/loop + adversarial-verify/judge-panel/loop-until-dry). It runs **in-loop** — results return to the orchestrator between phases. This is DIFFERENT from `overnight-parallel-agents` (fire-and-forget background agents in worktrees, human integrates next morning).

## When to use Workflow vs overnight-parallel-agents (decided 2026-05-30)

Reach for the **Workflow tool** when work is **convergent + gated** (a result must feed the next decision, or a quality bar must be PROVEN before ship):
- pre-ship verification on a consolidated branch (the one structural blind spot overnight has — nobody checks cross-agent integration edges)
- doc/ADR drift where loop-until-dry re-audit ELIMINATES drift (vs overnight's static LIST)
- adversarial dead-code proof (skeptics must REFUTE each removal)
- flake hunting (in-loop runInBand+seeded permutations before the human sees a result)

Stay on **overnight-parallel-agents** when work is **file-disjoint bulk fan-out** whose only payoff is wall-clock sleep time: coverage waves, theme/i18n/dead-code sweeps. Conflicts are PREVENTED by allow-list protocol, not resolved by a loop.

**They compose**: overnight produces breadth while you sleep → run a Workflow `pre-ship-gate` the next morning on the stacked branch BEFORE pushing to main. Do NOT replace working overnight sweeps with Workflow pipelines (trades throughput for orchestration overhead, no quality gain).

## The shipped workflows

### `pre-ship-gate.js` — consolidated-branch certification
Run AFTER cherry-picking parallel/overnight branches into local main (or a staging branch), BEFORE pushing. Phases: **Checks** (1 agent: tsc + jest + lint + changed-file inventory) → **Skeptics** (5 parallel Explore agents: sqlite-migration / pure-logic / i18n / rn-layout / cross-agent, each only flags a `blocker` if it can prove main would break) → **Attest** (readyToLand bool + blockers/warnings + summary). Invoke:
```
Workflow({ name: "pre-ship-gate" })                       // base defaults to origin/main
Workflow({ name: "pre-ship-gate", args: { base: "<ref>" } })
```
Green → push; red → fix `blockers[]`. It does MORE than manual tsc+jest: runs `expo lint`, 5 adversarial lenses, cross-agent integration check, and emits a reusable attestation. Validated 2026-05-30 on the round-3 stacked branch (9 files) — caught a stale doc-comment as a non-blocking warning, certified green, pushed.

### assess pattern (Understand→Synthesize)
For "evaluate X" research: `parallel(surveyors with agentType:'Explore' + schema)` → barrier → `agent(synthesize over JSON.stringify(surveys))`. Used 2026-05-30 to evaluate workflow-fit across 7 facets.

## Authoring gotchas (validated)

- **`meta` must be a PURE literal** — no variables/spreads/calls. `phases[].title` must match `phase()` calls.
- **Force structured output with `schema`** (JSON Schema, `additionalProperties:false`) — agent returns the validated object, no parsing. Synthesis reads `JSON.stringify(surveys)` cleanly.
- **`agentType: 'Explore'`** for read-only surveyors/skeptics (composes with schema). Default agent for synthesis.
- **`pipeline()` by default; `parallel()` only when a barrier is genuinely needed** (synthesis needs ALL surveys → barrier is correct there).
- **No `Date.now()` / `Math.random()` / argless `new Date()`** in scripts (they throw). Stamp after return, or vary by index.
- **Reading a truncated result**: the task-completion notification truncates long results. The FULL result JSON is at `/private/tmp/.../tasks/<taskId>.output` — Read that file (it's the structured return, ~10-15KB, safe; NOT the agent JSONL transcript).
- **Iterate without resending**: every run persists its script; re-invoke with `{scriptPath, resumeFromRunId}` — unchanged `agent()` calls return cached results.
- **Concurrent jest across workflow agents** is safe now that the db cross-suite flake is fixed (commit 94a7bc9); the FIND/Checks agent runs jest once, skeptics are grep/read-only.

## Anti-pattern
- ❌ Using a Workflow for routine i18n/coverage bulk sweeps — overnight is faster + simpler there.
- ❌ Pushing before the gate is green — the whole point is gate-then-push.
