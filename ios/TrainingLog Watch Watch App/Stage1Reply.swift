//
//  Stage1Reply.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 2 — Codable mirror of the TypeScript-side
//  `Stage1ReplyPayload`. Reply shape per ADR-0019 NEW-Q44 two-stage
//  handshake; sender impl lives in
//  `src/adapters/watch/handshake.ts` → `buildStage1Reply` (D9 wire-in,
//  shipped 2026-05-28).
//
//  Why Codable + JSONSerialization round-trip:
//    WC delivers the reply as a `[String: Any]` dictionary (iOS WC
//    framework's native shape). The cleanest decode path is to
//    re-serialise to JSON Data via JSONSerialization, then run
//    `JSONDecoder().decode(Stage1Reply.self, from: data)`. Slightly
//    more work than manual dict-walking but pays off when the
//    schema grows — proven by Phase 2.5 (this commit), which extended
//    the payload with `programs` + per-program `intensities` +
//    `todayPlanned` without touching the parse path.
//
//  Race-resistance:
//    The Watch holds the requestId it sent; `parse()` extracts the
//    echoed requestId so the caller (WatchConnectivityCoordinator)
//    can match against its pending nonce — stale replies for a
//    previous launch get dropped. See `matchesPendingRequest` in the
//    TS handshake module for the equivalent.
//

import Foundation

/// Minimal active-session summary returned when iPhone has an
/// in-progress session.
struct Stage1SessionSummary: Codable, Equatable {
    let sessionId: String
    /// Epoch ms.
    let startedAt: Int64
    /// Per-session display title; empty string for freestyle.
    let title: String
    /// Number of `session_exercise` rows attached to the session.
    let exerciseCount: Int
}

/// 2026-05-29 SetLogger sets[] fix — one planned set inside a
/// fat-tree exercise. Mirror of TS `Stage1TemplateSet`
/// (handshake.ts). Replaces the Watch's reliance on the deprecated
/// `template_exercise.default_*` summary columns: when this list is
/// non-empty, `buildSnapshotFromFatTree` uses these per-row values
/// to populate SetLoggerView so the user sees real weight/reps
/// instead of "— kg / 0 次".
///
/// Slim wire shape (no setId / parentSetId / notes) — see TS-side
/// comment for envelope-cap rationale. Cluster + notes ride later.
struct Stage1TemplateSetDTO: Codable, Equatable, Hashable {
    /// template_set.set_kind — 'warmup' | 'working' | 'dropset'.
    let setKind: String
    /// template_set.reps (NOT NULL on iPhone schema; may be `0` for
    /// legacy rows synthesised by the v009 migration when the source
    /// `template_exercise.default_reps` was null).
    let reps: Int
    /// template_set.weight in kg (NOT NULL; may be `0` for legacy
    /// migrated rows — same caveat as `reps`).
    let weightKg: Double

    // 2026-05-29 SetLogger sets[] fix — sizing notes:
    //   • `position` intentionally omitted; array index IS the
    //     position because the iPhone loader ORDER BYs position ASC.
    //   • Wire field names compacted to single chars (`k`/`r`/`w`)
    //     to stay under the 64 KB WC envelope ceiling. We expose
    //     readable Swift property names via CodingKeys so the
    //     consumer code (PickerViewModel etc.) stays legible.
    enum CodingKeys: String, CodingKey {
        case setKind = "k"
        case reps = "r"
        case weightKg = "w"
    }
}

/// NEW-Q50 D29 — one planned exercise inside a fat-tree template.
/// Mirror of TS `Stage1TemplateExercise` (handshake.ts:106). Sourced
/// from `template_exercise` JOIN `exercise`; `exerciseName` is
/// denormalised onto the wire so Watch never needs a separate
/// exercise lookup table to render the planned card.
///
/// 2026-05-29 SetLogger sets[] fix — added `sets` field carrying the
/// per-row `template_set` projection. When non-empty, the Watch
/// consumer prefers it over `default*` (which were always the
/// deprecated summary columns and surfaced wrong values like
/// "— kg / 0 次" for any template whose set rows diverged from the
/// summary). Tolerant decode: missing field → empty array, so older
/// iPhone payloads that pre-date this field still parse cleanly and
/// the consumer falls back to the legacy defaults path.
struct Stage1TemplateExerciseDTO: Codable, Equatable, Hashable {
    let templateExerciseId: String
    let exerciseId: String
    let exerciseName: String
    let ordering: Int
    let defaultSets: Int
    /// May be null when the source template_exercise leaves reps open.
    let defaultReps: Int?
    /// May be null when the source template_exercise leaves weight open.
    let defaultWeightKg: Double?
    /// 2026-05-29 SetLogger sets[] fix — per-row `template_set`
    /// projection ordered by `position ASC`. Decoded as `[]` on
    /// older iPhone payloads that don't include the field (tolerant
    /// fallback so picker still renders; consumer then falls back
    /// to the legacy default_* path).
    let sets: [Stage1TemplateSetDTO]
    /// D15 superset card — cluster linkage from `template_exercise`
    /// (handshake.ts `Stage1TemplateExercise.parentId` /
    /// `reusableSupersetId`). The Watch folds two ADJACENT exercises sharing
    /// the same non-nil `reusableSupersetId` into one superset card. Tolerant
    /// decode: missing key → nil (older iPhone payloads → solo render).
    let parentId: String?
    let reusableSupersetId: String?

