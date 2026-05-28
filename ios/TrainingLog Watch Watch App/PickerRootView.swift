//
//  PickerRootView.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — Watch app root view (picker).
//  Per ADR-0019 § Slice 13d D8 Watch Picker Spec (frozen 2026-05-28).
//
//  Visual structure (matching ASCII mock line 1641-1654):
//
//    ┌──────────────────────────────────┐
//    │ 選擇訓練                    🔄   │   ← navigationTitle + toolbar
//    │ ─────────────────────────────    │
//    │ 計劃訓練                         │   ← Section header
//    │  ▶ 推日 W3D1（今日）             │
//    │ ─────────────────────────────    │
//    │ 模板訓練                         │   ← Section header
//    │  • 推日（A）                     │
//    │  ...
//    └──────────────────────────────────┘
//
//  Phase 1 scope:
//    - Sections + rows + empty states render correctly
//    - 🔄 button triggers 0.5s spin (cosmetic; Phase 2 wires WC)
//    - Tap routing: 計劃 row → bypass sheet → set logger stub
//                   模板 row → ProgramPickerSheet
//    - Selection terminus: D11 set logger is not built yet,
//      so we navigate to `PickerSetLoggerPlaceholderView` which
//      just shows the captured 3-tuple as text (Phase 3 will
//      replace this with the actual D11 view).
//

import SwiftUI

/// Navigation destinations stacked on top of the picker root.
enum PickerDestination: Hashable {
    /// Sheet 2: 計劃 (program selector). Opened from a 模板訓練 row.
    case programSheet(template: TemplateOption)

    /// Sheet 3: 強度 (intensity selector). Opened from a non-通用
    /// program row in the 計劃 sheet.
    case intensitySheet(template: TemplateOption, program: ProgramOption)

    /// Terminal: enter the Set logger (D11). Phase 1 shows a stub
    /// view that just prints the 3-tuple; Phase 3 wires the actual
    /// outbound + replaces this with the real D11 view.
    case setLogger(selection: PickerSelection)
}

struct PickerRootView: View {
    @StateObject private var vm: PickerViewModel
    @State private var path: [PickerDestination] = []

