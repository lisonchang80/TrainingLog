# TrainingLog

iOS weight-training log app for personal use, with App Store as the long-term goal.

## Tech stack

- **Framework**: Expo SDK (latest) + React Native + TypeScript
- **Routing**: expo-router (file-based, tabs template)
- **Storage**: SQLite via `expo-sqlite` (local-first); pure logic / adapter / UI separated under `src/{db,domain,adapters}` (see ADR-0001 onwards)
- **Health integration**: HealthKit via `@kingstinct/react-native-healthkit` (foundation shipped slice 13b 2026-05-26; data read + HKWorkout writer slice 13c-d). Originally planned as `react-native-health` but that package is legacy bridge + incompatible with New Architecture (forced on by `react-native-reanimated`'s Podspec).
- **Apple Watch**: in scope for v1 — separate native SwiftUI target, lands in slices 11–14 (per ADR-0008)
- **Backup / sync**: iCloud Drive whole-DB backup (per ADR-0011), lands in slice 15

## 導航地圖（agent 動手前先查這裡，省掉探索輪）

### 目錄職責

- `app/` — expo-router 路由（21 個 screen）。理想上是薄 glue，但三大 god-file 例外（見下）
- `components/<feature>/` — feature UI：`session/`（cluster-card、rest-timer、stats panel）、`template-editor/`、`exercise/`、`help/`（ⓘ 說明 + coach mark 系統）、`shared/`（set row、keypad、sheets）、`onboarding/`、`templates/`、`training/`
- `components/*.tsx`（頂層）— 全域 provider/gate：`database-provider`（DB context，36 處引用）、`restore-gate`、`backup-*`、`achievements-panel`、`body-*`
- `src/domain/` — 純函式（node-env 可測），子目錄按領域：`session/ set/ template/ program/ exercise/ pr/ achievement/ stats/ watch/ backup/ body/ …`。索引見 CONTEXT.md `## Domain 模組`
- `src/services/` — 跨層 orchestration（Watch push/receive、HK sync、backup/restore、Today tab 查詢 fan-out）。索引見 CONTEXT.md `## Services 模組`
- `src/adapters/sqlite/` — repositories（經 `Database` interface；prod=expo-sqlite、test=better-sqlite3）。注意 `sessionRepository` fan-in 23 檔
- `src/adapters/watch/` — WatchConnectivity TS 端 protocol（`payloadSchema.ts` envelope 定義、`handshake.ts`）
- `src/adapters/healthkit/` — HK `reader.ts` / `writer.ts`
- `src/db/` — schema migrations（`schema/vNNN_*.ts` + `migrate.ts`；新增用 `migration-new` skill）
- `src/i18n/` — `strings.ts`（全部 UI 字串 zh/en）、`dynamic.ts`（DB row 顯示翻譯）、`locale-persist.ts`
- `src/{theme,unit,app-mode,onboarding,achievements-enabled}/` — settings-backed context providers
- `src/components/history/` — 歷史頁 views（CalendarGrid / ListView / MonthGridView；歷史遺留位置）
- `ios/TrainingLog Watch Watch App/` — watchOS SwiftUI target（33 檔；入口 `SetLoggerView` / `SessionController` / `WatchConnectivityCoordinator`）
- `tests/` — jest node-env，鏡射 src 結構

### 功能 → 位置

| 要改什麼 | 去哪裡 |
|---|---|
| Today tab / 進行中 session UI | `app/(tabs)/index.tsx`（⚠ god-file，見下） |
| Rest timer | `components/session/rest-timer-modal.tsx` + `.behavior.ts` |
| Set row / 打勾 / dropset UI | `components/shared/{swipeable-set-row,set-row-content}.tsx`、`components/session/cluster-card.tsx` |
| Session 歷史詳情 | `app/session/[id].tsx`（⚠ god-file） |
| Template 編輯器 | `components/template-editor/template-editor-view.tsx`（in-memory draft = ADR-0016 決策）+ `src/domain/template/templateOps.ts` |
| 週期/課表（Programs）| `app/(tabs)/programs.tsx`、`app/program-wizard/new.tsx`、`src/domain/program/` |
| 動作庫 / 動作 CRUD | `app/(tabs)/library.tsx`、`app/exercise/*`、`exerciseLibraryRepository` |
| 動作歷史 / 圖表 | `app/exercise-history/[id].tsx`、`app/exercise-chart/[id].tsx` |
| PR / 成就 / 統計 | `src/domain/{pr,achievement,stats}/`、`achievementRepository`、`statsRepository` |
| Watch 同步（iPhone 端）| `src/services/watch*.ts` + `src/adapters/watch/`；WC listener useEffect 集中在 `app/(tabs)/index.tsx`。新 envelope kind → `wc-add-envelope-kind` skill |
| Watch App UI（SwiftUI）| `ios/TrainingLog Watch Watch App/` |
| HealthKit 讀寫 | `src/adapters/healthkit/`、`src/services/healthkitSessionSync.ts` |
| 備份 / 還原 / 匯出 | `src/services/{backupService,restoreService,jsonExport,restoreDepsWiring}.ts`、`components/restore-gate.tsx` |
| Onboarding（iPhone / Watch）| `components/onboarding/`（ADR-0029）、`WatchOnboarding.swift`（ADR-0030） |
| 頁面 ⓘ 說明 / coach mark | `components/help/`；文案在 `components/help/content/<pageId>.ts`（→ `page-help-overlay` skill） |
| UI 字串 / i18n | `src/i18n/strings.ts`（新 key 記得 zh+en 都加） |
| 主題色 / 單位 | `src/theme/`、`src/unit/` |
| 身體數據 | `app/body.tsx`、`components/body-*.tsx`、`src/domain/body/` |
| DB schema | `src/db/schema/`、`src/db/migrate.ts` |

### God-file 警示（先 Grep 定位、用 offset/limit 讀區段，別整檔讀）

- `app/(tabs)/index.tsx`（~4.6k 行 ≈ 49k tokens）— 混 Watch WC sync、session 狀態機、HealthKit finalize、PR 偵測
- `components/template-editor/template-editor-view.tsx`（~3.9k 行）— 大，但結構是 ADR-0016 記載的刻意設計；檔內「deliberately inlines」註解處勿 DRY
- `app/session/[id].tsx`（~3.6k 行）— session lifecycle + HK sync + snapshot
- `src/i18n/strings.ts`（~2.3k 行）— 加 key 用 Grep 找 namespace 再區段編輯

### 深入文件

- `CONTEXT.md` — 領域術語（`## Language`）、模組索引（`## Domain 模組`、`## Services 模組`）、實體關係（`## Relationships`）。按章節讀，別整檔載入
- `docs/adr/` — 30 篇架構決策；`docs/audit/` — 歷次審計報告；`docs/agents/` — issue tracker / triage / domain 文件慣例

## Development environment

- **Primary OS**: macOS (Mac mini M4 Pro) — switched from Windows 11 on 2026-05-06
- **Preview**: 
  - Slices 1-13a: iOS Simulator on Mac (`npx expo start` → press `i`) or Expo Go on iPhone (QR scan)
  - Slice 13b+: Bare workflow, Xcode build to real iPhone (Expo Go path retired). See `expo-bare-build-pipeline` skill.
- **Build / TestFlight / App Store submission**: Apple Developer Program ($99/yr) purchased on 2026-05-07 (order W1540856250); enrollment **active** since 2026-05-08 (Welcome to ADP + App Store Connect emails received). Required from slice 11 onwards (HealthKit + iCloud entitlements — `ios/TrainingLog/TrainingLog.entitlements`; no App Group is defined or used); slices 1–10 run on Expo Go without it.

## Testing

- `npm test` — jest with `ts-jest` preset, `testEnvironment: node`. Tests live in `tests/` and exercise pure logic / adapter code paths via the `Database` interface (production = expo-sqlite, tests = better-sqlite3 in-memory).
- **Pre-commit gate**: a `tsc --noEmit` + `npm test` hook blocks commits when types or tests fail (skipped for commits that touch no `.ts/.tsx`). Canonical source is tracked at [`.githooks/pre-commit`](.githooks/pre-commit); install/refresh the live hook with `./.githooks/install.sh`.

## Agent skills

### Issue tracker

GitHub Issues at `lisonchang80/TrainingLog` — operate via `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical roles, all using default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See [`docs/agents/domain.md`](docs/agents/domain.md).
