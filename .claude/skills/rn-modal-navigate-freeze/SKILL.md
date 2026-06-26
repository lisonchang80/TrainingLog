---
name: rn-modal-navigate-freeze
description: Fix the iOS "screen frozen / visible-but-untappable after a flow that closed a bottom-sheet and navigated" bug in TrainingLog. Trigger words — "一到 X 頁面就卡死", "畫面點不動", "卡死但重開有存", "modal 卡住新頁", "stuck modal overlay", "navigate while modal open", "RN modal freeze". Root cause is calling `router.push/replace` in the SAME tick as closing a RN `<Modal>` (the native modal floats above the pushed screen and swallows touches). Files — any `components/**/*-sheet.tsx` (the picker Modal) + its navigating parent (`src/components/history/MonthGridView.tsx`, `app/session/[id].tsx`, `app/(tabs)/index.tsx`).
---

# RN `<Modal>` → navigate freeze (iOS)

## Symptom

User reports a screen "卡死" right after a flow that **closed a bottom sheet and then
navigated**. Specifically:

- The new screen is **visible but every tap does nothing** (it is NOT a white/black
  crash, NOT a spinner). This is the diagnostic tell — ask the user "(a) 看得到但
  點不動 / (b) 空白 / (c) 一直轉" — answer (a) ⇒ this bug.
- Restarting the app shows the data **was actually saved** — i.e. the DB write +
  navigation both ran; only the UI is wedged.

## Root cause

React Native's `<Modal>` presents at the **window level — above the entire navigation
stack**. When you close a Modal (`visible → false`) and `router.push(...)` in the same
synchronous handler, the modal's native dismiss animation and the screen-push race; the
modal's transparent host view can stay mounted **over** the pushed screen and absorb all
touches. Validated 2026-06-26 (TrainingLog 補訓練).

**Two flavours seen:**

1. **Single modal + same-tick push** — `setSheetOpen(false); router.push(...)` in one
   handler.
2. **Double-modal flash** — a multi-step sheet (e.g. BackfillSheet renders
   StartTemplateSheet as a second `<Modal>`, toggled by `metaTemplate`). Clearing the
   intermediate state (`setMetaTemplate(null)`) **before** the async session-create
   finishes re-presents the first modal for the ~10–50 ms gap → a rapid present→dismiss
   that wedges the native modal. The flash is invisible but lethal.

## The fix — navigate from the Modal's `onDismiss`, not from the pick handler

Defer the navigation until the modal has **fully dismissed** (iOS `<Modal onDismiss>`
fires after the dismiss animation completes). Pattern:

**Sheet component** — forward an `onDismiss` to its `<Modal>` and expose an `onClosed`
prop; for nested modals, give EACH `<Modal>` an `onDismiss` that calls back:

```tsx
type Props = { visible: boolean; onPick: (p: Pick) => void; onClosed?: () => void; ... };

<Modal visible={visible} onDismiss={() => onClosed?.()} ...>...</Modal>
// nested second modal (if any):
<StartTemplateSheet visible={visible && meta != null}
  onDismiss={() => { setMeta(null); onClosed?.(); }}  // clear AFTER dismiss, not before
  ... />
```

**Parent** — the pick handler does the DB write, stashes the target in a ref, and
ONLY closes the sheet. `onClosed` (fired by the modal's onDismiss) does the navigate:

```tsx
const pendingNavRef = useRef<string | null>(null);
const onPick = useCallback(async (p) => {
  const id = await createThing(db, ...);   // DB write
  pendingNavRef.current = id;
  setSheetOpen(false);                      // close — do NOT navigate here
}, [db]);
const onClosed = useCallback(() => {
  const id = pendingNavRef.current;
  if (!id) return;                          // cancel / intermediate dismiss → no-op
  pendingNavRef.current = null;
  router.push(`/route/${id}`);              // safe — modal is fully gone
}, [router]);
// <Sheet onPick={onPick} onClosed={onClosed} ... />
```

`onClosed` fires on EVERY dismiss (incl. cancel + intermediate step transitions); the
`pendingNavRef` guard makes those no-ops, so only a real pick navigates. Whichever modal
was visible at close time fires its `onDismiss` → exactly one navigation.

**Double-modal flash fix:** in the step-2 handler, do NOT clear the intermediate state
early. Let the parent's `onPick → setSheetOpen(false)` drop BOTH modals' `visible` in one
batch (the first modal was already hidden because the second's state is set), so only the
currently-visible (second) modal dismisses. Clear the intermediate state in that modal's
`onDismiss`.

## Anti-patterns (don't)

- ❌ `setTimeout(() => router.push(...), 350)` — a timing guess. Validated 2026-06-26 it
  does NOT reliably fix the freeze (especially the double-modal flash, which the delay
  doesn't address at all). Use `onDismiss`, not a magic delay.
- ❌ `InteractionManager.runAfterInteractions(navigate)` — deprecated signature in current
  RN/TS, and it doesn't track the Modal's native dismiss, so it can fire too early.
- ❌ Navigating from inside the sheet component itself — the sheet shouldn't own routing;
  the parent does, gated on `onClosed`.

## Where this recurs

This Modal-heavy app navigates out of bottom sheets in several places. Any NEW
"sheet → create → open detail page" flow needs the `onClosed`/`onDismiss`-deferred
navigation. Grep for `router.push` / `router.replace` inside or right after a
`set*Sheet*(false)` / `setVisible(false)` call — that pair is the smell.
