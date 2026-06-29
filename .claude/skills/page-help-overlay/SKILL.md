---
name: page-help-overlay
description: Add a right-corner ⓘ help button to a difficult TrainingLog page that opens either a 說明視窗 (InfoModal — screenshot + text, for "how to read this") or a 引導遮罩 (CoachMarkOverlay — spotlight tour, for "what hidden gestures live here"). Covers the decision rubric (info vs coach), the shared `components/help/` infra contract, per-page wiring, the screenshot capture/refresh pipeline, and the 3-subagent parallel fan-out (help-content-author → help-overlay-wirer → help-reviewer). Trigger words: 說明 icon / 說明視窗 / 引導遮罩 / coach mark / help overlay / onboarding tooltip / 頁面說明.
---

# Page help overlay — TrainingLog

Add per-page help that a user opens from a ⓘ button in the page's top-right.
Two styles, one shared infra layer (`components/help/`), and a parallel
fan-out for rolling it across many pages.

## Decision rubric — 說明視窗 vs 引導遮罩

One line: **要「解讀畫面」用說明視窗；要「教操作」用引導遮罩。**

| | `style: 'info'` 說明視窗 | `style: 'coach'` 引導遮罩 |
|---|---|---|
| Pain it solves | interpretation ("what am I looking at / how is this number computed") | discoverability of interaction ("what hidden gestures, what multi-step flow") |
| Form | one static modal: screenshot(s) + text sections | spotlight tour: highlight one element per step + arrow + caption |
| Pick when | charts, legends, data definitions, rules | hidden gestures (long-press / swipe / drag), wizards, dense interaction |
| `style: 'mixed'` | both — InfoModal first, with a「操作教學」button that hands off to the tour |

## Design constraints (2026-06-29 user feedback — these OVERRIDE the defaults)

The Today pilot was reviewed on device and the direction sharpened. Apply these
to every page from now on:

1. **Coach-first; drop text-only explanation for operations pages.** If the page
   is about *doing* (start a workout, edit a template, run a wizard), use
   `'coach'` — NOT `'mixed'`/`'info'`. Reserve `'info'`/`'mixed'` for pages whose
   difficulty is purely *interpretation with nothing to tap* (a chart's legend, a
   heatmap's colours, a number's formula). When in doubt → `'coach'`.
2. **Every caption ≤ 2 lines.** Achieve it by writing short copy, NOT by
   `numberOfLines` truncation (that clips and fights the en-layout rule). Title is
   one short phrase; body is one short sentence, two at the very most.
3. **Explain only the current state; split per mode into separate files.** Don't
   describe other modes the user isn't in. The Today pilot is the precedent:
   `content/today-plan.ts` (計劃模式, 3 steps incl. `today.planPanel`) and
   `content/today-minimal.ts` (極簡模式, 2 steps, no 計劃 concept) are separate
   files; the page picks one via `usePageHelp(isMinimal ? 'today-minimal' :
   'today-plan', isMinimal ? todayMinimalHelp : todayPlanHelp, …)` — a distinct
   `pageId` per mode so each auto-shows once independently. Any page with a
   mode/variant that changes what's on screen follows this.
4. **Number steps only for real procedures.** Set `coachNumbered: true` on the
   `PageHelpContent` ONLY when the steps are an ordered 1→2→3 flow (program
   wizard, superset builder). Parallel/alternative targets (Today's three start
   methods) stay unnumbered — the dots already show progress.
5. **The overlay's look is infra-fixed — do NOT restyle it.** `CoachMarkOverlay`
   already implements: theme-aware scrim (darker in dark mode), a fixed
   near-black caption bubble with white text in BOTH modes (黑底白字), and NO
   arrow (the rounded ring + bubble point at the target). Content/wirer agents
   CONSUME this; they never touch `components/help/*`. If a page needs a new look,
   STOP and report — the integrator changes infra in one place.
6. **Coach can't show the flow → fall back to a screenshot+text flow diagram.**
   When a procedure genuinely can't be conveyed by the spotlight tour — a gesture
   the ring can't highlight (mid-drag, swipe, long-press), or a sequence that
   spans screens/states the overlay can't hold — use an `info` (or `mixed`)
   diagram instead of forcing it into coach steps: an ordered set of screenshots,
   one per step, in `images[]`. **Each image's caption ≤ 2 lines** (same rule as
   captions; write short, don't truncate). Number the steps in the caption text
   (`1.` / `2.` …) since it's a real procedure. This is the one case that still
   needs screenshots on an otherwise coach-led app — capture per the pipeline
   below.