    enum CodingKeys: String, CodingKey {
        case templateExerciseId
        case exerciseId
        case exerciseName
        case ordering
        case defaultSets
        case defaultReps
        case defaultWeightKg
        case sets
        case parentId
        case reusableSupersetId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.templateExerciseId = try c.decode(String.self, forKey: .templateExerciseId)
        self.exerciseId = try c.decode(String.self, forKey: .exerciseId)
        self.exerciseName = try c.decode(String.self, forKey: .exerciseName)
        self.ordering = try c.decode(Int.self, forKey: .ordering)
        self.defaultSets = try c.decode(Int.self, forKey: .defaultSets)
        self.defaultReps = try? c.decode(Int.self, forKey: .defaultReps)
        self.defaultWeightKg = try? c.decode(Double.self, forKey: .defaultWeightKg)
        // Tolerant: missing key → [] for back-compat with pre-fix wire.
        self.sets = (try? c.decode([Stage1TemplateSetDTO].self, forKey: .sets)) ?? []
        // Tolerant: missing key → nil (older payloads / solo rows).
        self.parentId = try? c.decode(String.self, forKey: .parentId)
        self.reusableSupersetId = try? c.decode(String.self, forKey: .reusableSupersetId)
    }

    init(
        templateExerciseId: String,
        exerciseId: String,
        exerciseName: String,
        ordering: Int,
        defaultSets: Int,
        defaultReps: Int?,
        defaultWeightKg: Double?,
        sets: [Stage1TemplateSetDTO] = [],
        parentId: String? = nil,
        reusableSupersetId: String? = nil
    ) {
        self.templateExerciseId = templateExerciseId
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.ordering = ordering
        self.defaultSets = defaultSets
        self.defaultReps = defaultReps
        self.defaultWeightKg = defaultWeightKg
        self.sets = sets
        self.parentId = parentId
        self.reusableSupersetId = reusableSupersetId
    }
}

/// NEW-Q50 D28/D29 — fat-tree template summary. Replaces the pre-Q50
/// thin `{templateId, name}` shape: each template now carries its full
/// planned exercise list so Watch can build a SessionSnapshot offline
/// (without a second round-trip to iPhone).
///
/// Caps per Q3=a sizing: default 20 templates × ~10 exercises ≈ 30 KB
/// JSON, well under the 64 KB WC envelope ceiling.
struct Stage1TemplateSummary: Codable, Equatable {
    let templateId: String
    let name: String
    /// NEW-Q50 D29 — Decoded as `[]` on older iPhone payloads that
    /// don't include the field (tolerant fallback so picker still
    /// renders; tap path then has no exercises to build from and
    /// falls back to mockSnapshot in PickerViewModel).
    let exercises: [Stage1TemplateExerciseDTO]

    enum CodingKeys: String, CodingKey {
        case templateId
        case name
        case exercises
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.templateId = try c.decode(String.self, forKey: .templateId)
        self.name = try c.decode(String.self, forKey: .name)
        // Tolerant: missing key → [] (back-compat with pre-Q50 wire).
        self.exercises = (try? c.decode(
            [Stage1TemplateExerciseDTO].self,
            forKey: .exercises
        )) ?? []
    }

    init(
        templateId: String,
        name: String,
        exercises: [Stage1TemplateExerciseDTO]
    ) {
        self.templateId = templateId
        self.name = name
        self.exercises = exercises
    }
}

/// Phase 2.5 — one intensity 副標籤 inside a Program prefetch entry.
/// `id` equals the sub_tag string (natural key per ADR-0003).
struct Stage1IntensitySummary: Codable, Equatable {
    let id: String
    let name: String
}

/// Phase 2.5 — one program in the prefetch list. Intensities are
/// inlined to match the picker's `ProgramOption` value type 1:1.
/// `id` is the program row's primary key (legacy WC field name on
/// `start-from-watch.programCycleId` is a misnomer — there is no
/// separate program_cycle entity per ADR-0004).
struct Stage1ProgramSummary: Codable, Equatable {
    let id: String
    let name: String
    let intensities: [Stage1IntensitySummary]
}

