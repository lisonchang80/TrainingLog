# `assets/help/` — screenshots for the 說明視窗 (InfoModal)

Real screenshots are the chosen visual for the 說明視窗 help style (user
decision 2026-06-29). They live here, one folder per page:

```
assets/help/
  today/
    idle.png
    in-session.png
  exercise-chart/
    e1rm.png
```

Reference them from a page's content file
(`components/help/content/<pageId>.ts`):

```ts
images: [
  { source: require('@/assets/help/today/idle.png'),
    caption: '空白訓練的三個區塊', aspectRatio: 16 / 9 },
],
```

> ⚠️ NEVER `require()` a path that isn't on disk yet — a missing asset breaks
> the Metro bundler for the whole app. Add the PNG first, then the `require`.

## Capture / refresh pipeline (screenshots go stale — this is the upkeep cost)

Because the app changes fast, a screenshot can drift from the live UI. Recapture
with the iOS dev-client simulator (NOT Expo Go — it NitroModule-crashes; launch
`com.lisonchang.TrainingLog`):

1. Boot the dev build and navigate to the page/state you want.
2. Capture at point resolution:
   ```bash
   xcrun simctl io booted screenshot /tmp/help-shot.png
   ```
   (or the `ios-simulator` MCP `screenshot` tool).
3. Crop to the relevant region (avoid the status bar / unrelated chrome) and
   downscale so the bundled asset stays small. `qlmanage`/`sips`:
   ```bash
   sips --resampleWidth 1200 /tmp/help-shot.png --out "assets/help/<pageId>/<name>.png"
   ```
4. Re-run the app — the InfoModal picks up the new asset on next bundle.

## When a page's UI changes

If you edit a page that has help screenshots, treat the screenshots as part of
that page's contract: recapture any shot that no longer matches, in the same
commit. The `help-reviewer` agent flags stale-looking shots, but it can't see
pixels — the author/wirer is responsible for freshness.
