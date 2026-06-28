# Submission-Readiness Checklist + Punch-List (2026-06-13)

> **Supersedes** [`submission-readiness-2026-06-03.md`](./submission-readiness-2026-06-03.md)
> (kept as history). That doc was a **code-quality** audit (migrations / hygiene /
> empty-state / i18n / coverage) + a now-largely-drained merge runbook; it
> predates slice 15 iCloud backup, slice 15b JSON export, #311/#312 Watch work,
> and Y-dup. This doc folds in the two fresh read-only audits run on
> 2026-06-13:
>
> - **Report 07** — `07-slice15-backup-ship-readiness.md` (slice 15 iCloud backup/restore full-chain ship-readiness; authoritative for the backup punch-list).
> - **Report 08** — `08-appstore-submission-readiness.md` (entitlements / signing / version / icon / privacy / metadata; authoritative for the submission blocker list).
>
> Doc-only synthesis. No build, device, or git mutation behind these claims —
> every status is sourced from reports 07/08 (which carry `file:line` evidence).
> Base: main `f9f637e` (slice 15b C6 wired).
>
> **Cross-links:** [`app-store-metadata-draft.md`](./app-store-metadata-draft.md) ·
> [`build-bump.md`](./build-bump.md) · [`icon-spec.md`](./icon-spec.md) · the
> Privacy Policy + App Privacy questionnaire docs (parallel-agent-owned).

---

## (a) Requirement scorecard

Legend: ✓ ready · ✗ blocker · ⚠️ should-fix/unverified · n/a not applicable.

