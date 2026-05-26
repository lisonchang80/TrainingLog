# iOS App Icon Spec — TrainingLog

> Generated 2026-05-27 as part of TestFlight readiness work.

## Current state

The icons in `ios/TrainingLog/Images.xcassets/AppIcon.appiconset/` are
**auto-downscaled placeholders** produced from the single existing
`App-Icon-1024x1024@1x.png` by `scripts/gen-ios-icons.sh` (which uses macOS
`sips`). They will pass TestFlight validation, but the small sizes (20pt /
29pt / 40pt) will look soft because they were not hand-tuned at those
resolutions. A designer should replace the 1024 source with the final art and
re-run the script.

## Spec table (iOS 17 / 18)

| Usage                    | Pt size  | Scale     | Pixels    | File                              |
|--------------------------|----------|-----------|-----------|-----------------------------------|
| iPhone Notification      | 20pt     | @2x       | 40×40     | App-Icon-20x20@2x.png             |
| iPhone Notification      | 20pt     | @3x       | 60×60     | App-Icon-20x20@3x.png             |
| iPhone Settings          | 29pt     | @2x       | 58×58     | App-Icon-29x29@2x.png             |
| iPhone Settings          | 29pt     | @3x       | 87×87     | App-Icon-29x29@3x.png             |
| iPhone Spotlight         | 40pt     | @2x       | 80×80     | App-Icon-40x40@2x.png             |
| iPhone Spotlight         | 40pt     | @3x       | 120×120   | App-Icon-40x40@3x.png             |
| iPhone App               | 60pt     | @2x       | 120×120   | App-Icon-60x60@2x.png             |
| iPhone App               | 60pt     | @3x       | 180×180   | App-Icon-60x60@3x.png             |
| iPad Notification        | 20pt     | @1x       | 20×20     | App-Icon-20x20@1x~ipad.png        |
| iPad Notification        | 20pt     | @2x       | 40×40     | (shares iPhone @2x)               |
| iPad Settings            | 29pt     | @1x       | 29×29     | App-Icon-29x29@1x~ipad.png        |
| iPad Settings            | 29pt     | @2x       | 58×58     | (shares iPhone @2x)               |
| iPad Spotlight           | 40pt     | @1x       | 40×40     | App-Icon-40x40@1x~ipad.png        |
| iPad Spotlight           | 40pt     | @2x       | 80×80     | (shares iPhone @2x)               |
| iPad App                 | 76pt     | @2x       | 152×152   | App-Icon-76x76@2x~ipad.png        |
| iPad Pro App             | 83.5pt   | @2x       | 167×167   | App-Icon-83.5x83.5@2x~ipad.png    |
| App Store Marketing      | 1024pt   | @1x       | 1024×1024 | App-Icon-1024x1024@1x.png         |

13 generated sizes + 1 marketing master = 14 total PNGs. Several iPad sizes
reuse iPhone @2x assets via the Contents.json manifest, so only 13 sizes are
emitted by the script. Apple requires the 1024 marketing icon to be **RGB
with no alpha** (verified via `sips -g hasAlpha` — current source complies).

## Workflow when the designer ships final art

1. Replace `ios/TrainingLog/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`
   with the new 1024×1024 RGB (no alpha) export.
2. From repo root: `./scripts/gen-ios-icons.sh`
3. Verify in Xcode: open `ios/TrainingLog.xcworkspace`, click the
   `Images.xcassets` → `AppIcon` set, confirm no warning badges.
4. Commit the 14 PNGs plus any Contents.json tweaks.

## Validation

```bash
# Confirm the 1024 marketing icon has no alpha channel (Apple rejects alpha).
sips -g hasAlpha ios/TrainingLog/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
# Expected: hasAlpha: no
```
