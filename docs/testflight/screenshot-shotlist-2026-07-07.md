# App Store Screenshots — Shot List & Capture Guide

> **STATUS: DRAFT — 2026-07-07.** A capture-ready plan for the App Store
> screenshot sets: required sizes, how many per size, and a numbered shot list
> with the **exact in-app navigation path** to each screen plus a bilingual
> marketing caption to overlay. Capture is **not** performed here — this tells
> the user precisely what to shoot and in what state.
>
> **Cross-links:** [`app-store-metadata-2026-07-07.md`](./app-store-metadata-2026-07-07.md),
> [`icon-spec.md`](./icon-spec.md).
>
> **Tab bar reference (5 tabs, per `app/(tabs)/_layout.tsx`):**
> `訓練 / Today` (index) · `計劃表 / Programs` · `動作庫 / Library` ·
> `訓練紀錄 / History` · `設定 / Settings`.
> ⚠️ In **極簡 (minimal) mode** the tab bar shows 4 tabs (計劃表 hidden) — shoot
> in **計劃 (plan) mode** so all features are visible.

---

## Required sizes & counts

Apple accepts **min 3, max 10** screenshots per device size, per locale. You
have **two locales** (zh-Hant, en-US) → capture each set twice (or reuse the
same images if captions are baked bilingual — but separate localized captions
look far more polished; recommended: one set per locale).

