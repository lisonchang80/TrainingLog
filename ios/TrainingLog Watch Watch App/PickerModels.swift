//
//  PickerModels.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — value-type data models for the Watch picker.
//  Per ADR-0019 § Slice 13d D8 Watch Picker Spec (frozen 2026-05-28).
//
//  Phase 1 scope: pure value types only. Hardcoded mock factories live
//  on PickerViewModel. Phase 2 will populate these from Stage1Reply
//  envelope returned by the iPhone-side `onHandshakeRequest`
//  orchestrator (D9 wire-in, see src/adapters/watch/handshake.ts).
//
//  The "通用" fallback option that appears at the top of both the
//  計劃 sheet and 強度 sheet is NOT modelled here — it is a synthetic
//  row rendered inside each sheet view, not a value coming from data.
//

import Foundation

/// One row in the 模板訓練 list (= one user-created Template on iPhone).
///
/// NEW-Q50 D29 — carries `exercises` (fat-tree from Stage1Reply) so
/// PickerViewModel can build a SessionSnapshot offline when the user
/// picks this template. Empty array signals «exercises not yet
/// available» (pre-Q50 iPhone payload, or template that genuinely has
/// no exercises); startFromWatch falls back to mockSnapshot in that
/// case so SetLoggerView still mounts.
struct TemplateOption: Identifiable, Hashable {
    let id: String
    let name: String
    let exercises: [Stage1TemplateExerciseDTO]

    // Two-arg convenience init for code paths / mocks that don't have
    // exercise data (Phase 1 mock factories, sheets that only need
    // {id, name} for display).
    init(id: String, name: String, exercises: [Stage1TemplateExerciseDTO] = []) {
        self.id = id
        self.name = name
        self.exercises = exercises
    }
}

/// One row in the 計劃 sheet (= one user-created Program on iPhone).
/// Each program owns its own list of intensities (副標籤).
struct ProgramOption: Identifiable, Hashable {
    let id: String
    let name: String
    let intensities: [IntensityOption]
}

/// One row in the 強度 sheet (= one intensity 副標籤 inside a Program).
struct IntensityOption: Identifiable, Hashable {
    let id: String
    let name: String
}

/// State of the "計劃訓練" section's top row, computed by iPhone from
/// the active program's current mesocycle (see D8 spec §「今日」推算).
///
/// NEW-Q50 D29 — `.planned` carries `templateId` + `exercises` (fat-tree
/// from Stage1Reply.todayPlanned) so PickerViewModel.startFromWatch can
/// build a SessionSnapshot offline for the planned-row tap path. Pre-Q50
/// iPhone payload decodes to empty `[]` → mockSnapshot fallback.
enum TodayPlanned: Equatable {
    /// User has an active program and today is a training day.
    /// `label` is the human-readable string e.g. "推日 W3D1（今日）".
    case planned(
        label: String,
        programDayId: String,
        templateId: String,
        exercises: [Stage1TemplateExerciseDTO]
    )

    /// User has an active program but today is a rest day.
    case restDay

    /// No active program — user must set one up on iPhone.
    case noActiveProgram
}

/// The 3-tuple required to enter the Set logger (D11).
/// `program` and `intensity` are nil when the user picked "通用" in
/// the corresponding sheet (= 通用 program / 通用 intensity fallback).
/// `template` is nil only on the iPhone-led "today's planned" path
/// (= program day spec already carries the 3-tuple; no template
///  involved).
struct PickerSelection: Hashable {
    let template: TemplateOption?
    let program: ProgramOption?
    let intensity: IntensityOption?
}