| # | Requirement | Status | One-line | Source |
|---|---|---|---|---|
| 1 | HealthKit entitlement (host + Watch) | ✓ | both targets carry `com.apple.developer.healthkit` | R08 §1 |
| 2 | App Group entitlement | n/a | not present, not needed — Watch↔iPhone uses WatchConnectivity; CLAUDE.md's "App Group" line is stale/unused | R08 §1 |
| 3 | iCloud entitlement (CloudDocuments + container + ubiquity) | ⚠️ | host `.entitlements` has all 3 keys, container id consistent; but **text-edited** → signing path unverifiable until an archive proves it | R08 Blocker 5 |
| 4 | iCloud Developer-Portal registration / provisioning | ✗ | container `iCloud.com.lisonchang.TrainingLog` must exist in the Portal + be on the App ID; auto-signing fails unless registered via Xcode capability UI or `-allowProvisioningUpdates` | R08 Blocker 5a · R07 P2 |
| 5 | HK privacy usage strings (host) | ✓ | `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` present, specific (`Info.plist:48-51`) | R08 §2 |
| 6 | HK privacy usage strings (Watch) | ⚠️ | present via pbxproj `INFOPLIST_KEY_*`; grammatical but vaguer placeholder copy (Update key literally says "預留以符合 API 要求") | R08 Should-fix 7 |
| 7 | `NSUbiquitousContainers` | ✓ | present + well-formed (`Info.plist:52-63`) | R08 §2 |
| 8 | Privacy manifest `PrivacyInfo.xcprivacy` | ✓ | on main, wired into Resources, honest (no collected data, no tracking) | R08 §5 |
| 9 | Marketing version (host) | ✓ 1.0.0 | `Info.plist` / `project.pbxproj` / `app.json` all agree | R08 §3 |
| 10 | Marketing version (Watch) | ✗ | Watch `MARKETING_VERSION = 1.0` ≠ host `1.0.0` → ITMS rejects mismatched Watch CFBundleShortVersionString. Fix is ONLY on the unmerged branch | R08 Blocker 2 |
| 11 | Build number / ITMS-90478 | ✓ | Run-Script auto-bump stamps `date +%s` into both built plists → strictly increasing, no git churn | R08 §3 · `build-bump.md` |
| 12 | App icon (host) | ✓ | 13 sizes + 1024 master, RGB no-alpha verified | R08 §4 · `icon-spec.md` |
| 13 | App icon (Watch) | ✗ | Watch `AppIcon.appiconset` is EMPTY (placeholder Contents.json, no PNG). Icon exists ONLY on the unmerged branch | R08 Blocker 1 |
| 14 | `LSApplicationCategoryType` | ✗ | missing on main; `healthcare-fitness` value lives ONLY on the unmerged branch | R08 Blocker 3 |
| 15 | Privacy Policy + reachable URL | ✗ | HealthKit apps MUST have a privacy policy URL. Doc owned by parallel agent; needs publishing + URL into ASC. (Note: a `docs/PRIVACY-POLICY-DRAFT.md` may have just landed via that agent — confirm before submit) | R08 Blocker 4 |
| 16 | App Privacy questionnaire (ASC "nutrition label") | ⚠️ | draft exists on branch but its "iCloud/JSON-export NOT shipped" premise is now FALSE — both shipped → re-bless "Data Not Collected" | R08 Should-fix 6 |
| 17 | ASC metadata (name/subtitle/desc/keywords/release notes) | ⚠️ | drafted in [`app-store-metadata-draft.md`](./app-store-metadata-draft.md); several `[PLACEHOLDER]`s (URLs, keyword final cut, screenshots) | R08 Should-fix 8 |
| 18 | Screenshots | ✗ | not captured (min 3 per locale) | R08 Should-fix 8 |
| 19 | Dev-gating / no backdoors / no egress | ✓ | 0 `__DEV__`, no dev section/DB-reset/mock-toggle in Release; 0 fetch/XHR/WebSocket; Watch mocks are `#if simulator` / `#Preview` only | R08 §6 |
| 20 | watchOS bundling | ✓ | `SKIP_INSTALL=YES`, `WKCompanionAppBundleIdentifier` set, embedded under host | R08 §8 |
| 21 | Migration / schema data-safety | ✓ | v001→ chain monotonic, transaction-wrapped, zero data-destroying ops (carried from 2026-06-03 A-audit; unchanged) | R03 doc · still 🟢 per R08 |
| 22 | iCloud backup/restore CODE chain | ✓ (code) | no code-level blocker; R-01🔴 (fresh-install copy-in) fixed, R-02/R-03/R-05🟠 resolved; 1 narrow 🟠 (backup↔restore mutex) is restart-self-healing | R07 §1/§2/§6 |
| 23 | iCloud backup/restore DEVICE verification | ✗ | the entire native chain has NEVER compiled / run on device — all static API matching. Must device-smoke before ship | R07 P3 §7 |
| 24 | npm/lockfile alignment | ⚠️ | `expo-file-system` node_modules **19.0.22** vs lock/pkg **19.0.23** (Y-1). Metro runs on installed, but next `npm ci` swaps versions → build env drifts from lock | R07 P1 |
| 25 | `NSAllowsLocalNetworking = true` | ⚠️(benign) | Metro/dev LAN allowance; harmless in Release (no network calls). Optional drop for cleanliness | R08 Should-fix 9 |
| 26 | i18n single-locale leaks | ⚠️(cosmetic) | 16 render-gated leaks across 8 files; non-blocking polish | 2026-06-03 F-audit |

### Bottom line

The **code is submission-clean** — no backdoors, no network egress, honest
privacy manifest, data-safe migrations, and the iCloud backup chain has no
code-level blocker. Every real blocker is **packaging / signing / one unmerged
branch / never-run-on-device** plus the **never-published Privacy Policy**:

- 4 hard 🔴 land in one branch merge: **`chore/appstore-watch-readiness`** (Watch
  icon · Watch version `1.0`→`1.0.0` · `LSApplicationCategoryType`) + the
  questionnaire — items 10, 13, 14, 16.
- Privacy Policy publish + URL — item 15.
- iCloud signing first-archive proof — items 3/4.
- iCloud backup/restore + Y-dup + JSON-export device smokes — item 23.

---

## (b) Dependency-ordered punch-list

