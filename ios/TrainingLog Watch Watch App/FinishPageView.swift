//
//  FinishPageView.swift
//  TrainingLog Watch
//
//  Slice 13d D14 — Watch session 完成頁. Mounted as `selectedPage == 0`
//  of the SetLoggerView TabView shell (per ADR-0019 § Slice 13d D14
//  spec line 1809-1962, frozen 2026-05-28).
//
//  Scope of this commit (D14 SwiftUI impl):
//    - 4-state UI machine: idle / ⟳ syncing / ✓ success / ⚠ fail
//    - 5 fixed-order tiles: ✓ 組數 / ⏱ 時長 / ❤ HR / 🔥 kcal / 💪 動作數
//    - 兩 button [取消] / [完成]; dim+disable while syncing/success
//    - Mock sync via Task.sleep(2s) + Bool.random() (90% success / 10% fail)
//    - Auto-dismiss 0.5s after success via `onFinishComplete` closure
//    - `onAbort` closure for [取消] tap
//
//  Out of scope (deferred to D7 / D9 wire-in, channel #11):
//    - Real WC end-session push (HK workout finalize + iPhone-side
//      session row updates + Stage1 sync)
//    - Real abort path (session delete + dismiss back to D8 picker)
//    - Live HR / kcal from HealthKitController (snapshot schema does
//      not yet carry HR / kcal; spec values 142 / 285 are placeholders)
//
//  State machine (per spec line 1897-1914):
//
//      [idle]
//        ├ tap [完成] ──→ [syncing] ──→ 90% ──→ [success] ─ 0.5s ─→ onFinishComplete
//        │                          └ 10% ──→ [fail] ─ buttons re-enabled
//        └ tap [取消] ──→ onAbort
//      [fail]
//        ├ tap [完成] ──→ [syncing] ...（retry）
//        └ tap [取消] ──→ onAbort
//

import SwiftUI

/// 4 phases of the sync state machine.
enum FinishPhase: Equatable {
    case idle
    case syncing
    case success
    case fail
}

struct FinishPageView: View {
    let snapshot: SessionSnapshot

    /// Called when sync succeeds (after the 0.5s ✓ display) — caller
    /// should dismiss the finish page (TabView → selectedPage = 1 for
    /// now; real dismiss to D8 picker lands in D7/D9 wire-in).
    let onFinishComplete: () -> Void

    /// Called when user taps [取消] — caller should abort the session
    /// (currently: TabView → selectedPage = 1; real abort path lands
    /// in D7/D9 wire-in, channel #11).
    let onAbort: () -> Void

    @State private var phase: FinishPhase = .idle

