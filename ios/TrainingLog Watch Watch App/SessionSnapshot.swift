//
//  SessionSnapshot.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 3 — Codable mirror of the TypeScript-side
//  `SessionSnapshot` shape that ships in the `start-from-iphone`
//  reply (per ADR-0019 § Slice 13d Amendment Q4 channel #1 +
//  `src/adapters/watch/handshake.ts` snapshotToWire projection).
//
//  Reply wrapper:
//    The iPhone-side `onStartFromWatch` orchestrator (D9 wire-in,
//    d7edadd) replies with `{ sessionId, snapshot }` — top-level
//    sessionId is the wire envelope identifier, `snapshot` is the
//    full SessionSnapshot tree (or `{}` on the error path where
//    `sessionId` will be empty string).
//
//  Tolerant decode:
//    - Empty `sessionId` ⇒ iPhone reported failure; snapshot is nil.
//    - `snapshot` field is a present-but-empty `{}` ⇒ also nil
//      (defensive: shouldn't co-occur with non-empty sessionId, but
//       belt + braces).
//    - Extra keys on snapshot or set/exercise rows ignored
//      (forward-compat: future Phase will add `rpe`, per-set `rest_sec`,
//       cluster fields, etc.).
//
//  Phase 3 use: PickerSetLoggerPlaceholderView consumes
//    `StartFromWatchReply` and renders sessionId + exercise count
//    as a "wired-through" indicator. The full snapshot decode lives
//    in this file so D11 set logger (next slice) can reuse it
//    directly without duplicating the wire schema.
//

import Foundation

/// Per-set rows shipped inside a SessionSnapshot.
struct SessionSnapshotSet: Codable, Equatable {
    let setId: String
    let ordinal: Int
    /// Kilograms. Null when the user hasn't entered a weight yet.
    let weight: Double?
    /// Reps count. Null when the user hasn't entered reps yet.
    let reps: Int?
    /// RPE 1-10. Currently always nil — `set.rpe` column doesn't
    /// exist yet in the iPhone schema (reserved for a future migration).
    let rpe: Double?
    /// Per-set rest seconds. Currently denormalised from
    /// `session_exercise.rest_sec` so all sets in an exercise share
    /// the same value; the wire shape is forward-compat for per-set
    /// rest without a wire change.
    let restSec: Int?
    let notes: String?
    let setKind: String
    let isLogged: Bool
    /// Dropset-chain parent. NULL for a head / working / warmup row; on a
    /// follower it holds the HEAD row's `setId`. The iPhone reconcile folds a
    /// head + its followers into one cluster via this (replaces the old
    /// "consecutive dropset" visual-only heuristic for cross-device parity).
    /// JSONEncoder omits nil → it travels ABSENT for non-followers; the iPhone
    /// `parseLiveMirrorSnapshot` normalises absent → null.
    let parentSetId: String?

    enum CodingKeys: String, CodingKey {
        case setId
        case ordinal
        case weight
        case reps
        case rpe
        case notes
        case restSec = "rest_sec"
        case setKind = "set_kind"
        case isLogged = "is_logged"
        case parentSetId = "parent_set_id"
    }

    /// Memberwise init with `parentSetId` defaulted so the ~16 existing
    /// call sites that don't deal with dropset chains stay unchanged; only
    /// the projection / merge / added-set paths thread a real parent through.
    /// (A custom init doesn't disable the synthesized Codable conformance.)
    init(
        setId: String,
        ordinal: Int,
        weight: Double?,
        reps: Int?,
        rpe: Double?,
        restSec: Int?,
        notes: String?,
        setKind: String,
        isLogged: Bool,
        parentSetId: String? = nil
    ) {
        self.setId = setId
        self.ordinal = ordinal
        self.weight = weight
        self.reps = reps
        self.rpe = rpe
        self.restSec = restSec
        self.notes = notes
        self.setKind = setKind
        self.isLogged = isLogged
        self.parentSetId = parentSetId
    }
}

/// Per-exercise rows shipped inside a SessionSnapshot.
struct SessionSnapshotExercise: Codable, Equatable {
    let sessionExerciseId: String
    let exerciseId: String
    let exerciseName: String
    let ordering: Int
    let plannedSets: Int
    let sets: [SessionSnapshotSet]
}

/// Full session tree returned by iPhone after creating (or adopting)
/// a session.
struct SessionSnapshot: Codable, Equatable {
    let sessionId: String
    /// Per-session display title. Empty string for freestyle path.
    let title: String
    /// Epoch ms.
    let startedAt: Int64
    let exercises: [SessionSnapshotExercise]
}

/// Reply payload for the `start-from-watch` outbound. Top-level
/// `sessionId` mirrors the snapshot's own sessionId on success; on
/// failure both `sessionId == ""` and `snapshot == nil`.
struct StartFromWatchReply: Equatable {
    let sessionId: String
    let snapshot: SessionSnapshot?

    /// Convenience predicate: was the iPhone able to create / adopt
    /// the session?
    var isOK: Bool {
        return !sessionId.isEmpty && snapshot != nil
    }

    /// Decode from the raw `[String: Any]` dict that WC delivers via
    /// `WCSession.sendMessage`'s reply handler. Returns nil if the
    /// dict is not a well-formed start-from-watch reply (missing
    /// `sessionId` field entirely, etc.). Empty-sessionId / empty-
    /// snapshot cases decode to a value with `isOK == false`.
    static func parse(from dict: [String: Any]) -> StartFromWatchReply? {
        guard JSONSerialization.isValidJSONObject(dict) else { return nil }
        guard let sessionId = dict["sessionId"] as? String else { return nil }

        // Empty sessionId ⇒ iPhone-reported failure.
        if sessionId.isEmpty {
            return StartFromWatchReply(sessionId: "", snapshot: nil)
        }

        // Snapshot may be present-but-empty defensively.
        guard
            let snapshotDict = dict["snapshot"] as? [String: Any],
            !snapshotDict.isEmpty
        else {
            return StartFromWatchReply(sessionId: sessionId, snapshot: nil)
        }

        guard
            let data = try? JSONSerialization.data(
                withJSONObject: snapshotDict,
                options: []
            ),
            let snapshot = try? JSONDecoder().decode(
                SessionSnapshot.self,
                from: data
            )
        else {
            return StartFromWatchReply(sessionId: sessionId, snapshot: nil)
        }

        return StartFromWatchReply(sessionId: sessionId, snapshot: snapshot)
    }
}
