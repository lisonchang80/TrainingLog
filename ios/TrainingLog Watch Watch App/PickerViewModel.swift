//
//  PickerViewModel.swift
//  TrainingLog Watch
//
//  Slice 13d D8 — picker view-state owner.
//
//  Phase 1 (skeleton 73b2dfc): hardcoded mock data factories only.
//  Phase 2 (Path A minimal): coordinator integration + Stage 1
//  handshake wire — templates only.
//  Phase 2.5 (this commit): Stage 1 reply extension landed —
//  programs + per-program intensities + today's planned-day now
//  flow from the iPhone-side `loadProgramsPrefetchList` /
//  `loadTodayPlanned` builders. The hardcoded mock paths
//  (mockDefault / mockRestDay / mockNoProgram / mockNoTemplates /
//  mockAllEmpty) survive intact for `#Preview` invocations only.
//  See ADR-0019 NEW-Q44 for the staged-extension rationale.
//
//  Why @MainActor: SwiftUI views observe @Published mutations on the
//  main thread; the WC reply handler hops to MainActor before
//  mutating, same pattern as WatchConnectivityCoordinator.
//
//  Mock factories survive intact for `#Preview` invocations — they
//  bypass the coordinator and inject canned data directly.
//

import Foundation
import Combine

@MainActor
final class PickerViewModel: ObservableObject {

    /// Today's planned-row state.
    @Published var todayPlanned: TodayPlanned

    /// Templates list — populated from Stage 1 reply after handshake.
    /// Empty array → "請在手機創建模板" empty state.
    @Published var templates: [TemplateOption]

    /// Active programs the user can pick from in the 計劃 sheet.
    /// Phase 2.5 (this commit): populated from the Stage 1 reply's
    /// `prefetch.programs` field (which carries inline intensities per
    /// program). Older iPhone builds that don't send the field → init
    /// value (caller-provided mock OR empty `[]`) survives.
    @Published var programs: [ProgramOption]

    /// True while a handshake round-trip is in flight (cold bootstrap
    /// OR 🔄 refresh tap). Drives the toolbar icon's spin animation.
    @Published var isRefreshing: Bool = false

    // MARK: - Start-from-watch state (Phase 3)

    /// True while a start-from-watch round-trip is in flight. The
    /// Phase 3 placeholder view uses this to render a "creating
    /// session…" indicator.
    @Published var isStartingSession: Bool = false

    /// Result of the most recent `startFromWatch(...)` call. Cleared
    /// each time the picker root reappears (`resetSelection`).
    /// Cases:
    ///   - nil: no attempt yet
    ///   - .some(nil): WC transport failure (no reply / framework err)
    ///   - .some(reply) with isOK=true: iPhone created the session
    ///   - .some(reply) with isOK=false: iPhone replied, couldn't create
    @Published var startResult: StartFromWatchReply??

    // MARK: - 3-tuple navigation state

    @Published var selectedTemplate: TemplateOption?
    @Published var selectedProgram: ProgramOption?
    @Published var selectedIntensity: IntensityOption?

    // MARK: - Coordinator dependency

    /// WC coordinator used to send `handshake` outbound. Weak to break
    /// the retain cycle (ContentView holds the coordinator strongly
    /// via @StateObject; VM is owned by PickerRootView's @StateObject
    /// which is held by the picker NavigationStack — without weak the
    /// coordinator would never deinit even if the picker tree is
    /// unmounted).
    ///
    /// Nil ⇔ Preview / unit-test mode → `refresh()` falls back to a
    /// 0.5s fake spin without touching WC.
    private weak var coordinator: WatchConnectivityCoordinator?

    /// True after the first cold-launch handshake has run (regardless
    /// of success). Used by `bootstrap()` to make it idempotent so
    /// `.task` doesn't re-fire on every onAppear.
    private var hasBootstrapped: Bool = false

    // MARK: - Inits

