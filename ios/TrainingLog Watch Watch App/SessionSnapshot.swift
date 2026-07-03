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
/// Hashable so `SessionSnapshot` can ride inside the `PickerDestination`
/// navigation enum (cast-session route, 2026-06-27).
struct SessionSnapshotSet: Codable, Equatable, Hashable {
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
struct SessionSnapshotExercise: Codable, Equatable, Hashable {
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

    /// Per-exercise rest seconds (`session_exercise.rest_sec`) — item 1
    /// (2026-07-03) authoritative bidirectional live-sync value. On the wire it
    /// is CAMEL-cased (`restSec`, like the other exercise fields), OPTIONAL, and
    /// omit-null: `JSONEncoder` drops nil (→ ABSENT on the forward wire),
    /// synthesized `decodeIfPresent` tolerates absence on the reverse wire. The
    /// Watch reads it into `SessionInteractionState.restOverride[seId]`; the
    /// per-set `SessionSnapshotSet.restSec` denormalisation stays for the rest
    /// timer's per-set lookup.
    let restSec: Int?

    /// Memberwise init with the cluster fields + `restSec` defaulted to nil so
    /// the existing call sites (fat-tree build / mock / producer projection)
    /// stay unchanged; only the superset-aware / rest-sync paths thread real
    /// values through. (A custom init does NOT disable synthesized Codable.)
    init(
        sessionExerciseId: String,
        exerciseId: String,
        exerciseName: String,
        ordering: Int,
        plannedSets: Int,
        sets: [SessionSnapshotSet],
        parentId: String? = nil,
        reusableSupersetId: String? = nil,
        restSec: Int? = nil
    ) {
        self.sessionExerciseId = sessionExerciseId
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.ordering = ordering
        self.plannedSets = plannedSets
        self.sets = sets
        self.parentId = parentId
        self.reusableSupersetId = reusableSupersetId
        self.restSec = restSec
    }
}

/// Full session tree returned by iPhone after creating (or adopting)
/// a session.
struct SessionSnapshot: Codable, Equatable, Hashable {
    let sessionId: String
    /// Per-session display title (line 1) — the editable session name (= the
    /// originating template name for a template-started session). Empty string
    /// for the freestyle path.
    let title: String
    /// Second-line identity badge「模板名 · 計劃 · 強度」(2026-06-26 Goal 2d).
    /// Built Watch-side at start (`PickerViewModel.resolveSelectionExercises`);
    /// IMMUTABLE per session — program / intensity are fixed at start, so an
    /// iPhone rename of line 1 never touches it. nil ⇒ no second line (planned /
    /// freestyle / minimal mode). Reverse-sync inbound omits it (decodeIfPresent
    /// → nil) and the apply path reads only `title`, so the immutable base
    /// snapshot keeps its own subtitle and line 2 survives a live-mirror apply.
    let subtitle: String?
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
        case subtitle
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
        subtitle: String? = nil,
        startedAt: Int64,
        exercises: [SessionSnapshotExercise],
        rev: Int64? = nil,
        originator: String? = nil
    ) {
        self.sessionId = sessionId
        self.title = title
        self.subtitle = subtitle
        self.startedAt = startedAt
        self.exercises = exercises
        self.rev = rev
        self.originator = originator
    }
}

extension SessionSnapshot {
    /// Phase C-core (2026-06-26) — decode an inbound reverse-sync wire dict
    /// (iPhone→Watch live mirror) into a SessionSnapshot. The iPhone producer
    /// (`iphoneLiveMirrorProducer.ts`) ships the SAME wire shape the Watch's
    /// forward `snapshotToWireDict` produces (snake_case set fields, nulls
    /// omitted), so a JSONSerialization→JSONDecoder round-trip over the
    /// synthesized Codable decodes it: `decodeIfPresent` tolerates the absent
    /// nullable fields, and `rev`/`originator` ride along. Returns nil on any
    /// malformed payload (caller drops it rather than crash).
    static func decodeInbound(_ dict: [String: Any]) -> SessionSnapshot? {
        guard
            JSONSerialization.isValidJSONObject(dict),
            let data = try? JSONSerialization.data(withJSONObject: dict)
        else {
            return nil
        }
        return try? JSONDecoder().decode(SessionSnapshot.self, from: data)
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
