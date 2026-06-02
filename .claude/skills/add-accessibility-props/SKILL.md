---
name: add-accessibility-props
description: Add VoiceOver / Dynamic-Type accessibility props to TrainingLog RN components (bottom sheets, modals, SVG charts, icon buttons). Trigger phrases - "a11y", "accessibility", "VoiceOver", "報告 07 a11y", "label the charts/sheets". Covers the `button.a11y*` i18n namespace, accessibilityViewIsModal on sheets, accessibilityRole="image" wrap on charts, what NOT to wrap, and the tsc+jest → VoiceOver-smoke gate. Validated 2026-06-02 (6 sheets + 5 charts, branch chore/a11y-sheets-charts).
---

# Add accessibility props (TrainingLog)

When you're improving VoiceOver / Dynamic-Type support — typically working
through `/tmp/overnight-reports-*/07-accessibility.md` items — this is the
recipe. The wins cluster in **shared components** so most fixes are
fix-once.

These additions are **purely additive props** — they change the
accessibility tree, never rendered pixels / layout / behaviour. That makes
them tsc+jest-provable but NOT jest-render-provable; confidence comes from a
VoiceOver device pass (see "Verify + gate").

## i18n: where a11y labels live

Accessibility labels are i18n strings under the **`button` namespace** as
`a11y*` keys in `src/i18n/strings.ts` (e.g. `a11yExerciseSettings`,
`a11yOpenNote`, `a11yHrZoneChart`). Call site: `t('button', 'a11y…')`.

- The `strings` tree is **type-locked** — every key MUST exist in **both**
  `zh` and `en` blocks or `tsc` fails. Add to both.
- A label-less prop (`accessibilityRole`, `accessibilityViewIsModal`) needs
  NO new key — only `accessibilityLabel` does.

## Sheets / modals recipe

Every in-session sheet follows the same chrome: a backdrop `Pressable` →
inner content `Pressable`/`View` (`styles.sheet` / `styles.card`) → text
`[取消]/[完成]/[儲存]/[跳過]` `Pressable`s.

1. `accessibilityViewIsModal` on the **inner content** View/Pressable (the
   one that swallows touches), **NOT the backdrop** — traps VoiceOver focus
   so it can't swipe into the dimmed screen behind.
2. `accessibilityRole="button"` on each cancel / confirm / skip `Pressable`
   (they already carry child `<Text>` so the label is read).

Sheets covered 2026-06-02 (report 07 item 3): `set-note-sheet`,
`reorder-exercises-sheet`, `rest-timer-modal`, `body-data-sheet`,
`template-meta-sheet`, `session-time-editor-sheet`. (Native `pageSheet`
modals trap focus already, but adding the prop is harmless + consistent.)

## SVG charts recipe

Charts are `accessibility:0` by default — a blind user gets nothing (or raw
axis numbers). Make the whole chart **one labeled image**:

- Add `accessible accessibilityRole="image" accessibilityLabel={t('button','a11y…Chart')}`
  to the chart's **existing outermost container View** — do NOT introduce a
  new wrapping View (that risks a layout shift). `accessible` collapses the
  SVG subtree into one element, which is exactly right for a static chart.

Charts wrapped 2026-06-02: `hr-zone-chart`, `mini-bar-chart`,
`body-trend-chart`, `body-heatmap` (the exported `BodyHeatmap` row View),
`app/exercise-chart/[id].tsx` (the inner `LineChart` `<View>` only).

### ⚠️ Do NOT wrap a multi-control container as one image

`components/stats-panel.tsx` is the Stats sub-tab **container** (period
selector + heatmap + N `MiniBarChart`s + headings). Wrapping it in
`accessible` would collapse all its buttons into one element and destroy
navigation. **Wrap the chart children instead** — once `MiniBarChart` and
`BodyHeatmap` are labeled, the panel's a11y comes for free. Same rule for
`exercise-chart`: wrap only the `LineChart` `<View>`, leaving the screen's
filter chips individually focusable.

## Verify + gate

- `npx tsc --noEmit` (catches missing i18n key / bad prop) + `npx jest`
  (regression; a11y props have no jest-testable surface in this repo).
- Ignore the IDE's phantom "Cannot find name expect/describe / Cannot find
  module" diagnostics from a symlinked `node_modules` — `tsc` exit 0 is
  authoritative.
- **Final confidence = VoiceOver on device** (turn it on, swipe through the
  sheet/chart, confirm focus trap + announced labels). Cannot be done from
  here — hand back for a quick VoiceOver pass.

## Workflow placement (don't disturb in-progress smoke / main)

- Work in a **worktree off `main`**, not the main checkout — the user may be
  running Metro + device smoke against the main worktree; switching its
  branch would swap files under their session.
- The a11y branch is independently `--ff-only`-mergeable off main, BUT
  **do NOT merge it to main yourself while other device-gated branches are
  still based on main's current tip** — advancing main makes those siblings
  no longer descendants of main and breaks their `--ff-only` (they'd need a
  rebase). Leave it pushed; let the user sequence/rebase the merge queue.

## Remaining backlog (report 07 deferred, NOT yet done)

These were deferred 2026-06-02 because they touch the frozen big-screen
smoke surface or need deeper work:

- 🔴 `set-row-content.tsx` label the 4 button types (weight / reps /
  label-cycle / dropset ±) — powers every set row.
- 🔴 `numeric-keypad.tsx` key role+label + `accessibilityViewIsModal`.
- 🔴 `swipeable-set-row.tsx` expose delete/add via `accessibilityActions`
  (swipe-only actions are VoiceOver-invisible).
- 🟡 touch targets < 44pt (dropset ± are 22×22; bump `hitSlop`).
- 🟡 `muscle-body-tagger.tsx` interactive SVG needs a checkbox/list fallback.
- 🟢 Dynamic Type (`allowFontScaling` is 0 everywhere; fixed heights clip).
- 🟢 `accessibilityHint` on destructive actions.
