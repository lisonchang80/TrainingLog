---
name: reverse-sync-apply-surfaces
description: >
  Debug/extend iPhone→Watch reverse live-sync (Phase C-core / D32). When an
  iPhone edit during a Watch-led session does NOT show on the Watch (打勾/改值/
  排序/標題/備註/加刪 不同步), or you're adding a new reverse-synced field, walk
  the 3-layer chain: push fires → applyRemoteSnapshot maps to a @Published
  overlay → the Watch view reads `state.<override> ?? base`. Files: app/(tabs)/
  index.tsx (push), src/services/iphoneLiveMirrorProducer.ts + src/adapters/
  watch/handshake.ts (wire), ios/.../SessionInteractionState.swift (overlay +
  applyRemoteSnapshot), LiveMirrorProducer.swift (project), SetLoggerView.swift
  (render), WatchConnectivityCoordinator.swift (inbound).
---

# Reverse-sync (iPhone→Watch) apply surfaces

Phase C-core makes an iPhone edit during a Watch-led in-progress session show
on the Watch. The forward direction (Watch→iPhone) is D29; this is the reverse.
When something "doesn't sync", it is ALWAYS one of three layers. Diagnose in
order — don't rebuild blind.

## The 3-layer chain (diagnose in this order)

### Layer 1 — does the iPhone PUSH fire? (`app/(tabs)/index.tsx`)

The Today-tab edit handlers do OPTIMISTIC `setSetsInSession(...)` / `setSessionTitle(...)`
— they do **NOT** call `refresh()`. So a push placed only at the `refresh`
tail (the single collection point) MISSES them. Only `appendSessionExercise` /
delete-exercise / reorder go through `await refresh()`.

→ Every optimistic edit handler must call `pushMirrorIfWatchLed()` itself after
its DB write (per-handler). The helper gates on
`sessionState.status === 'in_progress' && sessionState.is_watch_tracked`
(`fromRow` DOES carry `is_watch_tracked` into the in_progress variant) and calls
`scheduleLiveMirrorPush(db, sid)` (280ms debounce, `applyDepth>0` self-no-op).

**Fast triage**: if add/delete EXERCISE syncs but a set-level edit doesn't, the
edit's handler is missing its `pushMirrorIfWatchLed()` (refresh covers exercise
ops; per-handler covers optimistic ones). ~15 handlers need it: onAddSet (2
branches), onUpdateSet, onToggleLogged, onUpdateNotes, onCycleSetKind,
onDeleteSet, onAddSetAfter, onAddDropsetRow, onRemoveDropsetRow, 3 cluster ops,
title `onUpdated`.

DON'T use a `useEffect` on `[setsInSession,…]` instead of per-handler: it can't
tell a local edit from an inbound-apply-driven refresh, so it echoes every Watch
tick back (and a time/skip-ref guard chronically suppresses iPhone edits during
active Watch logging). Per-handler is the only echo-free design (the WC inbound
path runs no edit handler).

### Layer 2 — does the WIRE carry the field?

Layer 2 is TWO stages — a field must survive BOTH or it never reaches Swift:

1. **DB → snapshot** (`fetchSessionSnapshot`, handshake.ts ~:1202 `bucket.map`).
   The SQL (`listSetsBySession`, setRepository.ts) SELECTs the column, but the
   `bucket.map((s) => ({...}))` projection must also COPY it onto the
   `SessionSnapshotSet`. A field that the type declares + the SQL selects but
   the projection forgets is silently `undefined` on the snapshot.
2. **snapshot → wire** (`iphoneLiveMirrorProducer.projectToWire`, omit-null).
   `:181 is_logged` always emitted; `:191 if (s.display_rank != null) …` is
   conditional. Omit-null collapses the stage-1 `undefined` to "absent" — so a
   stage-1 miss looks identical to a legitimately-null field. No Swift fix helps.

⚠️ The 2026-06-26 ③ bug lived in **stage 1**: `SessionSnapshotSet.display_rank`
existed in the type, `listSetsBySession` SELECTed `s.display_rank`, the producer
+ Swift apply + render were all correct — but `fetchSessionSnapshot`'s `bucket.map`
dropped `display_rank`, so it was never on the snapshot → omit-null hid it → the
Watch's `setRankOverrides` stayed empty. When a reverse field "has all the
plumbing but still doesn't arrive", grep `fetchSessionSnapshot`'s projection
FIRST — it's the easiest stage to forget because the type + SQL both look right.