    /// Production init: takes a coordinator. Starts in an empty state
    /// — caller invokes `bootstrap()` after mount to populate via
    /// handshake.
    init(coordinator: WatchConnectivityCoordinator) {
        self.coordinator = coordinator
        self.todayPlanned = .noActiveProgram
        self.templates = []
        self.programs = []
    }

    /// Mock init: bypasses coordinator. Used by `#Preview` factories.
    init(
        todayPlanned: TodayPlanned,
        templates: [TemplateOption],
        programs: [ProgramOption]
    ) {
        self.coordinator = nil
        self.todayPlanned = todayPlanned
        self.templates = templates
        self.programs = programs
    }

    // MARK: - Lifecycle

    /// Idempotent cold-launch entry point. Called from
    /// `PickerRootView.task { … }` so the first handshake fires on
    /// initial appear; subsequent appears are no-ops.
    ///
    /// `.task` cancels on view disappear, so the in-flight handshake
    /// will be cancelled if the user dismisses the picker mid-trip.
    /// The coordinator's `withCheckedContinuation` doesn't observe
    /// cancellation by itself; we rely on the 5s framework timeout
    /// to resume + the deinit guard on coordinator weak ref.
    func bootstrap() async {
        guard !hasBootstrapped else { return }
        hasBootstrapped = true
        await refresh()
    }

    /// Force a fresh handshake regardless of `hasBootstrapped` state.
    /// Wired to the 🔄 toolbar button. Failures (no coordinator, no
    /// reply, decode fail) silently leave existing data in place —
    /// the spinning animation provides the only user-visible signal.
    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        // Preview / no-coordinator path: cosmetic 0.5s spin only.
        guard let coordinator else {
            try? await Task.sleep(nanoseconds: 500_000_000)
            return
        }

        if let reply = await coordinator.requestHandshake() {
            applyStage1Reply(reply)
        }
    }

    // MARK: - Stage 1 reply application

    /// Map Stage 1 reply onto view state. Phase 2 wired only
    /// `templates`; Phase 2.5 (this commit) extends to `programs` +
    /// `todayPlanned` from the iPhone-side `loadProgramsPrefetchList`
    /// + `loadTodayPlanned` builders (`src/adapters/watch/handshake.ts`).
    ///
    /// Optional-field semantics:
    ///   - `reply.prefetch.programs == nil` (older iPhone build) →
    ///     leave existing `self.programs` in place (init value = `[]`,
    ///     or whatever the caller's mock factory seeded).
    ///   - `reply.prefetch.todayPlanned == nil` (older iPhone build) →
    ///     leave existing `self.todayPlanned` in place.
    ///   - Both fields populated → overwrite verbatim.
    func applyStage1Reply(_ reply: Stage1Reply) {
        templates = reply.prefetch.templates.map { summary in
            TemplateOption(id: summary.templateId, name: summary.name)
        }
        // Phase 2.5 — programs with inline intensities.
        if let programDTOs = reply.prefetch.programs {
            programs = programDTOs.map { p in
                ProgramOption(
                    id: p.id,
                    name: p.name,
                    intensities: p.intensities.map { i in
                        IntensityOption(id: i.id, name: i.name)
                    }
                )
            }
        }
        // Phase 2.5 — today's planned-day.
        if let plannedDTO = reply.prefetch.todayPlanned {
            switch plannedDTO {
            case .planned(let label, let programDayId):
                todayPlanned = .planned(
                    label: label,
                    programDayId: programDayId
                )
            case .restDay:
                todayPlanned = .restDay
            case .noActiveProgram:
                todayPlanned = .noActiveProgram
            }
        }
        // NB: reply.hasActiveSession is intentionally ignored in
        // Phase 2. Phase 3 will branch here to auto-adopt the
        // iPhone-initiated session (skip picker → jump to set logger).
        // Until D11 is built, there's no set logger to jump to.
    }

    // MARK: - Start-from-watch (Phase 3)

    /// Fire `start-from-watch` outbound for the captured selection
    /// and store the result. Idempotent at the VM level: re-firing
    /// with the same selection re-sends (Phase 3 doesn't dedup;
    /// Phase 4+ may add a hashing guard).
    ///
    /// HK lifecycle is NOT touched here — `SessionController.start()`
    /// belongs to D11 set logger's lifecycle ownership. Phase 3 is
    /// pure WC-mechanics validation.
    func startFromWatch(selection: PickerSelection) async {
        guard let coordinator else {
            // Preview / sim / no-coordinator: mock SUCCESS with the
            // canonical mock snapshot. This lets the picker → set
            // logger flow be exercised end-to-end without a paired
            // iPhone (e.g. for Sim smoke testing the D11 UI).
            isStartingSession = true
            try? await Task.sleep(nanoseconds: 500_000_000)
            isStartingSession = false
            startResult = .some(StartFromWatchReply(
                sessionId: "mock-session-1",
                snapshot: SetLoggerMockData.mockSnapshot()
            ))
            return
        }

        isStartingSession = true
        defer { isStartingSession = false }

        let reply = await coordinator.sendStartFromWatch(
            templateId: selection.template?.id,
            programCycleId: selection.program?.id,
            intensityId: selection.intensity?.id
        )
        startResult = .some(reply)
    }

    // MARK: - Selection helpers

    /// Reset 3-tuple slots when user leaves the drill-down. Also
    /// clears any prior start-from-watch result.
    func resetSelection() {
        selectedTemplate = nil
        selectedProgram = nil
        selectedIntensity = nil
        startResult = nil
        isStartingSession = false
    }

    /// Convenience for "user picked today's planned row".
    func selectTodayPlanned() {
        resetSelection()
    }
}

