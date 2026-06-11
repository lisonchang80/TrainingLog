//
//  HealthKitController.swift
//  TrainingLog Watch
//
//  Slice 13d D5 — HKHealthStore wrapper + authorization gate.
//  Per ADR-0019 § Slice 13d Amendment Q22 + NEW-Q47 spike A.
//
//  Authorization scope:
//    read  = .heartRate, .activeEnergyBurned, .workoutType
//    share = .workoutType (kept for future-proofing; current Branch C
//            trigger-only flow does NOT write HKWorkout from Watch,
//            iPhone 13c saveTrainingLogWorkout is the only writer)
//
//  Q22 paired-share status (2026-05-27):
//    Spike B 仍 pending — paired-share (iPhone-side grant propagates
//    to Watch) 未驗。D5 takes the safe fallback path: Watch-side
//    `store.requestAuthorization()` runs on each cold launch until
//    granted; once granted the OS does NOT re-prompt. When spike B
//    confirms paired-share works, ensureAuthorized() can degrade to
//    a precheck-only no-op on Watch (with iPhone grant as prereq).
//
//  Spike A confirmation (2026-05-27 19:51 真機 PASS):
//    Same authorization shape + HKWorkoutSession + HKLiveWorkoutBuilder
//    + HKLiveWorkoutDataSource setup confirmed working on Apple Watch
//    Ultra watchOS 11.6.2. See SpikeAHarness.swift on branch
//    slice/13d-d0-spike-a @ be3c179.
//

import Foundation
import HealthKit
import Combine

enum HealthKitError: Error, LocalizedError {
    case unavailable
    case authorizationDenied(Error)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "HealthKit is not available on this device"
        case .authorizationDenied(let underlying):
            return "HK authorization denied: \(underlying.localizedDescription)"
        }
    }
}

@MainActor
final class HealthKitController: ObservableObject {

    enum AuthorizationStatus: Equatable {
        case unknown
        case requesting
        case authorized
        case denied
        case unavailable
    }

    @Published private(set) var authorizationStatus: AuthorizationStatus = .unknown

    /// Shared HKHealthStore instance. `let` is intentional — HK docs
    /// recommend a single store per app process. Read access from
    /// SessionController via dependency injection.
    let store = HKHealthStore()

    static let typesToShare: Set<HKSampleType> = [
        HKObjectType.workoutType(),
    ]

    static let typesToRead: Set<HKObjectType> = [
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
        HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
        // #312 — 靜態卡路里 tile (FinishPage 動/靜 split)。新增型別會在
        // 下次 ensureAuthorized() 時於 Watch 跳一次增量授權畫面，既有
        // HR / active 授權不受影響。
        HKObjectType.quantityType(forIdentifier: .basalEnergyBurned)!,
        HKObjectType.workoutType(),
    ]

    /// Run before starting a session. Idempotent — once authorized,
    /// HK does not re-prompt on subsequent calls. First call on a
    /// Watch process surfaces the system permission dialog ON THE
    /// WATCH (per spike A unexpected finding 2026-05-27).
    func ensureAuthorized() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationStatus = .unavailable
            throw HealthKitError.unavailable
        }

        authorizationStatus = .requesting
        do {
            try await store.requestAuthorization(
                toShare: Self.typesToShare,
                read: Self.typesToRead
            )
            authorizationStatus = .authorized
        } catch {
            authorizationStatus = .denied
            throw HealthKitError.authorizationDenied(error)
        }
    }
}
