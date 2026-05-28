//
//  SetLoggerMockData.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase A — hardcoded mock SessionSnapshot.
//  Renders 2 exercises:
//    1. 深蹲 — 1 warmup + 4 working sets (covers warmup gray-dim
//       + working numbered visual)
//    2. 臥推 — 3 working sets + 1 cluster `D1` with 2 sub-sets
//       (covers cluster header + indented sub-set visual)
//
//  Phase A SetLoggerView ignores any real SessionSnapshot passed
//  in; it reads from this mock instead. Phase B replaces the mock
//  with real Snapshot consumption.
//

import Foundation

enum SetLoggerMockData {

    /// Hardcoded session snapshot for Phase A visual verification.
    /// Mirrors the SessionSnapshot wire shape so Phase B can swap
    /// to real data without view changes.
    static func mockSnapshot() -> SessionSnapshot {
        SessionSnapshot(
            sessionId: "mock-session-1",
            title: "推日（A）",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            exercises: [
                SessionSnapshotExercise(
                    sessionExerciseId: "se-1",
                    exerciseId: "ex-squat",
                    exerciseName: "深蹲",
                    ordering: 1,
                    plannedSets: 4,
                    sets: [
                        // 1 warmup
                        SessionSnapshotSet(
                            setId: "s-1a", ordinal: 1,
                            weight: 40, reps: 12,
                            rpe: nil, restSec: 120, notes: nil,
                            setKind: "warmup", isLogged: false
                        ),
                        // 4 working
                        SessionSnapshotSet(
                            setId: "s-1b", ordinal: 2,
                            weight: 80, reps: 8,
                            rpe: nil, restSec: 120, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-1c", ordinal: 3,
                            weight: 80, reps: 8,
                            rpe: nil, restSec: 120, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-1d", ordinal: 4,
                            weight: 80, reps: 8,
                            rpe: nil, restSec: 120, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-1e", ordinal: 5,
                            weight: 80, reps: 8,
                            rpe: nil, restSec: 120, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                    ]
                ),
                SessionSnapshotExercise(
                    sessionExerciseId: "se-2",
                    exerciseId: "ex-bench",
                    exerciseName: "臥推",
                    ordering: 2,
                    plannedSets: 3,
                    sets: [
                        SessionSnapshotSet(
                            setId: "s-2a", ordinal: 1,
                            weight: 60, reps: 10,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-2b", ordinal: 2,
                            weight: 60, reps: 10,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-2c", ordinal: 3,
                            weight: 60, reps: 10,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "working", isLogged: false
                        ),
                        // Cluster: 1 header + 2 sub-sets.
                        // Phase A models cluster as 3 sets all
                        // with set_kind="dropset" — the protocol
                        // doesn't natively distinguish header vs
                        // sub-set; the rendering layer groups
                        // consecutive dropset rows into a cluster
                        // with the first as header (ordinal=4) and
                        // the rest as sub-sets.
                        SessionSnapshotSet(
                            setId: "s-2d", ordinal: 4,
                            weight: 80, reps: 8,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "dropset", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-2e", ordinal: 5,
                            weight: 40, reps: 8,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "dropset", isLogged: false
                        ),
                        SessionSnapshotSet(
                            setId: "s-2f", ordinal: 6,
                            weight: 20, reps: 8,
                            rpe: nil, restSec: 90, notes: nil,
                            setKind: "dropset", isLogged: false
                        ),
                    ]
                ),
            ]
        )
    }
}
