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
6. **A coach tour mixes spotlight steps and screenshot-card steps — weave gestures/menus INTO the tour, don't split them into a separate `info` window.** (Built 2026-06-29.) A `CoachStep` is EITHER a spotlight (`targetId`) OR a screenshot card (`image` = a `require()`'d PNG; omit `targetId`). `CoachMarkOverlay` spotlights real elements and, for the steps a ring can't frame — a pop-up ActionSheet, swipe / long-press / tap-cycle gestures, anything needing the page in another state — shows a centred card with the FULL screenshot + caption, **interleaved in the SAME numbered sequence**. So a page's whole flow stays ONE 引導遮罩. Keep screenshot-card steps to **≤3 per tour**; captions still ≤2 lines.
   - **Template editor is the precedent (shipped):** 5 steps = 加入動作🔦 → 動作卡🔦 → ⚙️選單🖼️ → 設定每一組🖼️ → 儲存/開始🔦 (`content/template-editor.ts`).
   - The earlier idea of falling back to a *standalone* `info`/`mixed` window for these gestures was tried for the template editor and **rejected by the user — "步驟能用遮罩就用遮罩；不能用遮罩再用截圖＋文字，穿插在遮罩的步驟中；不要獨立出來."** A long standalone info window also hit a real bug (see InfoModal note in the infra section). `info`/`mixed` is now ONLY for pure-interpretation pages that have NO tour at all (a chart legend, a heatmap's colours).

7. **Verify EVERY operation against source before writing it — never infer from a handler name** (user directive 2026-06-29, "請確定是否有這些功能再寫，之後功能也一樣"). Open the component, read the actual config. Real catches this session, all initially wrong from prop-name guessing: the template ⚙️ menu is 備註 / 休息時間 / 移動動作 / 設為常設·一般 / 刪除 — there is **NO「改器材」** (a draft fabricated it; truth in `openGearMenu`); tapping a set's label is a **3-way cycle 正式→熱身→遞減組** (`cycleSetKind` → `templateOps.ts`), not a 2-way warm-up/working toggle; set swipe = **左滑刪除 / 右滑複製·備註** (the earlier draft listed only 左滑). Cite the source file + line in the content file's header comment so the next author can re-verify against drift.

**嚮導/精靈式流程頁不加 ⓘ** (user directive 2026-06-29): if the page IS a
step-by-step guided flow that already walks the user (a `Step N of M` wizard),
it self-guides — do NOT bolt a help overlay on top. The program wizard had a
2-step coach + auto-show; the user had it **fully removed** ("計劃精靈不用ⓘ，
因為精靈本身就是引導，後面再優化看看"). So skip help for wizards even though
they're "operation pages". Other complex pages still get the ⓘ.

Page recommendations (2026-06-29 survey; ✅ = shipped this round):

| Page | Recommend |
|---|---|
| `app/(tabs)/index.tsx` 訓練/今日 | mixed (idle 概念=info, in-session 手勢=coach) — idle ✅ |
| `components/template-editor/*` (`template/[id]` is a thin wrapper) | coach ✅ (5-step hybrid) |
| `app/session/[id].tsx` 詳情/編輯 | coach ✅ **(5-step: 3 spotlight + 2 cards — gear-menu / sets; the template-editor's editing twin)** |
| `app/program-wizard/new.tsx` | ~~coach~~ **NONE — wizard self-guides, ⓘ removed 2026-06-29** |
| `app/superset/new.tsx` | coach ✅ **(3-step all-spotlight; happy path has no pop-up/gesture → genuinely 0 screenshot cards, and that's faithful — don't force a card)** |
| `app/exercise-chart/[id].tsx` | coach ✅ **(4-step feature-explainer, `coachNumbered:false`: rep buckets/cluster/advanced/metric)** |
| `app/exercise-history/[id].tsx` | coach ✅ **(4-step: same filters + first SessionRow expand/超/replay)** |
| `app/(tabs)/library.tsx` | coach ✅ **(3-step: MG tree / equipment dropdown / card meta)** |
| `app/(tabs)/programs.tsx` | coach ✅ **mode-aware (2026-07-02): `editing ? programsEditHelp : programsViewHelp`. VIEW = 3 spotlights, pure layout (grid〔列=週期/欄=天〕 / 編輯 button / manage row), 0 cards. EDIT = grid intro spotlight + 4 grid-op cards (下拉/▼/▶/拖曳). Was a single 6-step hybrid.** |
| `app/(tabs)/history.tsx` | coach ✅ **(4-step: subtabs / 月曆·表列 / calendar colour+N / 🖼️ zoomed day-cell card labelling the 3 rows 容量·模板色·強度)** |
| `app/exercise/[id].tsx` | coach ✅ **(2-step: muscle figure orange=primary blue=secondary / footer)** |
| `app/superset/[id].tsx` | coach ✅ **(2-step: locked A+B pair / footer 歷史·圖表 open A-side filtered)** |
| `app/body.tsx` | coach ✅ **(3-step: input placeholder=hint / dual-Y chart / legend toggles)** |
| `components/body-heatmap.tsx` legend | info (interpretation-only, no tour) |
| `program/[id]` · `exercise-picker` · `exercise/new` · `exercise/edit` · `superset/edit` · settings | NONE — pure forms / read-only / self-evident; nothing counter-intuitive to teach |

**Feature-explainer pattern (2026-06-29, the 8 ✅ above):** for non-wizard, non-procedure pages (analytics, browse, detail), a coach tour with `coachNumbered:false` is the right shape — each step spotlights ONE *counter-intuitive* control and says what it does (not "do 1 → 2 → 3"). User directive: 「沒辦法寫流程的話，就用遮罩說明功能、反直覺的東西」. **Author captions ONLY from verified source** — this round 2 captions would have been wrong if guessed (exercise muscle figure uses orange/blue COLOUR not depth; the media card auto-crossfades, it's not swipeable, so it gets NO step). A conditional target (a control only shown in some state, e.g. chart cluster segmented) degrades to a centred caption — that's fine; write the copy to read either way. Tab pages / header-less stack pages with no native `headerRight` slot get the `<HelpButton>` in an in-page title row next to the heading.

**~~Gotcha~~ FIXED 2026-06-29 — overlay now dismisses on navigation.** Was: `PageHelpHost` is a plain `<Modal>`, so navigating away (deep-link, switcher, back) while it's open left the Modal presented over the next screen (hit repeatedly while sim-deep-link-testing between pages). Fix = `usePageHelp` (`components/help/usePageHelp.ts`) registers an expo-router `useFocusEffect` whose blur cleanup calls `setVisible(false)`; one hook, applies to every coach/info/mixed page automatically. Sim-verified (today + programs + body): open ⓘ → deep-link away → no stuck overlay, next page fully interactive; open-on-tap + autoShowOnce still work. So you can now sim-deep-link page→page freely with an overlay open. (The separate in-session `<Modal>`-unmount stuck-overlay note on the Today-in-session row below is a *different* problem and still stands.)

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
| 模板編輯器 `components/template-editor/*` | ⭐⭐ | add exercise → add sets → (form cluster / superset) → save; flow is freer, not strictly linear | ✅ **SHIPPED** as a 5-step hybrid coach tour (3 spotlight + 2 screenshot cards, `content/template-editor.ts`). The passive-`coach`+screenshot-card mix (constraint #6) is the chosen ship, not a stopgap — only upgrade to tap-through `coach-interactive` if the user later asks. |
| Today first in-session logging (打勾完成 / 左滑刪除 / 右滑加組·備註 / 長按拖曳排序) | ⭐⭐ | real gestures the ring can't show; you only learn them by doing — but it's *logging*, not *creating*. (Gestures verified against `cluster-card.tsx` + `SwipeableSetRow` + live sim 2026-07-01 — NOT the earlier guess of 長按=遞減 / 左滑=投影; 投影 is a ⋯-menu item.) | ✅ **SHIPPED 2026-07-01** as `info` + `blocks` (interleaved text + real-capture gesture images), NOT coach (ring can't frame the memoized set-row subtree). ⚠️ **The orphan hazard is real** — the in-session view (`(tabs)/index.tsx`) branch UNMOUNTS on a **Watch-led session end**; a `<Modal>` left open across that unmount = stuck overlay (hit 2026-06-29). **Sanctioned wiring** (now shipped): a dedicated `inSessionHelp = usePageHelp('today-session', …)` handle whose host lives in the in-session `return`, PLUS `inSessionHelp.close()` called **synchronously at the top of `finalizeEndAndRoute`** (both iPhone-led + Watch-inbound end paths route through it → the Modal renders invisible BEFORE any status flip/unmount), PLUS a `useEffect([sessionState.status])` backstop that closes it whenever status leaves `in_progress`. Sim-verified: end session → detail page clean, no residual overlay. |
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
  `coachMarkLayout.ts` (unit-tested in `tests/help/`). Two capabilities added
  2026-06-29: (a) `CoachStep.image` — a coach step can be a screenshot card
  instead of a spotlight (constraint #6); (b) `InfoContent.blocks` — interleaved
  text+image blocks for an `info` page that needs a heading right next to its
  shot (the `sections`-then-`images` default can't interleave). **`InfoModal`
  scroll bug fixed same day**: its `ScrollView` needed `flexShrink: 1` or tall
  content overflowed the card's `maxHeight` and was clipped, not scrollable —
  any new long `info` content relies on that fix.
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
   JSX). Custom child components don't forward `ref` — the SAFE move is
   `React.forwardRef` so the ref lands on the component's OWN root view. **⚠️ Do
   NOT wrap a layout-sensitive child in a bare `<View ref>`** — it can BREAK the
   child's size (regression hit + FIXED 2026-06-29, library `<Sidebar>`): the
   Sidebar (`sidebarWrap` fixed `width:92`, no height) relied on being a DIRECT
   child of the row `body` so the row's `align-items:stretch` gave it full height →
   its inner `flex:1` ScrollView filled. Wrapping it in a plain (column-default)
   `<View>` interrupted that stretch chain → the ScrollView collapsed to 0 height →
   **the whole sidebar vanished**. Fix shipped: `Sidebar = forwardRef(...)` with
   `ref` on `sidebarWrap` (no wrapper). A wrapper-style hack (`{ width,
   alignSelf:'stretch' }`) won't fix an inner `flex:1` that needs a defined height
   — forward-ref is the move. Missing targets degrade to a centred caption — never
   crash, but the tour is weaker, so verify every target is reachable in the state
   the tour runs in.
   - **Full-height / edge-hugging targets are now SAFE to spotlight** (2026-06-29):
     `CoachMarkOverlay` positions the caption via `resolveCoachBubbleAnchor`
     (pure, in `coachMarkLayout.ts`, unit-tested). When the natural side (above a
     bottom target / below a top target) has no room, it OVERLAYS the caption on a
     safe band instead of pushing it past the status bar. So you no longer have to
     avoid spotlighting a tall column (e.g. the library sidebar) — but a card is
     still clearer for very tall targets if the caption would cover the thing it
     describes.
   - **⚠️ Spotlight measure inset is PRESENTATION-DEPENDENT — only modal-presented
     hosts need compensation (root-caused 2026-06-30 over two rounds; don't
     re-debug from scratch).** `CoachMarkOverlay` renders inside a full-screen
     `<Modal>` and measures the underlying page's targets WHILE the modal is open.
     - On a **`presentation: 'modal'` route** (e.g. `superset/new` — check
       `app/_layout.tsx`), `measureInWindow` under-reports the target's window-Y by
       the top safe-area inset (~62pt): the modal sheet's content lives in a
       container the overlay Modal's window space excludes. Symptom: a thin near-top
       target rings the wrong element (超級組「選 2 個」row ringed the search bar above).
     - On a **card-presented route** (the DEFAULT — template editor, session, the
       tabs, every exercise/history/chart/body/superset-detail page), `measureInWindow`
       returns TRUE window coords — NO compensation needed.
     Fix (shipped): the compensation is gated by a `modalHost` flag —
     `usePageHelp(pageId, content, { modalHost: true })` → `PageHelpHost` →
     `CoachMarkOverlay`, which adds `useSafeAreaInsets().top` to `rect.y` ONLY when
     `modalHost`. **So for a NEW coach page: pass `modalHost: true` IFF its route is
     `presentation: 'modal'`; otherwise do nothing.**
     - ⛔ **Round-1 trap (do NOT redo): an UNCONDITIONAL `+insets.top`.** That fixed
       superset (the one modal host) but shoved every card page's spotlight ~62pt too
       low — the template editor「加入動作」ring (bottom action bar, real y≈800) landed
       off-screen showing no ring. "It hits every coach page" was the WRONG diagnosis;
       only modal hosts under-report.
     Dead ends that DON'T fix it (don't repeat): `forwardRef` onto the target's styled
     root, giving the target a real `backgroundColor`, switching the provider
     `measureInWindow`↔`measure(pageY)`, wrapping the page in an extra flex `<View>`,
     or `<SafeAreaView edges={['top']}>`→`<View paddingTop={insets.top}>` (that
     DOUBLE-pads — the parent Stack already reserves the inset). And do NOT "fix" a
     mis-placed spotlight by deleting/merging the step — the user wants the step
     placed right, not gone.
   - **Debug technique that cracked it: render the measured rect ON SCREEN.** When
     a spotlight lands wrong and you can't tell why, temporarily drop an
     absolute-positioned `<Text style={{position:'absolute',top:150,zIndex:99999}}>
     DBG {step.targetId} {JSON.stringify(rect)}</Text>` inside the overlay's
     `<Pressable>`, reload, screenshot — you SEE the raw `{x,y,width,height}` the
     spotlight uses. (Here: width/height correct, y=60 vs real ~122 → "off by the
     inset" was obvious in one shot.) console.log is useless (goes to the Metro
     terminal you can't read from the sim). Remove the debug Text before shipping.
     **Also print `modalHost` in the DBG line** (`modalHost=${!!modalHost} raw=…
     adj=…`) — for a card page you want `modalHost=false` + `raw==adj`; only the
     modal host (superset/new) should show `adj.y = raw.y + ~62`.
   - **Verify ALL overlay positions in one sweep (after any coach-infra change).**
     The inset compensation is a per-PRESENTATION constant, so confirming one
     card page + the one modal page logically covers everything — but to *see* it,
     deep-link each coach host, open ⓘ, screenshot the step-1 spotlight, read the
     DBG line. Recipe per page: `xcrun simctl openurl <UDID> "<route>"` → sleep 4
     → `ui_find_element ["說明"]` for the ⓘ frame (tap its centre) → screenshot.
     **⚠️ `ui_find_element ["說明"]` intermittently returns `[]` on the
     exercise-detail / exercise-history / exercise-chart / superset-detail routes
     (idb flakiness, not a real absence)** — fall back to tapping the visible
     top-right ⓘ (~pt x=366,y=86 on a 402-wide screen). Coach-host deep-links
     (2026-06-30): tabs `traininglog:///` (today) `/history` `/library` `/programs`
     `/body`; stack `/template/<id>` `/session/<id>` `/exercise/<id>`
     `/exercise-history/<id>` `/exercise-chart/<id>` `/superset/<id>`
     `/superset/new` (the lone modal). exercise-history/chart need an exercise
     that HAS logged sets or the bucket/row targets don't render (empty state) —
     query `SELECT se.exercise_id FROM "set" s JOIN session_exercise se … WHERE
     s.is_logged=1 GROUP BY … ORDER BY COUNT(*) DESC`. The dev LogBox toast
     ("Open debugger to view warnings") floats over the overlay at the bottom and
     can occlude a bottom-anchored spotlight; tap its ✕ (it's above the coach
     Modal, so the tap dismisses the toast without advancing the step).
6. **(info/mixed with screenshots)** add PNGs under `assets/help/<pageId>/` and
   `require()` them in the content file. See `assets/help/README.md`.

## Screenshot pipeline (real screenshots — they go stale)

Capture with the iOS dev-client sim (`com.lisonchang.TrainingLog`, NOT Expo Go):
`xcrun simctl io booted screenshot` → crop → `sips --resampleWidth N` into
`assets/help/<pageId>/`. NEVER `require()` a not-yet-existing path (breaks Metro).
Recapture stale shots in the same commit. To get a populated page (e.g. a demo
template) use `sim-db-seed-smoke` + deep-link `traininglog://template/<id>`; set
`help_seen:<pageId>=true` in `app_settings` first so the auto-show doesn't cover
the page while you shoot. New/changed assets need an app reload to re-bundle.

**Crop gotchas (validated 2026-06-29 — the ⚙️-menu shot took 3 tries):**
- **`sips` CAN offset-crop — use it, skip the throwaway script** (corrected
  2026-07-01; the old "sips only centre-crops" claim was WRONG). One built-in
  command: `sips -c <H> <W> --cropOffset <offsetY> <offsetX> in.png --out out.png`
  (order is offsetY then offsetX). Verify with `sips -g pixelWidth -g pixelHeight
  out.png`, then Read the PNG to eyeball. No ImageMagick/PIL needed (macOS has
  neither by default; don't install — feedback_workflow). The old stdlib
  `pngcrop.py` throwaway is only a fallback if sips ever chokes on a color type.
- **⚠️ simctl screenshots are 3× (px), not 1.5× — crop offsets are in PX.** iPhone
  17 sim = **1206×2622 px** for a **402×874 pt** screen (Retina @3×). So a target at
  pt `(x,y)` sits at px `(3x, 3y)`; a set row centred at pt y≈394 → px ≈1182. Compute
  `--cropOffset`/`-c` in PX (× 3 of the pt coords from `ui_find_element` AXFrames).
  Getting this wrong crops the wrong region (first attempt at 1.5× grabbed the stats
  tile). `Read` returns the PNG scaled-down for display — always trust the real
  `pixelWidth/Height`, not the displayed size.
- **A tab page may be unreachable by tapping its tab** — the RN dev LogBox toast
  ("Open debugger to view warnings") sits over the bottom tab bar, so a tab tap
  lands on the toast. Navigate via deep-link instead: `xcrun simctl openurl <UDID>
  traininglog:///library` (or `/history`, etc.). The `ⓘ`/coach are reachable from there.
- **Don't eyeball crop bounds — scan the pixels for them.** A tight guess clips one
  side; a loose guess leaks the dimmed page behind (the「(無常設動作)」placeholder
  bled into the ⚙️ shot's left). For a pop-up card (ActionSheet), read pixels, find
  the card's bright-region centre x + widest extent, and crop SYMMETRICALLY around
  the centre, just inside the leak. Verify by re-reading the crop, not by eye.
  Beware false positives: a bright-luminance scan over a *whole screenshot* also
  hits white stat-tile text / toggles, not just the card — band the scan to the
  card's vertical region (validated 2026-06-29: the session ⚙️ scan's `miny=606`
  was the「1 hr 0' 00"」tile text, the card actually started ~y=870).
- **The content file's `aspectRatio` MUST equal the cropped PNG's `width/height`** —
  `contentFit:'contain'` then shows it whole; a wrong ratio letterboxes or visually
  crops. Recompute it whenever you re-crop.
- **Tall portrait shots need image-`maxHeight` headroom** (`CoachMarkOverlay`
  cardImage `maxHeight` is 520; `InfoModal` caps its own) or they letterbox; the
  card still fits the screen.

**Set-row gesture cards (左滑/右滑/長按) — capture recipe (validated 2026-07-01):**
- **Reach a real set row**: start/open a session → expand an exercise card (tap it)
  → the `SwipeableSetRow`s appear (`1  20 kg × 8  ○`). Get the row's pt-Y from
  `ui_find_element ["切換組別"]` / `["編輯重量"]` AXFrame (row ≈ 49pt tall).
- **Swipe reveals STAY OPEN** (react-native-gesture-handler `Swipeable`): `ui_swipe`
  the row → the action buttons stay revealed until you tap/swipe elsewhere → then
  `screenshot`. **Left-swipe** (x large→small) reveals red 刪除 on the right;
  **right-swipe** (x small→large) reveals the add/note buttons on the left. To flip
  from a left-open row to a right reveal, swipe right ONCE to close, then a SECOND
  clean right-swipe on the now-closed row opens the left actions (one big swipe just
  closes).
- **長按 (drag-reorder) CANNOT be captured** — the "lifted" state exists only DURING
  the active gesture, and `ui_tap duration=…` releases before the screenshot fires;
  idb has no hold-then-screenshot. So the 長按 card uses a NEUTRAL multi-row shot
  (add a 2nd set via 新增1組 so reorder is meaningful) + a caption; you show WHERE to
  long-press, not the lift. Honest and accepted.
- **⚠️ Verify the reveal LABELS against the live UI, not the docstring.** The green
  add button differs by page: session-detail + today-session = **「＋1」**, but the
  **template editor = 「加」** (the old docstring's「複製」was WRONG — sim disproved it
  2026-07-01). So a shared image is fine for 左滑/長按, but capture the 右滑 per
  green-label variant. Crop each to the row strip (`sips --cropOffset`, PX = pt×3);
  the swipe strip AR ≈ 1030/190 ≈ 5.4, two-row 長按 ≈ 1030/350 ≈ 2.9.
- **Shared gesture assets** live in `assets/help/gestures/` (`swipe-left`,
  `swipe-right`, `swipe-right-template`, `long-press`) — reused by session-detail,
  template-editor, and today-session content files, so re-cropping one updates all
  three cards.

**⚠️ Metro stale-bundle after a multi-step content edit**: if you Write a content
file then `perl`/Edit it again (e.g. add top-level `const X = require(...)`, then
inline the requires + delete the const), Metro's HMR can cache the INTERMEDIATE
broken state → the app runtime throws `ReferenceError: Property 'X' doesn't exist`
even though `tsc` + `grep` show the source is clean. Fix = restart Metro with
`--clear` (kill the :8081 PID, relaunch `npx expo start --dev-client --clear`) +
relaunch the app. Don't chase a phantom source bug; confirm source is clean, then
bust the cache.

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

## App-mode-aware coach pages (極簡 / 計劃, ADR-0026)

When a page's UI changes with `useAppMode()` (極簡 hides the 計劃/強度 concept), its
coach must change too — else it teaches / spotlights elements that aren't there in
極簡. Validated 2026-06-30 on history / exercise-chart / exercise-history.

**Mechanism by how different the two modes are:**
- **Same screen, minor delta** (drop one step, or reword one step) → keep the SAME
  `pageId`, derive the minimal variant from the plan content with `.map/.filter`
  (plan = single source of truth, no duplicated bilingual blob):
  ```ts
  export const xHelpMinimal: LocalizedPageHelp = {
    zh: { ...xHelp.zh, coach: (xHelp.zh.coach ?? [])
      .filter((s) => s.targetId != null)            // drop screenshot-card steps
      .map((s) => s.targetId === 'x.advanced' ? { ...s, body: '…' } : s) },
    en: { ... },
  };
  ```
  Call site: `usePageHelp('x', isMinimal ? xHelpMinimal : xHelp, …)` (isMinimal from
  `useAppMode()`). Same pageId → seen-once flag shared; minimal is a subset so nothing
  is lost if they switch after seeing one.
- **Genuinely different screens** (Today plan = 3 start methods vs minimal = 2) →
  split files + separate pageIds (`today-plan` / `today-minimal`). Heavier; only when
  the screens really differ.

**Page-side gating (non-obvious):**
- Gate ONLY the mode-specific controls; keep the spotlight target's WRAPPER mounted.
  The `useCoachMarkTarget` ref sits on the outer wrap (e.g. `advancedWrap`), so hiding
  the inner 計劃/強度 dropdown+chips leaves the ref alive → the step still frames the
  section, never goes null. (Unmount the whole target and the step degrades to a
  centred caption — usually not wanted.)
- Keep useful non-mode controls inside the gated section (chart/history 進階篩選: hide
  program+intensity, KEEP the action row 看歷史·切換圖表 / 取消·清除).
- **Hydration guard**: if the page hydrates a persisted filter carrying the mode
  concept (programId/sub_tag from a mailbox), wrap the setState in `if (!isMinimal)`
  + add `isMinimal` to the effect deps — else a filter set in 計劃 silently narrows
  data in 極簡 with no control to clear it.

**Which pages needed it / didn't (read the bodies, don't assume):**
- Needed: `history` (drop the zoomed day-cell card — 極簡 cell is 2 rows, fold a 2-row
  note into the calendar step), `exercise-chart` / `exercise-history` (gate 進階篩選
  program/intensity, reword the advanced step).
- NOT needed: `session-detail` / `template-editor` — copy already program-agnostic;
  the hidden subtitle / 另存強度 menu item are not coach targets. `programs` —
  unreachable in 極簡 (tab `href:null`). library/body/exercise-detail/superset-* — no
  計劃/強度 concept.

**Sim-verify**: Settings → 訓練模式 → toggle. `history` ⓘ = 4 steps (with day-cell
card) in 計劃 / 3 (no card) in 極簡; chart·history-detail expand 進階篩選 → only the
action row, advanced step reworded, spotlight still framing the section.

## Long ScrollView coach pages — auto-scroll + per-sub-tab ⓘ (2026-07-01)

Two capabilities added for History ▸ 統計 / 獎章 (`feat/history-subtab-help`):

**1. One header ⓘ, per-sub-tab content.** A tab screen with inner sub-tabs
(history.tsx: 歷史/統計/獎章) calls `usePageHelp` ONCE PER sub-tab (stable pageIds
`history` / `history-stats` / `history-achievements`), then the single header ⓘ
opens whichever matches `effectiveTab`:
```ts
const h = usePageHelp('history', ..., { autoShowOnce: true });
const s = usePageHelp('history-stats', statsHelp);
const a = usePageHelp('history-achievements', achHelp);
const help = effectiveTab === 'stats' ? s : effectiveTab === 'achievements' ? a : h;
// <HelpButton onPress={help.open}/> + <PageHelpHost help={help}/>
```
Only the default landing sub-tab gets `autoShowOnce` — the others' effect runs on
mount while you're still on the default tab, so an autoShow there is consumed unseen.
Per-panel coach targets live IN the panels (stats-panel / achievements-panel via
`useCoachMarkTarget`), always under the History tab's `CoachMarkProvider`.

**2. Auto-scroll below-the-fold targets.** A long ScrollView page's targets can sit
below the fold; `measureInWindow` then reports an off-screen y and the spotlight/bubble
land off-screen. Fix = the page registers its ScrollView so the overlay scrolls each
target into view before measuring:
```ts
const coachScroll = useCoachScroller();   // from @/components/help
<ScrollView ref={coachScroll.ref} onScroll={coachScroll.onScroll}
            scrollEventThrottle={coachScroll.scrollEventThrottle}> … </ScrollView>
```
Infra (CoachMarkProvider): `registerScroller` + `scrollIntoView(id)` (measures window
y; if off-screen scrolls target top to ~26% screen height with `animated:false` + a
short settle) + `scrollToTop(animated?)` (overlay calls it INSTANT on tour open, SMOOTH
on close via `handleClose`). CoachMarkOverlay resets to top on step 1, then `await`s
`scrollIntoView(targetId)` before each measure. The scroll-offset maths is the pure,
unit-tested `computeCoachScrollOffset` in `coachMarkLayout.ts`. Pages that don't register
a scroller no-op — zero impact on the other ~12 coach pages.

**✅ FIXED (2026-07-01): step-1 莫名滑動 → 遮罩跑位.** Symptom: a tour opened on an
already-scrolled stats page made step 1 (period selector, near content-top) yank the
page to re-centre it, and the spotlight ring/bubble landed off-target. **The earlier
"340ms settle / coordinate mix" hypotheses were both wrong** — `computeCoachScrollOffset`
is correct (the ScrollView's window-top cancels out of `offset + (windowY − desiredTop)`,
proved by derivation + the unit tests). The real causes were in the PROVIDER flow:
(1) the tour started from wherever the page was scrolled, so a near-top target above the
top-safe band triggered an auto-scroll (the「莫名滑動」); (2) step scrolls used
`animated:true`, so the fixed 340+60ms measure could read a MID-animation y → ring
mis-position (the「遮罩跑位」). Fix (maths untouched): step 1 instantly resets the
scroller to the top (`scrollToTop(false)`), so its near-top target needs no scroll; per-
step scrolls use `animated:false` so the follow-up measure reads the settled position.
Sim-verified: pre-scrolled stats page → ⓘ → step 1 ring on the period selector with no
surprise scroll; steps 2–4 still auto-scroll heatmap/capacity/duration into view with
correct rings. **Lesson: don't trust an audit's root-cause label — derive the maths
yourself before patching** (this one sent two notes down the wrong path).

## Mode-aware coach + card-vs-spotlight rules (2026-07-01)

**Mode-aware dispatch.** When one page runs two states with different help (session
detail view vs edit; Today idle plan vs 極簡), DON'T cram both into one tour. Split into
two content files and dispatch on the state flag, mirroring the Today tab's
`isMinimal ? todayMinimalHelp : todayPlanHelp`:
```ts
const help = usePageHelp(
  editMode ? 'session-detail-edit' : 'session-detail-view',
  editMode ? sessionDetailEditHelp : sessionDetailViewHelp,
  { autoShowOnce: true });   // pageId change re-arms autoShowOnce per mode
```
⚠ TDZ: the handle must be declared AFTER the state var (`editMode`/`isMinimal`) — move
the `usePageHelp` call below the `useState`, it's still an unconditional hook so order
is fine (validated session/[id].tsx 2026-07-01, `help` used at :1963/:2461 both below).

**What gets a spotlight vs a card** (the decision that keeps you off the step-1 scroll
landmine — see KNOWN BUG above):
- **Spotlight (`targetId`)** ONLY fixed / above-fold chrome — header buttons, a fixed
  bottom action bar (`session.edit/saveTemplate/delete`, in-session `today.session.add/
  finish`). These never need `useCoachScroller`.
- **Screenshot card (`image`)** for everything else: pop-up menus (⚙️ per-card ActionSheet,
  header ⋯ ActionSheet), per-set gestures (swipe/long-press), AND scroll-body READING
  features you'd otherwise scroll to (HR-zone chart, a 隱藏未打勾 toggle). Making these
  cards means the tour registers NO scroller → dodges the step-1 mis-position bug.
- The real discriminator is the TRIGGER's position, not "is it a menu". A menu whose
  trigger is FIXED chrome → SPOTLIGHT it (body text lists the items); a menu/gesture whose
  trigger lives in the scroll body → card. ⚠ **2026-07-02 REVERSAL**: the in-session ⋯ was
  briefly downgraded to a `dots-menu.png` card, then put BACK to a spotlight — ⋯ is a fixed
  header button, spotlightable, so a card there was the wrong call ("沒切到" was the user's
  word for a card that felt like it missed). The per-card ⚙️ stays a card (its trigger is
  in the scrolling exercise list). When flipping direction, add/remove the
  `useCoachMarkTarget` + `ref=` AND delete the now-orphan screenshot (`git rm`).
- **Scroll-body targets can't be spotlit reliably** ("沒切到"). The template editor 動作卡
  was a `template.card` spotlight whose `ref` sat on a `renderSection` card inside the
  ScrollView — the ring measured a below-fold section and missed. Fix = screenshot card
  (`template-editor/card.png`), and rip out the dead `useCoachMarkTarget('template.card')`
  + the `firstCardRef` param it threaded through `renderSection`. (Grids/cards that are
  ABOVE the fold, like `programs.grid`, spotlight fine — the bar is measurability, not
  "is it in a ScrollView".)

**Reuse identical menu screenshots across pages.** The in-session per-card ⚙️ ActionSheet
and session-detail's ⚙️ have the SAME options (verified via `index.tsx` `menuOptions` +
`onHeaderMenuPress` — 備註/休息秒數/刪除動作/排序動作) → the in-session ⚙️ card `require`s the
existing `session-detail/gear-menu.png`, no re-capture. Verify options in source first.

**Native ActionSheet capture gotcha.** An `ActionSheetIOS` sheet sits LOWER on screen than
you'll estimate from the rendered thumbnail — first `--cropOffset` grabbed the stats panel
instead. The sheet's top is ~37% down (px ≈ 0.37×screenH at 3× scale), bottom ~67%. Crop,
`Read` the PNG, re-crop if it's the wrong region (the displayed thumbnail's apparent height
≠ the real 2622-px height). Set `aspectRatio` from the FINAL `sips -g pixelWidth/Height`.

**Mode-aware pages so far** (2026-07-02): `session/[id]` (`editMode?edit:view`), Today
in-session vs idle plan/極簡, and **`programs`** (`editing ? 'programs-edit' : 'programs'`
→ `programsEditHelp`/`programsViewHelp`). Programs view = 3 spotlights, pure layout
(grid〔列=週期/欄=天〕 / 編輯 button `programs.edit` / manage row `programs.manage`), 0
cards; edit = the 4 grid-op cards (下拉/▼/▶/拖曳). Its ⓘ is ALWAYS rendered (outside the
`editing` conditional), so both modes are reachable. User rule (repeat of session-detail):
**"(非編輯) 簡化，只需遮罩說明佈局"** → the idle/view ⓘ is a light layout coach, the detailed
ops move to the edit-mode tour.

**Sim-verifying a coach tour (gotchas, validated 2026-07-02).**
- Sim screenshots are ~1206×2622 → too big for the image reader. Downscale first:
  `xcrun simctl io <UDID> screenshot out.png; sips -Z 760 out.png --out out-s.png`, Read the `-s`.
- The `CoachMarkOverlay` is a full-screen `<Modal>` that collapses to ONE flat AXElement
  (`ui_describe_point` anywhere inside returns that one "…選單"-labelled element) — the
  「下一步 / 略過 / 上一步」buttons are NOT exposed to AX. You must tap them by pixel coords.
- **下一步 Y shifts with card height**: tall screenshot-card steps put it low (~y688 on a
  874pt screen), short spotlight cards higher (~y585); a TOP-anchored card (target near the
  top → bubble below it) puts the button row ~y190. Re-read each screenshot and re-aim.
- To reach the **計畫 (programs) tab** you need PLAN mode (5 tabs); 極簡 mode hides it —
  toggle app mode in Settings first (ADR-0026).

## Verify

- `npx tsc --noEmit` + `npm test` (the pure `coachMarkLayout` test must stay green).
- Sim smoke (ios-simulator-smoke): ⓘ visible top-right; tap → correct overlay;
  info reads right; coach highlights the real elements with arrows; auto-show-once
  fires on a fresh `help_seen:` key then never again.
