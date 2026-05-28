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
//    schema grows (Phase 2.5 will add programs + intensities to this
//    payload via Stage1 extension).
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

/// Template prefetch envelope inside the Stage 1 reply.
struct Stage1ReplyPrefetch: Codable, Equatable {
    let templates: [Stage1TemplateSummary]
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
