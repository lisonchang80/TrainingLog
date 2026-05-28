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

/// One row in the template prefetch list.
struct Stage1TemplateSummary: Codable, Equatable {
    let templateId: String
    let name: String
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
    case planned(label: String, programDayId: String)
    case restDay
    case noActiveProgram

    private enum CodingKeys: String, CodingKey {
        case kind
        case label
        case programDayId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "planned":
            let label = try c.decode(String.self, forKey: .label)
            let programDayId = try c.decode(String.self, forKey: .programDayId)
            self = .planned(label: label, programDayId: programDayId)
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
        case .planned(let label, let programDayId):
            try c.encode("planned", forKey: .kind)
            try c.encode(label, forKey: .label)
            try c.encode(programDayId, forKey: .programDayId)
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
