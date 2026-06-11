---
name: wc-add-envelope-kind
description: Add a new WatchConnectivity envelope kind end-to-end across TS protocol layer, iPhone orchestrator + receiver, Swift coordinator outbound, and Watch SwiftUI caller. Triggers — "新增 WC envelope kind", "新通訊 channel", "Watch ↔ iPhone 新訊息類型", "extend WC protocol". Owns paths: `src/adapters/watch/payloadSchema.ts`, `src/adapters/watch/index.ts`, `tests/adapters/watch/payloadSchema.test.ts`, `src/services/watchSession*.ts`, `app/(tabs)/index.tsx` useEffect listener block, `ios/TrainingLog Watch Watch App/WatchConnectivityCoordinator.swift`, and the Watch SwiftUI view that triggers the outbound (typically `SetLoggerView.swift` / `PickerRootView.swift`).
---

# WC envelope kind — end-to-end addition

## When to use

Adding a new message kind to the Watch ↔ iPhone WatchConnectivity protocol (per ADR-0019 § Slice 13d Amendment). Each new kind needs the full 8-step pipeline below; missing any step breaks compile or runtime.

Validated 2026-05-29 evening (D31 wave 1 `start-resolve`) + 2026-05-29 late-evening (D31 wave 2 `discard-session`). Same pattern, both shipped clean end-to-end without rework.

## When NOT to use

- Tweaking an existing envelope's payload shape — just edit `payloadSchema.ts` + update Swift mirror + propagate test fixtures. The 8-step dance is for NEW kinds.
- Adding a new envelope that only exists Watch-internal (no iPhone counterpart) — skip TS side entirely.
- Adding an iPhone-only event (no Watch involvement) — wrong skill, this is for cross-device WC.

## Variant — LIVE / non-durable kind (e.g. `live-mirror`, 2026-06-01)

The default 8 steps assume a **durable** kind (TUI / `transferUserInfo` + `addUserInfoListener`). A **live** kind (a repeating snapshot stream you want sub-1s, where a dropped tick self-heals on the next push) deviates:

- **Step 5 uses `addMessageListener('kind', …)`, NOT `addUserInfoListener`.** TUI is a durable FIFO queue — for a live stream it would replay stale snapshots late. Live kinds must NOT ride TUI.
- **Step 6 outbound = DUAL-FIRE but NO TUI**: `sendMessage` when `isReachable` (the instant <1s foreground channel, FIFO-ordered) + `updateApplicationContext` (background backstop, latest-state-replace). NOT `transferUserInfo`.
- **Anti-reorder guard required**: dual-fire + the late-delivering appContext backstop means the same/stale snapshot can arrive AFTER a fresher one. Stamp a monotonic `rev` (ms-since-epoch, `max(now, prev+1)`) on the producer; the receiver keeps a per-session high-water mark and drops `rev <= lastApplied` (claim BEFORE the await; roll back the claim on db-error so the same-rev backstop self-heals). See `onLiveMirror` (`watchLiveMirrorReceiver.ts`).
- **⚠️ Liveness gate required if the live kind UPSERTs lifecycle-owned rows** (e.g. a `session` row + its tree). The rev guard only orders ticks WITHIN a live session — it does NOT cross WC channels with the durable lifecycle kinds (`discard-session`/`end-session` ride `transferUserInfo`; the live kind rides `sendMessage`/`applicationContext`). There is **no cross-channel ordering**, so a tick already in flight when the user hits 放棄/完成 can land AFTER the discard/end and **resurrect the just-deleted session** (a zombie `ended_at = NULL` row) or re-INSERT a row that end-session's purge just removed. A high cadence (0.5s) + emit-on-mutation makes "in-flight tick at teardown" the COMMON case, not a corner. Mitigation: gate the receiver on session liveness before applying — `SELECT ended_at FROM session WHERE id=?`; if the row is ABSENT (discarded) or `ended_at IS NOT NULL` (finalized), drop the tick; and **never `INSERT` the lifecycle row from a live tick** (the start path owns creation — a live tick that finds no row is by definition late-after-discard). Defence-in-depth: also `stop()`/un-arm the producer at the START of the Watch abort/commit handler. (Surfaced 2026-06-01 as H1 in the `live-mirror` overnight audit — the `reconcileSessionTree` `INSERT INTO session … ON CONFLICT` had no liveness gate; the reverse Phase C live channel MUST carry one from day one.)
- **No new `watchSession<Verb>.ts` orchestrator** if a receiver already exists (live-mirror reused `onLiveMirror`).
- **`env.payload` IS the raw payload dict** (the snapshot), same shape both channels deliver, so one receiver serves both. Validated 2026-06-01 (`live-mirror`, 17th kind) — the reverse iPhone→Watch live channel (Phase C) will follow this same variant.

