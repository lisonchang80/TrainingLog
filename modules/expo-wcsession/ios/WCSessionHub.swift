import Foundation
import WatchConnectivity

/**
 * WCSessionHub — process-singleton WCSession delegate + inbound event journal.
 *
 * Design (issue lisonchang80/TrainingLog#54):
 *
 * Every inbound envelope (message / userInfo / applicationContext) is stamped
 * with a process-scoped `(epoch, seq)` and appended to an in-memory ring
 * buffer BEFORE the JS event fires. JS can therefore always answer two
 * questions natively, without trusting the event-emitter lane:
 *
 *   1. "What is the latest seq?"          → `latestSeqInfo()`
 *   2. "Give me everything after seq N."  → `eventsSince(_:)`
 *
 * A JS runtime that goes deaf (the RCTEventEmitter failure family this
 * module replaces) detects the gap by polling #1 and self-heals via #2.
 * `epoch` (a per-process UUID) disambiguates process restarts: a changed
 * epoch means the ring belongs to a new process life — callers should run
 * their full state resync instead of a gap pull.
 *
 * Cold-boot parity with RCTEventEmitter's `pendingEvents`: envelopes that
 * arrive before any JS listener is attached stay undrained in the ring;
 * `drainPending(channel:)` hands them over exactly once (per-channel
 * watermark). Live emissions advance the watermark only when the channel
 * has JS observers — mirroring the old `hasObservers` gate, but with the
 * buffer under our control instead of inside React Native.
 *
 * Reply bridging: WCSession's `replyHandler` closures cannot cross the
 * native↔JS boundary, so each one is parked in `pendingReplies` under a
 * generated `replyId` that travels with the event. JS answers via
 * `reply(replyId:payload:)`. Entries are GC'd after 10s WITHOUT auto-reply —
 * the watch-side sendMessage errorHandler owns timeout semantics, and the
 * counterpart's fallback paths (e.g. TrainingLog's edit-lock "No response"
 * flow) must see the exact same behavior as before.
 *
 * Threading: all mutable state is confined to `queue`. WCSession delegate
 * callbacks arrive on arbitrary background threads; JS-facing reads use
 * `queue.sync` (short critical sections only).
 */
final class WCSessionHub: NSObject {
  static let shared = WCSessionHub()

  enum Channel: String, CaseIterable {
    case message = "message"
    case userInfo = "user-info"
    case applicationContext = "application-context"
  }

  struct RingEntry {
    let seq: Int64
    let channel: Channel
    let payload: [String: Any]
    let replyId: String?
  }

  /// Ring capacity. Sized for the reconciliation window, not for history:
  /// observed deaf-window bursts are <20 envelopes, and a full workout
  /// session's inbound traffic fits comfortably below this.
  private static let ringCap = 256

  /// How long a parked replyHandler survives before GC (map hygiene only —
  /// no auto-reply on expiry, see class doc).
  private static let replyGCSeconds: TimeInterval = 10

  let epoch = UUID().uuidString

  private let queue = DispatchQueue(label: "expo.wcsession.hub")
  private var seq: Int64 = 0
  private var ring: [RingEntry] = []
  private var drainedWatermark: [Channel: Int64] = [:]
  private var observedChannels: Set<Channel> = []
  private var pendingReplies: [String: ([String: Any]) -> Void] = [:]
  private var eventSink: ((_ name: String, _ body: [String: Any]) -> Void)?
  private var activated = false

  private override init() {
    super.init()
  }

  // MARK: - Module wiring

  /// Install the JS event sink (the module's `sendEvent`). Called from
  /// `OnCreate`; replaced wholesale on dev-menu reloads when Expo recreates
  /// the module instance — the hub itself lives for the whole process.
  func attach(sink: @escaping (String, [String: Any]) -> Void) {
    queue.async { self.eventSink = sink }
  }

  func detachSink() {
    queue.async {
      self.eventSink = nil
      self.observedChannels.removeAll()
    }
  }

  /// Mirror of RCTEventEmitter's observer bookkeeping, driven by the
  /// module's `OnStartObserving`/`OnStopObserving`. Only observed channels
  /// advance the drain watermark on live emission (see `emitLocked`).
  func setObserving(_ channel: Channel, _ observing: Bool) {
    queue.async {
      if observing {
        self.observedChannels.insert(channel)
      } else {
        self.observedChannels.remove(channel)
      }
    }
  }

  /// Activate WCSession exactly once per process. Safe to call repeatedly.
  func activateIfNeeded() {
    queue.async {
      guard !self.activated, WCSession.isSupported() else { return }
      self.activated = true
      let session = WCSession.default
      session.delegate = self
      session.activate()
    }
  }

  // MARK: - State reads (JS: getIsPaired / getIsWatchAppInstalled / getReachability)

  var isPaired: Bool {
    guard WCSession.isSupported() else { return false }
    return WCSession.default.isPaired
  }

  var isWatchAppInstalled: Bool {
    guard WCSession.isSupported() else { return false }
    return WCSession.default.isWatchAppInstalled
  }

  var isReachable: Bool {
    guard WCSession.isSupported() else { return false }
    return WCSession.default.isReachable
  }

  // MARK: - Outbound

  func sendMessage(
    _ message: [String: Any],
    wantsReply: Bool,
    onReply: @escaping ([String: Any]) -> Void,
    onError: @escaping (Error) -> Void
  ) {
    guard WCSession.isSupported() else {
      onError(WCError(.sessionNotSupported))
      return
    }
    let session = WCSession.default
    if wantsReply {
      session.sendMessage(message, replyHandler: { onReply($0) }, errorHandler: onError)
    } else {
      session.sendMessage(message, replyHandler: nil, errorHandler: onError)
      // Fire-and-forget: hand-off to WCSession succeeded; resolve now.
      onReply([:])
    }
  }