// MARK: - Mock factories (Preview only)

extension PickerViewModel {

    /// Both sections populated. Same shape as Phase 1; used by every
    /// `#Preview` macro that needs non-empty data.
    static func mockDefault() -> PickerViewModel {
        PickerViewModel(
            todayPlanned: .planned(label: "推日 W3D1（今日）", programDayId: "pd-1"),
            templates: [
                TemplateOption(id: "t1", name: "推日（A）"),
                TemplateOption(id: "t2", name: "拉日（B）"),
                TemplateOption(id: "t3", name: "腿日（C）"),
                TemplateOption(id: "t4", name: "全身"),
            ],
            programs: [
                ProgramOption(
                    id: "p1",
                    name: "Linear progression W3",
                    intensities: [
                        IntensityOption(id: "i1", name: "Volume day"),
                        IntensityOption(id: "i2", name: "Intensity day"),
                        IntensityOption(id: "i3", name: "Deload"),
                    ]
                ),
                ProgramOption(
                    id: "p2",
                    name: "PPL W5",
                    intensities: [
                        IntensityOption(id: "i4", name: "Heavy"),
                        IntensityOption(id: "i5", name: "Volume"),
                    ]
                ),
                ProgramOption(
                    id: "p3",
                    name: "PHUL W2",
                    intensities: [
                        IntensityOption(id: "i6", name: "Power"),
                        IntensityOption(id: "i7", name: "Hypertrophy"),
                    ]
                ),
            ]
        )
    }

    /// Rest day variant.
    static func mockRestDay() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .restDay
        return vm
    }

    /// No-active-program variant.
    static func mockNoProgram() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .noActiveProgram
        vm.programs = []
        return vm
    }

    /// No templates variant.
    static func mockNoTemplates() -> PickerViewModel {
        let vm = mockDefault()
        vm.templates = []
        return vm
    }

    /// Both sections empty.
    static func mockAllEmpty() -> PickerViewModel {
        PickerViewModel(
            todayPlanned: .noActiveProgram,
            templates: [],
            programs: []
        )
    }
}
