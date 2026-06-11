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
    /// Watch display rank (slice 13d 2026-06-02, device-bug #1/#2). The
    /// effective sort key the Watch renders by: a base set = its `ordinal`, a
    /// reordered / mid-inserted set = a fractional override
    /// (`SessionInteractionState.setRankOverrides` / `AddedSet.displayRank`).
    /// `LiveMirror.mergeSets` already sorts by it, but the wire `ordinal` is
    /// glued to set IDENTITY (the iPhone reconcile matches by
    /// `(session_exercise_id, ordinal)` value), so the ordinal alone can't
    /// carry display order. This travels it → the iPhone lands it in
    /// `set.display_rank` and renders by `display_rank ?? ordering`.
    /// JSONEncoder omits nil → it travels ABSENT for a snapshot built without a
    /// stamped rank; the iPhone `parseLiveMirrorSnapshot` normalises absent →
    /// null and falls back to `ordering`.
    let displayRank: Double?

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
        case displayRank = "display_rank"
    }

    /// Memberwise init with `parentSetId` + `displayRank` defaulted so the
    /// ~16 existing call sites that don't deal with dropset chains / reorder
    /// stay unchanged; only the projection / merge / added-set paths thread a
    /// real parent / rank through. (A custom init doesn't disable the
    /// synthesized Codable conformance.)
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
        parentSetId: String? = nil,
        displayRank: Double? = nil
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
        self.displayRank = displayRank
    }

    /// Copy with `displayRank` stamped — used by `LiveMirror.mergeSets` to
    /// attach the effective sort rank to each set after sorting, so it travels
    /// on the wire. Keeps every other field unchanged.
    func withDisplayRank(_ rank: Double) -> SessionSnapshotSet {
        SessionSnapshotSet(
            setId: setId,
            ordinal: ordinal,
            weight: weight,
            reps: reps,
            rpe: rpe,
            restSec: restSec,
            notes: notes,
            setKind: setKind,
            isLogged: isLogged,
            parentSetId: parentSetId,
            displayRank: rank
        )
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
    /// D15 superset card — cluster linkage (ADR-0018 v014). Two ADJACENT
    /// exercises sharing the same non-nil `reusableSupersetId` are folded into
    /// one superset card by `SetLoggerView`; `parentId` is the parent's id on
    /// the B side (nil on A / solo). The Watch groups by `reusableSupersetId`
    /// + `ordering` (A = lower ordering), so `parentId` is carried for
    /// forward-compat only — the local fat-tree build leaves it nil because the
    /// template's parent_id points at a template_exercise id that doesn't map
    /// to the freshly minted `sessionExerciseId`. JSONEncoder omits nil → they
    /// travel ABSENT; synthesized `decodeIfPresent` tolerates absence → nil.
    let parentId: String?
    let reusableSupersetId: String?

    /// Memberwise init with the cluster fields defaulted to nil so the existing
    /// call sites (fat-tree build / mock / producer projection) stay unchanged;
    /// only the superset-aware paths thread a real `reusableSupersetId` through.
    /// (A custom init does NOT disable the synthesized Codable conformance.)
    init(
        sessionExerciseId: String,
        exerciseId: String,
        exerciseName: String,
        ordering: Int,
        plannedSets: Int,
        sets: [SessionSnapshotSet],
        parentId: String? = nil,
        reusableSupersetId: String? = nil
    ) {
        self.sessionExerciseId = sessionExerciseId
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.ordering = ordering
        self.plannedSets = plannedSets
        self.sets = sets
        self.parentId = parentId
        self.reusableSupersetId = reusableSupersetId
    }
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
    /// Sync fast lane (2026-06-01) — monotonic per-emit revision (ms-since-
    /// epoch). The live-mirror producer stamps this; the iPhone receiver
    /// (`onLiveMirror`) keeps a per-session high-water mark and DROPS any
    /// snapshot whose `rev <= lastApplied`, so a late applicationContext
    /// backstop can't clobber a fresher `sendMessage`. nil on snapshots that
    /// aren't live ticks (start-from-watch reply, mock/preview); JSONEncoder
    /// omits nil → it travels ABSENT and the iPhone parser tolerates that.
    let rev: Int64?
    /// `"watch"` | `"iphone"` — which side produced the snapshot (echo
    /// suppression + forward-compat for the reverse direction). nil ⇒ absent.
    let originator: String?

    enum CodingKeys: String, CodingKey {
        case sessionId
        case title
        case startedAt
        case exercises
        case rev
        case originator
    }

    /// Memberwise init with `rev` / `originator` defaulted to nil so the
    /// existing 4-arg call sites (projection / mock / placeholder / finish
    /// page / start-from-watch decode) stay unchanged; only the live-mirror
    /// `emit` path threads a real rev + originator through. (A custom init
    /// does NOT disable the synthesized Codable conformance.)
    init(
        sessionId: String,
        title: String,
        startedAt: Int64,
        exercises: [SessionSnapshotExercise],
        rev: Int64? = nil,
        originator: String? = nil
    ) {
        self.sessionId = sessionId
        self.title = title
        self.startedAt = startedAt
        self.exercises = exercises
        self.rev = rev
        self.originator = originator
    }
}

/// Local start-attempt result consumed by `PickerRootView` routing.
/// Top-level `sessionId` mirrors the snapshot's own sessionId on
/// success; on failure both `sessionId == ""` and `snapshot == nil`.
///
/// Historical note: this used to also be the WIRE reply shape for the
/// legacy `sendStartFromWatch` sendMessage+replyHandler path (its
/// `parse(from:)` decoder was deleted 2026-06-12 along with that dead
/// path). Today the only producer is `PickerViewModel.startFromWatch`'s
/// locally-built reply (NEW-Q50 D29 offline-first start).
struct StartFromWatchReply: Equatable {
    let sessionId: String
    let snapshot: SessionSnapshot?

    /// Convenience predicate: was the iPhone able to create / adopt
    /// the session?
    var isOK: Bool {
        return !sessionId.isEmpty && snapshot != nil
    }
}
