# TrainingLog

iOS weight-training log app for personal use, with App Store as the long-term goal.

## Tech stack

- **Framework**: Expo SDK (latest) + React Native + TypeScript
- **Routing**: expo-router (file-based, tabs template)
- **Storage**: SQLite via `expo-sqlite` (local-first); pure logic / adapter / UI separated under `src/{db,domain,adapters}` (see ADR-0001 onwards)
- **Health integration**: HealthKit via `react-native-health` (planned; requires Expo Dev Build, lands in slice 13)
- **Apple Watch**: in scope for v1 — separate native SwiftUI target, lands in slices 11–14 (per ADR-0008)
- **Backup / sync**: iCloud Drive whole-DB backup (per ADR-0011), lands in slice 15

## Development environment

- **Primary OS**: macOS (Mac mini M4 Pro) — switched from Windows 11 on 2026-05-06
- **Preview**: iOS Simulator on Mac (`npx expo start` → press `i`) or Expo Go on iPhone (QR scan)
- **Build / TestFlight / App Store submission**: Apple Developer Program ($99/yr) purchased on 2026-05-07 (order W1540856250); enrollment **active** since 2026-05-08 (Welcome to ADP + App Store Connect emails received). Required from slice 11 onwards (HealthKit + App Group entitlements); slices 1–10 run on Expo Go without it.

## Testing

- `npm test` — jest with `ts-jest` preset, `testEnvironment: node`. Tests live in `tests/` and exercise pure logic / adapter code paths via the `Database` interface (production = expo-sqlite, tests = better-sqlite3 in-memory).

## Agent skills

### Issue tracker

GitHub Issues at `lisonchang80/TrainingLog` — operate via `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical roles, all using default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See [`docs/agents/domain.md`](docs/agents/domain.md).