  func transferUserInfo(_ info: [String: Any]) {
    guard WCSession.isSupported() else { return }
    WCSession.default.transferUserInfo(info)
  }

  func updateApplicationContext(_ context: [String: Any]) throws {
    guard WCSession.isSupported() else { return }
    try WCSession.default.updateApplicationContext(context)
  }

  /// Fulfil a parked replyHandler. No-op when the entry was already GC'd —
  /// by then the watch side has long received its own timeout error.
  func reply(replyId: String, payload: [String: Any]) {
    queue.async {
      guard let handler = self.pendingReplies.removeValue(forKey: replyId) else { return }
      handler(payload)
    }
  }

  // MARK: - Journal reads (JS: getLatestSeq / getEventsSince / drainPending)

  func latestSeqInfo() -> [String: Any] {
    return queue.sync {
      [
        "epoch": epoch,
        "seq": seq,
        // audit B🟡-2 (2026-07-05) — the oldest journal entry still pullable.
        // `seq + 1` when the ring is empty ("nothing below the next seq is
        // available"), so JS can detect head-loss after a ring256 overflow
        // (`oldestSeq > watermark + 1`) instead of silently pulling half a
        // gap and believing it healed.
        "oldestSeq": ring.first?.seq ?? (seq + 1),
      ]
    }
  }

  /// Pure read for gap reconciliation — does NOT touch the drain watermark.
  func eventsSince(_ afterSeq: Int64) -> [[String: Any]] {
    return queue.sync {
      ring.filter { $0.seq > afterSeq }.map { body(for: $0, includeChannel: true) }
    }
  }

  /// Exactly-once hand-over of envelopes that never reached a JS listener
  /// (cold boot, JS reload). Advances the per-channel watermark.
  func drainPending(channel: Channel) -> [[String: Any]] {
    return queue.sync {
      let low = drainedWatermark[channel] ?? 0
      let entries = ring.filter { $0.channel == channel && $0.seq > low }
      if let last = entries.last {
        drainedWatermark[channel] = last.seq
      }
      return entries.map { body(for: $0, includeChannel: false) }
    }
  }

  // MARK: - Intake

  private func ingest(
    channel: Channel,
    payload: [String: Any],
    replyHandler: (([String: Any]) -> Void)?
  ) {
    queue.async {
      self.seq += 1
      var replyId: String? = nil
      if let handler = replyHandler {
        let id = UUID().uuidString
        replyId = id
        self.pendingReplies[id] = handler
        self.queue.asyncAfter(deadline: .now() + Self.replyGCSeconds) {
          self.pendingReplies.removeValue(forKey: id)
        }
      }
      let entry = RingEntry(seq: self.seq, channel: channel, payload: payload, replyId: replyId)
      self.ring.append(entry)
      if self.ring.count > Self.ringCap {
        self.ring.removeFirst(self.ring.count - Self.ringCap)
      }
      self.emitLocked(entry)
    }
  }

  /// Must run on `queue`. Live-emits to JS and, when the channel has JS
  /// observers, advances the drain watermark (RCTEventEmitter parity: an
  /// observed emission counts as delivered; an unobserved one stays
  /// drainable). A deaf-but-observed window is Phase 2's job — recovered
  /// via `eventsSince`, never via double-drain.
  private func emitLocked(_ entry: RingEntry) {
    if observedChannels.contains(entry.channel) {
      drainedWatermark[entry.channel] = max(drainedWatermark[entry.channel] ?? 0, entry.seq)
    }
    guard let sink = eventSink else { return }
    sink(Self.eventName(for: entry.channel), body(for: entry, includeChannel: false))
  }

  private func body(for entry: RingEntry, includeChannel: Bool) -> [String: Any] {
    var b: [String: Any] = [
      "seq": entry.seq,
      "epoch": epoch,
      "payload": entry.payload,
    ]
    if let replyId = entry.replyId {
      b["replyId"] = replyId
    }
    if includeChannel {
      b["channel"] = entry.channel.rawValue
    }
    return b
  }

  static func eventName(for channel: Channel) -> String {
    switch channel {
    case .message: return "onMessage"
    case .userInfo: return "onUserInfo"
    case .applicationContext: return "onApplicationContext"
    }
  }
}

// MARK: - WCSessionDelegate

extension WCSessionHub: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if let error = error {
      NSLog("[ExpoWCSession] activation error: %@", error.localizedDescription)
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    // iPhone-side requirement for watch switching; nothing to do.
  }

  func sessionDidDeactivate(_ session: WCSession) {
    // Re-activate so the session keeps working after the user switches
    // to a different paired watch (Apple-documented pattern).
    session.activate()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    queue.async {
      guard let sink = self.eventSink else { return }
      // State signal, not data — bypasses the ring/seq journal by design.
      sink("onReachabilityChange", ["reachable": reachable])
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    ingest(channel: .message, payload: message, replyHandler: nil)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    ingest(channel: .message, payload: message, replyHandler: replyHandler)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    ingest(channel: .userInfo, payload: userInfo, replyHandler: nil)
  }

  func session(
    _ session: WCSession,
    didFinish userInfoTransfer: WCSessionUserInfoTransfer,
    error: Error?
  ) {
    // Log-only, and deliberately does NOT read `userInfoTransfer.userInfo`:
    // on the error path (sim 7006 etc.) that payload can be nil — building
    // an event body from it is exactly the SIGABRT we patched in the old lib.
    if let error = error {
      NSLog("[ExpoWCSession] transferUserInfo failed: %@", error.localizedDescription)
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    ingest(channel: .applicationContext, payload: applicationContext, replyHandler: nil)
  }
}
