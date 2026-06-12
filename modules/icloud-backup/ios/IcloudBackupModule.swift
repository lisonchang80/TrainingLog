import ExpoModulesCore

/**
 * IcloudBackup — thin local Expo module bridging the iCloud Drive ubiquity
 * container to JS (slice 15, ADR-0011 + 2026-06-12 grill amendment, Q1-A).
 *
 * Deliberately minimal surface — file COPYING is done in JS via
 * expo-file-system (its new File/Directory API defers permission checks for
 * paths outside the sandbox to the OS, so a `file://` ubiquity URL works).
 * Only the four things JS genuinely cannot do live here:
 *
 *   1. `isICloudAvailable`        — `ubiquityIdentityToken != nil` (sync, fast)
 *   2. `getUbiquityContainerUrl`  — `url(forUbiquityContainerIdentifier: nil)`;
 *                                   first call may trigger container
 *                                   provisioning and block, so ALWAYS off the
 *                                   main thread (Apple docs; prep-report R8)
 *   3. `listBackupItems`          — NSMetadataQuery over the Documents scope.
 *                                   A plain FileManager directory listing shows
 *                                   undownloaded cloud items as
 *                                   `.<name>.icloud` placeholders and knows
 *                                   nothing about upload state; the metadata
 *                                   query is the only honest source for the
 *                                   `isUploaded` readout Settings needs (R2).
 *   4. `startDownload`            — `startDownloadingUbiquitousItem(at:)` for
 *                                   restore-side placeholder hydration.
 *
 * Container identifier: `nil` → first entitlement entry
 * (`iCloud.com.lisonchang.TrainingLog`), so the identifier is never
 * hard-coded in source.
 */
public class IcloudBackupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("IcloudBackup")

    /// True when an iCloud account is signed in and iCloud Drive is enabled
    /// for this app. Cheap (no container provisioning), safe on any thread.
    Function("isICloudAvailable") { () -> Bool in
      return FileManager.default.ubiquityIdentityToken != nil
    }

    /// Resolves the ubiquity container root as a `file://` URL string, or
    /// nil when iCloud is unavailable. Runs on a utility queue because the
    /// FIRST call after install/sign-in can block while the system extends
    /// the app sandbox to the container (Apple: "do not call from the main
    /// thread").
    AsyncFunction("getUbiquityContainerUrl") { (promise: Promise) in
      DispatchQueue.global(qos: .utility).async {
        let url = FileManager.default.url(forUbiquityContainerIdentifier: nil)
        promise.resolve(url?.absoluteString)
      }
    }

    /// Lists items in the ubiquitous Documents scope (where backups live)
    /// with cloud state attached. Resolves with an array of dictionaries:
    ///   name: String, url: String,
    ///   sizeBytes: Double?, modifiedAtMs: Double?,
    ///   isUploaded: Bool?, isUploading: Bool?, percentUploaded: Double?,
    ///   downloadingStatus: "current" | "downloaded" | "not-downloaded"
    /// Optional attributes are OMITTED when the system has no value (never
    /// NSNull) — the JS wrapper normalizes missing keys to null.
    ///
    /// Watchdog: iCloud metadata gathering has no SLA. A 10s timeout
    /// resolves with whatever has been gathered so far instead of hanging
    /// forever (#311 watchdog lesson; Q18 limited-wait discovery).
    AsyncFunction("listBackupItems") { (promise: Promise) in
      // NSMetadataQuery needs a runloop thread — main is the standard choice.
      DispatchQueue.main.async {
        BackupItemsQuery.run(promise: promise)
      }
    }

    /// Triggers download of a not-yet-local ubiquitous item. `relativePath`
    /// is relative to the CONTAINER ROOT (e.g.
    /// "Documents/TrainingLog-backup-2026-06-13T013000Z.sqlite"). Pass the
    /// logical name — never the `.icloud` placeholder name. Resolves nil on
    /// success; rejects when iCloud is unavailable or the request fails.
    /// (Completion of the download is observed by the CALLER polling
    /// `listBackupItems` for downloadingStatus == "current"/"downloaded".)
    AsyncFunction("startDownload") { (relativePath: String, promise: Promise) in
      DispatchQueue.global(qos: .utility).async {
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: nil) else {
          promise.reject(
            "ERR_ICLOUD_UNAVAILABLE",
            "iCloud ubiquity container is unavailable (not signed in or iCloud Drive disabled)"
          )
          return
        }
        let target = container.appendingPathComponent(relativePath)
        do {
          try FileManager.default.startDownloadingUbiquitousItem(at: target)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_START_DOWNLOAD", error.localizedDescription)
        }
      }
    }
  }
}

