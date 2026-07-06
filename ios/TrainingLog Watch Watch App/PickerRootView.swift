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

    /// Terminal: enter the Set logger for a session CAST from the iPhone
    /// (2026-06-27, 投影 Watch). Unlike `.setLogger` this carries the full
    /// snapshot directly and renders `SetLoggerView(snapshot:)` WITHOUT going
    /// through `PickerSetLoggerPlaceholderView` — so it never fires
    /// `startFromWatch` (the session already exists on iPhone; the Watch is
    /// adopting it, not creating one). Live-mirror keeps it synced after mount.
    /// `epoch` (ADR-0028) is the iPhone's seeded edit-token generation → the
    /// Watch mounts LOCKED at it (the iPhone holds the token, 發起方初握).
    case castSession(snapshot: SessionSnapshot, epoch: Int)
}

struct PickerRootView: View {
    @StateObject private var vm: PickerViewModel
    @State private var path: [PickerDestination] = []

    /// Injected at ContentView level (`.environmentObject(watchConn)`). Used to
    /// observe inbound `cast-session` (投影 Watch) via `$pendingCast`.
    @EnvironmentObject private var coordinator: WatchConnectivityCoordinator

    /// #6 (2026-07-06) — foreground re-entry hook. A cast delivered to a
    /// backgrounded Watch rides the durable TUI and sets `coordinator.pendingCast`
    /// on wake, but `.onChange(of: pendingCast)` never fires for an already-set
    /// value and the one-shot `.task` below may have run before the TUI landed
    /// (the routing race). Re-running `routeCastIfNew` on every foreground closes
    /// that gap so the cast reliably routes → the set logger mounts → HK starts.
    @Environment(\.scenePhase) private var scenePhase

    /// Id of the session currently open on the wrist (Watch-led OR cast),
    /// nil at the picker root. Drives the cast conflict decision: same id →
    /// no-op, different id → ask before replacing. Cleared on session end.
    @State private var openSessionId: String?

    /// Set when a `cast-session` arrives while a DIFFERENT session is open →
    /// presents the conflict alert. nil dismisses it. Holds the full request
    /// (snapshot + ADR-0028 epoch) so a「切換」carries the epoch into the cast.
    @State private var castConflict: CastRequest?

    /// Token of the last cast we routed — dedups the two entry points
    /// (`.onChange` for casts arriving while shown + `.task` for a cast already
    /// queued at cold launch). Each `CastRequest` carries a monotonic token, so
    /// a cast routes exactly once regardless of which fires first.
    @State private var lastCastToken: Int?

    /// Bumped on session-end return so the carousel List re-creates and resets
    /// its scroll to the TOP (user 2026-06-01: 完成/放棄後回第一頁、捲到最上層).
    /// `.id(listResetToken)` on the List drives the reset — a LOOP-SAFE
    /// alternative to `ScrollViewReader` (which + a `.carousel` List inside this
    /// NavigationStack triggered a scene-update render-loop watchdog kill,
    /// 0x8badf00d, see the List comment). The token only changes on return →
    /// the id is otherwise stable → no loop.
    @State private var listResetToken = 0