| Device size class | Required? | Pixel size (portrait) | Simulator/device to use | How many |
|---|---|---|---|---|
| **6.9" iPhone** | ✅ **Required** (primary) | 1290 × 2796 | iPhone 16 Pro Max / 15 Pro Max | 6–8 (from shot list) |
| **6.5" iPhone** | Optional if 6.9" provided | 1242 × 2688 or 1284 × 2778 | iPhone 11 Pro Max / 14 Plus | Apple upscales 6.9"→6.5" automatically; **you can skip** unless you want tuned framing |
| **6.7" iPhone** | Covered by 6.9" | — | — | — (6.9" set covers it) |
| **iPad 13"** | ⚠️ **Required IF iPad build ships** | 2064 × 2752 | iPad Pro 13" (M4) | 3–4 — see note ⚠️ below |
| **Apple Watch** | Optional (recommended — it's a headline feature) | 410 × 502 (S9/S10 45mm) | Apple Watch Series 10 / Ultra | 2–3 (Watch shots #7–#8) |

> ⚠️ **iPad decision (blocker if left ambiguous).** `app.json` has
> `ios.supportsTablet: true`, so the archive is a **Universal** build and App
> Store Connect will **require at least one 13" iPad screenshot set** before you
> can submit. Two paths:
> 1. **Keep iPad support** → capture the iPad set (shots #1–#4 render fine on
>    iPad; verify layout isn't broken first).
> 2. **Go iPhone-only** → set `supportsTablet: false`, re-prebuild, rebuild —
>    then no iPad screenshots are needed. This is a native change, out of scope
>    for this doc; flagged as an open decision.
>
> `[PLACEHOLDER]` — user picks iPad path before submit.

---

## ⚠️ Pre-capture requirement: seed demo data

Several screens look empty/sad without training history. **Before capturing,
populate a demo dataset** (a few weeks of sessions across 2–3 programs, with
PRs and at least one achievement unlocked). Shots that **require seeded data**
are marked **[需資料]** below. Shots marked **[空畫面 OK]** are fine on a fresh
install.

- Fastest seeding path: use the `sim-db-seed-smoke` skill to inject DB state,
  or manually log ~10–15 sessions across a couple of templates.
- Capture command (simulator):
  ```bash
  xcrun simctl io booted screenshot ~/Desktop/tl-shot-$(date +%H%M%S).png
  ```
- Turn **off** the dev warning-toast overlay before shooting (Release build, or
  dismiss it) so it doesn't appear in the frame.

---

## Shot list (pick 6–8 for the iPhone set)

Order below = suggested App Store ordering (strongest first). Captions are
suggestions; keep them ≤ ~6 words so they read at thumbnail size.

### Shot 1 — Active session: set logger with a cluster / dropset **[需資料 optional]**
- **Path:** `訓練 (Today)` tab → tap a template/plan card → **開始訓練** → the
  in-session set-logger screen with a superset or dropset cluster visible, one
  set ✓-checked.
- **Why:** the core loop. Show weight/reps/RPE + a cluster card.
- **Caption zh:** `專注記錄每一組`
- **Caption en:** `Log every set, faithfully`

### Shot 2 — Today overview / home **[空畫面 OK but better 需資料]**
- **Path:** `訓練 (Today)` tab (default landing screen), showing today's
  plan/quick-start.
- **Why:** first impression; shows the entry point.
- **Caption zh:** `打開就能開練`
- **Caption en:** `Open and start training`

### Shot 3 — History calendar, a filled month **[需資料]**
- **Path:** `訓練紀錄 (History)` tab → Calendar view → a month with many
  training days marked.
- **Why:** demonstrates consistency/streak appeal; looks great when full.
- **Caption zh:** `回顧每一次訓練`
- **Caption en:** `See your whole month`

### Shot 4 — Trend chart / PR for an exercise **[需資料]**
- **Path:** `動作庫 (Library)` tab → pick an exercise → **動作歷史 / 圖表**
  (exercise-chart) → trend chart with a PR marker; or `訓練紀錄` → exercise →
  chart.
- **Why:** progress tracking + automatic PR detection — a headline benefit.
- **Caption zh:** `追蹤進步與 PR`
- **Caption en:** `Track progress & PRs`

### Shot 5 — Programs + templates grid **[需資料 optional]**
- **Path:** `計劃表 (Programs)` tab → the program/template grid with a few
  templates and intensity variants.
- **Why:** shows periodization / reusable templates.
- **Caption zh:** `計劃與可重用模板`
- **Caption en:** `Programs & reusable templates`

### Shot 6 — Exercise library with real demo photo **[空畫面 OK]**
- **Path:** `動作庫 (Library)` tab → an exercise detail page showing the real
  demo photo + muscle highlighting.
- **Why:** the built-in library with real photos + anatomy highlight is a
  differentiator and looks polished on a fresh install.
- **Caption zh:** `內建動作庫．真人示範`
- **Caption en:** `Real-photo exercise library`

### Shot 7 — Apple Watch: live workout (HR + calories) **[Watch — 需 Watch sim/device]**
- **Path:** Apple Watch app → start a workout → the live set-logger screen
  showing live heart rate + calories (or the finish-stats screen).
- **Why:** wrist-first training is a signature feature. Use the Watch size class.
- **Caption zh:** `手腕開練．即時心率`
- **Caption en:** `Train from your wrist`

### Shot 8 — Settings: theme picker + iCloud backup status **[空畫面 OK]**
- **Path:** `設定 (Settings)` tab → scroll to 色彩主題 (theme radios) + 備份/還原
  (backup section showing "自動備份" + last backup status).
- **Why:** proves dark mode + iCloud auto-backup ("your data is always yours").
- **Caption zh:** `深色模式．iCloud 自動備份`
- **Caption en:** `Dark mode & iCloud backup`

### Optional extras (swap in if you want variety)
- **Fitness-app cell showing a TrainingLog workout** (HealthKit write proof) —
  Apple Fitness app → a workout entry written by TrainingLog. **[需 HealthKit + device]**
  Caption zh `寫回 Apple 健康` / en `Writes back to Apple Health`.
- **Achievements panel** with a tier unlocked — `設定` or history achievements
  entry. **[需資料]** Caption zh `解鎖成就` / en `Unlock achievements`.
- **Onboarding welcome** — fresh install first-run wizard. **[空畫面 OK]**

---

## Recommended final iPhone 6.9" set (8 shots)

For the strongest store page, ship these 8 in order:
**1 (session) → 4 (PR chart) → 7 (Watch) → 3 (history calendar) → 5 (programs)
→ 6 (exercise library) → 8 (settings/backup) → 2 (today home)**.
Front-load the differentiators (logging, progress, Watch); end with the calm
home + settings shots.

## Caption styling notes
- Overlay captions on a solid brand-color band (the blue dumbbell brand — see
  `docs/testflight/icon-spec.md` / `assets/logo/`), not directly on the UI.
- Same font size + weight across all 8 (English long words: keep uniform size,
  wrap to 2 lines centered — do NOT auto-shrink to fit).
- Bilingual: produce a zh caption set and an en caption set; attach each to the
  matching localized screenshot set in App Store Connect.

## Checklist before uploading
- [ ] Demo data seeded (all **[需資料]** shots look full).
- [ ] Dev warning-toast / debug overlays off.
- [ ] 計劃 (plan) mode active (all 5 tabs visible).
- [ ] 6.9" set captured at 1290×2796.
- [ ] iPad decision resolved (capture 13" set OR set `supportsTablet:false`).
- [ ] Watch set captured (optional but recommended).
- [ ] Both locales' caption sets prepared.
