//
//  ExerciseCard.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase A — one exercise card visual.
//  Per ADR-0019 § Slice 13d D11 spec, lines 1368-1400.
//
//  Phase A scope (idle visual only; all interactions in B-H):
//    - Header: exercise name + `[⋯]` SF Symbol `ellipsis.circle` icon
//    - Continuous progress bar (▰▰▰▱▱ style) — segments = work sets
//      + cluster count. Warmup excluded; cluster counts as 1 segment.
//    - Set rows in order: warmup (parens, gray) / working (numbered,
//      plain) / cluster (header + indented sub-set rows).
//    - Hairline dividers between top-level set rows; cluster sub-set
//      rows share the cluster's container without per-sub dividers.
//
//  Phase A renders all sets as idle (no `{}` Active highlight, no
//  ✓ marker hit-tested). The progress bar shows 0 filled segments
//  because no rows are logged.
//

import SwiftUI

struct ExerciseCard: View {
    let exercise: SessionSnapshotExercise

    /// Grouped rows for rendering. Consecutive `dropset` rows are
    /// folded into a `cluster` group with the first dropset as the
    /// cluster header and the remaining ones as sub-sets.
    private var rowGroups: [SetRowGroup] {
        return SetRowGroup.group(sets: exercise.sets)
    }

    /// Progress bar segment count. Work sets count 1 each; each
    /// cluster counts as 1; warmup excluded. Phase A: all idle so
    /// `filled` is always 0.
    private var progressSegments: Int {
        rowGroups.reduce(0) { acc, group in
            switch group {
            case .warmup:
                return acc
            case .working:
                return acc + 1
            case .cluster:
                return acc + 1
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            progressBar
            setRowsSection
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.15))
        )
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(exercise.exerciseName)
                .font(.headline)
                .lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "ellipsis.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
                // Phase A: visual only. Tap target inert until
                // D15 ⋯ menu wires up.
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    // MARK: - Progress bar

    private var progressBar: some View {
        HStack(spacing: 1) {
            ForEach(0..<progressSegments, id: \.self) { _ in
                Rectangle()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 6)
    }

    // MARK: - Set rows

    private var setRowsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rowGroups.enumerated()), id: \.offset) { idx, group in
                if idx > 0 {
                    Divider()
                        .padding(.vertical, 2)
                }
                groupRow(group)
            }
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private func groupRow(_ group: SetRowGroup) -> some View {
        switch group {
        case .warmup(let set):
            SetRowWarmup(set: set)

        case .working(let set, let index):
            SetRowWorking(set: set, displayIndex: index)

        case .cluster(let header, let subs, let clusterIndex):
            VStack(alignment: .leading, spacing: 2) {
                SetRowClusterHeader(set: header, clusterIndex: clusterIndex)
                ForEach(subs, id: \.setId) { sub in
                    SetRowClusterSub(set: sub)
                }
            }
        }
    }
}

// MARK: - Row grouping

/// Logical groups of set rows after cluster folding.
enum SetRowGroup: Identifiable {
    case warmup(SessionSnapshotSet)
    case working(set: SessionSnapshotSet, index: Int)
    case cluster(
        header: SessionSnapshotSet,
        subs: [SessionSnapshotSet],
        clusterIndex: Int
    )

    var id: String {
        switch self {
        case .warmup(let s): return s.setId
        case .working(let s, _): return s.setId
        case .cluster(let h, _, _): return h.setId
        }
    }

