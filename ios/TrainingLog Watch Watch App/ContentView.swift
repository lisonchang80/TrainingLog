//
//  ContentView.swift
//  TrainingLog Watch
//
//  Slice 13d D8 — Watch app root view.
//
//  Phase 1 (73b2dfc): replaced D5/D7 dev_smoke with PickerRootView,
//  hardcoded mock data.
//  Phase 2 (this commit, Path A minimal): inject the
//  WatchConnectivityCoordinator into a fresh PickerViewModel so the
//  picker can fire the Stage 1 handshake on cold launch + on 🔄.
//
//  Why pre-build the VM here rather than inside PickerRootView's
//  default-arg init: the VM needs a reference to the
//  WatchConnectivityCoordinator @StateObject, which only ContentView
//  owns. PickerRootView wraps the passed-in VM as its own @StateObject
//  for SwiftUI lifecycle management.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var healthKit = HealthKitController()
    @StateObject private var session: SessionController
    @StateObject private var watchConn: WatchConnectivityCoordinator
    @StateObject private var pickerVM: PickerViewModel

    init() {
        let hk = HealthKitController()
        let sc = SessionController(healthKit: hk)
        let wc = WatchConnectivityCoordinator(sessionController: sc)
        // On Sim there's no paired iPhone — handshake will time out and
        // the picker stays empty. Use the mock-default VM so templates
        // pre-load and the picker → set logger flow is fully testable.
        // Real device + paired iPhone uses the production coordinator-
        // bound VM.
        #if targetEnvironment(simulator)
        let vm = PickerViewModel.mockDefault()
        #else
        let vm = PickerViewModel(coordinator: wc)
        #endif
        _healthKit = StateObject(wrappedValue: hk)
        _session = StateObject(wrappedValue: sc)
        _watchConn = StateObject(wrappedValue: wc)
        _pickerVM = StateObject(wrappedValue: vm)
    }

    var body: some View {
        PickerRootView(viewModel: pickerVM)
            // 2026-05-29 deep-night smoke fix (Bug 3 + Bug 4 wire):
            // SetLoggerView + FinishPageView need direct access to the
            // coordinator so the [完成] button can fire
            // `sendEndToiPhone(...)` and SetLoggerView can subscribe to
            // `$lastIncomingEnd` to auto-dismiss when iPhone initiates
            // end-session. Inject via .environmentObject so descendants
            // declare `@EnvironmentObject var coordinator` without
            // threading constructors.
            .environmentObject(watchConn)
            // Phase 3 will also wire healthKit + session — deferred
            // until D11 set logger needs HK lifecycle hooks.
    }
}

#Preview {
    ContentView()
}
