//
//  ContentView.swift
//  TrainingLog Watch
//
//  Slice 13d D5 — temporary dev hook for SessionController smoke.
//  D8 replaces this with the picker root 3-step UI per ADR-0019
//  NEW-Q29 + NEW-Q17. Everything inside the `dev_smoke` section
//  below disappears when D8 lands.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var healthKit = HealthKitController()
    @StateObject private var session: SessionController
    @StateObject private var watchConn: WatchConnectivityCoordinator
    @State private var sessionIdText: String = ""

    init() {
        let hk = HealthKitController()
        let sc = SessionController(healthKit: hk)
        let wc = WatchConnectivityCoordinator(sessionController: sc)
        _healthKit = StateObject(wrappedValue: hk)
        _session = StateObject(wrappedValue: sc)
        _watchConn = StateObject(wrappedValue: wc)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("TrainingLog")
                    .font(.headline)
                Text("D5 dev smoke")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("Picker UI ships in D8")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Divider().padding(.vertical, 4)

                // ── dev_smoke (D5): SessionController lifecycle —
                // remove when D8 picker UI lands.
                Text("D5 / SessionController")
                    .font(.caption)
                    .bold()

                Text("HK auth: \(authText(healthKit.authorizationStatus))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Text("State: \(stateText(session.state))")
                    .font(.caption2)
                    .foregroundStyle(stateColor(session.state))

                if let startedAt = session.sessionStartedAt {
                    Text("Started: \(timeText(startedAt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let endedAt = session.sessionEndedAt {
                    Text("Ended: \(timeText(endedAt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 4) {
                    Button("Start") {
                        Task { await session.start() }
                    }
                    .disabled(!canStart(session.state))

                    Button("End") {
                        Task { await session.end() }
                    }
                    .disabled(!canEnd(session.state))
                }

                Button("Cancel") {
                    Task { await session.cancel() }
                }
                .disabled(!canEnd(session.state))
                .tint(.red)

                Divider().padding(.vertical, 4)

                // ── dev_smoke (D7-Swift): WC end-session bidirectional —
                // remove when D8 picker UI lands.
                Text("D7 / WatchConnectivity")
                    .font(.caption)
                    .bold()

                Text("WC: \(wcStatusText(watchConn.status))")
                    .font(.caption2)
                    .foregroundStyle(wcStatusColor(watchConn.status))

                Text("Inbound: \(watchConn.lastInbound)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Text("Outbound: \(watchConn.lastOutbound)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                TextField("sessionId", text: $sessionIdText)
                    .font(.caption2)
                    .textFieldStyle(.plain)

                Button("End + send → iPhone") {
                    Task {
                        // Watch-led: stop local HK first for UI
                        // responsiveness, then notify iPhone. iPhone's
                        // handler in app/(tabs)/index.tsx will finalize
                        // SQLite + bounce end-session(side:iphone) back
                        // — that bounce is a no-op locally because
                        // SessionController.end() is idempotent.
                        await session.end()
                        await watchConn.sendEndToiPhone(sessionId: sessionIdText)
                    }
                }
                .disabled(sessionIdText.isEmpty || watchConn.status != .activated)
                .tint(.orange)
            }
            .padding()
        }
    }

    private func wcStatusText(_ s: WatchConnectivityCoordinator.Status) -> String {
        switch s {
        case .unsupported: return "unsupported"
        case .inactive: return "inactive"
        case .activating: return "activating…"
        case .activated: return "activated"
        case .failed(let msg): return "failed: \(msg)"
        }
    }

    private func wcStatusColor(_ s: WatchConnectivityCoordinator.Status) -> Color {
        switch s {
        case .activated: return .green
        case .failed, .unsupported: return .red
        case .activating: return .orange
        default: return .secondary
        }
    }

    private func authText(_ s: HealthKitController.AuthorizationStatus) -> String {
        switch s {
        case .unknown: return "unknown"
        case .requesting: return "requesting…"
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .unavailable: return "unavailable"
        }
    }

    private func stateText(_ s: SessionController.State) -> String {
        switch s {
        case .idle: return "idle"
        case .starting: return "starting…"
        case .active: return "active"
        case .ending: return "ending…"
        case .ended: return "ended"
        case .failed(let msg): return "failed: \(msg)"
        }
    }

    private func stateColor(_ s: SessionController.State) -> Color {
        switch s {
        case .active: return .green
        case .failed: return .red
        case .ending, .starting: return .orange
        default: return .secondary
        }
    }

    private func timeText(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: d)
    }

    private func canStart(_ s: SessionController.State) -> Bool {
        switch s {
        case .idle, .ended, .failed: return true
        default: return false
        }
    }

    private func canEnd(_ s: SessionController.State) -> Bool {
        switch s {
        case .active, .starting: return true
        default: return false
        }
    }
}

#Preview {
    ContentView()
}
