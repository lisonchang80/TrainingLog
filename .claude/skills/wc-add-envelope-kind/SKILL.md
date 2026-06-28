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

### Sub-variant — REVERSE producer (reuse the same kind the OTHER side already owns; e.g. iPhone→Watch `live-mirror` Phase B, 2026-06-25)

When the live kind already ships in one direction and you're adding the OTHER direction's producer, you do **NOT add a new kind** (skip Steps 1-3 entirely) — you reuse the existing kind + the existing receiver shape. The producer lives in a new `src/services/<x>LiveMirrorProducer.ts`. Gotchas validated building `iphoneLiveMirrorProducer.ts`:

- **Reuse the shared snapshot builder, but project to a NEW omit-null wire — do NOT reuse the `start-from-iphone` `snapshotToWire`.** WC payloads on ALL three channels are plist-serialised and **cannot carry JSON `null`** (`NSNull` isn't a plist type). The forward Swift producer's `JSONEncoder` OMITS nil optionals and the receiver's `parseLiveMirrorSnapshot` normalises ABSENT→null. So the reverse producer must likewise **omit null optionals** (`if (s.weight != null) wire.weight = s.weight`), NOT emit `weight: null`. `handshake.snapshotToWire` (private, for the `start-from-iphone` sendMessage reply) emits explicit null — byte-incompatible with the live channel — so write a dedicated omit-null projection in the producer. (Build the snapshot via the shared `fetchSessionSnapshot` — it already localises `exerciseName` (Bug Y) + carries notes.)
- **rev high-water is PER-DIRECTION — separate variables each side.** The iPhone receiver tracks the watch-rev high-water; the Watch receiver (Phase C) tracks the iphone-rev high-water. They must be DISTINCT counters (never shared) — each side stamps its own monotonic `rev` and gates only on the other side's.
- **Dual echo guard (both directions now exist → ping-pong is possible).** (1) Receiver `originator` drop: `onLiveMirror` drops `originator==='iphone'` (its own echo) BEFORE the rev claim; symmetric Watch receiver drops `originator==='watch'`. (2) **In-flight gate on the producing side**: while APPLYING a remote snapshot, suppress producing — else the applied snapshot → `refresh()` → push bounces straight back. Implement as a depth counter + `runWhile…` async wrapper (`finally`-releases on throw); the producer no-ops while depth>0 and **re-checks after its DB-read await** (the gate can close during the await). The ⚠️ critical one is the OTHER side's gate: the Watch forward `LiveMirrorProducer` subscribes to the same overlay a reverse-apply writes, so it would `markDirty`→bounce unless gated (worst case is a wasted round-trip + same-value no-op, NOT a loop, but close it).
- **Inject the transport for jest** — `interface LiveMirrorTransport { sendMessage; updateAppContext }`, default binds the real `connectivity` fns; tests pass a spy. Lets you assert the dual-fire dispatch (envelope kind + payload on BOTH channels) without bridge-mocking. `makeEnvelope` CLONES the payload into the envelope, so assert `toEqual` (deep), not `toBe` (ref), when comparing the sendMessage payload vs the appContext object.
- **Producer ships INERT until the receiver direction exists.** A pushed snapshot with no consumer has no observable effect — keep the producer + echo-drop on a branch (jest-green) and land the runtime wiring (edit-handler triggers + inbound-apply `runWhile…` bracket) WITH the receiving-side build in a device session. Wiring into the giant `index.tsx`/`session/[id].tsx` runtime files is un-jest-able + blind without the receiver → defer it, don't blind-wire. (`slice/13d-reverse-sync-phase-b` @ `7f0b30d`: producer + echo-drop + 14 jest, inert; wiring deferred to Phase C-core.)

## Variant — request-reply PULL (e.g. `handshake`, `history-request` 18th kind 2026-06-09)

A **pull**: Watch asks iPhone for data on demand (📊 tap, picker cold-load) and awaits a typed answer. The REQUEST is a modelled kind; the REPLY is **NOT** — it rides the `sendMessage` `replyHandler` ack. Deviations from the default 8 steps:

- **Only the REQUEST payload goes in `payloadSchema.ts`** (Step 1). The reply shape lives in the handler file (`watchHistory.ts` / the handshake reply in `handshake.ts`) because it pulls in SQLite/domain types — keep `payloadSchema.ts` WC-import-free. Don't add a second kind for the reply.
- **Reply-shape EVOLUTION (adding fields to an EXISTING reply) — skip the 8-step kind-add entirely.** No new kind, no `payloadSchema` change. You only owe three things: (1) **wire null rule** on every new nullable field (省 key, never explicit `null` — see bullet below); (2) **Swift tolerant-decode** the new field (`?` + `decodeIfPresent`, absence → sensible default, so an OLD Watch build ignores it and a NEW Watch build tolerates an OLD iPhone that omits it — bidirectional forward-compat); (3) **re-measure the worst-case envelope** if the reply is a FAT-TREE one (`handshake` Stage1). Validated 2026-06-13 Y-dup (Stage1 prefetch v3: flat → grouped + `variants[]`, jest-gated TS half `35deea4`, zero new kind).
- **Fat-tree replies crowd the 64 KB ceiling — adding fields RE-OPENS the size budget.** `handshake` Stage1 carries N template trees and is the one reply where field-adds have a real byte cost. When you add per-row wrappers (Y-dup's `variants[]` = templateId + triple per variant), the wrapper tax (~80 B × budget) eats ~1.5 KB and can blow a soft threshold. Two musts: (a) **DEDUP trees on the wire** — never send the same exercise tree twice (Y-dup: representative tree rides top-level `exercises`, `variants[0]` OMITS its tree → total trees stay = the variant budget, not 2×); (b) **model the TRUE worst case in the size test** — not the cheapest shape. The genuine worst case is the one with the largest wrappers (Y-dup: a multi-variant name group where every variant carries a full `(programId, subTag)` triple), not 20 bare singletons. `tests/adapters/watch/handshake.test.ts` size-budget test asserts both a documented soft threshold AND the hard `< 64_000` ceiling; the soft one is allowed to rise WITH a comment explaining the new tax, the hard one never moves (Q8 rejected raising the cap precisely because worst case crowds 64 K).
- **Step 5 uses `addMessageListener('kind', async (env, reply) => …)`** (request-reply needs the 2nd `reply` arg), NOT `addUserInfoListener`. Mirror `addMessageListener('handshake', …)`.
- **Step 4 handler = `onXxxRequest(db, env, replyHandler?)`** mirroring `onHandshakeRequest`: `if (!replyHandler) return;` (non-realtime channel → drop); query; `replyHandler(toWireRecord(reply))`. Never throws.
- **Reply carries an `ok` flag** so the Watch tells apart iPhone-side query error (`ok:false` → Watch error state) from a genuine empty result (`ok:true, records:[]` → "no data yet"). On `catch`, reply `ok:false` — do NOT hang and do NOT lie "empty".
- **display-ready over the wire** (Bug Y + `set-weight-unit-surfaces`): the iPhone resolves unit (`getUnitPreference`) + locale (`t('domain',…)`) and sends formatted strings; the Watch has neither table. Only raw FK ids (e.g. `exerciseId`) travel un-formatted.
- **Watch caller (Step 7) needs loading + error + empty + data states** (a pull can time out / be unreachable → error state, DISTINCT from genuine-empty). The pure record builder belongs in `src/domain/watch/` (unit-testable); the handler resolves unit/locale + DB read.
- **Reply payload 不要產 `null` — nullable 欄位用 `''`/sentinel 或省 key 表「absent」**。工程結論不變，但機制真相比舊版「null → NSNull → 7010」的一句話細（2026-06-12 稽核 F5 讀 RN `RCTTurboModule.mm` 實證後修文）。`toWireRecord` 是 no-op cast（`value as Record<…>`），JS `null` 原樣抵達 RN JSI 邊界後走兩條不同的路：
  - **dict 欄位值的 `null` 被 DROP — key 直接消失**：`convertJSIObjectToNSDictionary`（L142-145）在 `enableModuleArgumentNSNullConversionIOS` feature flag（預設關）下，`convertJSIValueToObjCObject` 對 null 回 `nil` → 該 key 不進 NSDictionary。這就是為什麼 handshake Stage1 reply（`handshake.ts:797-806` `parentId: r.parent_id ?? null` 等）滿地顯式 null 卻實機 N 次都正常 — 靠 RN 行為自動省 key，**不是 null 安全**。
  - **array「元素位置」的 `null` 一律轉 `kCFNull`（NSNull）保 index**（`convertJSIArrayToNSArray` L124-125）→ 這才是真正讓 `WCSession` 整包 reject（`payloadUnsupportedTypes` 7010）→ Watch 端看到 timeout/error 的路。把 null 塞進 array slot 的人必炸。
  - ⚠️ **RN 升級風險**：該 flag 若未來翻成預設開，dict-null 改走 NSNull → 現存所有顯式 null 的 reply builder（handshake = picker 命脈）一夕 7010 級全炸。所以規則維持「builder 端就不要產 null」：用 `''` sentinel 或條件式省 key（Swift decode 本就容忍 absent — `Stage1TemplateExercise` 註解明示 optional decode）。
  - 案例：2026-06-10 `WatchHistoryRecord.topSetLine` 定為 `''` 而非 `null`（pure-bodyweight 歷史曾因此壞；該欄位位於 records array 元素內的 dict）。Swift parse 對 `''`/absent 一律當「hidden」。
- **A PULL needs an explicit Watch-side watchdog — WC's errorHandler is NOT a reply timeout** (device-falsified 2026-06-11, ②). `errorHandler` only fires on **delivery failure**. A killed iPhone app is still `isReachable == true` (iOS wakes it in the background to deliver), so delivery succeeds — but the dead/booting JS layer never calls the native replyHandler → **neither closure fires → the continuation never resumes → spinner forever**. Fix pattern (`c026107`): a `@MainActor private final class XxxReplyOnce` resume-once box (`cont?.resume(…); cont = nil`) + a `Task { @MainActor in try? await Task.sleep(6s); once.resume(nil) }` watchdog; all three paths (reply / error / timeout) hop through `Task { @MainActor }` so the nil-out check-and-set is serialized — no lock, no `Sendable`-captured-`var` double-resume hazard (which only bites when the flag is a bare `var` mutated directly inside the concurrent WC closures). Late replies after timeout are discarded; the user's 重試 button then hits the now-woken app and succeeds fast.
- **The Watch reply view often lives inside a `.sheet` → it does NOT inherit `@EnvironmentObject`** (the coordinator). Don't reach for `@EnvironmentObject` in the pushed view; instead INJECT a pull closure (`typealias XxxLoad = (String) async -> ReplyType?`) built by the parent that DOES hold the coordinator (e.g. `SetLoggerView`) and thread it down through the cards. Closure capture sidesteps the sheet-environment break + keeps previews/tests coordinator-free. (2026-06-10: `ExerciseHistoryLoad` injected `SetLoggerView → SessionCardListPage → ExerciseCard/SupersetCard → ExerciseHistoryView`.)
- **Push the reply view via `NavigationLink(value:)` + `.navigationDestination(for:)`, NEVER `navigationDestination(isPresented:)` bridged from card-level @State** (device-falsified 2026-06-11, ③). The isPresented variant recreates its computed Binding on every parent re-render; set-logger cards re-render constantly in-session (live-mirror tick / set logging / page swipe), and a re-render racing the push makes watchOS occasionally mount the destination as stack ROOT — centered large title, NO back chevron. Value-based keeps push state inside the NavigationStack: a Hashable target struct (`DotsMenuHistoryTarget`), the 📊 row IS a `NavigationLink(value:)`, the stack root registers `.navigationDestination(for:)` once (`5a24bb4`). Shortening the nav title only treats the symptom.
- Validated 2026-06-09/10 (`history-request`, #311-A, **merged to main `6ed3d8f`, ①②③ device smoke 全綠**): pure builder + handler + mount + 13 tests; Swift `ExerciseHistoryView` 4-state + 手機-aligned card (topSet line + numbered rows) + coordinator `requestExerciseHistory` (6s watchdog); injected `load:` closure; value-based 📊 push (`5a24bb4`, re-smoke 無異常).

## Variant — interactive HANDSHAKE kind FAMILY (e.g. `lock-*` edit-token, ADR-0028, 2026-06-28)

When the new "kind" is really a **family** of kinds that together form a stateful handshake (request → grant → ack, + recovery kinds), don't treat each as an isolated durable/live kind — model the protocol as a **pure state machine** and let the kinds be its messages. Validated building the cast edit-token lock (`lock-request`/`lock-grant`/`lock-ack`/`lock-takeover`/`lock-sync`).

- **Add all family kinds in one pass through Steps 1-3** (union + tuple + 5 interfaces + WCMessage + WCPayloadMap + barrel + 5 `sampleFor` cases). The `sampleFor` exhaustiveness sentinel + `it.each` table cover them automatically.
- **The decision logic lives in a PURE reducer, not in the listeners.** Write `src/adapters/watch/<x>.ts` as a platform-agnostic state machine (`reduce(state, event) -> {state, effects}`, no React/native/clock) so jest proves the invariants (`editLock.ts` + `editLock.test.ts` — incl. a TWO-SIDE simulation that drives both reducers and asserts the cross-device invariant, e.g. "never two holders"). The iPhone hook + the Swift port are thin impure shells over the same logic → the two platforms can't drift.
- **Transport = DUAL-FIRE instant + durable** (NOT the live variant's appContext, NOT pure TUI): `sendUserInfo` (durable backstop, survives unreachable) FIRST + `sendMessage` (instant when reachable). A handshake is interactive (user is waiting) AND must not be lost (a dropped grant deadlocks) → needs both. Register BOTH `addMessageListener(kind, h)` AND `addUserInfoListener(kind, h)` for EVERY family kind (10 listeners for 5 kinds); the msgId ring dedupes the foreground double-delivery, and the reducer drops stale/duplicate by its own monotonic field.
- **A monotonic generation field (`epoch`) embedded in the existing stream kind** is the universal self-heal: stamp it on `live-mirror`/`cast-session` (optional, omit when 0 for pre-feature byte-compat), receiver applies at `==`, demotes/adopts at `>`, drops at `<`. This makes "I missed a transfer" and "I was force-taken over" the same code path — no separate reconcile.
- **Timeouts are events, not ad-hoc setTimeout in the view**: the reducer emits `start/cancel-timer` effects; the impure shell owns the actual timers and feeds `request-timeout`/`ack-timeout` back as events. Keeps the timeout transitions tested.
- TS half shippable + fully jest-tested INDEPENDENTLY of the Swift port (the pure machine + hook + overlay are RN/jest-verifiable); the Swift mirror lands in a device session (no compile feedback here). `slice/13d-edit-lock` `8871fb6`(protocol+machine)+`bf35b39`(iPhone) green, Swift deferred.

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
- **2026-06-12 起 intake 已 dedupe（稽核 F4 落地）**：`connectivity.ts`
  的 'message' 與 'user-info'（TUI）兩個 intake 共用同一 msgId ring——
  前景 dual-fire 的第二發（同 msgId、跨 channel）在 intake 就 drop，
  不會進 handler、也不會被 #287 Fix C replay buffer 收留重播。但 ring
  是 in-memory、不跨 app 重啟，TUI（OS 耐久佇列）可在 relaunch 後
  redeliver——**上述三件套（耐久層）仍必須保留，ring 只是第一道**。
  resend 類 path（如 `resendStartFromWatch`）mint 新 msgId、不被誤擋；
  無 msgId 的 legacy envelope 放行不 dedupe。

## Validation history

- 2026-05-29 evening — `start-resolve` (D31 wave 1). 6 new files / files touched. Compile + jest + xcodebuild green first try. Shipped @ 4b34bfd.
- 2026-05-29 late-evening — `discard-session` (D31 wave 2). 8 new files / files touched. Same pattern, also clean. Shipped @ 6e86c11.

Two clean trips through this 8-step dance in one day. Pattern proven; future D32/D33 envelope additions should follow this exact sequence.

## 相關 agent

- `@watch-connectivity-reviewer`（subagent）— 新 kind 寫完後丟給它審：TS↔Swift schema parity（每個 field 對得上）、handler never-throws 不變式、channel 選對（applicationContext / transferUserInfo / sendMessage）、雙向 send+receive 都接齊、payloadSchema 無 WC import、test 覆蓋。涵蓋本 skill 8 步最容易漏的 cross-device 破口。