    /// Fold a flat set list into display groups.
    ///
    /// Algorithm:
    ///   - warmup row → `.warmup`
    ///   - working row → `.working` with a 1-based running index
    ///     among working rows (warmup + cluster don't bump the
    ///     working counter per D11 spec line 1551 `1 / 2 / 3 / 4 / D1`)
    ///   - first dropset row → start a cluster, that row becomes the
    ///     header with a 1-based cluster index
    ///   - subsequent dropset rows → folded as sub-sets under the
    ///     current cluster
    ///   - non-dropset row after a cluster closes the cluster
    static func group(sets: [SessionSnapshotSet]) -> [SetRowGroup] {
        var out: [SetRowGroup] = []
        var workingCount = 0
        var clusterCount = 0
        var pendingCluster: (header: SessionSnapshotSet, subs: [SessionSnapshotSet])? = nil

        func flushCluster() {
            if let c = pendingCluster {
                clusterCount += 1
                out.append(.cluster(
                    header: c.header,
                    subs: c.subs,
                    clusterIndex: clusterCount
                ))
                pendingCluster = nil
            }
        }

        for s in sets {
            switch s.setKind {
            case "dropset":
                if pendingCluster == nil {
                    pendingCluster = (header: s, subs: [])
                } else {
                    pendingCluster?.subs.append(s)
                }
            case "warmup":
                flushCluster()
                out.append(.warmup(s))
            case "working":
                flushCluster()
                workingCount += 1
                out.append(.working(set: s, index: workingCount))
            default:
                // 'superset' shipped as a Phase G card variant, not
                // a row group; if it leaks in we treat as working.
                flushCluster()
                workingCount += 1
                out.append(.working(set: s, index: workingCount))
            }
        }
        flushCluster()
        return out
    }
}

// MARK: - Row views

/// Warmup row — gray dim, parens around weight/reps, no number, no
/// progress contribution.
private struct SetRowWarmup: View {
    let set: SessionSnapshotSet

    var body: some View {
        HStack(spacing: 4) {
            Text("熱")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 20, alignment: .center)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text("( \(formatWeight(set.weight)) kg )")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("( \(set.reps ?? 0) 次 )")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Image(systemName: "circle")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// Working set row — numbered, plain visual.
private struct SetRowWorking: View {
    let set: SessionSnapshotSet
    let displayIndex: Int

    var body: some View {
        HStack(spacing: 4) {
            Text("\(displayIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text("[ \(formatWeight(set.weight)) kg ]")
                .font(.caption2)
            Text("[ \(set.reps ?? 0) 次 ]")
                .font(.caption2)
            Spacer(minLength: 0)
            Image(systemName: set.isLogged ? "checkmark.circle.fill" : "circle")
                .font(.caption2)
                .foregroundStyle(set.isLogged ? .green : .secondary)
        }
        .padding(.vertical, 2)
    }
}

/// Cluster header row — labelled `D{n}`, same column layout as
/// working set.
private struct SetRowClusterHeader: View {
    let set: SessionSnapshotSet
    let clusterIndex: Int

    var body: some View {
        HStack(spacing: 4) {
            Text("D\(clusterIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text("[ \(formatWeight(set.weight)) kg ]")
                .font(.caption2)
            Text("[ \(set.reps ?? 0) 次 ]")
                .font(.caption2)
            Spacer(minLength: 0)
            Image(systemName: set.isLogged ? "checkmark.circle.fill" : "circle")
                .font(.caption2)
                .foregroundStyle(set.isLogged ? .green : .secondary)
        }
        .padding(.vertical, 2)
    }
}

/// Cluster sub-set row — indented, no number column, weight/reps
/// only. Per D11 spec line 1394: `[ 40 kg ] [  8 次 ]`.
private struct SetRowClusterSub: View {
    let set: SessionSnapshotSet

    var body: some View {
        HStack(spacing: 4) {
            // Spacer to align with cluster header's number column
            Text("").frame(width: 16, alignment: .center)
            Text("[ \(formatWeight(set.weight)) kg ]")
                .font(.caption2)
            Text("[ \(set.reps ?? 0) 次 ]")
                .font(.caption2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 1)
    }
}

// MARK: - Helpers

private func formatWeight(_ w: Double?) -> String {
    guard let w else { return "—" }
    if w == w.rounded() {
        return String(format: "%.0f", w)
    }
    return String(format: "%.1f", w)
}

// MARK: - Previews

#Preview("深蹲 (warmup + working)") {
    ScrollView {
        ExerciseCard(exercise: SetLoggerMockData.mockSnapshot().exercises[0])
            .padding()
    }
}

#Preview("臥推 (working + cluster)") {
    ScrollView {
        ExerciseCard(exercise: SetLoggerMockData.mockSnapshot().exercises[1])
            .padding()
    }
}
