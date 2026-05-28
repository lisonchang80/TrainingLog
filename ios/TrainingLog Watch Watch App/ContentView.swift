//
//  ContentView.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — Watch app root view.
//
//  Retired in this commit:
//    The D5/D7 dev_smoke (lifecycle smoke buttons + WC end-session
//    test bench) that originally lived here. Lifecycle is now
//    triggered by the picker → set logger flow (Phase 3+);
//    end-session inbound from iPhone still works because
//    WatchConnectivityCoordinator is instantiated below and its
//    delegate stays mounted while the app is running.
//
//  Why @StateObject still owned at ContentView level:
//    HealthKitController + SessionController + WatchConnectivityCoordinator
//    are app-lifetime objects. PickerRootView creates its own
//    PickerViewModel (UI-state only) but does NOT own the lifecycle
//    objects — those will be injected via EnvironmentObject in
//    Phase 3 when the Set logger actually starts/ends sessions.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var healthKit = HealthKitController()
    @StateObject private var session: SessionController
    @StateObject private var watchConn: WatchConnectivityCoordinator

    init() {
        let hk = HealthKitController()
        let sc = SessionController(healthKit: hk)
        let wc = WatchConnectivityCoordinator(sessionController: sc)
        _healthKit = StateObject(wrappedValue: hk)
        _session = StateObject(wrappedValue: sc)
        _watchConn = StateObject(wrappedValue: wc)
    }

    var body: some View {
        PickerRootView()
            // Phase 3 will inject the lifecycle objects here:
            //   .environmentObject(healthKit)
            //   .environmentObject(session)
            //   .environmentObject(watchConn)
            // so the Set logger view can call session.start() / .end()
            // and watchConn.sendStartFromWatch(...) when a 3-tuple
            // selection is made.
    }
}

#Preview {
    ContentView()
}
