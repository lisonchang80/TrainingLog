---
name: rn-component-behavior-split
description: >
  Split React Native component logic into a `.behavior.ts` pure-TS module +
  thin JSX wrapper so the decision logic is testable under
  `testEnvironment: node` (no RN renderer / no @testing-library/react-native).
  Use when adding a component that has non-trivial layout / format /
  transition decisions and you want unit-test coverage without standing up
  a React renderer. Trigger words: "behavior split", "F2/F4 pattern",
  "unit test RN component", "testEnvironment node 怎麼測 component",
  "想 unit test 但沒 renderer". Validated 4× on TrainingLog 2026-05-25
  (session-title-editor / hr-zone-chart / session-stats-panel / rest-timer-modal).
---

# RN component behavior split

TrainingLog jest config runs `testEnvironment: node` with no React Native
renderer + no `@testing-library/react-native` installed. Direct `render(<X/>)`
tests are off the table. The workaround: extract every interesting decision
out of the JSX into a sibling `.behavior.ts` pure-TS module, and test that
module under node.

## When TO use

Component has any of:

- Variant/layout branching (3-tile vs 4-tile vs 5-tile-watch)
- Format helpers (`formatKcal` / `formatAvgHr` / `formatElapsedShort`)
- Geometry / scaling math (`bpmToY` / `tsToX` / `zoneBands`)
- State-transition predicates (`shouldFireFinishEdge` / `decideCommit`)
- Color / token selection driven by props (`hrTileBorderColor`)

…AND you want unit-test coverage on those decisions.

## When NOT to use

- Trivial wrappers (just JSX + a couple of theme tokens) — over-engineered.
  Threshold: if the helper would be a single one-liner, skip.
- Pure visual-only components — render snapshot value is dim without a
  renderer; skip.
- Components whose behavior is already covered by integration tests at the
  parent screen level — duplication, skip.

## Recipe

### Step 1 — Name + scaffold

```
components/<area>/<kebab-name>.tsx           ← JSX wrapper (existing or NEW)
components/<area>/<kebab-name>.behavior.ts   ← NEW pure logic
tests/components/<camelCase>.test.ts         ← NEW (or extend existing)
```

Use exactly the same kebab-name; just `.behavior.ts` suffix. Tests live
under `tests/components/<camelCase>.test.ts` (camel name matches the
behavior module's main export).

### Step 2 — Extract decisions, not data

The behavior module exports:

- Type unions for variant / status / option enums
- Pure functions that take inputs and return decisions / strings / numbers
- Re-exports of types from `src/domain/*` if the JSX file needs them too,
  so JSX imports through behavior.ts (single import surface)
- Constants used by tests (e.g. `Y_BPM_MIN`, `ZONE_COLORS`)

Do **not** export:

- React components / JSX
- Hook returns (`useState` setters, etc.)
- Theme tokens (those flow through JSX only)
- Anything that needs RN runtime

### Step 3 — Wire JSX wrapper

JSX file imports from behavior:

```tsx
import {
  bpmToY,
  buildSamplePath,
  formatElapsedShort,
  shouldShowEmptyHint,
  type HRSample,
  Y_BPM_MAX,
  Y_BPM_MIN,
  yAxisTicks,
  zoneBands,
} from './hr-zone-chart.behavior';
```

JSX file's job: useTheme + StyleSheet + JSX tree using behavior outputs.
Zero embedded `if (variant === 'X')` / format / math.

### Step 4 — Test the behavior module

```ts
import { ... } from '../../components/<area>/<kebab-name>.behavior';

describe('formatX', () => {
  it('returns "—" for null', () => { ... });
  it('rounds positive values', () => { ... });
});

describe('decideY', () => {
  it('fires on transition + first call', () => { ... });
  it('idempotent on second call', () => { ... });
});
```

Coverage target: every branch of every exported function. With the JSX
out of the way the tests are clean unit tests, milliseconds to run.

## Validated cases (TrainingLog 2026-05-22 → 2026-05-25)

### 1. `session-title-editor.behavior.ts` (Bugs F2 + F4)

- `nextDraftOnPropSync(initialTitle, draft, editing)` — race between
  parent async-loaded title and in-flight user typing
- `decideCommit(draft, initialTitle)` — guard against clobbering with ''
- `type SessionTitleEditorHandle` — forwardRef imperative API contract

Tested in `tests/components/sessionTitleEditorBehavior.test.ts`.

### 2. `hr-zone-chart.behavior.ts` (Slice 13a C2)

- `bpmToY / tsToX` — clamped axis scaling
- `zoneBands(hrmax, dims)` — 5-band Z1-Z5 layout with Polar palette
- `buildSamplePath` — SVG path d-attr emission
- `shouldShowEmptyHint` — null/empty predicate
- `formatElapsedShort` — mm:ss formatter
- `yAxisTicks` — Y axis tick values

Tested in `tests/components/hrZoneChart.test.ts` (18 tests).

### 3. `session-stats-panel.behavior.ts` (Slice 13a C3)

- `tilesForVariant('3tile' | '4tile' | '5tile-watch')` — ordered tile keys
- `bottomRowCount(variant)` — row-2 size (0 / 2 / 2)
- `formatKcal / formatAvgHr` — NULL → '—' placeholder, integer otherwise
- `hrTileBorderColor(avgHr, age)` — Z-zone hex or NULL

Tested in `tests/components/sessionStatsPanel.variants.test.ts` (11 tests).

### 4. `rest-timer-modal.behavior.ts` (Slice 13a C7)

- `shouldFireFinishEdge(status, alreadyFired)` — one-shot transition guard

Tested in `tests/components/restTimerSound.test.ts` (4 of 6 tests; the
other 2 verify the wav asset exists + is < 50 KB).

## Anti-patterns

- ❌ Putting JSX inside the behavior module (defeats the split)
- ❌ Importing React from behavior.ts (it's pure TS, no React types)
- ❌ Testing the JSX wrapper directly with mocked react-native (no RN
  testing library is installed; the mock surface is fragile)
- ❌ Skipping the split for a "one-liner" then accumulating 5 one-liners
  in the JSX (refactor threshold: ≥ 2 helpers / decisions → split)
- ❌ Re-implementing the same decision in the test (test should import
  the helper, not duplicate the logic)

## File-allow-list discipline

Per `overnight-parallel-agents` skill #17, when multiple agents run in
parallel and one creates a behavior module, the others must treat that
module's surface as read-only — divergent additions cause merge churn.
Spell out the behavior module path in DO NOT TOUCH lists for sibling
agents.
