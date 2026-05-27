//
//  SpikeAHarness.swift
//  TrainingLog Watch
//
//  Slice 13d D0 spike A — Q28 Branch C validation
//  (ADR-0019 § Slice 13d Amendment Q28 + NEW-Q47).
//
//  Hypothesis (Q28 Branch C):
//    Watch starts HKWorkoutSession (HR sampling), end via
//    HKLiveWorkoutBuilder.discardWorkout() → NO HKWorkout entry
//    written to Health app, BUT HR samples still persisted in
//    HK store (sample writes are independent of workout entry).
//
//  Validation criteria:
//    PASS  = workoutEntryWritten == false  AND  hrSamplesAfterDiscard > 0
//    FAIL  = workoutEntryWritten == true   (Q28 Branch C INVALID — fallback to Branch A)
//    PART. = no workout entry but HR samples == 0 (env issue, retry or check sensor contact)
//

import Foundation
import HealthKit
import Combine

@MainActor
final class SpikeAHarness: ObservableObject {
    @Published var isRunning: Bool = false
    @Published var status: String = "idle"
    @Published var report: SpikeReport?

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    func runSpike() async {
        guard !isRunning else { return }
        isRunning = true
        defer { isRunning = false }

        let overallStart = Date()
        var steps: [SpikeStep] = []
        var hkAuthOk = false
        var sessionStarted = false
        var hrSamplesDuring = 0
        var hrSamplesAfter = 0
        var workoutCount = 0
        var sessionStartDate = overallStart
        var sessionEndDate = overallStart

        // ── Phase 1: HK availability + authorization
        status = "Phase 1: HK auth"
        let p1Start = Date()
        guard HKHealthStore.isHealthDataAvailable() else {
            steps.append(SpikeStep(name: "HK availability check", durationMs: msSince(p1Start), ok: false, note: "HKHealthStore.isHealthDataAvailable() == false"))
            finalize(start: overallStart, steps: steps, hkAuthOk: false, sessionStarted: false, hrDuring: 0, hrAfter: 0, workoutCount: 0)
            return
        }
        do {
            let typesToShare: Set<HKSampleType> = [HKObjectType.workoutType()]
            let typesToRead: Set<HKObjectType> = [
                HKObjectType.quantityType(forIdentifier: .heartRate)!,
                HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
                HKObjectType.workoutType()
            ]
            try await store.requestAuthorization(toShare: typesToShare, read: typesToRead)
            hkAuthOk = true
            steps.append(SpikeStep(name: "request HK auth", durationMs: msSince(p1Start), ok: true, note: nil))
        } catch {
            steps.append(SpikeStep(name: "request HK auth", durationMs: msSince(p1Start), ok: false, note: "\(error)"))
            finalize(start: overallStart, steps: steps, hkAuthOk: false, sessionStarted: false, hrDuring: 0, hrAfter: 0, workoutCount: 0)
            return
        }

        // ── Phase 2: configure HKWorkoutSession + builder
        status = "Phase 2: configure session + builder"
        let p2Start = Date()
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        do {
            let newSession = try HKWorkoutSession(healthStore: store, configuration: config)
            let newBuilder = newSession.associatedWorkoutBuilder()
            newBuilder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            self.session = newSession
            self.builder = newBuilder
            steps.append(SpikeStep(name: "configure session + builder", durationMs: msSince(p2Start), ok: true, note: nil))
        } catch {
            steps.append(SpikeStep(name: "configure session + builder", durationMs: msSince(p2Start), ok: false, note: "\(error)"))
            finalize(start: overallStart, steps: steps, hkAuthOk: hkAuthOk, sessionStarted: false, hrDuring: 0, hrAfter: 0, workoutCount: 0)
            return
        }

        // ── Phase 3: startActivity + beginCollection
        status = "Phase 3: start session"
        let p3Start = Date()
        sessionStartDate = Date()
        session?.startActivity(with: sessionStartDate)
        do {
            try await builder?.beginCollection(at: sessionStartDate)
            sessionStarted = true
            steps.append(SpikeStep(name: "startActivity + beginCollection", durationMs: msSince(p3Start), ok: true, note: nil))
        } catch {
            steps.append(SpikeStep(name: "startActivity + beginCollection", durationMs: msSince(p3Start), ok: false, note: "\(error)"))
            finalize(start: overallStart, steps: steps, hkAuthOk: hkAuthOk, sessionStarted: false, hrDuring: 0, hrAfter: 0, workoutCount: 0)
            return
        }

        // ── Phase 4: wait for HR samples (15s)
        status = "Phase 4: collecting HR samples (15s)…"
        let p4Start = Date()
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        steps.append(SpikeStep(name: "wait 15s for samples", durationMs: msSince(p4Start), ok: true, note: nil))

        // ── Phase 5: query HR samples DURING session (pre-discard)
        status = "Phase 5: query HR (during session)"
        let p5Start = Date()
        let preDiscardNow = Date()
        hrSamplesDuring = await queryHRSampleCount(start: sessionStartDate, end: preDiscardNow)
        steps.append(SpikeStep(name: "query HR during session", durationMs: msSince(p5Start), ok: true, note: "\(hrSamplesDuring) samples in [start, now]"))

        // ── Phase 6: stopActivity + discardWorkout
        status = "Phase 6: stop + discardWorkout"
        let p6Start = Date()
        sessionEndDate = Date()
        session?.stopActivity(with: sessionEndDate)
        builder?.discardWorkout()
        steps.append(SpikeStep(name: "stopActivity + discardWorkout", durationMs: msSince(p6Start), ok: true, note: nil))

        // ── Phase 7: settle (HK store async write completion)
        status = "Phase 7: settle 3s"
        let p7Start = Date()
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        steps.append(SpikeStep(name: "settle 3s post-discard", durationMs: msSince(p7Start), ok: true, note: nil))

        // ── Phase 8: query HKWorkout entries in window — KEY NEGATIVE ASSERTION
        status = "Phase 8: query workout entries"
        let p8Start = Date()
        let workoutWindowEnd = sessionEndDate.addingTimeInterval(10)
        workoutCount = await queryWorkoutCount(start: sessionStartDate, end: workoutWindowEnd)
        steps.append(SpikeStep(name: "query HKWorkout entries", durationMs: msSince(p8Start), ok: true, note: "\(workoutCount) entries in [start, end+10s]"))

        // ── Phase 9: query HR samples AFTER discard — KEY POSITIVE ASSERTION
        status = "Phase 9: query HR (after discard)"
        let p9Start = Date()
        hrSamplesAfter = await queryHRSampleCount(start: sessionStartDate, end: sessionEndDate)
        steps.append(SpikeStep(name: "query HR after discard", durationMs: msSince(p9Start), ok: true, note: "\(hrSamplesAfter) samples in [start, end]"))

        finalize(start: overallStart, steps: steps, hkAuthOk: hkAuthOk, sessionStarted: sessionStarted, hrDuring: hrSamplesDuring, hrAfter: hrSamplesAfter, workoutCount: workoutCount)
    }

