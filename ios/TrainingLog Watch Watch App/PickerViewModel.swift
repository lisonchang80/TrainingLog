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
        // NEW-Q50 D29 — propagate fat-tree exercises into TemplateOption
        // so the tap path can build a SessionSnapshot offline (without
        // a second round-trip).
        templates = reply.prefetch.templates.map { summary in
            TemplateOption(
                id: summary.templateId,
                name: summary.name,
                exercises: summary.exercises
            )
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
        // Phase 2.5 + NEW-Q50 D29 — today's planned-day, now with
        // templateId + exercises fat-tree for offline snapshot build.
        if let plannedDTO = reply.prefetch.todayPlanned {
            switch plannedDTO {
            case .planned(let label, let programDayId, let templateId, let exercises):
                todayPlanned = .planned(
                    label: label,
                    programDayId: programDayId,
                    templateId: templateId,
                    exercises: exercises
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

    /// NEW-Q50 D29 — Watch standalone offline-first start.
    ///
    /// Pre-Q50 model (D8 P3): await iPhone's reply via sendMessage,
    /// requires `isReachable=true` (iPhone foregrounded). On failure
    /// Watch showed 「傳輸失敗 (iPhone 未配對)」 red screen.
    ///
    /// New model (this commit): Watch mints its own sessionId locally,
    /// transitions to SetLogger IMMEDIATELY (no await), then fires
    /// `start-from-watch` envelope to iPhone via `transferUserInfo`
    /// (queued by iOS — survives iPhone background / kill / out-of-
    /// range). iPhone's `onStartFromWatch` orchestrator INSERT OR IGNORE
    /// keyed on sessionId (per Q5 first-write-wins).
    ///
    /// iPhone confirms (or surfaces conflict) via a reverse-TUI
    /// `start-reconcile` envelope; coordinator.$lastReconcile receives
    /// it. D31 will subscribe + show conflict UI; D29/D30 just publish
    /// for diagnostic.
    ///
    /// Snapshot population: D29 uses `SetLoggerMockData.mockSnapshot()`
    /// as a placeholder. Real exercise data (from template fat-tree
    /// or appContext mirror) lands in D32.
    ///
    /// HK lifecycle: NOT touched here per D11 ownership boundary.
    func startFromWatch(selection: PickerSelection) async {
        isStartingSession = true
        defer { isStartingSession = false }

        // Mint local sessionId. Convention per ADR-0019 NEW-Q50: `W-`
        // prefix marks Watch-originated; 8-char base32-ish suffix from
        // the leading hex of a UUID for compactness in debug logs.
        let uuid = UUID().uuidString
        let suffix = uuid
            .replacingOccurrences(of: "-", with: "")
            .prefix(12)
            .lowercased()
        let localSessionId = "W-\(suffix)"

        // NEW-Q50 D29 (extended) — build local SessionSnapshot from
        // the fat-tree exercises carried in Stage1Reply. Two source
        // paths:
        //   • Template tap path  → selection.template.exercises
        //   • Planned-row path   → todayPlanned.planned.exercises
        //                          (selection is all-nil per
        //                          PickerRootView.planSection convention)
        //
        // Falls back to SetLoggerMockData.mockSnapshot() when neither
        // source has exercises (pre-Q50 iPhone payload OR genuinely
        // empty template) so SetLoggerView still mounts.
        let (resolvedTitle, resolvedExercises, resolvedTemplateId) = resolveSelectionExercises(selection)
        let snapshot: SessionSnapshot
        if resolvedExercises.isEmpty {
            snapshot = SetLoggerMockData.mockSnapshot()
        } else {
            snapshot = buildSnapshotFromFatTree(
                sessionId: localSessionId,
                title: resolvedTitle,
                exercises: resolvedExercises
            )
        }
        let localReply = StartFromWatchReply(
            sessionId: localSessionId,
            snapshot: snapshot
        )
        startResult = .some(localReply)

        // Preview / no-coordinator path: stop here — no WC to send.
        guard let coordinator else { return }

        // Fire-and-forget to iPhone. transferUserInfo queues even if
        // iPhone is unreachable; iOS handles persistence + retry.
        // No `await` — we already transitioned UI above.
        //
        // For planned-row path: templateId comes from
        // todayPlanned.planned.templateId so iPhone-side reconcile can
        // build a matching session_exercise tree from the same source.
        coordinator.sendStartFromWatchTUI(
            sessionId: localSessionId,
            templateId: selection.template?.id ?? resolvedTemplateId,
            programCycleId: selection.program?.id,
            intensityId: selection.intensity?.id
        )
    }

    // MARK: - NEW-Q50 D29 — Fat-tree → SessionSnapshot

    /// Resolve which fat-tree exercises + title + templateId to use
    /// based on the selection state. Returns empty exercises when no
    /// source matches (pre-Q50 fallback path).
    ///
    /// Tuple shape: (title, exercises, templateIdForWire).
    private func resolveSelectionExercises(_ selection: PickerSelection)
        -> (String, [Stage1TemplateExerciseDTO], String?)
    {
        // Template-tap path — template was selected via the 模板訓練
        // section row, possibly drilled through 計劃 + 強度 sheets.
        if let template = selection.template {
            return (template.name, template.exercises, template.id)
        }
        // Planned-row path — selection is all-nil per PickerRootView's
        // planSection planned-case (the program-day already carries the
        // 3-tuple from iPhone). Pull exercises from todayPlanned.
        if case .planned(_, _, let templateId, let exercises) = todayPlanned, !exercises.isEmpty {
            // Display title — use the planned label if available, else
            // a generic fallback.
            let label = plannedLabel ?? "今日訓練"
            return (label, exercises, templateId.isEmpty ? nil : templateId)
        }
        return ("自由訓練", [], nil)
    }

    /// Convenience accessor for the planned label string (when
    /// todayPlanned is .planned). Returns nil for restDay /
    /// noActiveProgram.
    private var plannedLabel: String? {
        if case .planned(let label, _, _, _) = todayPlanned {
            return label
        }
        return nil
    }

    /// Build a SessionSnapshot from a fat-tree exercise list.
    /// Per Stage1TemplateExercise → SessionSnapshotExercise:
    ///   • sessionExerciseId — synthesised as `SE-<index>` for local
    ///     use; iPhone-side reconcile will own the real persisted ID.
    ///   • plannedSets / sets — two paths depending on whether the
    ///     fat-tree wire carried per-row `template_set` data:
    ///       - **Preferred (post 2026-05-29 SetLogger sets[] fix):**
    ///         when `ex.sets.count > 0`, use those rows verbatim
    ///         (per-set weight/reps/setKind). plannedSets =
    ///         `ex.sets.count` so the SetLoggerView shows the real
    ///         planned row count, not the deprecated `default_sets`
    ///         summary.
    ///       - **Fallback (back-compat):** when `ex.sets.isEmpty`
    ///         (older iPhone payload, or template_exercise truly has
    ///         no template_set rows), use the legacy default_*
    ///         summary to pre-populate `defaultSets` empty rows —
    ///         same shape as pre-fix behaviour, which renders
    ///         "— kg / 0 次" if defaults are null.
    ///
    /// startedAt = current epoch ms.
    private func buildSnapshotFromFatTree(
        sessionId: String,
        title: String,
        exercises: [Stage1TemplateExerciseDTO]
    ) -> SessionSnapshot {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let snapshotExercises: [SessionSnapshotExercise] = exercises.enumerated().map { (idx, ex) in
            let snapshotSets: [SessionSnapshotSet]
            let plannedCount: Int
            if !ex.sets.isEmpty {
                // Preferred path — fat-tree carried template_set rows.
                snapshotSets = ex.sets.enumerated().map { (setIdx, s) in
                    SessionSnapshotSet(
                        // 2026-05-29 SetLogger sets[] fix —
                        // `s.position` was dropped from the wire to
                        // save envelope bytes; setIdx (array index)
                        // serves the same purpose because the
                        // loader ORDER BYs position ASC.
                        setId: "SET-\(idx)-\(setIdx)",
                        ordinal: setIdx + 1,
                        // Pass `weightKg` / `reps` through verbatim;
                        // a literal `0` from the v009 migration is
                        // surfaced as a real 0 (user can fix in the
                        // template editor on iPhone).
                        weight: s.weightKg,
                        reps: s.reps,
                        rpe: nil,
                        restSec: nil,
                        notes: nil,
                        setKind: s.setKind,
                        isLogged: false
                    )
                }
                plannedCount = ex.sets.count
            } else {
                // Fallback — legacy default_* path. Same shape as
                // pre-2026-05-29 behaviour: pre-populate
                // `defaultSets` empty rows; weight/reps may be nil.
                snapshotSets = (0..<max(1, ex.defaultSets)).map { setIdx in
                    SessionSnapshotSet(
                        setId: "SET-\(idx)-\(setIdx)",
                        ordinal: setIdx + 1,
                        weight: ex.defaultWeightKg,
                        reps: ex.defaultReps,
                        rpe: nil,
                        restSec: nil,
                        notes: nil,
                        setKind: "working",
                        isLogged: false
                    )
                }
                plannedCount = ex.defaultSets
            }
            return SessionSnapshotExercise(
                sessionExerciseId: "SE-\(idx)-\(ex.exerciseId)",
                exerciseId: ex.exerciseId,
                exerciseName: ex.exerciseName,
                ordering: ex.ordering,
                plannedSets: plannedCount,
                sets: snapshotSets
            )
        }
        return SessionSnapshot(
            sessionId: sessionId,
            title: title,
            startedAt: nowMs,
            exercises: snapshotExercises
        )
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
            todayPlanned: .planned(
                label: "推日 W3D1（今日）",
                programDayId: "pd-1",
                templateId: "",
                exercises: []
            ),
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
