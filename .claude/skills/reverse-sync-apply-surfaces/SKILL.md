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

`iphoneLiveMirrorProducer.buildLiveMirrorPayload` re-reads via the shared
`fetchSessionSnapshot` (handshake.ts) then omit-nulls. Confirm the field is
SELECTed + put on the wire set/snapshot (e.g. `:191 if (s.display_rank != null)
wireSet.display_rank = …`, `:205 title: snap.title`). If it's not on the wire,
no Swift fix helps.

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
| 備註 | `notesOverride[setId/seId]` | ⚠️ NO on-card UI yet (visual-ref blocked) |

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

## 2026-06-26 device-session status (slice/13d-phase-c-device-2026-06-26)

Verified syncing: ① 加動作 / ⑥ 刪動作. Layer-3 fixes landed (titleOverride ④,
setRankOverrides ③) but **⑤ 打勾 + ③ set 排序 still NOT syncing as of last
report** — open. ⑤ has loggedSetIds apply (Layer 3 ok) so suspect Layer 1
(push not firing for onToggleLogged) OR stale bundle; ③ has the apply map +
render now, so suspect Layer 2 (does the iPhone set-reorder actually write
`display_rank` to DB for the surface the user reordered — 詳情頁 session/[id].tsx
is NOT push-wired, only index.tsx is) or a render not re-observing. Next session:
re-walk the 3 layers for ⑤/③ specifically; check `session/[id].tsx` reorder has
no `pushMirrorIfWatchLed` (only index.tsx was wired).
