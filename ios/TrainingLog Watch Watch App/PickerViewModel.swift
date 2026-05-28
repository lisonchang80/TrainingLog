//
//  PickerViewModel.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — picker view-state owner with hardcoded mock
//  data factories. Phase 2 will populate `todayPlanned` / `templates` /
//  `programs` from the iPhone-side `Stage1ReplyPayload` returned via
//  WC handshake (see src/adapters/watch/handshake.ts, iPhone helpers
//  `loadActiveSessionSummary` + `loadTemplatePrefetchList`).
//
//  Why @MainActor: SwiftUI views observe @Published mutations on the
//  main thread; the WC inbound dispatch (Phase 2) hops to MainActor
//  before mutating, same pattern as WatchConnectivityCoordinator.
//
//  Mock factories cover all 5 empty-state variants per D8 spec:
//    - .mockDefault       — both sections populated
//    - .mockRestDay       — 計劃: 休息日 / 模板: populated
//    - .mockNoProgram     — 計劃: 無 active program / 模板: populated
//    - .mockNoTemplates   — 計劃: planned / 模板: empty
//    - .mockAllEmpty      — 雙區皆空
//

import Foundation
import Combine

@MainActor
final class PickerViewModel: ObservableObject {

    /// Today's planned-row state. See `TodayPlanned` for variants.
    @Published var todayPlanned: TodayPlanned

    /// Templates list. Empty array → render "請在手機創建模板" empty
    /// state in 模板訓練 section.
    @Published var templates: [TemplateOption]

    /// All active programs the user can pick from in the 計劃 sheet.
    /// Empty → the sheet still shows "通用" fallback only; tap
    /// "通用" still bypasses the 強度 sheet.
    @Published var programs: [ProgramOption]

    /// True while a 🔄 refresh is in flight. Drives the icon's 0.5s
    /// spin animation. Phase 1 fakes a 0.5s delay; Phase 2 hooks this
    /// to the actual WC handshake round-trip.
    @Published var isRefreshing: Bool = false

    // MARK: - 3-tuple navigation state
    //
    // Captured progressively as user drills into 計劃 sheet → 強度
    // sheet. When all three slots are populated (or the user picked
    // "通用" in a sheet, leaving the corresponding slot nil), the
    // view layer triggers the start-from-watch outbound (Phase 3).

    @Published var selectedTemplate: TemplateOption?
    @Published var selectedProgram: ProgramOption?
    @Published var selectedIntensity: IntensityOption?

    init(
        todayPlanned: TodayPlanned,
        templates: [TemplateOption],
        programs: [ProgramOption]
    ) {
        self.todayPlanned = todayPlanned
        self.templates = templates
        self.programs = programs
    }

    // MARK: - Refresh (Phase 1 stub)

    /// Phase 1: fake a 0.5s spin so the toolbar 🔄 button visibly
    /// reacts. Phase 2 replaces the body with an actual
    /// `WatchConnectivityCoordinator.requestHandshake()` round-trip.
    func refresh() async {
        isRefreshing = true
        try? await Task.sleep(nanoseconds: 500_000_000)
        isRefreshing = false
    }

    // MARK: - Selection helpers

    /// Reset 3-tuple slots when user leaves the picker drill-down
    /// (e.g. dismissed a sheet via swipe-back). Called by view layer
    /// on root reappear.
    func resetSelection() {
        selectedTemplate = nil
        selectedProgram = nil
        selectedIntensity = nil
    }

    /// Convenience for "user picked today's planned row" — no
    /// drill-down, the program/day spec already carries the 3-tuple
    /// from iPhone-side (Phase 2+ wires this up).
    func selectTodayPlanned() {
        // Phase 1: just clear any drill-down state. Phase 3 will
        // emit start-from-watch with `programDayId` payload.
        resetSelection()
    }
}

// MARK: - Mock factories (Phase 1 only — retired in Phase 2)

extension PickerViewModel {

    /// Both sections populated. 1 active program with 3 intensities,
    /// 4 templates. Default for normal usage.
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

    /// Rest day variant: 計劃 section shows "今日休息（無訓練）".
    static func mockRestDay() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .restDay
        return vm
    }

    /// No-active-program variant: 計劃 section shows
    /// "（無計劃進行中）/ 請至 iPhone 設定計劃".
    static func mockNoProgram() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .noActiveProgram
        vm.programs = []
        return vm
    }

    /// No templates: 模板 section shows "請在手機創建模板".
    static func mockNoTemplates() -> PickerViewModel {
        let vm = mockDefault()
        vm.templates = []
        return vm
    }

    /// Both sections empty: combines mockNoProgram + mockNoTemplates.
    /// Picker has no actionable row in this state.
    static func mockAllEmpty() -> PickerViewModel {
        PickerViewModel(
            todayPlanned: .noActiveProgram,
            templates: [],
            programs: []
        )
    }
}