Each item: **owner** (you=agent / user / device-session) · **effort** ·
**device-gated?**. Ordered so each step unblocks the next.

### A1 — `npm install` lockfile align — owner: user · ~5 min · not device-gated (CLI)

`expo-file-system` is **19.0.22** installed vs **19.0.23** in lock+package.json
(R07 P1 / Y-1). Run `npm install` (NOT `npm ci`) to reconcile node_modules to the
lock, then `pod install` before any build. Soft-blocker: Metro works on the
installed version, but a fresh `npm ci` would swap it and drift the build env
from the lock. **Do this before A2** so the pre-archive build matches the lock.

### A2 — iCloud-entitlements first-sign pre-check — owner: user (Xcode/CLI) · one-time · **device-gated** (signing)

R08 Blocker 5 / R07 P2. The iCloud keys were text-edited in slice 15, not added
via Xcode's capability UI. **Hard-blocker — the app won't even install if the
distribution profile lacks the iCloud entitlement.** Either: open the workspace,
toggle the iCloud (CloudDocuments) capability once on the **host** target so
Xcode registers the container `iCloud.com.lisonchang.TrainingLog` in the Portal +
regenerates the profile (confirm no red error, team `XQTU89U2J2`); **or** archive
with `xcodebuild … -allowProvisioningUpdates`. **This is the highest-risk
unknown** — only a real archive reveals it. Prefer the Xcode UI archive per
`build-bump.md`.

### B3 — merge `chore/appstore-watch-readiness` — owner: user (rebase) + device (Xcode validate) · ~0.5–1 hr rebase + archive check · **device-gated**

