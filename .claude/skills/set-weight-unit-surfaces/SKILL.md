---
name: set-weight-unit-surfaces
description: Map of EVERY surface that displays or enters a set's weight + which respect the kg/lb `unit` preference. Use when adding a unit-aware weight display/input, fixing "lb 模式 set 重量沒換算 / 存錯", touching weight rendering, or extending unit support (e.g. F1 assisted volume, template editor lb). Storage is ALWAYS kg; a new set-weight surface that forgets `unit` silently shows/stores kg = data-corruption bug (the F4 class). Touches src/domain/body/unitConversion.ts, components/shared/set-row-content.tsx, components/session/cluster-card.tsx, app/(tabs)/index.tsx, app/session/[id].tsx.
---

# Set-weight unit surfaces (kg ↔ lb)

Companion to `set-ordering-surfaces`. Same whack-a-mole shape: set weight is
displayed/entered in **many** independent surfaces. Storage is **always kg**
(canonical). Each surface must convert via the helpers below — miss one and an
lb user's weight is shown/stored as kg (silent corruption). This was the F4 bug
(2026-06-05): the unit toggle was honored by body/history/charts/PR but NOT by
the set logger → lb entry stored raw as kg, then history ×2.2'd it back.

## Convention (single source of truth)

`src/domain/body/unitConversion.ts` — storage kg, display/entry convert:
- `displayWeight(kg, unit)` → **editable cell / keypad value**. kg = exact
  identity (zero regression). lb = `kgToLb` rounded to 1 decimal (round-trip
  stable so a mid-edit field isn't clobbered). Returns a number; caller `String()`s it.
- `displayToKg(value, unit)` → entry (display unit) back to kg for storage (kg identity).
- `kgToDisplay(kg, unit)` / `formatWeight(kg, unit)` (`'NN.N unit'`) / `parseWeightInput(text, unit)` — pre-existing, used by the already-aware surfaces.
- `unit` = `UnitPreference` (`'kg' | 'lb'`) from `@/src/domain/body/types`; read via
  `getUnitPreference(db)` (`settingsRepository`), set via `setUnitPreference`.

**2026-07-02 — app-wide `UnitProvider` / `useUnit()` (`src/unit/UnitContext.tsx`).**
Unit is now a reactive context (mirrors `useAppMode` / `useTheme`, SQLite-backed,
mounted in `app/_layout.tsx` inside DatabaseProvider). Replaced the old "every
screen re-reads `getUnitPreference` into local `useState` on focus" model that
silently froze surfaces which forgot to re-read (template editor was kg-only;
session-detail read on mount only). **New unit surfaces should `const { unit } = useUnit()`** instead of a local read. Adopted: Settings (writes via `setUnit`
— persists + re-renders all), `app/session/[id].tsx`, and the template editor
(main component + `ExerciseBody` each call `useUnit()`, threading `unit` into all
4 `SetRowContent` sites — this REVERSED the deliberate kg-only design per user
request). Still on the focus-read model (Today `index.tsx`, `body.tsx`,
exercise-history/chart) — consistent because they read the same DB row the context
persists to; migrating them to `useUnit()` is the clean follow-up.

## Every surface (must thread `unit` to ALL of them)

### Shared leaf
- `components/shared/set-row-content.tsx` — `unit?: UnitPreference` prop (**default `'kg'` = zero regression for omitters**). Converts: inline `TextInput` (entry → `displayToKg`), `weightText` init + resync `useEffect` (dep on `set.weight` AND `unit`; compares in **kg space** so kg is exact-prior behavior), tap-cell display (`displayWeight`), and the unit **suffix** (`{unit}`, was hardcoded `kg`).
- `components/session/cluster-card.tsx` — `unit?` prop → passes to BOTH per-side `SetRowContent` (A + B).

### Today in-session — `app/(tabs)/index.tsx`
- `unit` state (`getUnitPreference` in load), passed to:
  - `ExerciseCard` sub-component (own prop) → `SetRowContent` ×2 (head + dropset follower)
  - `ClusterCard`
  - **NumericKeypad** (tap-number path): `initialValue` = `displayWeight(current, unit)` (kg→display) and `onConfirm` = `displayToKg(value, unit)` **— weight branch ONLY** (reps stays raw).

### Session detail + edit — `app/session/[id].tsx`
- `unit` state loaded in `load()`'s `Promise.all`. Threaded through BOTH modes:
  - **Read-only**: `formatSetCell(s, load_type, unit)` ← `ReadOnlySetRow` ← `SoloExerciseBlock`; and `ClusterBlock` (×2 `formatSetCell`). (`formatSetCell`: `BW × reps` unchanged for bodyweight; `displayWeight` + `{unit}` for loaded/assisted.)
  - **Edit**: `EditableExerciseCard` (own prop) → `SetRowContent` ×2 + `ClusterCard`; **NumericKeypad** same two-point conversion as Today (weight branch only; the rest-sec keypad is seconds — do NOT convert).

### Already unit-aware before F4 (don't re-wire, but know they exist)
`app/body.tsx`, `app/exercise-history/[id].tsx` (`formatPRWeight`/`formatVolume`), `app/exercise-chart/[id].tsx`, `app/(tabs)/index.tsx` PR chip (`formatPRDeltaValue`), `app/(tabs)/settings.tsx` (the kg/lb radio).

### Deliberately kg-only (out of scope — leave as default `'kg'`)
**Template editor** (`components/template-editor/template-editor-view.tsx` + its `set-row-content` renders) — templates are kg prescriptions; F4 scoped to *session* set weight. Revisit if/when template lb support is requested.

## Pitfalls (the ones that bite)

- **A new place that renders/enters a set weight MUST receive `unit`** or it silently falls back to kg display+storage — exactly the F4 corruption. Grep `<SetRowContent` / `<ClusterCard` / `formatSetCell(` / `NumericKeypad` after any set-UI change.
- **Keypad has TWO conversion points** (initialValue kg→display, onConfirm display→kg) and only on the **weight** field branch. Forgetting `initialValue` shows the kg number while entering lb; forgetting `onConfirm` stores lb raw.
- **set-row-content compares resync in kg space** (`displayToKg(local, unit) === set.weight`) — keeps kg exact and avoids lb float clobbering a mid-typed value.
- **lb rounds to 1 decimal on display only**; never round the stored kg (preserve round-trip). kg display is **never** rounded (would change `62.55` etc).
- Sub-components inside `index.tsx`/`session/[id].tsx` (`ExerciseCard`/`EditableExerciseCard`) are separate scopes — `unit` state lives in the screen component and must be passed down as a prop (tsc "Cannot find name 'unit'" = you're in a child scope).

## Related
- `set-ordering-surfaces` — same whack-a-mole pattern, for set sort/numbering.
- `dropset-chain-semantics` — set filtering/counting (orthogonal but same files).
- Shipped: F4 `a8d899d` (2026-06-05 grill). Deferred follow-on that will re-touch
  weight-derivation surfaces: F1 (assisted volume in SQL fast-path aggregates) —
  see `project_traininglog_audit_backlog_2026-06-05` memory.
