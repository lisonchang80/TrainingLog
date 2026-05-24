---
name: parallel-agent-spawn
description: Same-day parallel agent spawn — diff-check before merge + hybrid cherry-pick salvage when isolation worktree lands on stale base. For overnight workflows see overnight-parallel-agents (which already covers prevention rules in item #23). Use when you call Agent tool with isolation:"worktree" AND plan to merge agent branches back interactively.
---

# Parallel Agent Spawn — same-day diff verification + salvage recipe

`overnight-parallel-agents` already documents prevention rules for `isolation: "worktree"` base mismatch (item #23: BASE BRANCH CHECK prompt template, forbidden-action list, alternative explicit-worktree approach). This skill covers what overnight doesn't:

1. **post-completion diff verification** — same-day workflows are interactive, you SEE the merge collision before it happens; check the diff BEFORE merging
2. **hybrid cherry-pick salvage recipe** — when prevention failed and direct merge would revert real work, this is the recovery path

Validated 2026-05-24 on TrainingLog (Card 10R + Slice 10g parallel salvage, ~1 hr recovery cost, ~80% of agent work salvaged vs. discarding everything).

## Step 1 — verify diff before merging agent branches

Agents self-report success based on their local tests passing. They cannot know whether their branch is on the right base relative to YOUR current tip. Always verify:

```bash
# How big is the diff really?
git diff --stat <current-branch> <agent-branch> | tail -3

# What's the actual merge-base?
git merge-base <current-branch> <agent-branch>

# Commits ahead / behind
git log <current-branch>..<agent-branch> --oneline | wc -l    # ahead
git log <agent-branch>..<current-branch> --oneline | wc -l    # behind
```

Red flags:
- `--stat` shows thousands of lines deleted you didn't expect → agent worked off stale base, will revert other people's work on merge
- merge-base SHA is far older than your branch tip → confirmed stale base
- "commits behind" > 50 → agent missed major recent work, manual review needed

Validated example: Agent A diff against current tip was `315 files / +12965 / -52461` — direct merge would have reverted 50k lines of i18n + slice 10b/10c work.

## Step 2 — categorize agent changes for salvage

For each agent branch, compute its own intent diff (against ITS base, not yours):

```bash
git diff --stat <agent-base> <agent-tip>
```

Sort the changed files into two buckets:

- **Pure new files** (don't exist on current tip yet) → almost always salvageable via direct extraction
- **Modifications to existing files** → almost always need manual redo against current state (agent's patch context won't match)

Check existence:
```bash
for f in <list-of-files>; do
  [ -f "$f" ] && echo "exists: $f" || echo "new:    $f"
done
```

## Step 3 — extract new files in bulk

```bash
mkdir -p <new-parent-dirs>
git show '<agent-branch>:<path>' > <path>
# repeat per file; ok in one batch command
```

Then verify imports compile:
```bash
npx tsc --noEmit
```

Common drift: agent created a helper that imports something using a name the codebase doesn't have (e.g., `listSessionExercises` vs actual `listSessionExercisesWithName`). Fix surface only — don't redesign.

## Step 4 — defer tests whose impl isn't landed yet

Tests for unland impl will fail pre-commit hook. Move them aside:

```bash
mkdir -p /tmp/deferred-tests
mv tests/x.test.ts /tmp/deferred-tests/
```

Restore each test in the SAME commit as the impl it tests. This keeps every commit green.

## Step 5 — manual redo each existing-file modification

Don't try to apply the agent's patch directly — context won't match. Instead:

1. Read agent's diff for **intent** only — but use the focused diff against the agent's OWN parent, not against your current tip:

   ```bash
   # Focused: shows ONLY the semantic change the agent made.
   git diff <agent-commit>^..<agent-commit> -- <path> > /tmp/intent.patch

   # Misleading: includes every change the trunk made between merge-base and tip.
   git diff HEAD..<agent-commit> -- <path>
   ```

   Real case (TrainingLog 2026-05-24, Slice 10g Phase 4 big): agent commit was 295/-153 LOC against its parent — readable in one pass. The same commit against current tip was 525/-2668 because the trunk had advanced ~100 commits since the agent's parent. The 525/-2668 diff would have looked like "this commit deletes Card 12R + Card 10R + body row" which is just trunk drift, not agent intent.

2. Read CURRENT file to understand current structure
3. Write your own edit against current state, reusing the extracted new files as building blocks (helpers, components, etc.)
4. Commit logical unit, let pre-commit hook gate (tsc + jest)

## Step 6 — communicate salvage status before next steps

After salvage commits land, tell user:
- Which commits are agent-derived (cherry-pick)
- Which commits are manual redo
- Which agent items couldn't be salvaged and need separate scheduling
- What's still pending vs the original ADR/spec

Optional: delete the original agent branches once salvage is verified clean. (Or keep as archive for ~1 week.)

## When NOT to salvage — discard threshold

If `git diff --stat` shows the agent's changes are mostly modifications to evolved files (not new files), salvage often costs more than redoing from scratch. Threshold: if salvage requires >50% manual redo or the agent's new files import multiple drifted APIs, just discard the agent branch and treat the agent's output as design notes.

## References

- `.claude/skills/overnight-parallel-agents/SKILL.md` — prevention rules (item #23 base-check prompt template, item #24 broad-search collision pattern)
- TrainingLog 2026-05-24 incident: Card 10R agent A + Slice 10g agent B salvaged via this recipe; salvage commits `61f0d79..16d043a` recovered 14 of 17 cherry-picks + 6 manual-redo commits. Phase 4 big (index.tsx idle 3-section, the largest existing-file modification, deferred) was completed same day in a separate session as commit `973c50a`, using the Step 5 focused-diff technique above — agent's 295/-153 LOC intent was ported manually in ~15 min vs the original 40-60 min estimate.
