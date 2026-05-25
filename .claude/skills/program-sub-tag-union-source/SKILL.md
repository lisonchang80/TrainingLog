---
name: program-sub-tag-union-source
description: When a sheet / picker displays a program's intensity (sub_tag) chip list, the correct query is the UNION of (a) `listDistinctSubTagsByProgram` (templates classified under the program) and (b) `listProgramSubTags` (v022 persistent dictionary). Querying only one source silently drops labels. Use when adding a new picker / sheet that shows per-program sub_tags, or when a user reports "I typed intensity X but it's not showing in [sheet]".
---

# Program sub_tag dict — union the two sources

Any UI surface that renders "this program's intensity chips" MUST query both:

1. **`listDistinctSubTagsByProgram(db, program_id)`** — `templateRepository.ts`. Returns sub_tags currently classified on at least one template under this program. *Legacy / pre-v022 path*.

2. **`listProgramSubTags(db, program_id)`** — `programRepository.ts`. Returns the v022 `program_sub_tag` persistent dictionary — every sub_tag the user has ever introduced for this program via wizard / row-apply / template-meta confirm, **regardless of whether any template currently references it**.

Then dedupe + sort:

```ts
Promise.all([
  listDistinctSubTagsByProgram(db, programId),
  listProgramSubTags(db, programId),
]).then(([templateTags, dictionaryTags]) => {
  const merged = Array.from(new Set([...templateTags, ...dictionaryTags]));
  merged.sort((a, b) => a.localeCompare(b));
  setSubTags(merged);
});
```

## Why both — they're not redundant

`listDistinctSubTagsByProgram` = "currently used". `listProgramSubTags` = "ever known". They diverge in two common cases:

- **Wizard fresh creation**: user types Step 1 sub_tags `[GG-1, GG-2, GG-3, GG-4]` then completes wizard. Step 6's `recordProgramSubTag` loop writes all 4 into v022. But Step 3 picked templates only for `GG-1` (per cycle in Step 4 overrides), so `template.sub_tag` only has `GG-1`. `listDistinctSubTagsByProgram` returns `[GG-1]` — drops `GG-2/3/4`.

- **Row-apply ▶ then swap**: user applies `II-2` to a row via Programs tab, then later replaces with `II-1`. `listDistinctSubTagsByProgram` no longer returns `II-2` (no template references it). But the v022 dict still has it — user expects the chip to be available for re-pick. This is exactly the wave 16 bug that triggered v022's creation (see `docs/adr/0021-program-sub-tag-dictionary.md`).

## When to use

- Adding a new sheet / dropdown / picker that lists a program's intensity chips
- Reviewing existing sheet code when user reports "missing intensity chip"
- Code review of any `listDistinctSubTagsByProgram` usage — should ALWAYS be paired with `listProgramSubTags` (the lone usage is a smell)

## When NOT to use

- Listing sub_tags **without** a program scope (e.g., global "all sub_tags ever used"). Different query.
- Reading sub_tags for a specific template (just read `template.sub_tag` directly — it's the source of truth for that template's classification).

## Current call sites (as of 2026-05-22, wave 18g)

- ✅ `components/templates/start-template-sheet.tsx` — wave 16 round 15 polish baseline
- ✅ `components/session/template-meta-sheet.tsx` — wave 18g smoke commit `e32a016`
- ✅ `app/program-wizard/new.tsx` Step 4 自訂 confirm path — uses `recordProgramSubTag` for write, reads via `state.draft.sub_tags`
- ⚠️ Any future picker — apply this union pattern at write time

## Inverse direction — when WRITING

Any place that introduces a new sub_tag for a program (cell upsert, row-apply, column-apply override, wizard onConfirm) MUST also call `recordProgramSubTag(db, program_id, sub_tag)` so the v022 dict learns about it. The repository helpers (`upsertCell` / `applyTemplateToColumn` w/ `sub_tag_override` / `applyTagToRow`) all do this internally — wizard's onConfirm + onNext (Step 1 → Step 2 transition) do it explicitly via a loop.

If you find a write path that lands a sub_tag onto `template.sub_tag` or `program_cell.sub_tag` but DOESN'T call `recordProgramSubTag`, that's a bug — the chip will "disappear from the picker" the next time the user views the program (because `listDistinctSubTagsByProgram` only returns it until something replaces it).

## References

- ADR-0021: `docs/adr/0021-program-sub-tag-dictionary.md`
- v022 schema: `src/db/schema/v022_program_sub_tag.ts`
- Sheet fix commit: `e32a016` (template-meta-sheet union)
- Wizard inflight sync commit: `5ccc113` (Step 1 → Step 2 transition)
- Wizard Step 4 自訂 sync commit: `ee28997`