/// Phase 2.5 — today's planned-day discriminated union, mirrored
/// from the iPhone-side `Stage1TodayPlanned` TS type. Codable decode
/// branches on the `kind` discriminator.
///
/// We model this as a custom Codable enum (rather than e.g. three
/// optional structs) so the wire shape matches the TS variant of
/// discriminated union literal types verbatim — `{kind: "planned",
/// label, programDayId}` / `{kind: "restDay"}` / `{kind:
/// "noActiveProgram"}`.
enum Stage1TodayPlannedDTO: Codable, Equatable {
    /// NEW-Q50 D29 — `templateId` + `exercises` added so Watch can
    /// build a SessionSnapshot offline from today's planned cell
    /// without a second round-trip. Pre-Q50 wire (no exercises field)
    /// decodes with empty `[]` for back-compat.
    // #7 (2026-05-30) — templateName / programName / intensity added so
    // the Watch can render the planned cell on TWO lines. decodeIfPresent +
    // fallback to `label` so an OLDER iPhone build (only `label`) decodes.
    case planned(
        label: String,
        templateName: String,
        programName: String,
        intensity: String?,
        programDayId: String,
        templateId: String,
        exercises: [Stage1TemplateExerciseDTO]
    )
    case restDay
    case noActiveProgram

    private enum CodingKeys: String, CodingKey {
        case kind
        case label
        case templateName
        case programName
        case intensity
        case programDayId
        case templateId
        case exercises
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "planned":
            let label = try c.decode(String.self, forKey: .label)
            let programDayId = try c.decode(String.self, forKey: .programDayId)
            // NEW-Q50 D29: tolerant — older iPhone payload may omit
            // templateId / exercises; default to empty so picker still
            // renders the row (tap path falls back to mockSnapshot).
            let templateId = (try? c.decode(String.self, forKey: .templateId)) ?? ""
            let exercises = (try? c.decode(
                [Stage1TemplateExerciseDTO].self,
                forKey: .exercises
            )) ?? []
            self = .planned(
                label: label,
                // #7 — fall back to `label` when older iPhone omits the
                // structured field so the row still shows something.
                templateName: (try? c.decode(String.self, forKey: .templateName)) ?? label,
                programName: (try? c.decode(String.self, forKey: .programName)) ?? "",
                intensity: try? c.decode(String.self, forKey: .intensity),
                programDayId: programDayId,
                templateId: templateId,
                exercises: exercises
            )
        case "restDay":
            self = .restDay
        case "noActiveProgram":
            self = .noActiveProgram
        default:
            // Forward-compat: unknown kind → safest default. Phase 3+
            // may add new variants; tolerant decode prevents the whole
            // reply from being rejected.
            self = .noActiveProgram
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .planned(label, templateName, programName, intensity, programDayId, templateId, exercises):
            try c.encode("planned", forKey: .kind)
            try c.encode(label, forKey: .label)
            try c.encode(templateName, forKey: .templateName)
            try c.encode(programName, forKey: .programName)
            try c.encodeIfPresent(intensity, forKey: .intensity)
            try c.encode(programDayId, forKey: .programDayId)
            try c.encode(templateId, forKey: .templateId)
            try c.encode(exercises, forKey: .exercises)
        case .restDay:
            try c.encode("restDay", forKey: .kind)
        case .noActiveProgram:
            try c.encode("noActiveProgram", forKey: .kind)
        }
    }
}

/// Template prefetch envelope inside the Stage 1 reply.
///
/// Phase 2.5 added `programs` + `todayPlanned`. Both are optional at
/// the type level so older Watch builds running against newer iPhone
/// payloads still decode cleanly (extra keys are ignored by
/// JSONDecoder); newer Watch builds running against older iPhone
/// payloads see `nil` and fall back to empty state.
struct Stage1ReplyPrefetch: Codable, Equatable {
    let templates: [Stage1TemplateSummary]
    let programs: [Stage1ProgramSummary]?
    let todayPlanned: Stage1TodayPlannedDTO?
}

/// Stage 1 reply payload. Discriminated by `hasActiveSession`; the
/// `session` field is non-nil only when `hasActiveSession == true`.
/// Phase 2 ignores `session` (set logger not yet wired in); Phase 3
/// will branch on it to auto-adopt iPhone-initiated sessions.
struct Stage1Reply: Codable, Equatable {
    let requestId: String
    let hasActiveSession: Bool
    let session: Stage1SessionSummary?
    let prefetch: Stage1ReplyPrefetch

    /// Decode from the raw `[String: Any]` dict that WC delivers
    /// via `WCSession.sendMessage`'s reply handler. Returns nil if
    /// the dict is not a well-formed Stage 1 reply (wrong shape,
    /// missing required fields, etc.).
    ///
    /// Tolerant: extra keys are ignored (forward-compat with Phase 2.5
    /// extensions like `programs` / `intensities`).
    static func parse(from dict: [String: Any]) -> Stage1Reply? {
        guard JSONSerialization.isValidJSONObject(dict) else { return nil }
        guard let data = try? JSONSerialization.data(
            withJSONObject: dict,
            options: []
        ) else {
            return nil
        }
        return try? JSONDecoder().decode(Stage1Reply.self, from: data)
    }
}
