//
//  TrainingLog_WatchApp.swift
//  TrainingLog Watch
//
//  Slice 13d D4 — minimal watchOS app entry. D5 will wire
//  HKLiveWorkoutBuilder + WCSession; D8+ will wire the picker UI.
//  Per ADR-0019 Q1 (manual scaffold) + Q22/Q28 (trigger-only HK,
//  watchOS 11+).
//

import SwiftUI

@main
struct TrainingLog_Watch_Watch_AppApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
