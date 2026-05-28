//
//  ExerciseCard.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase A (skeleton) → Phase B (interactions).
//  Per ADR-0019 § Slice 13d D11 spec (frozen 2026-05-28).
//
//  Phase B scope (this revision):
//    - `{}` Active state: tap row 中段 → 4-edge border, ◯ 留外
//    - `◯/✓ toggle`: tap on any state, exits Active per spec
//    - Progress bar recalc on ✓ change (live)
//    - Cluster acts as a unit: tap any cluster row → whole cluster
//      Active; tap header ✓ → marks the cluster logged
//
//  Still out of scope (Phase C onwards):
//    - `[]` Active cell edit (keypad / crown)
//    - Type cycling on tap number
//    - `-/+` cluster CRUD inside `{}` Active
//    - Swipe gestures (delete / +1)
//    - Long-press reorder
//

import SwiftUI

struct ExerciseCard: View {
    let exercise: SessionSnapshotExercise

    @ObservedObject var state: SessionInteractionState

    /// Grouped rows for rendering. Consecutive `dropset` rows are
    /// folded into a `cluster` group with the first dropset as the
    /// cluster header and the remaining ones as sub-sets.
    private var rowGroups: [SetRowGroup] {
        return SetRowGroup.group(sets: exercise.sets)
    }