Clears **3 of the 5 🔴** in one go: Watch AppIcon (item 13), Watch
`MARKETING_VERSION 1.0→1.0.0` (item 10), `LSApplicationCategoryType =
public.app-category.healthcare-fitness` (item 14) — and brings the
`submission-questionnaire.md` on-main. **Branch is stale** (merge-base ~27 behind
main per R08 / 2026-06-04 backlog) → **rebase is mandatory**, expect possible
conflicts in `project.pbxproj` / `Info.plist` (resolve toward main's current
build baseline + this branch's category/icon/version additions). Per the
2026-06-03 runbook it's the **archive-gate branch** and goes near-last in any
multi-branch merge. After rebase: open `ios/TrainingLog.xcworkspace`, confirm the
Watch `AppIcon` set has no warning badge + renders on-wrist, and version/category
match `build-bump.md`'s pre-archive checklist, then `git merge --ff-only`.

### C4 — Privacy Policy + published URL — owner: user (+ parallel-agent draft) · ~1–2 hr · not device-gated

R08 Blocker 4 / item 15. HealthKit apps **must** provide a privacy-policy URL.
The draft is owned by the **parallel privacy-policy agent** (a
`docs/PRIVACY-POLICY-DRAFT.md` may have just landed — confirm). Publish it to a
reachable URL (GitHub Pages on the existing repo is the contemplated path), then
paste the URL into ASC and into the metadata draft's Privacy Policy URL
`[PLACEHOLDER]`.

### C5 — App Privacy questionnaire re-bless — owner: user · ~30 min · not device-gated

R08 Should-fix 6 / item 16. The branch questionnaire's "iCloud/JSON-export NOT
shipped" premise is now FALSE (both shipped: slice 15 backup + slice 15b C6 at
`settings.tsx:240-252`). Re-confirm each App Privacy category is still **Data Not
Collected** — the DB goes to the *user's own* private iCloud (not a developer
server) and JSON export writes a local file — and drop the "NOT shipped" caveat.
Depends on B3 landing the questionnaire on-main. (Owned in part by the parallel
privacy agent — coordinate; don't double-edit.)

### C6 — ASC metadata + screenshots — owner: user · ~2–4 hr (screenshots dominate) · screenshots prefer device/sim

R08 Should-fix 8 / items 17, 18. Fill the [`app-store-metadata-draft.md`](./app-store-metadata-draft.md)
`[PLACEHOLDER]`s (support/marketing/privacy URLs, secondary category,
availability, app-name decision, trim en-US keywords to ≤100). Capture ≥3
screenshots per locale on seeded demo data, AFTER B3 (so the Watch icon is real).
Also tighten the Watch HK usage copy (R08 Should-fix 7) while in the branch.

### D7 — ~7–8 device smokes — owner: device-session · ~half day · **fully device-gated**

R07 P3 / item 23 — the iCloud backup/restore native chain has **never run on a
device** (all static API matching; Swift never compiled). Run as one device
session, bundled with the carried-over Y-dup 7-smoke + the C6 JSON-export Share
Sheet follow-up:

1. **fresh-install restore** (the main scenario; R07's R-01 fix is unverified on device)
2. **manual 立即備份** → visible in iCloud Drive
3. **rotate keep-2** (3rd backup evicts oldest)
4. **restore fallback** to the older copy when newest is corrupt
5. **version-guard** rejects a too-new DB
6. **escalation banner** (3-day auto / 7-day manual failure streak)
7. **Watch envelope does not trip restore** (sync vs restore isolation)
8. (+ Y-dup picker dedup smoke · + JSON-export button writes file / Share Sheet — R07 P4, deferred, `expo-sharing` not yet installed)
9. **健身 App 訓練列顯示品牌 logo**（⚠️ **必須在穩定 TestFlight build 上驗，不能用 dev 重裝的 build**）— 新建 1 筆訓練 → 開 iPhone 健身 App → 該筆訓練列的 icon 應是藍底白啞鈴（不是 Apple 通用啞鈴 glyph）。原理：Fitness 訓練列 icon＝寫入它的「來源 App」圖示，我們唯一寫入點是 iPhone `saveTrainingLogWorkout`（手錶端 `discardWorkout` 不寫 HKWorkout），來源恆＝iPhone 主 App。dev build 反覆 rebuild+重裝會 churn Apple 的來源圖示快取（每 build 自動 bump `CFBundleVersion`＋重裝失效快取）→ 暫時 fallback 成通用啞鈴；**穩定版本號的 TestFlight build 會像「訓記」一樣穩定顯示 logo**。code/資產皆正確、非 bug——此項只是 ship 前確認。若 TestFlight 仍 fallback，才當真 bug 查（屆時版本固定可排除快取因素）。2026-06-28 device 觀察（dev build 重裝 churn）確立。

> **Order rationale:** A1 makes the build reproducible; A2 must pass or nothing
> installs; B3 lands the three packaging 🔴 + questionnaire (and is the archive
> gate, so it pairs naturally with A2's archive dry-run); C4/C5/C6 are the ASC
> content gates (C5 depends on B3); D7 is the final device pass and can overlap
> C6's screenshot capture. **A2 and B3 are the two that gate the very first
> successful archive** — do them on the same Xcode session.

### Single most important blocker

**A2 — the unverified iCloud signing path (R08 Blocker 5 / R07 P2).** It is the
only item that can make the build fail to *archive/install at all*, it cannot be
verified statically (R08 "Residual unknowns" #1 flags it as the highest-risk
unknown), and it is one-time + cheap to clear — so it should be flushed first, on
the same Xcode session that does the B3 archive dry-run. The Watch-branch
blockers (B3) are well-understood and mechanical by comparison.

---

## Carried-over context (from the 2026-06-03 doc, still relevant)

- **Build-bump is now automated** (Run-Script `date +%s`), so the manual
  `agvtool` flow in `build-bump.md` is a fallback, not a per-archive chore.
- The 2026-06-03 **merge runbook** (Part 2) is largely drained per project memory;
  `chore/appstore-watch-readiness` is the **one carry-over that still matters** —
  it is B3 above.
- All 2026-06-03 **code-quality verdicts still hold** (migration-safe, hygiene
  clean, no first-run crash); the i18n leaks (item 26) remain cosmetic/non-blocking.
