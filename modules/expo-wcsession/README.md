# expo-wcsession

**A New Architecture-native WCSession (Watch Connectivity) bridge for Expo / React Native — with a native inbound journal that makes silent event loss structurally impossible.**

Local Expo Module powering [TrainingLog](https://github.com/lisonchang80/TrainingLog)'s iPhone⇄Apple Watch sync. Written to replace `react-native-watch-connectivity` after its legacy `RCTEventEmitter` lane repeatedly went deaf under React Native's New Architecture (see [Motivation](#motivation)).

## Why another Watch Connectivity bridge?

Every existing RN bridge forwards `WCSessionDelegate` callbacks straight into an event emitter and hopes they arrive. When the emitter's observer bookkeeping breaks — which we reproduced repeatedly on long-lived processes under the New Architecture, and which upstream issue #287 shows happening in Release builds too — the envelope is gone. Worse, if the lost envelope was the durable `transferUserInfo` copy, the OS considers it delivered and never redelivers: **both lanes die silently**.

This module inverts the trust model:

```
WCSessionDelegate callback
        │
        ▼
┌─ WCSessionHub (native, process-singleton) ─┐
│  1. stamp (epoch, seq)                     │
│  2. append to ring buffer (256)            │   ← source of truth
│  3. emit JS event                          │   ← best-effort fast lane
└─────────────────────────────────────────────┘
        │                        │
        ▼                        ▼
   JS event listener      JS reconciler
   (normal path)          getLatestSeq() → gap? → getEventsSince(seq)
```

The JS event is now just a **hint**. The journal is the contract:

- `getLatestSeq(): { epoch, seq }` — what the native side has actually received.
- `getEventsSince(seq)` — pure read; pull everything the event lane dropped.
- `epoch` (per-process UUID) — a changed epoch means the phone process restarted and the ring is fresh; run your app-level full resync instead of a gap pull.

A JS runtime that goes deaf detects it by polling one cheap native call, and self-heals in-band. No app restart, no manual recovery, no lost data while the process lives.

### Cold boot: `drainPending`

Events that arrive before any JS listener exists (app cold start — WCSession activates in `OnCreate`, long before your JS subscribes) stay in the journal, undrained. `drainPending(channel)` hands them over **exactly once** (native per-channel watermark; live emissions to an observed channel advance the watermark automatically). This replaces `RCTEventEmitter`'s fragile `hasObservers`-gated `pendingEvents` flush with a buffer you own.

### Reply bridging

`didReceiveMessage:replyHandler:` closures can't cross the bridge, so the hub parks each one under a generated `replyId` that travels inside the event body. Answer with `replyToMessage(replyId, payload)`. Parked handlers are GC'd after 10 s **without** an auto-reply — the sender's own WCSession timeout stays the single source of timeout semantics, so counterpart fallback UX is unchanged.

## API

```ts
import * as WCSession from 'expo-wcsession';

// state
await WCSession.getIsPaired();
await WCSession.getIsWatchAppInstalled();
await WCSession.getReachability();

// outbound
await WCSession.sendMessage({ kind: 'ping' }, /* wantsReply */ true); // → reply dict
WCSession.transferUserInfo({ kind: 'durable' });   // OS-queued, survives unreachability
WCSession.updateApplicationContext({ kind: 'latest-state' });

// inbound (fast lane)
const unsub = WCSession.addMessageListener(({ seq, epoch, payload, replyId }) => {
  if (replyId) WCSession.replyToMessage(replyId, { ok: true });
});
WCSession.addUserInfoListener(...);
WCSession.addApplicationContextListener(...);
WCSession.addReachabilityListener(({ reachable }) => ...);

// journal (truth lane)
WCSession.getLatestSeq();          // { epoch, seq } | null
WCSession.getEventsSince(lastSeq); // [{ seq, epoch, channel, payload, replyId? }]
WCSession.drainPending('message'); // exactly-once cold-boot catch-up
```

`compat.ts` additionally exposes a drop-in for the `react-native-watch-connectivity` call surface (callback-style `sendMessage`, `watchEvents.addListener` with the old `(payload, replyHandler)` / user-info-array contracts) so an existing codebase can swap `require()` targets and migrate incrementally.

## Scope

iPhone-side only, and deliberately thin: interactive messages, durable user-info transfers, application context, reachability, and the journal. No file transfers, no complication pushes — the watch side is your own `WCSessionDelegate` Swift anyway. Degrades gracefully (no-ops / `false` / `[]`) when the native module is absent (Jest under `testEnvironment: node`, non-iOS platforms).

## Design notes

- **Everything lives in `WCSessionHub`**, a process singleton, because `WCSession.default` has exactly one delegate. The Expo module instance is a translation layer that Expo may recreate on dev reloads; the hub survives.
- All hub state is confined to one serial queue; delegate callbacks arrive on arbitrary threads.
- Ring capacity 256 is sized for the reconciliation window, not history: observed deaf-window bursts are <20 envelopes.
- Reachability changes bypass the journal by design — they're state, not data; the poll-based reconciler re-reads state anyway.

## Verification

- Jest: consumer-side contract tests run against the compat surface (300 suites in the host app).
- Live: full bidirectional matrix on **paired iOS + watchOS simulators** with real WCSession traffic (handshake, watch-led session start/end, live set/HR mirroring, an edit-lock 3-step handshake over the reply bridge, durable-lane delivery) — see the host repo's `scripts/sim-wc-smoke-env.sh` for the reproducible environment.
- Real-device smoke as the final gate.
