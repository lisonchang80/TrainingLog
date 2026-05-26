# Build Number Bump Strategy

> Apple requires every TestFlight upload to have a **strictly higher**
> build number than the previous upload **within the same marketing
> version**. Forgetting to bump is the single most common cause of
> rejected uploads (error `ITMS-90478` / "Redundant Binary Upload").

## Where the build number lives

- `ios/TrainingLog.xcodeproj/project.pbxproj` →
  `CURRENT_PROJECT_VERSION = N;` (one entry per build configuration —
  currently Debug and Release, so two lines).
- `ios/TrainingLog/Info.plist` → `CFBundleVersion` =
  `$(CURRENT_PROJECT_VERSION)` substitution (so the pbxproj value wins).
- `VERSIONING_SYSTEM = "apple-generic"` is set in pbxproj, which lets
  `agvtool` modify all configs in lockstep.

## Recommended bump workflow (manual, no extra tooling)

Run from `ios/`:

```bash
cd ios
agvtool what-version       # prints the current build number
agvtool next-version -all  # bumps every config by +1
agvtool what-version       # confirm the new value
```

Stage and commit:

```bash
git add ios/TrainingLog.xcodeproj/project.pbxproj
git commit -m "chore(ios): bump build to <N> for TestFlight upload"
```

Then archive in Xcode and upload.

## Alternative — npm script template

If we want to surface this from the repo root, add the following to
`package.json` (NOT done in this commit — package.json is in the
overnight do-not-touch list):

```json
{
  "scripts": {
    "ios:bump-build": "cd ios && agvtool next-version -all && agvtool what-version"
  }
}
```

## Marketing version bumps (X.Y.Z)

Resetting the build counter is allowed when the marketing version
changes (e.g. 1.0.0 build 12 → 1.0.1 build 1). To bump the marketing
version:

```bash
cd ios
agvtool new-marketing-version 1.0.1
```

This updates `MARKETING_VERSION` in pbxproj. Remember to also update
`ios/TrainingLog/Info.plist` `CFBundleShortVersionString` and
`app.json` `version` so all three sources of truth stay aligned (see
docs/testflight/icon-spec.md for the recurring "keep these in sync"
theme).

## Pre-archive checklist

- [ ] `git status` clean on the working tree
- [ ] `agvtool what-version` reports a value higher than the last
      TestFlight upload (check App Store Connect → TestFlight → Builds)
- [ ] `agvtool what-marketing-version` matches the user-facing version
      you intend to ship
- [ ] Xcode → Signing & Capabilities shows team `XQTU89U2J2` and
      Automatically manage signing is enabled for the Release config
- [ ] Run `Product → Archive` from Xcode (not `xcodebuild` — automatic
      signing for distribution is much smoother via UI)
