---
name: settings-backed-context-provider
description: Recipe for adding a new app-wide reactive preference/flag backed by `app_settings` (SQLite) via a React context — mirrors AppModeProvider / ThemeProvider / UnitProvider / OnboardingProvider. Use when adding a new global toggle, mode, or first-launch gate that must persist + re-render the whole tree live (e.g. a new Settings switch, an onboarding/first-run gate). Touches src/adapters/sqlite/settingsRepository.ts, src/<name>/<Name>Context.tsx, app/_layout.tsx.
---

# Settings-backed reactive context provider

TrainingLog has done this **4×** (AppMode / Theme / Unit / Onboarding). Same shape
every time: a preference/flag lives in the generic `app_settings(key,value)` KV
table, and a React context hydrates it on mount + persists + re-renders every
consumer live (no relaunch). Follow this; don't reinvent.

## When to use
- A new **global toggle / mode** that many screens read (like 計劃/極簡, kg/lb, theme).
- A **first-launch / gate** decision (like onboarding) — the "gate" variant below.
- NOT for screen-local state, and NOT for anything that needs a schema column
  (app_settings is schemaless KV — **no migration**).

## The 4 pieces

### 1. `settingsRepository.ts` — key + getter/setter
```ts
const FOO_KEY = 'foo';                              // top of file with the other _KEY consts
// boolean → store as 0/1 (like HK / auto-popup / onboarding_completed):
export async function getFoo(db: Database): Promise<boolean> {
  const v = await getSetting<number | boolean>(db, FOO_KEY);
  return v === 1 || v === true;                     // default false when the row is absent
}
export async function setFoo(db: Database, on: boolean): Promise<void> {
  await setSetting<number>(db, FOO_KEY, on ? 1 : 0);
}
// enum → store as string, default in the getter (see getAppMode):
//   const v = await getSetting<Foo>(db, FOO_KEY); return v === 'x' ? 'x' : 'default';
```
`getSetting<T>` / `setSetting<T>` / `deleteSetting` already exist (generic KV).

### 2. `src/<name>/<Name>Context.tsx` — mirror AppModeContext exactly
- `useDatabase()` for the db.
- `useState(<safeDefault>)` — the default MUST render a correct UI during the
  pre-hydration window (e.g. `'plan'` = full app, `false` = flag unset).
- `useEffect([db])` hydrate: `getFoo(db).then(setState)`; `catch` → keep default
  (never trap the user behind a settings read error). Guard with a `mounted` flag.
- Setter: **compare against the current state captured in the callback deps**, not
  inside a render-phase state updater (a `setState(prev => ...)` side-effect would
  double-fire under StrictMode/dev). Optimistic: `setState(next)` then
  `await setFoo(db,next)` in a `try/catch` (persist failure non-fatal).
- `useFoo()` hook: `useContext` + throw if null ("must be inside <FooProvider>").
- `src/<name>/index.ts` barrel re-exports Provider + hook (+ types).

### 3. `app/_layout.tsx` — mount INSIDE DatabaseProvider
Order matters: it needs `useDatabase()`, so below `<DatabaseProvider>`. If the
provider/consumer also uses theme or app-mode, mount inside those too. There is
**no boot-order constraint** (it only gates UI that renders after the DB opens;
the safe default covers the hydration window) — unlike locale/theme which hydrate
from AsyncStorage before SQLite.

### 4. Settings UI (if user-facing)
Reuse the `RadioRow` (enum) or `Switch` (bool) pattern already in
`app/(tabs)/settings.tsx`; the handler no-ops if `next === current` then calls the
context setter.

## The "gate" variant (OnboardingProvider / RestoreGate)
When the context decides **whether to show a full-screen flow instead of the app**:
- Provider exposes a `status: 'loading' | 'active' | 'done'` (not just a value).
- A `<XGate>` component renders: `loading` → a neutral themed `<View bg=base/>`
  (avoids flashing app-then-flow); `active` → the flow; `done` → `children`.
  Mirrors RestoreGate's replace-children shape (expo-router tolerates the Stack
  being transiently unmounted).
- **Trigger guard**: a bare flag is often not enough. Onboarding's flag alone would
  wrongly fire for existing users upgrading (data but no flag) and restored backups.
  Fix = a one-time secondary check (e.g. `hasAnySession(db)`): show only when
  `!flag && !hasData`; if data exists, back-fill the flag `true` + skip. Keep the
  decision a **pure function** (`shouldShowX`) so it's jest-covered (see
  `src/domain/onboarding/onboardingFlow.ts`).
- A Settings "re-run" entry can call a `restart()` that sets `status='active'`
  **in memory only** (don't clear the persisted flag) — this also doubles as the
  cleanest sim-smoke trigger (no DB wipe needed; see ios-simulator-smoke).

## Pitfalls
- **Forgetting the safe default** → blank/half-rendered UI during hydration.
- **Enum getter must normalize** (`v === 'x' ? 'x' : 'default'`) — a stale/garbage
  value shouldn't crash.
- **Provider placement** — "Cannot find name db / useX must be inside Provider"
  means it's mounted above DatabaseProvider or the consumer is outside the Provider.
- **i18n** for any new copy: add to BOTH `zh` and `en` trees in
  `src/i18n/strings.ts` (a new top-level key becomes a valid `t()` namespace).

## Shipped instances
AppMode (ADR-0026, `src/app-mode/`), Theme (ADR-0025, `src/theme/`),
Unit (`src/unit/`, 2026-07-02), Onboarding (ADR-0029, `src/onboarding/` + the gate
variant, 2026-07-02).