    /// ADR-0030 — Watch 首啟引導. `pickerGuideSeen` gates the Part A
    /// (picker intro) auto-present: false ⇒ show once on first appear, then
    /// pin true. `guide` drives the full-screen carousel cover — set to
    /// `.pickerIntro` by the first-appear trigger, or `.full` by the ⓘ
    /// re-run button (which replays A + B as one review).
    @AppStorage(WatchOnboardingKey.pickerSeen) private var pickerGuideSeen = false
    @State private var guide: WatchGuideMode?

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
            // Picker-hang fix (2026-05-30): UI-F #8 wrapped this carousel
            // List in a `ScrollViewReader` (to snap-to-top on return to
            // root after 完成/放棄). On watchOS that wrapper + a `.carousel`
            // List inside a NavigationStack push triggered a SwiftUI
            // scene-update render loop — drilling 模板 → 計劃 → 強度 burned
            // the main thread until the 10s watchdog killed the app
            // (0x8badf00d, crash 2026-05-30 22:03). Reverted to a plain
            // List; the scroll-to-top cosmetic is dropped until it can be
            // re-added with a loop-safe mechanism.
            List {
                // Slice 16 / ADR-0026 D2 — 極簡模式 hides the entire
                // 「計劃訓練」section; only the 模板訓練 list remains.
                if !vm.isMinimal {
                    planSection
                }
                templateSection
            }
            .listStyle(.carousel)
            .navigationTitle("選擇訓練")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // ADR-0030 — ⓘ re-run the picker intro (Part A). Placed
                // top-LEADING (root has no back button) so it doesn't crowd the
                // 🔄 top-trailing. Only Part A (1-3) — the gesture steps (4+)
                // live INSIDE 開始訓練 (auto on first set-logger mount), per
                // user 2026-07-02「第4步到後面移到手錶開始訓練裡頭」.
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        guide = .pickerIntro
                    } label: {
                        Image(systemName: "info.circle")
                    }
                    .accessibilityLabel("重新查看教學")
                }
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
                // ADR-0030 — auto-present Part A once on first picker appear.
                // Guarded so a first-launch that ALSO receives an iPhone cast
                // (which pushes straight to the set logger) doesn't flash the
                // intro over the pushed session: only fire at the bare root
                // (empty path) with no cast pending.
                if !pickerGuideSeen, guide == nil,
                   path.isEmpty, coordinator.pendingCast == nil {
                    guide = .pickerIntro
                }
            }
            .task {
                // Fire the cold-launch handshake once per VM lifetime.
                // `.task` cancels on view disappear; bootstrap is
                // idempotent so re-mount is safe.
                await vm.bootstrap()
            }
            // Re-create the List (→ scroll resets to top) on session-end
            // return. Stable at all other times so there's no render loop.
            .id(listResetToken)
            // 投影 Watch (2026-06-27) — route an inbound cast-session that
            // arrived WHILE the picker is showing (instant sendMessage leg, or
            // a TUI delivered after mount).
            .onChange(of: coordinator.pendingCast) { _, newValue in
                routeCastIfNew(newValue)
            }
            // 投影 Watch — ALSO check on appear. When the Watch app was CLOSED,
            // the cast rides the TUI backstop and iOS delivers it DURING cold
            // launch, often BEFORE this view's `.onChange` registers (which
            // never fires for an already-set value). Reading `pendingCast` here
            // is what makes「開啟手錶 app 後自動帶入」work — the achievable half
            // of "launch even when closed" (iOS has no remote foreground-launch
            // API, so the user still opens the app once). `routeCastIfNew`
            // dedups against `.onChange` via the request token.
            .task {
                routeCastIfNew(coordinator.pendingCast)
            }
            // #6 (2026-07-06) — re-drive cast routing on every foreground. A
            // cast that arrived while this Watch app was backgrounded set
            // `pendingCast` on wake, but `.onChange` never fires for an
            // already-set value and the one-shot `.task` above ran before the
            // TUI delivered it. On foreground, route it — token-deduped, so an
            // already-routed cast no-ops → the set logger mounts → HK starts.
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    routeCastIfNew(coordinator.pendingCast)
                }
            }
            // Track the Watch-LED session id so a later cast of a DIFFERENT
            // session is detected as a conflict (a cast of the SAME id no-ops).
            .onChange(of: vm.startResult) { _, newValue in
                if let reply = newValue.flatMap({ $0 }), reply.isOK,
                   let snap = reply.snapshot {
                    openSessionId = snap.sessionId
                }
            }
            // Conflict: iPhone cast a DIFFERENT session while one is open.
            .alert(
                "切換到投影的訓練？",
                isPresented: Binding(
                    get: { castConflict != nil },
                    set: { if !$0 { castConflict = nil } }
                ),
                presenting: castConflict
            ) { req in
                Button("切換", role: .destructive) { openCast(req) }
                Button("保留目前", role: .cancel) { castConflict = nil }
            } message: { _ in
                Text("iPhone 要把另一個訓練投影到手錶，切換會離開目前手錶上的訓練。")
            }
        }
        // ADR-0030 — Watch 首啟引導 carousel. Presented over the whole
        // NavigationStack so it covers the toolbar too. `.pickerIntro` (first
        // appear) + `.full` (ⓘ re-run) both pin `pickerGuideSeen` on dismiss.
        .fullScreenCover(item: $guide, onDismiss: {
            // Any dismissal — completing the last card OR the watchOS ✕ escape —
            // marks the picker guide seen so it won't auto-nag next launch.
            // (A `.full` re-run just re-sets the already-true flag, harmless.)
            pickerGuideSeen = true
        }) { mode in
            WatchOnboardingView(cards: mode.cards) {
                guide = nil
            }
        }
    }

    // MARK: - cast-session routing (投影 Watch)

    /// Route a cast request exactly once (token-deduped across the `.onChange`
    /// live path + the `.task` cold-launch-queued path). nil / already-routed
    /// tokens are ignored.
    private func routeCastIfNew(_ req: CastRequest?) {
        guard let req, req.token != lastCastToken else { return }
        lastCastToken = req.token
        routeCast(req)
    }

    /// Decide what to do with an inbound cast snapshot:
    ///   - a session of the SAME id is already open → no-op (live-mirror keeps
    ///     it synced; this also absorbs the dual-fire's second leg)
    ///   - a DIFFERENT session is open → ask before replacing (conflict alert)
    ///   - nothing open (idle / mid-drilldown) → open straight away
    private func routeCast(_ req: CastRequest) {
        if let open = openSessionId {
            if open == req.snapshot.sessionId { return }
            castConflict = req
        } else {
            openCast(req)
        }
    }

    /// Replace the nav stack with the cast session's set logger (carrying the
    /// ADR-0028 edit-token epoch so the Watch mounts LOCKED).
    private func openCast(_ req: CastRequest) {
        castConflict = nil
        openSessionId = req.snapshot.sessionId
        path = [.castSession(snapshot: req.snapshot, epoch: req.epoch)]
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
            case let .planned(label, templateName, programName, intensity, _, _, _):
                // #7 (2026-05-30) — 2-line render: template name on line 1,
                // "計劃：<program> · 強度：<intensity>" on line 2. Fall back to
                // the flat `label` when templateName is empty (older iPhone
                // build that only sent `label`).
                let line1 = templateName.isEmpty ? label : templateName
                let subtitle: String = {
                    var parts: [String] = []
                    if !programName.isEmpty { parts.append("計劃：\(programName)") }
                    if let intensity, !intensity.isEmpty {
                        parts.append("強度：\(intensity)")
                    }
                    return parts.joined(separator: " · ")
                }()
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
                    PlanRowLabel(marker: "▶", text: line1, subtitle: subtitle)
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
                        if vm.isMinimal {
                            // Slice 16 / ADR-0026 D2 — 極簡模式: a template
                            // tap goes STRAIGHT into the set logger as 通用
                            // (program=nil, intensity=nil), skipping BOTH
                            // ProgramPickerSheet and IntensityPickerSheet.
                            // Mirrors the existing 「通用」bypass in
                            // handleProgramPick — the (nil, nil) selection
                            // flows into the same resolveVariant path
                            // (prefer 通用 variant, else representative).
                            vm.selectedProgram = nil
                            vm.selectedIntensity = nil
                            path.append(.setLogger(selection: PickerSelection(
                                template: template,
                                program: nil,
                                intensity: nil
                            )))
                        } else {
                            path.append(.programSheet(template: template))
                        }
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
                onSessionEnd: {
                    // Pop back to the picker root + reset its scroll to the top
                    // by re-creating the List (listResetToken → `.id`).
                    path.removeAll()
                    openSessionId = nil
                    listResetToken += 1
                }
            )

        case .castSession(let snapshot, let epoch):
            // 投影 Watch (2026-06-27) — adopt an iPhone-cast session directly.
            // No PickerSetLoggerPlaceholderView wrapper → no startFromWatch /
            // outbound TUI; the session already lives on iPhone. SetLoggerView's
            // own `.task` starts the HK workout + registers reverseSyncApply so
            // the iPhone live-mirror continues to stream onto this view.
            // ADR-0028 — `castEpoch` makes SetLoggerView mount LOCKED at the
            // iPhone-seeded epoch (the iPhone holds the token, 發起方初握).
            SetLoggerView(
                snapshot: snapshot,
                castEpoch: epoch,
                onSessionEnd: {
                    path.removeAll()
                    openSessionId = nil
                    listResetToken += 1
                }
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
    // #7 (2026-05-30) — optional dimmed second line. The planned-cell row
    // passes "計劃：<program> · 強度：<intensity>" here; template rows omit it
    // → unchanged single-line render.
    var subtitle: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 12, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(text)
                    .font(.body)
                    .multilineTextAlignment(.leading)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
            }
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
            // Stage1 prefetch v3 (2026-06-13 Y-dup, grill Q2=A) — when the
            // user's (計劃, 強度) combo matched no variant in this template
            // name group, PickerViewModel fell back to the newest variant
            // and set `lastResolveMissed`. startFromWatch holds this view
            // ~1.5s on a miss so this notice is actually visible (mirrors
            // iPhone's alert-and-proceed). On a match this branch is never
            // taken and the view flashes for ~0ms.
            // ADR-0026 D3 (slice 16) — 極簡模式靜音 resolve-miss 提示，鏡像
            // iPhone。VM 端 startFromWatch 已把 lastResolveMissed 設為
            // `missed && !isMinimal`（noticeMissed），故此分支在極簡模式本就
            // 不會進入；此處 `&& !vm.isMinimal` 為自我說明的防禦守門，避免未來
            // VM 發佈邏輯回歸時這片橘色 ⚠ 又洩漏計劃概念。代換解析照常發生。
            if vm.lastResolveMissed && !vm.isMinimal {
                Label("此組合無對應模板，已使用最新版", systemImage: "exclamationmark.triangle")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            } else {
                Text("與 iPhone 同步中…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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
        // ADR-0026 D1 (slice 16) — 此 過場頁副標題自行重建 (模板 · 計劃 · 強度)
        // 三元組，並非讀 snapshot.title，故 PickerViewModel.resolveSelectionExercises
        // 的 F1 修正觸及不到這裡。極簡模式只顯示模板名，drop「· 通用 · 通用」後綴
        // （通用 是計劃概念標籤）。
        guard let templateName = selection.template?.name else {
            // 非模板路徑（planned / 自由訓練）— 沿用原樣（無計劃三元組）。
            var parts: [String] = []
            parts.append(selection.program?.name ?? "通用")
            parts.append(selection.intensity?.name ?? "通用")
            return parts.joined(separator: " · ")
        }
        if vm.isMinimal {
            return templateName
        }
        let parts = [
            templateName,
            selection.program?.name ?? "通用",
            selection.intensity?.name ?? "通用",
        ]
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