Page recommendations (2026-06-29 survey, by line count / complexity):

| Page | Recommend |
|---|---|
| `app/(tabs)/index.tsx` 訓練/今日 | mixed (idle 概念=info, in-session 手勢=coach) |
| `components/template-editor/*` (`template/[id]` is a thin wrapper) | coach |
| `app/session/[id].tsx` 詳情/編輯 | coach |
| `app/program-wizard/new.tsx` | coach |
| `app/superset/new.tsx` | coach |
| `app/exercise-chart/[id].tsx` | info |
| `app/exercise-history/[id].tsx` | info (+chip coach optional) |
| `app/(tabs)/library.tsx` | mixed |
| `app/(tabs)/programs.tsx` | mixed |
| `app/(tabs)/history.tsx` | info |
| `components/body-heatmap.tsx` legend | info |
| `app/exercise/[id].tsx`, `app/body.tsx` | info |
| settings / small `[id]` pages | usually none |

## Third style — `coach-interactive` (互動引導 / Interactive walkthrough) — PLANNED, infra NOT built

A third style proposed 2026-06-29. It differs from the two shipped styles by ONE
axis: **the user actually performs each step**, instead of watching.

| Style | Interactivity | One line | Infra |
|---|---|---|---|
| `coach` (引導遮罩 / Coach marks) | **passive** | Ring + caption on an element; tap anywhere to advance; the element is NOT operated | ✅ built |
| `info` + `images[]` (截圖流程圖 / Onboarding carousel) | none | Static screenshots, one per step, read straight through | ✅ built |
| `coach-interactive` (互動引導 / Interactive walkthrough) | **active** | The mask has a REAL hole; the user taps the live control THROUGH it and the tour advances only when the real action completes — walking the whole creation flow | ❌ not built |

### Root cause — why `coach` can't just be upgraded in place

Read `CoachMarkOverlay.tsx` (verified 2026-06-29). Three hard-wired behaviours
block interactivity:

1. The whole screen is one full-screen `<Pressable onPress={next}>` (`:129-131`)
   → a tap anywhere = "next"; touches never reach the real button beneath.
2. The hole is visual-only — four scrim rects + a `pointerEvents="none"` ring
   (`:132-160`). The source says so: `:107` "visual only — the Modal intercepts
   touches".
3. Advance = tap the dim area → `next()` (`:99-102`); it never listens for "the
   user actually did the action".

### 可/不可 table

| Capability | Now | Root cause | To build it |
|---|---|---|---|
| Highlight an element + caption (passive) | ✅ | full-screen Pressable + scrim + ring | — |
| Let the user really tap the control UNDER the hole | ❌ | `<Modal>`'s full-screen Pressable intercepts; hole is cosmetic | drop `<Modal>`; render as a root portal with `pointerEvents="box-none"`; each scrim rect `auto`; leave the hole empty so touches pass through |
| Advance only when the step's real action completes (event-driven) | ❌ | advance = tap-anywhere → `next()` | overlay subscribes to app-state events (row added / navigation succeeded) to advance, not its own `onPress` |
| Walk a creation flow ACROSS screens | ❌ | each step measures one `targetId`; the tour doesn't follow navigation | lift tour state above navigation; survive across screens |

**Verdict**: a NEW overlay variant (≈ `react-native-copilot` / `rn-tourguide`
tap-through tour). It can REUSE the existing `measure`/Provider/scrim maths, but
the Modal-intercept model and the advance model must be rewritten — ~1 isolated
infra commit, medium risk, must device-verify touch pass-through. **Status:
documented backlog, infra NOT implemented.** Schedule the infra BEFORE rolling
this style onto any page; until then `coach-interactive` is NOT a selectable
`HelpStyle` (content authors must not emit it — `tsc` would reject it anyway).

### Which pages / features suit `coach-interactive`

Criterion: the page has a **sequential build/setup flow** worth hand-holding the
user through ONCE, doing it for real. Parallel choices (no order), pure
interpretation (charts), and one-off single gestures do NOT qualify.

