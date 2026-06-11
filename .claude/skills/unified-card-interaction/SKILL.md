---
name: unified-card-interaction
description: How TrainingLog keeps the set/exercise-card UI consistent across the in-progress session, history-session-edit, and template-editor screens. Use when changing the drag-active highlight, card background, swipe-action colours, ✓ toggle, footer buttons, or any shared "exercise card with draggable set rows" appearance — so the change lands on ALL screens, not one. Trigger: 「統一外觀」「拖曳 active 樣式」「動作卡背景」「swipe 顏色」「改顏色/形狀多頁一併」, drag-active, card bg, swipe colour.
---

# Unified card interaction styling

Three screens render the SAME conceptual UI — an exercise card with draggable
set rows, swipe actions, a ✓ complete toggle, and footer buttons — and must look
identical. The reference look is the **in-progress session** (`app/(tabs)/index.tsx`).

## The 4 consumer files (keep this list current)

| File | Screen |
|---|---|
| `app/(tabs)/index.tsx` (`ExerciseCard`, inline) | 進行中 session — **REFERENCE** |
| `components/session/cluster-card.tsx` (`ClusterCard`) | superset 卡（session + 歷史共用）|
| `app/session/[id].tsx` (`EditableExerciseCard`, edit mode) | 歷史 session 編輯 |
| `components/template-editor/template-editor-view.tsx` | 模板編輯器 |

Set-row internals are ALREADY shared and must not be forked:
`components/shared/set-row-content.tsx`, `components/shared/swipeable-set-row.tsx`,
`components/shared/reorder-exercises-sheet.tsx`, `SetNoteSheet`, `NumericKeypad`.

## Single source of truth — `src/theme/cardStyles.ts`

Import via the theme barrel: `import { dragActiveRowStyle, interactiveCardBg, swipeActionColors } from '@/src/theme'`.

| Helper | Covers | Used as |
|---|---|---|
| `dragActiveRowStyle(tokens)` | **F. drag-active row** (long-press reorder highlight = surface + 1px `action.primary` border + shadow, the「藍框」look) | `<key>: dragActiveRowStyle(tokens)` inside each `makeStyles` |
| `interactiveCardBg(tokens)` | **A. card background** (collapsed + expanded) = `bg.elevated` | `backgroundColor: interactiveCardBg(tokens)` |
| `swipeActionColors(tokens)` | **H/I. swipe colours** `{remove, add, note}` = destructive / success / primary | `color: swipeActionColors(tokens).remove` etc. |

**To change the drag highlight / card bg / swipe colours app-wide: edit ONLY
`src/theme/cardStyles.ts`.** Every consumer picks it up.

## Canonical values for per-file-aligned parts (no helper — align to these)

These are simple token values; keep each file's layout but use these exact tokens
(theme tokens are themselves single-source, so colour changes still propagate):

- **J. ✓ toggle** — idle `backgroundColor: tokens.bg.surface`; done `tokens.action.success`; glyph `fontSize:16 fontWeight:'700' color: tokens.text.secondary`, done glyph `tokens.action.onPrimary`.
- **K. footer buttons** — primary `tokens.action.primary` (text `action.onPrimary`); secondary `tokens.bg.surface` (text `action.primary`); both `fontSize:14 fontWeight:'600' borderRadius:8`.
- **C. header** — gear `⚙️` `fontSize:18`; chevron `▼`(open)/`▶`(closed) `fontSize:14 color: tokens.text.tertiary`; long-press header → open `ReorderExercisesSheet` (`delayLongPress={400}`).
- **N. section label** — `fontSize:14 fontWeight:'600' color: tokens.text.secondary`.
- **O. empty-state text** — `fontSize:13 color: tokens.text.tertiary fontStyle:'italic'`.
- **L. cluster shared `#` button** (template) — use theme tokens, NOT hardcoded grays.

## Can / can't unify matrix

✅ **Unify (done / maintain):** A card bg, F drag-active, H/I swipe colours,
J ✓ toggle, K footer, C header, N section label, O empty text, L cluster `#`.

🚫 **Do NOT unify (functional difference — leave divergent):**
- **Progress / capacity bar** — templates have NO logging → no progress; they
  show a static `N熱+N組` summary instead. Session/history have a real
  `SegmentedProgressBar`. Correct to differ.
- **✓ logged concept** — templates define *planned* sets only; no ✓ at all.
- **Cluster structure** — template renders clusters *inline* (planned model);
  session/history use the `ClusterCard` component (live model). Different
  components + data models — unify only their visual tokens, never the structure.
- **Per-exercise notes** — history = read-only; template = editable; session = inline.
- **History-only chrome** — same-day ←/→ switcher, 「隱藏未打勾」switch, editing chip.
- **Template-only** — 建立並導入 flow, evergreen section, supersetTag.

## Recipe when asked to change a shared card appearance

1. Is it a colour/shape covered by a `cardStyles.ts` helper? → edit there, done.
2. Is it a per-file-aligned part (J/K/C/N/O/L)? → change the canonical value
   above, then apply the same token to all 4 consumer files (grep the style key).
3. Is it in the 🚫 list? → it's intentionally divergent; confirm with the user
   before touching.
4. Always `node_modules/.bin/tsc --noEmit && node_modules/.bin/jest --silent`
   then device-smoke all 3 screens (drag a set on each; verify identical look).