    /// Inject a view model. Default to .mockDefault() for production
    /// preview in Phase 1; Phase 2 caller passes a VM bound to the
    /// WatchConnectivityCoordinator.
    init(viewModel: PickerViewModel? = nil) {
        _vm = StateObject(
            wrappedValue: viewModel ?? PickerViewModel.mockDefault()
        )
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                planSection
                templateSection
            }
            .listStyle(.carousel)
            .navigationTitle("選擇訓練")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    refreshButton
                }
            }
            .navigationDestination(for: PickerDestination.self) { dest in
                destinationView(for: dest)
            }
            .onAppear {
                // Reset stale drill-down state on cold root present.
                vm.resetSelection()
            }
            .task {
                // Fire the cold-launch handshake once per VM lifetime.
                // `.task` cancels on view disappear; bootstrap is
                // idempotent so re-mount is safe.
                await vm.bootstrap()
            }
        }
    }

    // MARK: - Toolbar 🔄

    private var refreshButton: some View {
        Button {
            Task { await vm.refresh() }
        } label: {
            Image(systemName: "arrow.clockwise")
                .rotationEffect(.degrees(vm.isRefreshing ? 360 : 0))
                .animation(
                    vm.isRefreshing
                        ? .linear(duration: 0.5).repeatForever(autoreverses: false)
                        : .default,
                    value: vm.isRefreshing
                )
        }
        .accessibilityLabel("重新整理")
        .disabled(vm.isRefreshing)
    }

    // MARK: - 計劃訓練 section

    @ViewBuilder
    private var planSection: some View {
        Section {
            switch vm.todayPlanned {
            case .planned(let label, _):
                Button {
                    vm.selectTodayPlanned()
                    // Bypass both sheets — program day spec already
                    // carries the 3-tuple from iPhone (Phase 2+).
                    path.append(.setLogger(selection: PickerSelection(
                        template: nil,
                        program: nil,
                        intensity: nil
                    )))
                } label: {
                    PlanRowLabel(marker: "▶", text: label)
                }
                .buttonStyle(.plain)

            case .restDay:
                EmptyStateRow(text: "今日休息（無訓練）")

            case .noActiveProgram:
                VStack(alignment: .leading, spacing: 2) {
                    EmptyStateRow(text: "（無計劃進行中）")
                    EmptyStateRow(text: "請至 iPhone 設定計劃")
                        .font(.caption2)
                }
            }
        } header: {
            Text("計劃訓練")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - 模板訓練 section

    @ViewBuilder
    private var templateSection: some View {
        Section {
            if vm.templates.isEmpty {
                EmptyStateRow(text: "請在手機創建模板")
            } else {
                ForEach(vm.templates) { template in
                    Button {
                        vm.selectedTemplate = template
                        path.append(.programSheet(template: template))
                    } label: {
                        PlanRowLabel(marker: "•", text: template.name)
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            Text("模板訓練")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Navigation destinations

    @ViewBuilder
    private func destinationView(for dest: PickerDestination) -> some View {
        switch dest {
        case .programSheet(let template):
            ProgramPickerSheet(
                template: template,
                programs: vm.programs,
                onPick: handleProgramPick
            )

        case .intensitySheet(let template, let program):
            IntensityPickerSheet(
                template: template,
                program: program,
                onPick: handleIntensityPick
            )

        case .setLogger(let selection):
            PickerSetLoggerPlaceholderView(selection: selection, vm: vm)
        }
    }

    // MARK: - Sheet callbacks

    private func handleProgramPick(template: TemplateOption, program: ProgramOption?) {
        if let program {
            // Non-通用 program → drill into 強度 sheet
            vm.selectedProgram = program
            path.append(.intensitySheet(template: template, program: program))
        } else {
            // "通用" tapped → bypass 強度 sheet, enter Set logger with
            // template-only selection (program / intensity both nil).
            vm.selectedProgram = nil
            vm.selectedIntensity = nil
            path.append(.setLogger(selection: PickerSelection(
                template: template,
                program: nil,
                intensity: nil
            )))
        }
    }

    private func handleIntensityPick(
        template: TemplateOption,
        program: ProgramOption,
        intensity: IntensityOption?
    ) {
        vm.selectedIntensity = intensity
        // intensity is nil when "通用" tapped inside 強度 sheet.
        path.append(.setLogger(selection: PickerSelection(
            template: template,
            program: program,
            intensity: intensity
        )))
    }
}

// MARK: - Row layout helpers

/// One picker row: marker glyph + label. Used by both 計劃訓練 row
/// (▶) and 模板訓練 rows (•). Plain Button style; the parent List
/// handles row chrome.
private struct PlanRowLabel: View {
    let marker: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 12, alignment: .center)
            Text(text)
                .font(.body)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

/// Non-interactive empty state line. Used for 休息日 / 無計劃 / 無模板
/// rows. Reads as a dimmer body text, not a row-button.
private struct EmptyStateRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Terminal placeholder (D11 stub)

/// Phase 3 stub destination — fires `start-from-watch` to iPhone on
/// mount and renders the WC reply state (creating / created /
/// failed). Replaces D11 set logger view until that ships.
///
/// State machine:
///   - On appear:        kick off vm.startFromWatch(selection)
///   - isStartingSession: spinner + "與 iPhone 同步中…"
///   - startResult = nil after attempt: shouldn't happen (set before
///                                       returning)
///   - startResult = .some(nil): WC transport failure
///   - startResult = .some(reply) isOK=true: render sessionId + exercises
///   - startResult = .some(reply) isOK=false: iPhone-reported failure
///
/// Phase 4+ replaces this view with the actual D11 set logger.
struct PickerSetLoggerPlaceholderView: View {
    let selection: PickerSelection
    @ObservedObject var vm: PickerViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Set logger 進入點")
                    .font(.headline)
                Text("(D11 未實作、stub)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Divider().padding(.vertical, 2)

                Text("3 元組").font(.caption).bold()
                Text("模板：\(selection.template?.name ?? "（無 — 計劃路徑）")")
                    .font(.caption2)
                Text("計劃：\(selection.program?.name ?? "通用")")
                    .font(.caption2)
                Text("強度：\(selection.intensity?.name ?? "通用")")
                    .font(.caption2)

                Divider().padding(.vertical, 2)

                Text("WC 狀態").font(.caption).bold()
                wcStatusBlock
            }
            .padding()
        }
        .navigationTitle("Set logger")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await vm.startFromWatch(selection: selection)
        }
    }

    @ViewBuilder
    private var wcStatusBlock: some View {
        if vm.isStartingSession {
            HStack(spacing: 4) {
                ProgressView().controlSize(.mini)
                Text("與 iPhone 同步中…")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else if let attempted = vm.startResult {
            // attempted is `StartFromWatchReply?` (outer optional unwrapped).
            // nil ⇒ WC transport failure (no reply / framework err).
            // .some(reply) ⇒ iPhone responded; check reply.isOK for outcome.
            if let reply = attempted {
                if reply.isOK, let snapshot = reply.snapshot {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Session 建立成功", systemImage: "checkmark.circle")
                            .font(.caption2)
                            .foregroundStyle(.green)
                        Text("sess=\(String(reply.sessionId.prefix(8)))…")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("動作數：\(snapshot.exercises.count)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Label("iPhone 回報失敗", systemImage: "exclamationmark.triangle")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            } else {
                Label("傳輸失敗（iPhone 未配對或無回應）", systemImage: "wifi.slash")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        } else {
            Text("尚未發送")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Previews

#Preview("Default (有資料)") {
    PickerRootView(viewModel: PickerViewModel.mockDefault())
}

#Preview("休息日") {
    PickerRootView(viewModel: PickerViewModel.mockRestDay())
}

#Preview("無 active program") {
    PickerRootView(viewModel: PickerViewModel.mockNoProgram())
}

#Preview("無 templates") {
    PickerRootView(viewModel: PickerViewModel.mockNoTemplates())
}

#Preview("雙區皆空") {
    PickerRootView(viewModel: PickerViewModel.mockAllEmpty())
}