## Variant — request-reply PULL (e.g. `handshake`, `history-request` 18th kind 2026-06-09)

A **pull**: Watch asks iPhone for data on demand (📊 tap, picker cold-load) and awaits a typed answer. The REQUEST is a modelled kind; the REPLY is **NOT** — it rides the `sendMessage` `replyHandler` ack. Deviations from the default 8 steps:

- **Only the REQUEST payload goes in `payloadSchema.ts`** (Step 1). The reply shape lives in the handler file (`watchHistory.ts` / the handshake reply in `handshake.ts`) because it pulls in SQLite/domain types — keep `payloadSchema.ts` WC-import-free. Don't add a second kind for the reply.
- **Step 5 uses `addMessageListener('kind', async (env, reply) => …)`** (request-reply needs the 2nd `reply` arg), NOT `addUserInfoListener`. Mirror `addMessageListener('handshake', …)`.
- **Step 4 handler = `onXxxRequest(db, env, replyHandler?)`** mirroring `onHandshakeRequest`: `if (!replyHandler) return;` (non-realtime channel → drop); query; `replyHandler(toWireRecord(reply))`. Never throws.
- **Reply carries an `ok` flag** so the Watch tells apart iPhone-side query error (`ok:false` → Watch error state) from a genuine empty result (`ok:true, records:[]` → "no data yet"). On `catch`, reply `ok:false` — do NOT hang and do NOT lie "empty".
- **display-ready over the wire** (Bug Y + `set-weight-unit-surfaces`): the iPhone resolves unit (`getUnitPreference`) + locale (`t('domain',…)`) and sends formatted strings; the Watch has neither table. Only raw FK ids (e.g. `exerciseId`) travel un-formatted.
- **Watch caller (Step 7) needs loading + error + empty + data states** (a pull can time out / be unreachable → error state, DISTINCT from genuine-empty). The pure record builder belongs in `src/domain/watch/` (unit-testable); the handler resolves unit/locale + DB read.
- **Reply payload fields must NOT be `null` — use a `''`/sentinel for "absent"**. `toWireRecord` is a **no-op cast** (`value as Record<…>`), so a JS `null` reaches the RN bridge → becomes `NSNull` → `WCSession` rejects the WHOLE reply (`payloadUnsupportedTypes` 7010) → the Watch sees a timeout/error, not your data. (2026-06-10: `WatchHistoryRecord.topSetLine` had to be `''` not `null`, else pure-bodyweight history broke.) The Swift parse treats `'' / absent` as "hidden".
- **A PULL needs an explicit Watch-side watchdog — WC's errorHandler is NOT a reply timeout** (device-falsified 2026-06-11, ②). `errorHandler` only fires on **delivery failure**. A killed iPhone app is still `isReachable == true` (iOS wakes it in the background to deliver), so delivery succeeds — but the dead/booting JS layer never calls the native replyHandler → **neither closure fires → the continuation never resumes → spinner forever**. Fix pattern (`c026107`): a `@MainActor private final class XxxReplyOnce` resume-once box (`cont?.resume(…); cont = nil`) + a `Task { @MainActor in try? await Task.sleep(6s); once.resume(nil) }` watchdog; all three paths (reply / error / timeout) hop through `Task { @MainActor }` so the nil-out check-and-set is serialized — no lock, no `Sendable`-captured-`var` double-resume hazard (which only bites when the flag is a bare `var` mutated directly inside the concurrent WC closures). Late replies after timeout are discarded; the user's 重試 button then hits the now-woken app and succeeds fast.
- **The Watch reply view often lives inside a `.sheet` → it does NOT inherit `@EnvironmentObject`** (the coordinator). Don't reach for `@EnvironmentObject` in the pushed view; instead INJECT a pull closure (`typealias XxxLoad = (String) async -> ReplyType?`) built by the parent that DOES hold the coordinator (e.g. `SetLoggerView`) and thread it down through the cards. Closure capture sidesteps the sheet-environment break + keeps previews/tests coordinator-free. (2026-06-10: `ExerciseHistoryLoad` injected `SetLoggerView → SessionCardListPage → ExerciseCard/SupersetCard → ExerciseHistoryView`.)
- **Push the reply view via `NavigationLink(value:)` + `.navigationDestination(for:)`, NEVER `navigationDestination(isPresented:)` bridged from card-level @State** (device-falsified 2026-06-11, ③). The isPresented variant recreates its computed Binding on every parent re-render; set-logger cards re-render constantly in-session (live-mirror tick / set logging / page swipe), and a re-render racing the push makes watchOS occasionally mount the destination as stack ROOT — centered large title, NO back chevron. Value-based keeps push state inside the NavigationStack: a Hashable target struct (`DotsMenuHistoryTarget`), the 📊 row IS a `NavigationLink(value:)`, the stack root registers `.navigationDestination(for:)` once (`5a24bb4`). Shortening the nav title only treats the symptom.
- Validated 2026-06-09/10 (`history-request`, #311-A, **merged to main `6ed3d8f`, ①②③ device smoke 全綠**): pure builder + handler + mount + 13 tests; Swift `ExerciseHistoryView` 4-state + 手機-aligned card (topSet line + numbered rows) + coordinator `requestExerciseHistory` (6s watchdog); injected `load:` closure; value-based 📊 push (`5a24bb4`, re-smoke 無異常).

## The 8 steps

### Step 1 — TS protocol schema

`src/adapters/watch/payloadSchema.ts`:

1. Add to `WCMessageKind` union (line ~48-62)
2. Add to `WC_MESSAGE_KINDS` const array (line ~75-90) — keep alphabetical order within the same "family" (e.g. all `start-*` together)
3. Add new `XxxPayload` interface with doc-comment explaining:
   - Direction (Watch → iPhone vs iPhone → Watch)
   - When it fires (which UI action triggers)
   - Side effects (what the receiver does)
   - Semantic vs related kinds (e.g. `discard-session` vs `end-session`)
   - Transport (transferUserInfo / sendMessage / both)
4. Add to `WCMessage` discriminated union
5. Add to `WCPayloadMap` interface

### Step 2 — Barrel export

`src/adapters/watch/index.ts`:

```ts
export type {
  ...
  XxxPayload,
  ...
} from './payloadSchema';
```

### Step 3 — Test fixture

`tests/adapters/watch/payloadSchema.test.ts`:

Add a case to the `sampleFor<K>(kind: K)` switch:

```ts
case 'xxx-yyy':
  return {
    sessionId: 'sess-1',
    // ... payload-specific fields with sensible test values
  } as unknown as WCPayloadMap[K];
```

The `it.each(WC_MESSAGE_KINDS)` table auto-picks up the new kind. Without this case, TypeScript errors at line ~120 (`exhaustive: never` sentinel becomes reachable) AND the factory test fails.

### Step 4 — TS orchestrator (if needed)

If receiver does DB writes / side effects, write `src/services/watchSession<Verb>.ts`:

```ts
import type { Database } from '../db/types';
import type { WCEnvelope, XxxPayload } from '../adapters/watch';

export type XxxResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'bad-payload' | 'db-error'; message: string };

export async function onXxx(
  db: Database,
  env: WCEnvelope<'xxx-yyy', XxxPayload>
): Promise<XxxResult> {
  const { sessionId } = env.payload;
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, code: 'bad-payload', message: '...' };
  }
  try {
    // ... db side effects
    return { ok: true, sessionId };
  } catch (err) {
    return {
      ok: false,
      code: 'db-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
```

Mirror the `watchSessionResolve.ts` / `watchSessionDiscard.ts` pattern: never throws, returns structured result for caller telemetry.

### Step 5 — iPhone receiver wire

`app/(tabs)/index.tsx`:

1. Import the orchestrator:
   ```ts
   import { onXxx } from '@/src/services/watchSessionXxx';
   ```
2. In the useEffect that mounts the WC handlers, add:
   ```ts
   const unsubXxx = addUserInfoListener('xxx-yyy', async (env) => {
     await onXxx(db, env);
     refreshRef.current?.();  // if iPhone UI should re-render
   });
   ```
3. Add `unsubXxx()` to the return cleanup function.

### Step 6 — Swift coordinator outbound

`ios/TrainingLog Watch Watch App/WatchConnectivityCoordinator.swift`:

Add `sendXxxToiPhone(...)` method. Mirror `sendStartResolveToiPhone` / `sendDiscardToiPhone` pattern:

```swift
func sendXxxToiPhone(...) {
    guard let session, session.activationState == .activated else {
        lastOutbound = "xxx skip: not activated"
        return
    }
    // ... empty-field guards ...

    let envelope: [String: Any] = [
        "msgId": UUID().uuidString,
        "ts": Int64(Date().timeIntervalSince1970 * 1000),
        "kind": "xxx-yyy",
        "payload": [
            // payload fields
        ],
    ]

    session.transferUserInfo(envelope)
    var status = "tui"
    if session.isReachable {
        session.sendMessage(
            envelope,
            replyHandler: nil,
            errorHandler: { [weak self] err in
                Task { @MainActor [weak self] in
                    let ns = err as NSError
                    self?.lastOutbound =
                        "xxx msg ERR code=\(ns.code) \(err.localizedDescription)"
                }
            }
        )
        status = "tui+msg"
    }
    lastOutbound = "xxx \(status) sent ..."
}
```

Notes:
- **Dual-fire** (TUI + sendMessage when reachable) is standard for fire-and-forget outbound: TUI for queued / offline resilience, sendMessage for instant UX when iPhone is foregrounded.
- **Avoid `NSNull`** in the payload dict — WC framework rejects with WCError 7010 `payloadUnsupportedTypes`. Build dict conditionally and omit nil-value keys (iPhone TS-side receiver sees `undefined`, optional-chain checks handle it). Validated 2026-05-29 deep-night B1 fix.

### Step 7 — Watch SwiftUI caller

Wire the appropriate SwiftUI button / lifecycle event to call `coordinator.sendXxxToiPhone(...)`. Typical sites:

- `SetLoggerView.swift` — alert button closures, `.onChange` reacting to `coordinator.$lastReconcile`, FinishPageView's onAbort/onCommit closures
- `PickerRootView.swift` — picker selection callbacks

### Step 8 — Verify chain

```bash
# TS side
npx tsc --noEmit
npx jest tests/adapters/watch/payloadSchema.test.ts tests/services/watchSession<Verb>.test.ts

# Swift side
cd ios
xcodebuild -workspace TrainingLog.xcworkspace -scheme 'TrainingLog Watch Watch App' \
  -destination 'generic/platform=watchOS' -configuration Debug build
```

Watch for stale LSP "Property 'xxx-yyy' does not exist on type 'WCPayloadMap'" — that's the LSP not having re-indexed `payloadSchema.ts` yet. `tsc --noEmit` is the ground truth.

## Race conditions across concurrent handlers (D31 wave 2 learning)

iPhone's `addUserInfoListener` handlers run **concurrently**, not serialized. If you send 2 envelopes back-to-back where the second one needs to observe state changes from the first (e.g. start-resolve discards a row → start-from-watch resend expects it gone), the resend's `getActiveSession()` can race ahead of the discard's SQL commit and see stale state.

**Pattern**: insert a small explicit delay between the two on the Watch side:

```swift
coordinator.sendFirstEnvelope(...)
Task {
    try? await Task.sleep(nanoseconds: 800_000_000)  // 800ms — generous on real device
    await MainActor.run {
        coordinator.sendSecondEnvelope(...)
    }
}
```

800ms is generous on real device (iPhone 18.7.8 SQLite single-row delete < 50ms). User doesn't perceive lag if alert dismisses immediately + Watch UI stays on its current view.

**Why not iPhone-side serialization**: would require global lock on handlers, breaks the independence of unrelated kinds (e.g. concurrent `set-completed` + `hr-tick` shouldn't queue behind each other).

## Dual-fire kind 的 handler 必須對「重複投遞」全鏈 dedup — 含 UI 副作用（2026-06-11 learning）

一個 kind 走 dual-fire（`sendMessage` + `transferUserInfo` 後備、如
`end-session`）時，iPhone 在前景**兩發都會到**。「DB 閘門 idempotent」
不等於「handler idempotent」：

- **坑 1 — 閘門路徑的 UI 副作用照跑**：`end-session` 的 `ended_at` 閘門
  擋住了二次 HK sync / 成就 eval，但閘門分支裡的 `router.push`（原為
  iPhone-led already-ended 補跳頁設計）每發都執行 → **每場 Watch 完成
  iPhone 疊兩張完成頁**（修在 `1bb4d96`）。修法＝inbound listener 標記
  來源（`fromWatchInbound: true`），閘門對 Watch-led duplicate **不准
  導航**、只有 iPhone-led（user 真按了按鈕）才補跳。
- **坑 2 — 兩發毫秒級同時到的 TOCTOU**：第二發在第一發的 await 空檔讀到
  閘門欄位還沒寫 → 雙跑全部副作用。JS 單線程擋不住 async 交錯——加
  **in-flight `Set<sessionId>`（useRef）**：進場已在 set → 直接 return；
  `try/finally` 清除。
- **通則**：設計 dual-fire kind 時，把「同一 envelope 到兩次、且可能
  同時到」當 happy path 寫 handler——DB 閘門（耐久、跨重啟）+ in-flight
  set（同時抵達）+ 來源標記（UI 副作用只屬於對的 caller）三件套。

## Validation history

- 2026-05-29 evening — `start-resolve` (D31 wave 1). 6 new files / files touched. Compile + jest + xcodebuild green first try. Shipped @ 4b34bfd.
- 2026-05-29 late-evening — `discard-session` (D31 wave 2). 8 new files / files touched. Same pattern, also clean. Shipped @ 6e86c11.

Two clean trips through this 8-step dance in one day. Pattern proven; future D32/D33 envelope additions should follow this exact sequence.

## 相關 agent

- `@watch-connectivity-reviewer`（subagent）— 新 kind 寫完後丟給它審：TS↔Swift schema parity（每個 field 對得上）、handler never-throws 不變式、channel 選對（applicationContext / transferUserInfo / sendMessage）、雙向 send+receive 都接齊、payloadSchema 無 WC import、test 覆蓋。涵蓋本 skill 8 步最容易漏的 cross-device 破口。