/**
 * One-shot NSMetadataQuery wrapper.
 *
 * Lifecycle/threading contract: EVERYTHING runs on the main thread (start,
 * gather notification via `.main` queue, timeout via `asyncAfter(.main)`),
 * so a plain `finished` flag is a sufficient resume-once gate — the same
 * watchdog discipline as the WC `requestHandshake` 6s resume-once box
 * (#311 `c026107`), no locks needed.
 *
 * A strong reference to the in-flight query is kept in `active` until it
 * settles; otherwise ARC would deallocate the query before it finishes
 * gathering and the promise would never resolve.
 */
private final class BackupItemsQuery: NSObject {
  private static var active = [ObjectIdentifier: BackupItemsQuery]()
  private static let timeoutSeconds: TimeInterval = 10

  private let query = NSMetadataQuery()
  private let promise: Promise
  private var finished = false
  private var observer: NSObjectProtocol?

  static func run(promise: Promise) {
    let runner = BackupItemsQuery(promise: promise)
    active[ObjectIdentifier(runner)] = runner
    runner.start()
  }

  private init(promise: Promise) {
    self.promise = promise
    super.init()
  }

  private func start() {
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    // NSMetadataQuery refuses to start without a predicate; match-all.
    query.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)

    observer = NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidFinishGathering,
      object: query,
      queue: .main
    ) { [weak self] _ in
      self?.settle()
    }

    guard query.start() else {
      // start() returning false is rare (query misconfiguration); fail loud
      // rather than hanging until the watchdog.
      finishOnce { promise.reject("ERR_METADATA_QUERY", "NSMetadataQuery failed to start") }
      return
    }

    // Watchdog: resolve with the partial snapshot instead of hanging.
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeoutSeconds) { [weak self] in
      self?.settle()
    }
  }

  /// Idempotent: first caller (gather notification OR watchdog) wins.
  private func settle() {
    finishOnce { promise.resolve(snapshotResults()) }
  }

  private func finishOnce(_ body: () -> Void) {
    guard !finished else { return }
    finished = true
    body()
    teardown()
  }

  private func snapshotResults() -> [[String: Any]] {
    query.disableUpdates()
    var items: [[String: Any]] = []
    for case let item as NSMetadataItem in query.results {
      var entry: [String: Any] = [:]
      if let name = item.value(forAttribute: NSMetadataItemFSNameKey) as? String {
        entry["name"] = name
      }
      if let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL {
        entry["url"] = url.absoluteString
      }
      if let size = item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber {
        entry["sizeBytes"] = size.doubleValue
      }
      if let mtime = item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date {
        entry["modifiedAtMs"] = mtime.timeIntervalSince1970 * 1000
      }
      if let uploaded = item.value(forAttribute: NSMetadataUbiquitousItemIsUploadedKey) as? NSNumber {
        entry["isUploaded"] = uploaded.boolValue
      }
      if let uploading = item.value(forAttribute: NSMetadataUbiquitousItemIsUploadingKey) as? NSNumber {
        entry["isUploading"] = uploading.boolValue
      }
      if let pct = item.value(forAttribute: NSMetadataUbiquitousItemPercentUploadedKey) as? NSNumber {
        entry["percentUploaded"] = pct.doubleValue
      }
      if let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String {
        // Normalize Apple's constant values to short stable tokens so JS
        // never string-matches framework constants.
        switch status {
        case NSMetadataUbiquitousItemDownloadingStatusCurrent:
          entry["downloadingStatus"] = "current"
        case NSMetadataUbiquitousItemDownloadingStatusDownloaded:
          entry["downloadingStatus"] = "downloaded"
        case NSMetadataUbiquitousItemDownloadingStatusNotDownloaded:
          entry["downloadingStatus"] = "not-downloaded"
        default:
          entry["downloadingStatus"] = status
        }
      }
      items.append(entry)
    }
    return items
  }

  private func teardown() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }
    query.stop()
    Self.active.removeValue(forKey: ObjectIdentifier(self))
  }
}
