---
name: patch-package-rn-lib
description: How to patch a node_modules React Native library in TrainingLog (the repo already uses patch-package). Use when you must change behaviour inside a dependency — e.g. disable a library feature, fix a bug upstream won't take, tune internals. Trigger: 「patch library」「改 node_modules」「patch-package」, patch a dependency, library bug workaround. Covers which file Metro actually bundles + the Metro-cache gotcha.
---

# Patch a node_modules RN library (patch-package)

TrainingLog already has patch-package wired: `package.json` has
`"postinstall": "patch-package"` + devDeps `patch-package` / `postinstall-postinstall`,
and `patches/` holds existing patches (e.g. `react-native-watch-connectivity+2.0.0.patch`,
`react-native-draggable-flatlist+4.0.3.patch`). So patching is a first-class,
zero-new-tooling move here.

## Recipe

1. **Find which file Metro actually bundles** — do NOT assume `main`/`lib`.
   ```bash
   node -e "const p=require('<lib>/package.json'); console.log('main',p.main,'\nmodule',p.module,'\nreact-native',p['react-native'],'\nsource',p.source)"
   ```
   Metro's resolver uses `resolverMainFields = ['react-native','browser','main']`,
   so if the lib sets a **`react-native` field it wins** — and RN libs usually
   point it at uncompiled **`src/…`** (e.g. draggable-flatlist → `src/index.tsx`).
   Patch the file that field resolves to. (jest is separate — it uses `main`/the
   ts-jest path; only matters if a test imports the lib, which UI libs don't.)

2. **Edit the real source file** under `node_modules/<lib>/…` directly. Keep the
   edit minimal and tag it with a comment like `// TrainingLog patch (Bug #NNN) — …`
   so the diff is self-documenting.

3. **Generate / regenerate the patch:**
   ```bash
   cd /Users/hao800922/code/TrainingLog && npx patch-package <lib>
   ```
   Writes/overwrites `patches/<lib>+<version>.patch`. Re-run after any further
   edit to the same lib — it always diffs the whole package against pristine, so
   reverting a node_modules file then re-running drops that change from the patch.

4. **Commit the `patches/<lib>+<ver>.patch` file** (it's the source of truth;
   the postinstall hook re-applies it on every `npm install` / fresh worktree).

5. **Verify**: `node_modules/.bin/tsc --noEmit` (the patched node_modules file's
   own pre-existing type warnings show in the IDE but are NOT in the project tsc —
   tsconfig excludes node_modules; ignore them).

## The gotcha that costs time

**A node_modules change does NOT show up on a plain "Reload JS".** Metro caches
transformed modules. After applying/changing a patch you MUST restart Metro with
a clear:
```bash
cd /Users/hao800922/code/TrainingLog && npx expo start -c
```
Then Reload on device. Pure app-code (`app/`, `components/`, `src/`) edits are
fine with Reload JS — only the dependency change needs `-c`.

## When NOT to patch

- A prop/option already exists → use it (check the lib's TS types first; don't
  patch what's configurable).
- The behaviour is reachable from your own code → fix it app-side.
- Verify the patch path actually executes: some libs have a nested vs non-nested
  code path (e.g. draggable-flatlist's `useNestedAutoScroll` ignores the
  `autoscrollSpeed` prop and hardcodes defaults — the prop only reaches the
  non-nested `useAutoScroll`). Read the source to confirm your edit is on the
  path your app hits before generating the patch.