    /// Progress bar segments. Work sets + clusters each count as 1
    /// segment; warmup excluded per spec line 1567.
    private var progressBarItems: [ProgressBarItem] {
        rowGroups.compactMap { group in
            switch group {
            case .warmup:
                return nil
            case .working(let set, _):
                return ProgressBarItem(id: set.setId, filled: state.isLogged(setId: set.setId))
            case .cluster(let header, _, _):
                // Cluster is filled iff its header is logged.
                return ProgressBarItem(id: header.setId, filled: state.isLogged(setId: header.setId))
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
                // Phase B: visual only. Tap target inert until
                // D15 ⋯ menu wires up.
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    // MARK: - Progress bar

    private var progressBar: some View {
        HStack(spacing: 1) {
            ForEach(progressBarItems) { item in
                Rectangle()
                    .fill(item.filled
                        ? Color.green   // 對齊 ✓ 打勾色（per user 2026-05-28 polish）
                        : Color.secondary.opacity(0.3))
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 6)
        .animation(.easeInOut(duration: 0.15), value: progressBarItems.map { $0.filled })
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
            // Phase B: warmup gets `{}` Active + ✓ toggle just like
            // working rows. (Per spec lines 1531/1582 — any row.)
            // Phase C: warmup cells are non-editable (no onTap wired).
            InteractiveSetRow(
                state: state,
                setId: set.setId,
                hasCheckmark: true,
                content: { SetRowWarmupContent(set: set, state: state) }
            )

        case .working(let set, let index):
            InteractiveSetRow(
                state: state,
                setId: set.setId,
                hasCheckmark: true,
                content: { SetRowWorkingContent(set: set, displayIndex: index, state: state) }
            )

        case .cluster(let header, let subs, let clusterIndex):
            // Cluster is a single Active unit: tap any sub-row
            // activates the whole cluster, tap header ✓ logs the
            // whole cluster.
            ClusterSetGroup(
                state: state,
                header: header,
                subs: subs,
                clusterIndex: clusterIndex
            )
        }
    }
}

// MARK: - Progress bar items

private struct ProgressBarItem: Identifiable, Equatable {
    let id: String
    let filled: Bool
}

// MARK: - Interactive row (warmup + working)

/// One interactive set row: `{}` Active overlay on the labelled
/// area, with ◯ sitting OUTSIDE the border per D11 spec line 1408.
///
/// Tap zones:
///   - row middle (number + cells)       → activate / re-activate
///   - ◯ button                          → toggle logged + exit Active
///
/// Per spec line 1582: tap row 中段 → `{}` Active (4-edge border)
/// Per spec line 1593: tap ◯/✓ → exit Active + save (we toggle state)
private struct InteractiveSetRow<Content: View>: View {
    @ObservedObject var state: SessionInteractionState
    let setId: String
    let hasCheckmark: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 4) {
            content()
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(
                            state.isActive(setId: setId)
                                ? Color.green
                                : Color.clear,
                            lineWidth: 2.0
                        )
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    // Only activate the row on tap-anywhere when not
                    // already Active. Once Active, cells own the taps
                    // (so they can route to `[]` Active per Phase C).
                    if !state.isActive(setId: setId) {
                        state.activate(setId: setId)
                    }
                }

            if hasCheckmark {
                Button {
                    state.toggleLogged(setId: setId)
                } label: {
                    Image(systemName: state.isLogged(setId: setId)
                        ? "checkmark.circle.fill"
                        : "circle")
                        .font(.body)
                        .foregroundStyle(state.isLogged(setId: setId)
                            ? Color.green
                            : Color.secondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 1)
    }
}

// MARK: - Cluster group

/// Cluster acts as a single `{}` Active unit. Border wraps the
/// header + all sub-rows; the ◯ on the header toggles the whole
/// cluster's logged state. Sub-sets have no ◯ per spec line 1534.
///
/// The cluster's "active id" is the header's set ID — tapping any
/// row inside the cluster activates the whole group.
private struct ClusterSetGroup: View {
    @ObservedObject var state: SessionInteractionState
    let header: SessionSnapshotSet
    let subs: [SessionSnapshotSet]
    let clusterIndex: Int

    private var groupId: String { header.setId }

    var body: some View {
        HStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                SetRowClusterHeaderContent(
                    set: header,
                    clusterIndex: clusterIndex,
                    clusterId: groupId,
                    state: state
                )
                ForEach(subs, id: \.setId) { sub in
                    SetRowClusterSubContent(
                        set: sub,
                        clusterId: groupId,
                        state: state
                    )
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(
                        state.isActive(setId: groupId)
                            ? Color.primary
                            : Color.clear,
                        lineWidth: 1.2
                    )
            )
            .contentShape(Rectangle())
            .onTapGesture {
                // Don't auto-activate on tap-anywhere when cluster
                // is already Active — that would steal cell taps.
                if !state.isActive(setId: groupId) {
                    state.activate(setId: groupId)
                }
            }

            // Header ✓ controls the whole cluster.
            VStack {
                Button {
                    state.toggleLogged(setId: groupId)
                } label: {
                    Image(systemName: state.isLogged(setId: groupId)
                        ? "checkmark.circle.fill"
                        : "circle")
                        .font(.body)
                        .foregroundStyle(state.isLogged(setId: groupId)
                            ? Color.green
                            : Color.secondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 1)
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

// MARK: - Row content views (pure visual, no interaction)

/// Warmup row content — uses the SAME boxed CellBox layout as
/// working rows (per user 2026-05-29 polish 4: «[熱] 也麻煩跟一般組
/// 一樣»). Number column shows `熱` instead of `1` / `2` / `D1`.
/// Cells tappable when row `{}` Active.
private struct SetRowWarmupContent: View {
    let set: SessionSnapshotSet
    @ObservedObject var state: SessionInteractionState

    var body: some View {
        HStack(spacing: 4) {
            Text("熱")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: rowIsActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: rowIsActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            Spacer(minLength: 0)
        }
    }

    private var rowIsActive: Bool { state.isActive(setId: set.setId) }
    private var displayWeight: Double? {
        state.displayValue(setId: set.setId, field: .weight, fallback: set.weight)
    }
    private var displayReps: Double? {
        state.displayValue(setId: set.setId,
                           field: .reps,
                           fallback: set.reps.map { Double($0) })
    }
}

/// Working set row content — numbered, boxed cells. Cells are
/// tappable when the row is `{}` Active (Phase C); tap → enters
/// `[]` Active and opens the cell-edit overlay.
private struct SetRowWorkingContent: View {
    let set: SessionSnapshotSet
    let displayIndex: Int
    @ObservedObject var state: SessionInteractionState

    var body: some View {
        HStack(spacing: 4) {
            Text("\(displayIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: rowIsActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: rowIsActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            Spacer(minLength: 0)
        }
    }

    private var rowIsActive: Bool { state.isActive(setId: set.setId) }
    private var displayWeight: Double? {
        state.displayValue(setId: set.setId, field: .weight, fallback: set.weight)
    }
    private var displayReps: Double? {
        state.displayValue(setId: set.setId,
                           field: .reps,
                           fallback: set.reps.map { Double($0) })
    }
}

/// Cluster header row content — labelled `D{n}`, boxed cells.
/// Cells tappable when the cluster is `{}` Active.
private struct SetRowClusterHeaderContent: View {
    let set: SessionSnapshotSet
    let clusterIndex: Int
    let clusterId: String
    @ObservedObject var state: SessionInteractionState

    var body: some View {
        HStack(spacing: 4) {
            Text("D\(clusterIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            Spacer(minLength: 0)
        }
    }

    private var clusterActive: Bool { state.isActive(setId: clusterId) }
    private var displayWeight: Double? {
        state.displayValue(setId: set.setId, field: .weight, fallback: set.weight)
    }
    private var displayReps: Double? {
        state.displayValue(setId: set.setId,
                           field: .reps,
                           fallback: set.reps.map { Double($0) })
    }
}

/// Cluster sub-set row content — indented, boxed cells. Cells
/// tappable when the cluster is `{}` Active.
private struct SetRowClusterSubContent: View {
    let set: SessionSnapshotSet
    let clusterId: String
    @ObservedObject var state: SessionInteractionState

    var body: some View {
        HStack(spacing: 4) {
            // Spacer to align with cluster header's number column
            Text("").frame(width: 20, alignment: .center)
            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            Spacer(minLength: 0)
        }
    }

    private var clusterActive: Bool { state.isActive(setId: clusterId) }
    private var displayWeight: Double? {
        state.displayValue(setId: set.setId, field: .weight, fallback: set.weight)
    }
    private var displayReps: Double? {
        state.displayValue(setId: set.setId,
                           field: .reps,
                           fallback: set.reps.map { Double($0) })
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
        ExerciseCard(
            exercise: SetLoggerMockData.mockSnapshot().exercises[0],
            state: SessionInteractionState()
        )
        .padding()
    }
}

#Preview("臥推 (working + cluster)") {
    ScrollView {
        ExerciseCard(
            exercise: SetLoggerMockData.mockSnapshot().exercises[1],
            state: SessionInteractionState()
        )
        .padding()
    }
}
