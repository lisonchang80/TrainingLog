# TrainingLog

iOS weight-training log app for personal use, with App Store as the long-term goal.

## Tech stack

- **Framework**: Expo SDK (latest) + React Native + TypeScript
- **Routing**: expo-router (file-based, tabs template)
- **Storage**: SQLite via `expo-sqlite` (local-first); pure logic / adapter / UI separated under `src/{db,domain,adapters}` (see ADR-0001 onwards)
- **Health integration**: HealthKit via `@kingstinct/react-native-healthkit` (foundation shipped slice 13b 2026-05-26; data read + HKWorkout writer slice 13c-d). Originally planned as `react-native-health` but that package is legacy bridge + incompatible with New Architecture (forced on by `react-native-reanimated`'s Podspec).
- **Apple Watch**: in scope for v1 — separate native SwiftUI target, lands in slices 11–14 (per ADR-0008)
- **Backup / sync**: iCloud Drive whole-DB backup (per ADR-0011), lands in slice 15

## Development environment

- **Primary OS**: macOS (Mac mini M4 Pro) — switched from Windows 11 on 2026-05-06
- **Preview**: 
  - Slices 1-13a: iOS Simulator on Mac (`npx expo start` → press `i`) or Expo Go on iPhone (QR scan)
  - Slice 13b+: Bare workflow, Xcode build to real iPhone (Expo Go path retired). See `expo-bare-build-pipeline` skill.
- **Build / TestFlight / App Store submission**: Apple Developer Program ($99/yr) purchased on 2026-05-07 (order W1540856250); enrollment **active** since 2026-05-08 (Welcome to ADP + App Store Connect emails received). Required from slice 11 onwards (HealthKit + App Group entitlements); slices 1–10 run on Expo Go without it.

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