| Page / feature | Fit | Why | Fallback (until infra exists) |
|---|---|---|---|
| 課表精靈 `app/program-wizard/new.tsx` | ⭐⭐⭐ best | already a multi-step wizard; strong order; first run is where users stall | 截圖流程圖 |
| 超級組建立 `app/superset/new.tsx` | ⭐⭐⭐ | pick exercises → order → save; sequential creation | 截圖流程圖 |
| 模板編輯器 `components/template-editor/*` | ⭐⭐ | add exercise → add sets → (form cluster / superset) → save; flow is freer, not strictly linear | passive `coach` + 截圖 |
| Today first in-session logging (打勾完成 / 左滑刪除 / 右滑加組·備註 / 長按拖曳排序) | ⭐⭐ | real gestures the ring can't show; you only learn them by doing — but it's *logging*, not *creating*. (Gestures verified against `cluster-card.tsx` + `SwipeableSetRow` 2026-06-29 — NOT the earlier guess of 長按=遞減 / 左滑=投影; 投影 is a ⋯-menu item.) | 截圖流程圖 (constraint #6). ⚠️ **DO NOT host the help here as a plain `<Modal>` (InfoModal/coach).** The in-session view (`(tabs)/index.tsx`) is a rapidly-re-rendering, Modal-heavy mega-component whose branch UNMOUNTS on a **Watch-led session end**. A help Modal left open across that unmount leaves a stuck full-screen overlay → page "無法動" (hit 2026-06-29, in-session help reverted). Re-add only via an always-mounted host outside the idle/in-session branch split, or close the help synchronously in every session-end path first. `content/today-session.ts` is kept (orphaned) for that future re-add. |
| First-run 身體數據 / 備份設定 | ⭐ | short setup flow; optional | `info`, or no help |

Stay on their current style (do NOT force interactive):
- Today idle three entry points (計劃 / 模板 / 空白) = **parallel choices**, not a
  sequence → keep passive `coach`, unnumbered.
- exercise-chart / exercise-history / history / body-heatmap / 動作詳情 = pure
  interpretation → `info`.

## Shared infra contract (already built — do NOT rebuild)

Everything is under `components/help/` and exported from `components/help/index.ts`:

- `HelpButton` — the ⓘ. `<HelpButton onPress={help.open} />`. SF Symbol
  `info.circle`, 44pt tap target, theme-tokened. a11y label = `t('help','button')`.
- `usePageHelp(pageId, localized, { autoShowOnce? })` → `PageHelpHandle`
  `{ content, visible, open, close }`. Resolves `localized[locale]` via
  `useLocale()` (re-renders on language switch); with `autoShowOnce` it opens
  once on first visit and persists `help_seen:<pageId>` in `app_settings`.
- `PageHelpHost` — `<PageHelpHost help={help} />` renders the correct overlay
  for `content.style`.
- `CoachMarkProvider` + `useCoachMarkTarget(id)` — only for coach/mixed pages.
  Wrap the page in `<CoachMarkProvider>`; tag each highlighted element:
  `const tgt = useCoachMarkTarget('today.checkmark'); <View ref={tgt.ref}>`.
- Content types in `components/help/types.ts`; pure caption-placement maths in
  `coachMarkLayout.ts` (unit-tested in `tests/help/`).
- i18n chrome lives in `strings.ts` namespace `help` (`button`/`gotIt`/`startTour`);
  coach controls reuse `common.back/next/skip/done`. Page CONTENT is NOT in
  `strings.ts` — see below.

## Per-page wiring recipe

1. **Author content** → `components/help/content/<pageId>.ts` exporting a
   `LocalizedPageHelp` (`{ zh, en }`, same `style` on both). Copy the shape from
   `components/help/content/_example.ts`. Page content stays OUT of the 106 KB
   `src/i18n/strings.ts` (type-locked, and a merge-collision hotspot for parallel
   agents — see overnight-parallel-agents #17/#18). Each page owns its own file.
2. **Import + hook** in the page:
   ```tsx
   import { HelpButton, PageHelpHost, usePageHelp, CoachMarkProvider, useCoachMarkTarget } from '@/components/help';
   import { todayHelp } from '@/components/help/content/today';
   const help = usePageHelp('today', todayHelp, { autoShowOnce: true });
   ```
3. **Place the ⓘ** in the existing header / `Stack.Screen` `headerRight`, or
   absolutely over a custom header: `<HelpButton onPress={help.open} />`.
4. **Drop the host** at the page root: `<PageHelpHost help={help} />`.
5. **(coach/mixed only)** the page must be a DESCENDANT of `<CoachMarkProvider>`
   so its in-component `useCoachMarkTarget` hooks see the context. A context
   consumer can't sit beside its own provider, so DON'T just wrap the JSX inside
   the component's `return` — wrap from OUTSIDE via the default export:
   ```tsx
   function TodayScreen() { /* calls usePageHelp + useCoachMarkTarget */ }
   export default function TodayScreenWithHelp() {
     return (<CoachMarkProvider><TodayScreen /></CoachMarkProvider>);
   }
   ```
   (Validated 2026-06-29 on the Today pilot — wrapping inside `return` makes the
   refs silently no-op.) Then tag each `step.targetId` element with
   `useCoachMarkTarget(id).ref` (call the hook at the top of the component, not in
   JSX). Custom child components don't forward `ref` — wrap them in a thin
   `<View ref={tgt.ref}>`. Missing targets degrade to a centred caption — never
   crash, but the tour is weaker, so verify every target is reachable in the
   state the tour runs in.
6. **(info/mixed with screenshots)** add PNGs under `assets/help/<pageId>/` and
   `require()` them in the content file. See `assets/help/README.md`.

## Screenshot pipeline (real screenshots — chosen default; they go stale)

Capture with the iOS dev-client sim (`com.lisonchang.TrainingLog`, NOT Expo Go):
`xcrun simctl io booted screenshot` → crop → `sips --resampleWidth 1200` into
`assets/help/<pageId>/`. NEVER `require()` a not-yet-existing path (breaks Metro).
When you change a page's UI, recapture its stale shots in the same commit.
Full steps + caveats: `assets/help/README.md`.

## Parallel fan-out (the automation)

Foundation is a hard dependency for every page — build it once (done), THEN
fan out one pipeline per page. Use the 3 subagents in `.claude/agents/`.
(Gotcha: a freshly-added `.claude/agents/*.md` isn't selectable as
`subagent_type` until the session restarts — to dogfood it in the same session,
spawn a `general-purpose` agent and tell it to `Read` the agent's `.md` + the
skill, then act in that role. Validated 2026-06-29.)

- `help-content-author` — writes `components/help/content/<pageId>.ts` (zh+en)
  by reading the page + applying the rubric. Picks style, drafts copy, lists the
  `targetId`s a coach tour needs (so the wirer knows what to tag).
- `help-overlay-wirer` — wires the page: import + `usePageHelp` + `HelpButton` +
  `PageHelpHost` (+ `CoachMarkProvider`/`useCoachMarkTarget` for coach). Runs with
  `isolation: 'worktree'` so parallel page edits don't collide.
- `help-reviewer` — adversarial check: copy accuracy vs actual UI, every
  `targetId` is tagged + reachable, tsc/jest green, a11y label present, no
  `require()` of a missing asset.

Pipeline per page (pipeline(), not a barrier — each page is independent):

```
author(page) → wire(page, worktree) → review(page)
```

Discipline (from overnight-parallel-agents):
- **File-disjoint**: each page agent edits only its own page file +
  `content/<pageId>.ts` + its own `assets/help/<pageId>/`. Give each a
  positive allow-list AND a DO-NOT-TOUCH list (every other page + `strings.ts` +
  `components/help/*` infra + `tests/`).
- **Infra is frozen** during fan-out — agents consume `components/help/*`, never
  edit it. If a page genuinely needs a new infra capability, STOP and report;
  the integrator extends infra in one place, then resumes.
- **Screenshots are device/sim work** — an agent can author text + wire the
  component, but capturing real screenshots needs the running sim. Either run the
  capture inline (host) per `assets/help/README.md`, or leave the `images:` array
  empty + a `// TODO(screenshot): …` and capture in a follow-up pass. Never ship a
  `require()` to a missing file.

Scale to the ask: one page → just do it inline. "rolling out help across the app"
→ pipeline the P0–P2 pages; only invoke a Workflow / overnight wave on explicit
user opt-in (it spawns many agents).

## Verify

- `npx tsc --noEmit` + `npm test` (the pure `coachMarkLayout` test must stay green).
- Sim smoke (ios-simulator-smoke): ⓘ visible top-right; tap → correct overlay;
  info reads right; coach highlights the real elements with arrows; auto-show-once
  fires on a fresh `help_seen:` key then never again.
