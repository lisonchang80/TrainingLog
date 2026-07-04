import ExpoModulesCore

/**
 * ExpoWCSession — Expo Modules API surface over `WCSessionHub`.
 *
 * Thin by design: every piece of state and logic lives in the hub (a
 * process-singleton, because WCSession.default has exactly one delegate),
 * while this class only translates between the Expo runtime and the hub.
 * Expo recreates module instances on dev-menu reloads; `attach` simply
 * replaces the event sink each time. There is deliberately NO OnDestroy
 * detach — create/destroy ordering across a reload is not guaranteed, and
 * a stale sink is harmless (weak self → dropped call), whereas detaching
 * after the new instance attached would silence events entirely.
 */
public class ExpoWCSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoWCSession")

    Events("onMessage", "onUserInfo", "onApplicationContext", "onReachabilityChange")

    OnCreate {
      WCSessionHub.shared.attach { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      WCSessionHub.shared.activateIfNeeded()
    }

    // RCTEventEmitter-parity observer bookkeeping: only observed channels
    // count live emissions as delivered (see WCSessionHub.emitLocked).
    OnStartObserving("onMessage") { WCSessionHub.shared.setObserving(.message, true) }
    OnStopObserving("onMessage") { WCSessionHub.shared.setObserving(.message, false) }
    OnStartObserving("onUserInfo") { WCSessionHub.shared.setObserving(.userInfo, true) }
    OnStopObserving("onUserInfo") { WCSessionHub.shared.setObserving(.userInfo, false) }
    OnStartObserving("onApplicationContext") { WCSessionHub.shared.setObserving(.applicationContext, true) }
    OnStopObserving("onApplicationContext") { WCSessionHub.shared.setObserving(.applicationContext, false) }

    AsyncFunction("getIsPaired") { () -> Bool in
      WCSessionHub.shared.isPaired
    }

    AsyncFunction("getIsWatchAppInstalled") { () -> Bool in
      WCSessionHub.shared.isWatchAppInstalled
    }

    AsyncFunction("getReachability") { () -> Bool in
      WCSessionHub.shared.isReachable
    }

    /// Resolves with the watch's reply dictionary when `wantsReply`, or with
    /// an empty dictionary immediately after hand-off when fire-and-forget.
    /// Rejects with the underlying WCError on delivery failure.
    AsyncFunction("sendMessage") { (message: [String: Any], wantsReply: Bool, promise: Promise) in
      WCSessionHub.shared.sendMessage(
        message,
        wantsReply: wantsReply,
        onReply: { reply in promise.resolve(reply) },
        onError: { error in promise.reject(error) }
      )
    }

    Function("transferUserInfo") { (info: [String: Any]) in
      WCSessionHub.shared.transferUserInfo(info)
    }

    Function("updateApplicationContext") { (context: [String: Any]) throws in
      try WCSessionHub.shared.updateApplicationContext(context)
    }

    /// Fulfil the replyHandler parked under `replyId` (delivered inside an
    /// onMessage event body). No-op after the 10s native GC.
    Function("reply") { (replyId: String, payload: [String: Any]) in
      WCSessionHub.shared.reply(replyId: replyId, payload: payload)
    }

    Function("getLatestSeq") { () -> [String: Any] in
      WCSessionHub.shared.latestSeqInfo()
    }

    /// Pure journal read for gap reconciliation; entries carry `channel`.
    Function("getEventsSince") { (afterSeq: Int) -> [[String: Any]] in
      WCSessionHub.shared.eventsSince(Int64(afterSeq))
    }

    /// Exactly-once hand-over of not-yet-observed envelopes for one channel
    /// ("message" | "user-info" | "application-context").
    Function("drainPending") { (channel: String) -> [[String: Any]] in
      guard let ch = WCSessionHub.Channel(rawValue: channel) else { return [] }
      return WCSessionHub.shared.drainPending(channel: ch)
    }
  }
}
