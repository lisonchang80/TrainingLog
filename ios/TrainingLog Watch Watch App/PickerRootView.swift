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
            case .planned(let label, _, _, _):
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
            // 2026-05-29 deep-night smoke polish (Issue 1 fix):
            // session 終了（Watch [完成] OR iPhone 推 end-session）後要
            // 整路 pop 回 picker 第一頁，不能只 pop 一層回強度 sheet。
            // 把 `path.removeAll()` 包成 closure 傳進去；SetLoggerView
            // / FinishPageView 完成時 call 這個 closure 取代原本的
            // `dismiss()` (Environment) — `dismiss()` 只 pop 一層。
            PickerSetLoggerPlaceholderView(
                selection: selection,
                vm: vm,
                onSessionEnd: { path.removeAll() }
            )
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

// MARK: - Terminal destination (Picker → Set logger transition)

/// Drives the start-from-watch handshake AND swaps in the real
/// `SetLoggerView` (D11) once the iPhone reply lands. Before that
/// — during in-flight or after a failure — renders a transitional
/// view (spinner / retry button).
///
/// State branches (mounted in order during a typical flow):
///   1. isStartingSession=true ⇒ spinner page
///   2. startResult success    ⇒ SetLoggerView(snapshot:)  ← D11
///   3. startResult failure    ⇒ retry page
///
/// `.task` fires `vm.startFromWatch(selection)` on appear; the VM
/// resets its result + flag in `resetSelection()` so re-entering
/// the placeholder retries from scratch.
struct PickerSetLoggerPlaceholderView: View {
    let selection: PickerSelection
    @ObservedObject var vm: PickerViewModel

    /// 2026-05-29 deep-night smoke polish (Issue 1 fix):
    /// Called when the inner SetLoggerView wants to terminate the
    /// session (Watch [完成] success path OR iPhone-led end-session).
    /// PickerRootView wires this to `path.removeAll()` so we pop all
    /// the way back to the picker root, NOT just one level back to
    /// the intensity sheet (which is what `Environment.dismiss` does).
    /// Optional for back-compat with the 3-arg init below.
    var onSessionEnd: (() -> Void)? = nil

    var body: some View {
        contentView
            .task {
                await vm.startFromWatch(selection: selection)
            }
    }

    @ViewBuilder
    private var contentView: some View {
        if vm.isStartingSession {
            syncingView
        } else if let attempted = vm.startResult {
            if let reply = attempted, reply.isOK, let snapshot = reply.snapshot {
                // SUCCESS → real D11 set logger view (Phase A
                // skeleton; Phase B+ adds interactions).
                // Issue 1 fix: forward `onSessionEnd` so SetLoggerView
                // can terminate the whole nav stack instead of just
                // pop-one-level.
                SetLoggerView(
                    snapshot: snapshot,
                    onSessionEnd: onSessionEnd
                )
            } else if let reply = attempted, !reply.isOK {
                retryView(error: "iPhone 回報失敗", icon: "exclamationmark.triangle")
            } else {
                retryView(error: "傳輸失敗（iPhone 未配對或無回應）", icon: "wifi.slash")
            }
        } else {
            // Pre-task tick. Render an empty spacer; the `.task`
            // modifier will flip vm.isStartingSession on the next
            // render pass.
            Color.clear
        }
    }

    // MARK: - Sub-views

    private var syncingView: some View {
        VStack(alignment: .center, spacing: 8) {
            Spacer()
            ProgressView().controlSize(.regular)
            Text("與 iPhone 同步中…")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(selectionSubtitle)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("啟動訓練")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func retryView(error: String, icon: String) -> some View {
        VStack(alignment: .center, spacing: 8) {
            Spacer()
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.red)
            Text(error)
                .font(.caption2)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
            Button("重試") {
                Task { await vm.startFromWatch(selection: selection) }
            }
            .font(.caption2)
            .controlSize(.small)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("啟動訓練")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var selectionSubtitle: String {
        var parts: [String] = []
        if let t = selection.template?.name { parts.append(t) }
        parts.append(selection.program?.name ?? "通用")
        parts.append(selection.intensity?.name ?? "通用")
        return parts.joined(separator: " · ")
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