    /// Buttons are interactive only during `.idle` or `.fail`. The
    /// spec is explicit: while ⟳ syncing or ✓ success-flash, both
    /// buttons are disabled (line 1928-1933).
    private var buttonsEnabled: Bool {
        switch phase {
        case .idle, .fail:
            return true
        case .syncing, .success:
            return false
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                headerRow
                Rectangle()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(height: 0.5)
                subtitleRow
                tilesBlock
                    .padding(.top, 4)
                buttonsRow
                    .padding(.top, 6)
                hintRow
                    .padding(.top, 2)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
        }
        .navigationBarHidden(true)
        .animation(.easeInOut(duration: 0.18), value: phase)
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("Session 完成？")
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
            syncStatusIcon
        }
    }

    /// Right-aligned sync indicator. Idle ⇒ nothing rendered, but a
    /// fixed-size frame preserves header height to avoid jitter
    /// between phase transitions.
    @ViewBuilder
    private var syncStatusIcon: some View {
        switch phase {
        case .idle:
            // Reserve space so the header doesn't reflow when the
            // icon appears at syncing→success→fail.
            Color.clear
                .frame(width: 16, height: 16)
        case .syncing:
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.mini)
                .tint(.secondary)
                .frame(width: 16, height: 16)
        case .success:
            Image(systemName: "checkmark")
                .font(.caption)
                .foregroundStyle(.green)
                .frame(width: 16, height: 16)
        case .fail:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .frame(width: 16, height: 16)
        }
    }

    // MARK: - Subtitle (模板 · 計劃 · 強度)

    /// 3-tuple shown directly under the header. Per spec line 1844-1845
    /// the format is `模板 · 計劃 · 強度`. The snapshot's `title`
    /// already carries the template name (e.g. "推日（A）") from
    /// snapshotToWire; program + intensity are NOT yet on the wire
    /// (Stage1 payload extension is Phase 2.5, pending). For now we
    /// fall back to the spec mock values when those fields are absent
    /// so the layout matches.
    private var subtitleRow: some View {
        HStack(spacing: 0) {
            Text(subtitleText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
    }

    private var subtitleText: String {
        // TODO: D7/D9 + Stage1 payload extension (Phase 2.5) — pull
        // real program name + intensity tag from snapshot. Until then
        // we display the template title plus spec mock placeholders.
        let template = snapshot.title.isEmpty ? "—" : snapshot.title
        return "\(template) · Linear W3 · 中度日"
    }

    // MARK: - 5 Tiles (fixed order, vertical)

    private var tilesBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            tileRow(icon: "checkmark", text: setsTileText)
            tileRow(icon: "clock", text: durationTileText)
            tileRow(icon: "heart.fill", text: hrTileText, iconColor: .red)
            tileRow(icon: "flame.fill", text: kcalTileText, iconColor: .orange)
            tileRow(icon: "figure.strengthtraining.traditional", text: exerciseTileText)
        }
    }

    private func tileRow(
        icon: String,
        text: String,
        iconColor: Color = .secondary
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(iconColor)
                .frame(width: 16, alignment: .center)
            Text(text)
                .font(.caption)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
    }

    // MARK: - Tile values

    /// 已完成組數 / 計畫總組數（不含熱身）— per spec line 1939.
    private var setsTileText: String {
        let allSets = snapshot.exercises.flatMap { $0.sets }
        let workingSets = allSets.filter { $0.setKind != "warmup" }
        let completed = workingSets.filter { $0.isLogged }.count
        let total = workingSets.count
        return "\(completed)/\(total) 組"
    }

    /// session 開始至 now 的 elapsed — per spec line 1940.
    private var durationTileText: String {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let elapsedMs = max(0, nowMs - snapshot.startedAt)
        let totalSec = Int(elapsedMs / 1000)
        let hours = totalSec / 3600
        let minutes = (totalSec % 3600) / 60
        let seconds = totalSec % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }

    /// 平均 HR — placeholder until HK stream lands (D7/D9 wire-in).
    /// TODO: replace with snapshot.averageHR or live HealthKitController query.
    private var hrTileText: String {
        return "142 bpm（平均）"
    }

    /// kcal 總和 — placeholder until HK kcal sample sum lands.
    /// TODO: replace with snapshot.totalKcal or live HealthKitController query.
    private var kcalTileText: String {
        return "285 kcal"
    }

    /// session 動作數 — per spec line 1943.
    private var exerciseTileText: String {
        return "\(snapshot.exercises.count) 動作"
    }

    // MARK: - Buttons

    private var buttonsRow: some View {
        HStack(spacing: 6) {
            Button(action: handleCancel) {
                Text("取消")
                    .font(.caption)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.secondary)
            .disabled(!buttonsEnabled)
            .opacity(buttonsEnabled ? 1.0 : 0.5)

            Button(action: handleFinish) {
                Text("完成")
                    .font(.caption)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(!buttonsEnabled)
            .opacity(buttonsEnabled ? 1.0 : 0.5)
        }
    }

    private var hintRow: some View {
        HStack {
            Spacer()
            Text("(← 左滑回 session 繼續)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
        }
    }

    // MARK: - Actions

    private func handleCancel() {
        // TODO: D7/D9 wire abort path (real session delete + dismiss
        // to D8 picker via channel #11). For now we hand control back
        // to the TabView via `onAbort` which currently re-selects
        // page 1 (session card list).
        onAbort()
    }

    private func handleFinish() {
        // Guard: ignore retry presses while a sync is already in flight.
        guard buttonsEnabled else { return }
        phase = .syncing

        Task {
            // TODO: D7/D9 wire real end-session push (channel #11) —
            // currently a 2s mock with 90% success / 10% fail.
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let succeeded = (Int.random(in: 0..<10) < 9)
            await MainActor.run {
                if succeeded {
                    phase = .success
                    // Hold the ✓ for 0.5s so the user sees confirmation,
                    // then hand off to the caller for dismissal.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        onFinishComplete()
                        // Reset to idle in case the view stays mounted
                        // (caller may swap selectedPage without unmounting).
                        phase = .idle
                    }
                } else {
                    phase = .fail
                }
            }
        }
    }
}

// MARK: - Previews

#Preview("D14 — idle") {
    FinishPageView(
        snapshot: SetLoggerMockData.mockSnapshot(),
        onFinishComplete: {},
        onAbort: {}
    )
}

#Preview("D14 — empty snapshot") {
    FinishPageView(
        snapshot: SessionSnapshot(
            sessionId: "empty",
            title: "",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            exercises: []
        ),
        onFinishComplete: {},
        onAbort: {}
    )
}
