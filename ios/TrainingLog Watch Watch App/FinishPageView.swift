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
//      → DONE 2026-06-11 (#312): tiles now read the live
//        HKLiveWorkoutBuilder via the `liveStats` closure (avg HR +
//        active kcal), with "--" fallback when no sample landed.
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

    /// 2026-05-29 deep-night smoke fix (Bug 4 wire) — invoked
    /// SYNCHRONOUSLY at the moment user taps [完成] (before the 1.5s
    /// spinner UX). Caller (`SetLoggerView`) wires this to
    /// `coordinator.sendEndToiPhone(sessionId:)` so iPhone gets the
    /// envelope immediately, not after the spinner.
    ///
    /// Fire-and-forget — no return value to await. Transport errors
    /// surface on `coordinator.lastOutbound` for diagnostic only;
    /// the UI still proceeds to the success state (because iPhone
    /// reconciles independently via the end-session message which
    /// queues at WC layer even on transient failure).
    ///
    /// Optional with `{}` default for back-compat with the Phase A
    /// mock-only callers (e.g. #Preview macros). Pre-fix the spec
    /// only had `onFinishComplete` + `onAbort` and the WC send was
    /// a TODO inside `handleFinish`.
    var onCommit: () -> Void = {}

    /// #312 — live HK stats provider. Wired by SetLoggerView to
    /// `sessionController.liveWorkoutStats()`: HR min/max/latest + 動態
    /// (active) / 靜態 (basal) kcal read off the in-flight
    /// HKLiveWorkoutBuilder, which is still collecting while this page
    /// is visible (the HK session only ends after [完成]/[放棄]).
    /// Re-queried on every page appear. Defaults to empty stats for
    /// #Preview / mock callers → tiles render "--".
    var liveStats: () -> WorkoutLiveStats = { WorkoutLiveStats() }

    /// Called when sync succeeds (after the 0.5s ✓ display) — caller
    /// should dismiss the finish page. 2026-05-29 deep-night smoke fix:
    /// SetLoggerView now wires this to `\.dismiss` (pops the
    /// NavigationStack back to PickerRootView), replacing the previous
    /// cosmetic-only `selectedPage = 1`.
    let onFinishComplete: () -> Void

    /// Called when user taps [取消] — caller should abort the session
    /// (currently: TabView → selectedPage = 1; real abort path lands
    /// in D31 abort-channel grill).
    let onAbort: () -> Void

    @State private var phase: FinishPhase = .idle

    /// #312 — live builder readings, refreshed on every appear (the
    /// TabView re-fires onAppear each time this page swipes into view,
    /// so the values reflect "now", not session start).
    @State private var stats = WorkoutLiveStats()

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
        // 2026-05-29 late-evening polish (user smoke feedback):
        //   - Buttons promoted to right under the header (was at the
        //     bottom). Wrist-glance UX: user sees the action buttons
        //     immediately on swipe-in, no scroll needed.
        //   - Removed the "(← 左滑回 session 繼續)" hint row at the
        //     very bottom — redundant given the page-dot indicator
        //     and the new top-of-page button placement.
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                headerRow
                Rectangle()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(height: 0.5)
                buttonsRow
                subtitleRow
                    .padding(.top, 2)
                tilesBlock
                    .padding(.top, 4)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
        }
        .navigationBarHidden(true)
        .animation(.easeInOut(duration: 0.18), value: phase)
        .onAppear {
            stats = liveStats()
        }
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
        // 2026-06-26 Goal 2d — the 3-tuple「模板 · 計劃 · 強度」moved from
        // `title` (now line 1 = template name only) to the new `subtitle`
        // field. Prefer it; fall back to `title` (planned / minimal / freestyle
        // sessions carry no subtitle) and finally "—" when both are empty.
        if let sub = snapshot.subtitle, !sub.isEmpty { return sub }
        return snapshot.title.isEmpty ? "—" : snapshot.title
    }

    // MARK: - 5 Tiles (fixed order, vertical)

    private var tilesBlock: some View {
        // 2026-06-11 user 拍板（#312 v2）：🔥 拆動態/靜態兩行 → 6-tile
        // （5-tile 凍結 spec amend 見 ADR-0019 D14 § 2026-06-11）。
        VStack(alignment: .leading, spacing: 4) {
            tileRow(icon: "checkmark", text: setsTileText)
            tileRow(icon: "clock", text: durationTileText)
            tileRow(icon: "heart.fill", text: hrTileText, iconColor: .red)
            tileRow(icon: "flame.fill", text: activeKcalTileText, iconColor: .orange)
            tileRow(icon: "flame", text: basalKcalTileText, iconColor: .secondary)
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

    /// HR 範圍 min–max — live off the HKLiveWorkoutBuilder via
    /// `liveStats`（#312 v2 user 拍板：平均改範圍）。單一樣本（min==max
    /// 取整後相同）收斂單值；無樣本顯 "--"（Simulator / 未授權 / session
    /// 太短）。
    private var hrTileText: String {
        switch (stats.hrMin, stats.hrMax) {
        case let (lo?, hi?) where Int(lo.rounded()) != Int(hi.rounded()):
            return "\(Int(lo.rounded()))–\(Int(hi.rounded())) bpm"
        case let (lo?, _):
            return "\(Int(lo.rounded())) bpm"
        case let (nil, hi?):
            return "\(Int(hi.rounded())) bpm"
        default:
            return "-- bpm"
        }
    }

    /// 動態 kcal — activeEnergyBurned 累計（#312；原硬編 285）。
    private var activeKcalTileText: String {
        guard let v = stats.activeKcal else { return "-- kcal（動態）" }
        return "\(Int(v.rounded())) kcal（動態）"
    }

    /// 靜態 kcal — basalEnergyBurned 累計（#312 v2 user 拍板拆兩行；
    /// 型別 2026-06-11 才進 typesToRead，授權前永遠 "--"）。
    private var basalKcalTileText: String {
        guard let v = stats.basalKcal else { return "-- kcal（靜態）" }
        return "\(Int(v.rounded())) kcal（靜態）"
    }

    /// session 動作數 — #312 v2 user 拍板：有 ✓ 才算 1，N/M 格式對齊
    /// 組數 tile；完成定義＝該動作至少一個非熱身 ✓（與組數 tile 一致
    /// 排除熱身）。
    private var exerciseTileText: String {
        let total = snapshot.exercises.count
        let completed = snapshot.exercises.filter { ex in
            ex.sets.contains { $0.isLogged && $0.setKind != "warmup" }
        }.count
        return "\(completed)/\(total) 動作"
    }

    // MARK: - Buttons

    private var buttonsRow: some View {
        HStack(spacing: 6) {
            // 2026-05-29 deep-night smoke polish (Issue 2):
            // 「取消」→「放棄」 — 使用者反饋更貼切，因為這個按鈕的
            // 真實語意是「不要保留這次 session」(D31 abort channel
            // 將在那邊 wire 真的 session delete + WC abort)，不是
            // 一般 modal 的「取消當前操作回上一頁」。目前的 handler
            // 還是 cosmetic (TabView → selectedPage = 1)，等 D31
            // 上路後 wire 真的 abort 流程。
            // TODO(D31 abort channel): handleCancel 接 sessionDelete
            //   + coordinator.sendAbortToiPhone(...)，並用 onSessionEnd
            //   pop 整路回 picker。
            Button(action: handleCancel) {
                Text("放棄")
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

        // 2026-05-29 deep-night smoke fix (Bug 4 wire): fire WC
        // synchronously at tap-time. Caller (`SetLoggerView`) wires
        // `onCommit` to `coordinator.sendEndToiPhone(sessionId:)` —
        // fire-and-forget, transport errors surface on
        // `coordinator.lastOutbound` for diagnostic only.
        //
        // Why synchronous (vs awaiting): WC `sendMessage` is async at
        // the framework layer but the JS reply round-trip can take 5s
        // (replyHandler timeout). Blocking the spinner UX on that
        // round-trip would feel sluggish. Instead we fire-and-forget
        // and rely on iPhone-side idempotency (createSession is gated
        // by `existing == null`) to handle any retry double-trigger.
        onCommit()

        Task {
            // 1.5s visual spinner — enough to feel like "syncing" without
            // dragging on user perception. (Was 2s + 90% random success
            // pre-fix; with real WC firing we always succeed visually
            // since iPhone-side reconciliation is independent of the
            // Watch UI ack.)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run {
                phase = .success
                // Hold the ✓ for 0.5s so the user sees confirmation,
                // then hand off to the caller for dismissal (which now
                // pops the NavigationStack via `\.dismiss`).
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    onFinishComplete()
                    // Reset to idle in case the view stays mounted
                    // (defensive — `\.dismiss` should unmount, but the
                    // SwiftUI dismiss timing isn't guaranteed-synchronous).
                    phase = .idle
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
