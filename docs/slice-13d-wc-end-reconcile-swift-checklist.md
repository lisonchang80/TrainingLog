# Slice 13d — WC ship-blocker E1/E2 Swift checklist (device session)

TS layer shipped on `slice/13d-wc-end-reconcile` (`a67260b`). This is the
Swift half — must be done with Xcode + real device (paired iPhone + Apple
Watch). See ADR-0019 § "WC Ship-Blocker Fixes E1/E2/E3" for the Q1–Q6
decisions and the `xcodebuild-watchos-realdevice-install` skill for the
build/install traps.

The TS side is **back-compat / inert** until this Swift lands: the new
`EndSessionPayload.endedAt` + `.snapshot` are optional, and
`finalizeEndAndRoute` only purges when a `snapshot` arrives. So nothing
changes on device until the Watch starts sending the fat end envelope.

## What the TS side now expects on the `end-session` envelope

```
payload: {
  sessionId: string,
  side: "watch",
  endedAt:  Int64 epoch ms,        // NEW — Watch's authoritative finish time (Q4)
  snapshot: { …SessionSnapshot… }, // NEW — final complete tree (Q1/Q2)
}
```

- `endedAt` → iPhone writes it as `session.ended_at` (correct duration +
  HK `[started_at, ended_at]` window even on delayed TUI delivery).
- `snapshot` → iPhone runs `reconcileEndSnapshot` (purge-by-membership).
  MUST be the **complete** tree (every exercise + every set), because the
  iPhone treats absence as deletion. A partial/empty snapshot is caught by
  the Q3 guards (finalize-only fallback) but the point is to send the full
  one. Same plist-safe shape as the D29 live-mirror applicationContext
  (nils omitted by JSONEncoder → absent keys; TS parser tolerates
  absent→null for the 5 nullable set fields).

## Swift changes — `WatchConnectivityCoordinator.sendEndToiPhone(sessionId:)`

File: `ios/TrainingLog Watch Watch App/WatchConnectivityCoordinator.swift`
(current body ~L118-210; `await sessionController.end()` HK teardown at
L133 stays FIRST and unchanged.)

1. **Build the final snapshot** from the live producer's current projected
   state — NOT the throttled applicationContext. Add a `currentSnapshot()`
   accessor on `LiveMirrorProducer` (it already projects `base` over
   `SessionInteractionState` in `project(base:state:)` ~L55; expose the
   latest projection) and encode it to a plist-safe `[String: Any]` with
   the SAME JSONEncoder path the live-mirror push uses (nils omitted — see
   the NSNull caveat at Coordinator L363). If the producer has no base yet
   (session never had a snapshot), omit `snapshot` → iPhone finalize-only.

2. **Extend the envelope payload**:
   ```swift
   let endedAt = Int64(Date().timeIntervalSince1970 * 1000)
   var payload: [String: Any] = ["sessionId": sessionId, "side": "watch", "endedAt": endedAt]
   if let snap = finalSnapshotDict { payload["snapshot"] = snap }  // omit when nil
   ```
   (Reuse the existing `ts` Int64 computation at L156 for `endedAt`.)

3. **Dual-fire transport (Q2 / E1)** — replace the hard `guard
   session.isReachable { skip }` (L139-145) so the end ALWAYS goes via
   `transferUserInfo` (OS-queued, delivered when iPhone next reachable),
   and ADDITIONALLY via `sendMessage` when reachable (instant):
   ```swift
   guard let session, session.activationState == .activated else { lastOutbound = "skip: not activated"; return }
   guard !sessionId.isEmpty else { lastOutbound = "skip: empty sessionId"; return }
   session.transferUserInfo(envelope)                     // always — E1 backstop
   if session.isReachable { session.sendMessage(envelope, replyHandler: nil, errorHandler: { … }) }  // instant when awake
   lastOutbound = session.isReachable ? "sent (msg+tui)" : "queued (tui)"
   ```
   Keep the WCError 7016 (`MessageReplyTimedOut`) swallow on the sendMessage
   errorHandler. The iPhone dedupes the dual delivery via the `ended_at`
   idempotent gate — both channels route to `finalizeEndAndRoute`.

   NOTE: the iPhone TUI listener (`addUserInfoListener('end-session', …)`)
   is already wired (TS commit `a67260b`); without this Swift `transferUserInfo`
   it simply never fires — that is the inert state.

## Smoke matrix (real device, after build+install per xcodebuild skill)

| # | Scenario | Expected |
|---|---|---|
| 1 | **E1 core** — start session, background/lock iPhone (or airplane-mode it), tap [完成] on Watch, then reopen iPhone | iPhone session is ended (no zombie); a new 開始訓練 works — NOT refused by "session in progress" |
| 2 | **E2 set** — mid-session delete one set on Watch, tap [完成] | that set is GONE from iPhone history (no orphan row) |
| 3 | **E2 exercise** — mid-session delete one exercise on Watch, tap [完成] | exercise + its sets gone from iPhone history |
| 4 | **Regression** — normal [完成] with no deletions, iPhone reachable | session in history with all sets intact; ended_at ≈ Watch finish time; HK workout written once |
| 5 | **endedAt** — finish on Watch while iPhone unreachable, reopen iPhone minutes later | history duration reflects the REAL finish time, not the reopen time |

Also confirm (Q5) the user's current DB has no pre-existing zombie
(`ended_at IS NULL` on a session they already finished) — if one exists,
clear it once via iPhone 結束/放棄; the fix only prevents new ones.

## After smoke passes

Cherry-pick `slice/13d-wc-end-reconcile` (ADR + TS + Swift commits) into
`main`, full-tree tsc + jest gate, push, then `git worktree`/branch
cleanup per the overnight skill. Until then the branch holds the slice.

## Deferred (not this slice)

- **E4** (MED) — collapse the dual `start-from-watch` listeners (TUI + v1
  sendMessage) so the conflict alert can't fire for a Watch-owned session.
- **E6** (LOW) — payloadSchema "13/14 kinds" stale comment (it's 16) +
  the two applicationContext wrapper fns with opposite shape contracts.
