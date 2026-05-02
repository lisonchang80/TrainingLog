# TrainingLog

iOS weight-training log app for personal use, with App Store as the long-term goal.

## Tech stack

- **Framework**: Expo SDK (latest) + React Native + TypeScript
- **Routing**: expo-router (file-based, tabs template)
- **Storage**: SQLite via `expo-sqlite` (planned; local-first)
- **Health integration**: HealthKit via `react-native-health` (planned; requires Expo Dev Build)
- **Apple Watch**: deferred — separate native SwiftUI watch app post-Mac purchase (nice-to-have)

## Development environment

- **Primary OS**: Windows 11 (developer machine)
- **Preview**: Expo Go on iPhone (scan QR from `npx expo start`)
- **Build / TestFlight / App Store submission**: requires macOS — planned for after Mac purchase. Use EAS Build (cloud) as interim option for dev clients.
- **Native iOS Simulator**: not available on Windows — use Expo Go on real iPhone instead.

## Agent skills

### Issue tracker

GitHub Issues at `lisonchang80/TrainingLog` — operate via `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical roles, all using default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See [`docs/agents/domain.md`](docs/agents/domain.md).