### Layer 3 — does the Watch APPLY map it + does RENDER read the override?

The Watch base `SessionSnapshot` is **IMMUTABLE**. `applyRemoteSnapshot`
(`SessionInteractionState.swift`) writes only `@Published` OVERLAY fields. If
the renderer reads the base directly, an iPhone edit can't reach it.

| iPhone edit | overlay field written by applyRemoteSnapshot | render surface that must read it |
|---|---|---|
| 打勾 logged | `loggedSetIds` (insert/remove per `s.isLogged`) | `state.isLogged(setId)` ✓ existing |
| 改 weight/reps | `editedValues[EditedValueKey]` (when ≠ base) | `displayValue(…)` ✓ existing |
| 刪 set | `deletedSetIds` (formUnion, monotonic) | `mergeSets` filter ✓ |
| 加 set (既有動作) | `addedSets` (AddedSet) | `mergeSets` union ✓ |
| 加動作 | `addedExercises` | `SetLoggerView.visibleExercises` union ⭐ |
| 刪動作 | `deletedExerciseIds` (formUnion) | `visibleExercises` filter ✓ |
| 動作排序 | `exerciseOrderOverride` ([sessionExerciseId]) | `visibleExercises` sort ⭐ |
| **set 排序** | **`setRankOverrides[setId] = s.displayRank`** | **`mergeSets` `rankOverrides[id] ?? …`** ⭐ |
| **標題** | **`titleOverride = snap.title`** | **`state.titleOverride ?? snapshot.title`** ⭐ |
| 備註 | `notesOverride[setId/seId]` | `LongPressNoteOverlay` (3b 長按) + ⋯選單 (3a) |
| **set_kind (#/熱/D)** | **`setKindOverrides[id]` (set when `≠ base`, remove when `== base`)** | **`mergeSets`/`applyKindOverride` `kindOverrides[setId]`** ⭐ |

⚠️ The matched-set branch of `applyRemoteSnapshot` is a **per-field allow-list** — it
only writes the overlays it explicitly maps. It originally synced logged / weight /
reps / notes / display_rank but **silently OMITTED set_kind** (`cebde71`, 2026-06-28
device bug「熱身沒反映 / D# 多一行」). Symptom of an omitted matched-branch field:
the iPhone edit reaches the Watch snapshot fine (Layer 1+2 OK) but the matched row
ignores it. When adding a reverse field, add it to BOTH the matched branch AND the
added-set branch (and clear the override on the `== base` case, mirroring `logged`'s
insert/remove, so a revert un-sticks).

⭐ = needed a NEW overlay field AND a render-side `?? base` change (the base is
immutable; reading it directly is the #1 reverse-sync bug). Both must land —
adding the overlay field without changing the render surface is a silent no-op.

## Anti-bounce (don't break the forward direction)

- Watch side: `LiveMirrorProducer.applyingRemote` gate short-circuits
  `markDirty`/`emit` so the apply's @Published writes don't re-emit forward.
  `ReverseSyncApply.applyRemote` wraps the apply in begin/end (synchronous
  defer is enough — markDirty short-circuits at its TOP before scheduling).
- iPhone side: inbound `onLiveMirror + refresh` is wrapped in
  `runWhileApplyingRemoteSnapshot` (sets `applyDepth>0` → `scheduleLiveMirrorPush`
  no-ops). Echo-free because per-handler push only fires on user edits.
- Dedup: payload carries `originator:'iphone'` + monotonic `rev`; Watch
  `ingestReverseMirror` drops not-iphone + `rev <= lastAppliedIphoneRev[session]`.

## Finish / discard → Watch

Both reuse `pushEndToWatch(db, sessionId)` (sends `end-session {side:'iphone'}`;
the Watch handler runs `SessionController.end` → teardown). Finish: already in
`finalizeEndAndRoute` (index.tsx ~:2462). Discard: fire it in the 放棄 `onPress`
BEFORE the local delete, gated `in_progress && is_watch_tracked`.

## Stale-bundle gotcha (device dev-client)

A TS-only fix needs the device to reload the JS. **Shake → Reload is unreliable
on a dev-client; terminate + relaunch the app** (swipe it out of the app
switcher). Symptom of a stale bundle: a TS push fix shows the EXACT pre-fix
behaviour (e.g. exercise ops sync but set ops don't = the per-handler commit
didn't load). Always have the user hard-reload before concluding a TS push
"still doesn't fire".

## Reading the DEVICE's runtime — take over Metro + console.log probes

When the user can't read the Metro terminal (or you need the *device's* runtime
state, not the source), TAKE OVER Metro so its stdout (which includes the
device's `console.log`) lands in a file you can `grep`:

```bash
pkill -f "expo start --dev-client"           # kill the user's Metro
npx expo start --dev-client --port 8081 --clear > /tmp/metro-probe.log 2>&1 &  # yours, logged to file
# user reloads the app (it reconnects to :8081, shows "Downloading" = pulling from Metro)
grep "REVSYNC-PROBE" /tmp/metro-probe.log     # read the device's logs yourself
```

- **Confirm the device runs the latest JS** (rules out stale-bundle without a
  rebuild): fetch the bundle Metro actually serves and grep for a fresh symbol.
  The expo-router dev-client entry is
  `http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false`
  (NOT `/index.bundle` — that 404s with `UnableToResolveError`). A dev bundle
  keeps function names un-mangled, so `grep -c pushMirrorIfWatchLed` works.
  On-device "Downloading" (not "Bundling") = it IS pulling from Metro (this app
  has no expo-updates/OTA, verified — so Downloading is never a stale OTA).
- Add temporary `console.log('[REVSYNC-PROBE] ...')` at the push entry
  (`pushMirrorIfWatchLed`), the producer (`scheduleLiveMirrorPush`), AND inside
  `pushLiveMirrorToWatch` log the WIRE set list `{se, ord, setId, logged, rank}`
  — that proves Layer 1+2 from the device. Probes are uncommitted; `git checkout`
  the files to remove them after.
- **Behavioral disambiguation (push-vs-apply, no rebuild):** have the user
  toggle ✓ on the iPhone, THEN add an exercise. The add-exercise push carries
  the FULL snapshot incl. the toggled `logged:true`. If the new exercise appears
  on the Watch but the ✓ still doesn't → the Watch APPLY is broken (not delivery),
  because a known-working push carried the logged state and the Watch ignored it.

## 2026-06-26 device-session — ⑤/③ ROOT CAUSE = reverse apply matched by id, but iPhone re-keys (FIXED + device-verified)

**Confirmed STATICALLY (no diagnostic build needed) + device-verified ✅ (smoke
全過 ⑤③④+加動作).** Fix commit `d0048a8` (Swift) + `4d8ad9e` (③ wire).

**Root cause:** a Watch-led **template** start makes the iPhone mint FRESH
`session_exercise` + `session_set` uuids — `sessionFromTemplate.ts` does
`newSeId = snapshots[i].id` (~:201) and `setIdMap.set(ts.id, args.uuid())` (~:207).
So the reverse snapshot's ids (read from the iPhone DB) **never match this Watch's
immutable base ids** (built independently in `buildSnapshotFromFatTree` BEFORE the
iPhone created the session; the `created reply` carries only `sessionId`, not the
new ids). The original C-core `applyRemoteSnapshot` matched by id
(`sessionExerciseId` / `setId`), so:
- line ~631 `deletedExerciseIds.formUnion(baseKeys − snapExIds)` → ALL base
  exercises marked deleted; line ~632 → ALL iPhone exercises become `addedExercises`.
- line ~659 `guard baseExById[ex.sessionExerciseId] != nil` → nil for EVERY
  exercise → the **per-set loop is `continue`-skipped** → `loggedSetIds` (⑤) and
  `setRankOverrides` (③) NEVER populate.
- the renderer reads ✓/rank from those overlays by BASE id (ExerciseCard
  `state.isLogged(set.setId)`), so they stay empty → ⑤/③ never show.

This resolves the earlier **"deletedSets would hide ALL base sets — but they
DIDN'T vanish"** contradiction: the base sets ARE marked deleted, but the iPhone
re-adds them as `addedExercises` with identical content, so they're visually
unchanged in place — only the per-set ✓/rank overlay is missing. ④ title + 3a
add-exercise worked throughout because they don't depend on set-level base matching.

**The one-line framing:** the FORWARD reconcile (`replaceLiveMirror.ts`) was built
position/content-based PRECISELY because the ids diverge — exercises claimed by
`exercise_id` occurrence (~:304-336), sets by `(session_exercise_id, ordinal)`
(`SELECT … WHERE session_exercise_id=? AND ordering=?` ~:356). The reverse C-core
matched by id = the bug.

**Fix (`d0048a8`, mirror the forward identity):** in `applyRemoteSnapshot`, claim
base exercises by `exerciseId` occurrence (FIFO per id), match sets by `ordinal`,
**resolve each incoming row to its BASE setId**, and key every overlay (logged /
rank / edited / deletedSets) by the base setId = exactly what the renderer reads.
Genuinely-added exercises (no base match) keep the `addedExercises` path but ALSO
seed logged/rank/notes by their snap setId (the shared renderer reads them via
`state`). `ordinal` is reorder-stable (the wire ordinal is glued to identity;
reorder rides `display_rank`), so ③ works once `display_rank` is on the wire
(`4d8ad9e` — `fetchSessionSnapshot.bucket.map` had dropped it).

**Lesson:** before instrumenting a Watch rebuild, check whether the iPhone
RE-KEYS ids on the path under test (`sessionFromTemplate` / `replaceLiveMirror`
both do). If it does, any reverse-direction code that matches by id is broken by
construction — mirror the forward reconcile's position/content key instead. The
"base == render snapshot" check (both `SetLoggerView` bind `snapshotForRender`)
killed the divergence-of-base theory and pinned it to id matching, statically.

## Gotcha — handing a snapshot WITH state into SetLoggerView must seed the overlay (cast / 投影 Watch)

The reverse path above APPLIES onto an already-mounted `SetLoggerView` via
`applyRemoteSnapshot`. A different case — `cast-session` / 投影 Watch (2026-06-27)
— OPENS a fresh `SetLoggerView(snapshot:)` from an iPhone session that already
has state (some sets ✓'d). This hit a P0 data-loss bug:

**Symptom**: cast an in-progress session with logged sets → Watch shows them ALL
un-checked AND the iPhone's ✓s get cleared too ("兩邊都變未打勾").

**Root cause**: `SessionInteractionState.loggedSetIds` (the ✓ overlay) is EMPTY
on mount, and `isLogged(setId:)` reads ONLY the overlay — it NEVER consults the
snapshot's own `isLogged`. That's correct for Watch-led (a fresh start has
nothing logged), but a handed-over snapshot carries `isLogged=true` rows the
overlay never picks up. Worse: `LiveMirrorProducer.run()` does an **initial
full-tree push** on mount → it projects the empty overlay → Watch→iPhone forward
mirror carries `is_logged=false` for every set → the iPhone reconcile clears its
own ✓s. So an un-seeded overlay doesn't just mis-render, it round-trips the empty
state back and destroys the source.

**Fix (`b73e50b`)**: seed the overlay from the snapshot BEFORE the producer binds
its `$loggedSetIds` sink + does the initial push. `SessionInteractionState.
seedLoggedFromSnapshot(snap)` = `loggedSetIds = Set(snap.exercises.flatMap(\.sets)
.filter(\.isLogged).map(\.setId))`, called at the TOP of SetLoggerView's
live-mirror `.task` (before `liveMirror.configure(...)`). Seeding before the sink
binds → no spurious `markDirty`; the initial push then carries the CORRECT logged
state → iPhone reconcile = no-op (same state) instead of a clear. No-op for
Watch-led (all `isLogged=false` → empty set), so it's safe on every mount.

**Generalisation**: `loggedSetIds` is the ONLY pure-overlay-that-starts-empty
field — weight/reps/set_kind/notes all fall back to the base snapshot via
`displayValue(...)`, so they render correctly without seeding. If you add another
pure-overlay state (no base fallback), it needs the same seed-on-handover.

**Cold-launch route gotcha (`e02eff2`)**: the cast routes via `.onChange(of:
coordinator.pendingCast)` in `PickerRootView`. When the Watch app was CLOSED the
cast rides the TUI backstop, delivered DURING cold launch — often BEFORE the view
registers `.onChange` (which never fires for an already-set value). Add a `.task`
that ALSO reads `coordinator.pendingCast` on appear, deduped against `.onChange`
by the `CastRequest.token` (monotonic), so a queued cast routes exactly once on
next app open. (iOS has NO remote foreground-launch API — "open even when closed"
is impossible; the achievable half is "lands when the user opens the app".)

## 2026-06-28 — dropset (D#) reverse-sync: folds by array-adjacency, but iPhone ordinal-SHIFT breaks non-last (set_kind shipped, deep fix deferred)

set_kind reverse-sync shipped `cebde71` (matched-branch `setKindOverrides`). It
fully fixes **warmup** (kind-only, no row count change) and **dropset on the LAST
set** — but **dropset on a non-last set still corrupts** the Watch. Two facts pin
why, and the fix direction.

**Watch dropset folding is ARRAY-ADJACENCY, not parent-id matching.**
`ExerciseCard.SetRowGrouping.group(sets:)`: a `dropset` row with `parent_set_id ==
nil` opens a NEW cluster (chain HEAD); `parent_set_id != nil` appends to the
currently-open cluster; anything else (`working`/`warmup`) flushes it. So a
follower folds into the head purely by (a) being non-nil-parent AND (b) appearing
right AFTER the head in `mergeSets` display order. **The follower's parent VALUE is
never matched against the head's id** — so once the matched-branch flips the head's
kind to `dropset` (chain head, parent stays nil), the existing reverse-synced
follower folds in for free. Do NOT "resolve the follower's parentSetId to the base
head id" — it's unnecessary for folding AND it breaks the Watch→iPhone forward fold
(the round-trip needs the follower's parent to stay the iPhone's real head id).

**Why non-last dropset corrupts = iPhone ordinal SHIFT vs ordinal-based apply.**
`insertDropsetFollower` (`setRepository.ts:254`) does `UPDATE set SET ordering =
ordering + 1 WHERE session_id=? AND ordering >= newOrd` — it BUMPS every set after
the head. `fetchSessionSnapshot` sends the wire `ordinal = set.ordering`
(`handshake.ts:1204`). But `applyRemoteSnapshot` matches snap→base by **ordinal
value** against the IMMUTABLE base (frozen at start/cast, pre-shift). So for a
dropset on a non-last set, the follower's new ordinal collides with the NEIGHBOUR
base set's ordinal:
- Device trace (照片 `D1 / D2 / 1 / 1`): head(ord N) matches base → flips to D1 ✓;
  follower(ord N+1) collides with base neighbour(ord N+1) → that neighbour gets
  kind→dropset but `parent_set_id` stays nil → it becomes a SECOND head → renders
  **D2**; the real trailing sets (now ord N+2…) shift off the end → mis-render.
- After reverting D→working the Watch leaves residue (`1,2,2`): the matched branch
  never PRUNES `addedSets` that are no longer in the snapshot, so a follower added
  in a prior apply lingers.

This is the symmetric opposite of the FORWARD invariant: the Watch NEVER re-stamps
ordinals (added sets get dense max+1, base sets keep theirs) precisely so the iPhone
can match by `(se_id, ordinal)` value. The iPhone DOES re-stamp on dropset insert,
so reverse ordinal-matching is broken by construction — the same class of bug as the
2026-06-26 id-rekey one above, but on the ordinal axis instead of the id axis.

**Fix (implemented `30dc919`, branch `slice/13d-reverse-dropset-idmatch`, pending
device smoke):** `applyRemoteSnapshot` now matches **id-first, ordinal-fallback**.
Two passes per matched exercise: pass 1 claims base sets whose `setId` is in the
snapshot (cast / aligned-id); pass 2 ordinal-matches the rest among UNclaimed base.
A follower (fresh id) has no base match → `addedSet`; the shifted working sets keep
their ids → matched by id regardless of the bumped ordinal. Deletes = base sets
claimed by NEITHER pass. Plus a provenance-aware PRUNE: a new `remoteAddedSetIds`
set tags reverse-added followers, so one the iPhone later removes (D→工作 revert) is
dropped from `addedSets` (kills the 1,2,2 residue) while a Watch-LOCAL in-flight add
is preserved. `formIntersection` at the end keeps the tag set bounded.

⚠️ **Coverage = CAST / 投影 sessions only** (base carries the iPhone's REAL ids). A
**template-start (Watch-led)** session re-keys ids (2026-06-26) so NO id ever
matches → 100% ordinal fallback = the unchanged broken-on-non-last behaviour. The
ordinal fallback also keeps ⑤③④ byte-identical for template sessions (no
regression). Fully fixing template-start dropset needs the IPHONE to stop shifting
ordinals on insert (`insertDropsetFollower` → dense max+1 + display_rank, mirroring
the Watch's added-set model) — a separate iPhone-side change touching
set-ordering-surfaces, NOT yet done. The sibling report「超級組『新增1組』→ 手錶
編號 1,3,3,4」is re-tested in the same smoke (id-first may or may not cover it; if a
mid-list non-follower insert shifts ordinals it's the same iPhone-shift class).

---

## ⭐ 2026-06-28 — cast 雙向同時編輯本質脆弱 → 轉向「編輯鎖」(impl pending)

A cast / 投影 session runs FORWARD (Watch→iPhone) + REVERSE (iPhone→Watch)
**simultaneously**, so any Watch-initiated STRUCTURAL edit (set_kind / add / reorder)
while the iPhone is also live races against the echo. Device smoke (cast dropset)
surfaced a CASCADE of races, fixed in sequence, then the user **abandoned
simultaneous bidirectional editing entirely**. Read this before touching cast sync.

### Root causes + fixes shipped this round (integration/dropset-cast-smoke-2026-06-28)
- **Added-set apply was INSERT-only** (`SessionInteractionState.applyRemoteSnapshot`
  matched-exercise branch): an iPhone-added set (footer / +1) made into a dropset
  then reverted left the head frozen at `dropset` → lone「單行 D#」on Watch only
  (base sets fine — matched branch syncs them). Fix `c6476d5`: update an existing
  addedSet's fields in place (mirror matched per-field sync).
- **Watch add ids `ADD-<counter>` reset on relaunch** → cross-session collision →
  iPhone `localizeSetId` namespaces the INSERT (`replaceLiveMirror.ts:373`) → reverse
  echo carries a different id → Watch added-set dedup (by id) misses → DUPLICATE row
  (Watch 2, iPhone 1). Fix `8eb26d2`: mint `ADD-<UUID>` (collision-proof, iPhone
  adopts verbatim, no divert).
- **set_kind had NO provenance guard** (rank has `remoteRankedSetIds`, adds have
  `remoteAddedSetIds`, kind had nothing): a Watch-local working→warmup got stomped
  back to # by the next equal-base reverse push. Fix `8eb26d2`: add `remoteKindSetIds`
  — only clear an iPhone-provenance kind, never a Watch-local one. **The provenance
  trio is now rank + added + kind.**
- **Rapid working↔dropset cycling during sync** → head's working-flip + follower's
  row land in different ticks → ORPHAN dropset follower (kind=dropset, parent now
  working) → `setLabels.ts:41-46` renders BLANK box (iPhone) while Watch shows D1
  head = role SPLIT. Two-sided convergent fix: (ii) `replaceLiveMirror.ts` post-pass-2
  heal — demote a dropset row whose parent is NOT a dropset (`NOT IN (SELECT id …
  dropset)`, reads final DB state so an absent-but-in-DB head is left alone)
  `4c6c5de` +3 jest; (iii-a) `SessionInteractionState.swift` matched branch — when
  iPhone says working AND a Watch-local follower points at this head = invalid local
  chain the iPhone healed → clear the head override (converge) `b53cca2`. Follower
  converges via the added-set update branch.

### ⭐ The verdict: STOP fixing simultaneous-bidirectional, use an EDIT TOKEN
Even after all the above, **rapid taps still jump/flicker** — the overlay+echo model
is race-prone by construction. User decision 2026-06-28: **abandon simultaneous
bidirectional; one device edits at a time via a mutual-exclusion EDIT TOKEN.**
Grilled & 拍板'd (impl pending, Watch lock UI design delegated — no reference):
- ONE **edit token**; holder edits, the other = **read-only live mirror + lock
  overlay + 解鎖 button**. Sync stays **one-way** (holder→locked, live); unlock flips it.
- Initial holder = initiator (Watch-led→Watch; cast→iPhone, other locked).
- Transfer = locked side taps 解鎖 (never auto): 3-step handshake (request → holder
  flush final + release + ACK → taker apply + hold, holder locks). Timeout ~4s →
  user picks「強制取得控制權／保留鎖定」. Monotonic **token epoch** resolves
  offline-reconnect split-brain (stale holder sees newer epoch → self-locks).
- Lock scope = ALL interactions (even ✓ needs the token). Only when both devices
  have the session open (cast); single device = implicit holder, no overlay.
- The dropset/apply-correctness fixes above STAY (the one-way mirror still applies the
  holder's snapshot on the locked side — that's exactly the apply path). The
  ping-pong / rapid-tap fixes become belt-and-suspenders (no simultaneous edit can
  trigger them) but are harmless.
- Design captured in memory [[project-traininglog-name-notes-watch-batch]]; ADR to be
  written (new ADR superseding ADR-0019's simultaneous-bidirectional section).