    private func finalize(start: Date, steps: [SpikeStep], hkAuthOk: Bool, sessionStarted: Bool, hrDuring: Int, hrAfter: Int, workoutCount: Int) {
        let finished = Date()
        let workoutEntryWritten = workoutCount > 0

        let verdict: String
        let summary: String
        if !hkAuthOk {
            verdict = "fail"
            summary = "HK authorization denied — cannot validate Q28 Branch C. User likely tapped Don't Allow."
        } else if !sessionStarted {
            verdict = "fail"
            summary = "HKWorkoutSession did not start — cannot validate Q28 Branch C."
        } else if workoutEntryWritten {
            verdict = "fail"
            summary = "Q28 Branch C INVALID — HKWorkout entry WAS written (\(workoutCount) found) despite discardWorkout(). Must fall back to Branch A (Watch writes HKWorkout)."
        } else if hrAfter == 0 {
            verdict = "partial"
            summary = "discardWorkout() correctly skipped HKWorkout entry, but 0 HR samples found post-discard. Possible causes: Watch not on wrist, sensor contact lost, sample propagation lag. Retry after confirming Watch is worn with skin contact."
        } else {
            verdict = "pass"
            summary = "Q28 Branch C CONFIRMED — discardWorkout() did NOT write HKWorkout entry (\(workoutCount) found); \(hrAfter) HR samples persist in HK store for the session window."
        }

        let r = SpikeReport(
            startedAt: iso(start),
            finishedAt: iso(finished),
            totalMs: Int(finished.timeIntervalSince(start) * 1000),
            steps: steps,
            hkAuthOk: hkAuthOk,
            sessionStarted: sessionStarted,
            hrSamplesDuringSession: hrDuring,
            hrSamplesAfterDiscard: hrAfter,
            workoutEntriesFound: workoutCount,
            workoutEntryWritten: workoutEntryWritten,
            verdict: verdict,
            summary: summary
        )

        self.report = r
        self.status = "done — \(verdict)"
        printReport(r)
    }

    // MARK: - HK queries

    private func queryHRSampleCount(start: Date, end: Date) async -> Int {
        await withCheckedContinuation { (cont: CheckedContinuation<Int, Never>) in
            guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
                cont.resume(returning: 0)
                return
            }
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKSampleQuery(
                sampleType: hrType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                cont.resume(returning: samples?.count ?? 0)
            }
            store.execute(query)
        }
    }

    private func queryWorkoutCount(start: Date, end: Date) async -> Int {
        await withCheckedContinuation { (cont: CheckedContinuation<Int, Never>) in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                cont.resume(returning: samples?.count ?? 0)
            }
            store.execute(query)
        }
    }

    // MARK: - helpers

    private func msSince(_ d: Date) -> Int {
        Int(Date().timeIntervalSince(d) * 1000)
    }

    private func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    private func printReport(_ r: SpikeReport) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(r), let json = String(data: data, encoding: .utf8) {
            print("===== SPIKE A REPORT =====")
            print(json)
            print("===== END SPIKE A =====")
        } else {
            print("SPIKE A: failed to encode report")
        }
    }
}

// MARK: - DTOs

struct SpikeStep: Codable {
    let name: String
    let durationMs: Int
    let ok: Bool
    let note: String?
}

struct SpikeReport: Codable {
    let startedAt: String
    let finishedAt: String
    let totalMs: Int
    let steps: [SpikeStep]
    let hkAuthOk: Bool
    let sessionStarted: Bool
    let hrSamplesDuringSession: Int
    let hrSamplesAfterDiscard: Int
    let workoutEntriesFound: Int
    let workoutEntryWritten: Bool
    let verdict: String
    let summary: String
}
