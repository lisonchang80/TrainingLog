# App Store Connect Metadata — Draft

> **STATUS: DRAFT — 2026-05-27**
> Placeholders prepared during TestFlight readiness work. User fills in
> the actual values when creating the App Record in App Store Connect.
> Bilingual zh-Hant (primary) + en-US (secondary).

## Identity (cross-locale)

| Field             | Value                                                |
|-------------------|------------------------------------------------------|
| Bundle ID         | `com.lisonchang.TrainingLog`                         |
| SKU               | `traininglog-001` (suggested — must be unique per dev account) |
| Primary Language  | Chinese (Traditional) — `zh-Hant`                    |
| Category          | Primary: Health & Fitness · Secondary: Lifestyle     |
| Age Rating        | 4+                                                   |
| Pricing           | Free                                                 |
| Availability      | (TBD — start with Taiwan only, expand later)         |

## Localised — Chinese (Traditional, `zh-Hant`)

| Field                    | Limit  | Draft value                                                                  |
|--------------------------|--------|------------------------------------------------------------------------------|
| App Name                 | 30     | `TrainingLog 訓練誌`                                                          |
| Subtitle                 | 30     | `離線的重訓紀錄與 Apple Watch 整合`                                            |
| Promotional Text         | 170    | `(填入 release-specific 重點，可隨更新替換、不需重審)`                          |
| Description              | 4000   | (詳細功能描述，未來補)                                                         |
| Keywords (comma-sep)     | 100    | `重訓,健身,訓練紀錄,Apple Watch,HealthKit,健身房,RPE,組數,計畫,日誌`           |
| Support URL              | URL    | `https://github.com/lisonchang80/TrainingLog`                                |
| Marketing URL            | URL    | (optional — 留空)                                                            |
| Privacy Policy URL       | URL    | (待 docs/PRIVACY-POLICY-DRAFT.md 發布後填入)                                 |

## Localised — English (US, `en-US`)

| Field                    | Limit  | Draft value                                                                  |
|--------------------------|--------|------------------------------------------------------------------------------|
| App Name                 | 30     | `TrainingLog`                                                                |
| Subtitle                 | 30     | `Offline weight log + Apple Watch`                                           |
| Promotional Text         | 170    | `(release highlight, can change without review)`                             |
| Description              | 4000   | (full description — TBD)                                                     |
| Keywords (comma-sep)     | 100    | `weightlifting,workout,gym log,strength,HealthKit,Apple Watch,RPE,sets,reps,fitness` |
| Support URL              | URL    | `https://github.com/lisonchang80/TrainingLog`                                |
| Marketing URL            | URL    | (optional — leave blank)                                                     |
| Privacy Policy URL       | URL    | (publish docs/PRIVACY-POLICY-DRAFT.md first, then paste URL)                 |

## TestFlight-specific fields

| Field                    | Required for                | Draft value                                              |
|--------------------------|-----------------------------|----------------------------------------------------------|
| Beta App Description     | External tester              | (短版本的 App Store description)                          |
| Beta App Feedback Email  | External tester              | `lisonchang80@gmail.com`                                 |
| What to Test (per build) | All builds (internal too)    | `(本次 build 重點：例如 "13c HealthKit foundation, 請試試在 Fitness 是否看見 workout cell")` |
| Demo Account             | External tester              | `N/A — App 無登入，全離線`                                 |
| Sign-in required?        | All                          | No                                                       |
| Contact First / Last     | All                          | (user 填)                                                |
| Contact Phone            | All                          | (user 填)                                                |

## Screenshots (External tester only)

iOS 17+ accepts a single 6.5" or 6.7" iPhone size class. Minimum 3,
maximum 10 per locale. Suggested set:

1. Home — three sub-tab overview
2. Active session — cluster editor + set logger
3. History calendar
4. Programs grid
5. Settings (theme picker)
6. (Optional) HealthKit integration — Fitness app cell showing a
   TrainingLog workout (capture AFTER the multi-size icon ships)

Capture via:

```bash
xcrun simctl io booted screenshot ~/Desktop/tl-shot-$(date +%H%M%S).png
```

Recommended simulator: iPhone 16 Pro Max (6.9"). Demo data first —
empty screens look bad.

## App Review Information

| Field                  | Draft value                                                                  |
|------------------------|------------------------------------------------------------------------------|
| Sign-in required?      | No                                                                           |
| Notes for reviewer     | `本 App 為個人重訓紀錄工具,全離線,所有資料儲存於裝置本機 SQLite。 HealthKit 為可選功能,首次進入訓練 session 會請求授權。 無第三方追蹤、無分析、無廣告。` |
| Contact info           | `lisonchang80@gmail.com`                                                     |

## Open decisions

1. App name — `TrainingLog 訓練誌` vs pure English in both locales?
2. Whether to publish the Privacy Policy under the existing
   `lisonchang80/TrainingLog` repo (`docs/privacy-policy.md` →
   GitHub Pages) or a separate `traininglog-legal` repo.
3. Whether to ship to Taiwan-only first or worldwide on day 1.
4. External tester list — beyond the developer, who is on the
   internal/external test cohorts?
