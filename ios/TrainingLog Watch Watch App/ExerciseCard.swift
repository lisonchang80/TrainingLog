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

    // MARK: - D15 ⋯ menu state
    //
    // `dotsMenuOpen` drives the sheet that mounts DotsMenuView.
    // `isSkipped` is an in-card flag — caller's responsibility to
    // persist if/when D9 lands the real DB column. For now we flip
    // it in-memory so the user can see the menu label swap ⏭ ↔ ↩.
    //
    // `pendingConfirm` is set when the user picks 🗑 from the menu;
    // it opens DotsMenuConfirmView via a second sheet. We chain
    // sheets rather than nesting so swiping the inner one returns
    // to the menu (per spec line 2176 框外 tap / 左滑 = [取消]).
    //
    // `pendingHistorySide` is non-nil when the user picked 📊;
    // drives the history sub-page push.
    //
    // TODO: D9 wire `skipped` flag to repo (currently in-memory only).
    // Phase F (2026-05-31): delete-confirm now removes the exercise from
    // `SessionInteractionState` (overlay) → the live-mirror projection
    // drops it → the iPhone END-session reconcile purges the row (E2). No
    // direct DB write from the Watch — deletion propagates via the mirror.
    // TODO: D9 wire ExerciseHistory real DB query (replace mock).
    // TODO: D15 wire superset card variant (3-row header [超] + A ＋ B)
    //       when D11 frozen spec sweep lands the cluster card type.
    //       Currently every ExerciseCard renders as a solo card; the
    //       menu defaults `isCluster: false`.
    @State private var dotsMenuOpen: Bool = false
    @State private var isSkipped: Bool = false
    @State private var pendingConfirm: Bool = false
    @State private var pendingHistorySide: Int? = nil

    /// Grouped rows for rendering. Consecutive `dropset` rows are
    /// folded into a `cluster` group with the first dropset as the
    /// cluster header and the remaining ones as sub-sets.
    ///
    /// Phase F: sets the user left-swipe-deleted are filtered BEFORE
    /// grouping, so the row vanishes and the progress bar / working-set
    /// numbering recompute off the surviving rows automatically.
    private var rowGroups: [SetRowGroup] {
        let visibleSets = exercise.sets.filter { !state.isSetDeleted($0.setId) }
        return SetRowGroup.group(sets: visibleSets)
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
        .opacity(isSkipped ? 0.4 : 1.0)  // Spec line 2096: dim 30%-ish.
        // D15 menu sheet (per ADR-0019 § Slice 13d D15).
        .sheet(isPresented: $dotsMenuOpen) {
            // NavigationStack lets 📊 history push as a sub-page with
            // `‹` back chevron returning to the menu (per spec line 2148).
            NavigationStack {
                DotsMenuView(
                    exerciseName: exercise.exerciseName,
                    isCluster: false,
                    isSkipped: isSkipped,
                    clusterChildren: nil,
                    onReset: {
                        resetExerciseInMemory()
                    },
                    onSkip: {
                        // Toggle in-memory; D9 will wire to repo.
                        isSkipped.toggle()
                    },
                    onDelete: {
                        // Show confirm dialog — gate the destructive
                        // action behind View 4 per spec line 2166.
                        pendingConfirm = true
                    },
                    onShowHistory: { side in
                        pendingHistorySide = side
                    }
                )
                // Push history sub-page when user taps 📊.
                .navigationDestination(isPresented: Binding(
                    get: { pendingHistorySide != nil },
                    set: { if !$0 { pendingHistorySide = nil } }
                )) {
                    ExerciseHistoryView(
                        exerciseName: exercise.exerciseName,
                        records: ExerciseHistoryMock.fetch(
                            exerciseName: exercise.exerciseName
                        )
                    )
                }
                // Confirm dialog stacked as another sheet so dismissing
                // it returns to the menu (per spec line 2176).
                .sheet(isPresented: $pendingConfirm) {
                    DotsMenuConfirmView(
                        exerciseName: exercise.exerciseName,
                        isCluster: false,
                        onConfirm: {
                            // Phase F (gap 1) — remove the exercise from
                            // the Watch's local interaction state. The
                            // card disappears (SessionCardListPage filters
                            // `deletedExerciseIds`) and the live-mirror
                            // projection drops it → iPhone end-session
                            // reconcile purges the row (E2 chain).
                            dotsMenuOpen = false
                            // Defer one runloop so the confirm + menu sheets
                            // finish dismissing BEFORE this card (their host)
                            // is removed from the list — tearing a view down
                            // mid-sheet-dismiss glitches on watchOS.
                            DispatchQueue.main.async {
                                state.deleteExercise(
                                    sessionExerciseId: exercise.sessionExerciseId,
                                    setIds: exercise.sets.map { $0.setId }
                                )
                            }
                        }
                    )
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(exercise.exerciseName)
                .font(.headline)
                .lineLimit(1)
            Spacer(minLength: 0)
            // D15: `[⋯]` Button. Min 44×44 hit area per spec line 1980;
            // SF Symbol `ellipsis.circle` at .body visual size.
            // Always enabled — `{}` Active does NOT block this tap
            // per spec line 2159.
            Button {
                dotsMenuOpen = true
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    // MARK: - D15 in-memory side effects (D9 will replace with real DB)

    /// 重置此動作 — flip every set in this exercise to `is_logged=false`.
    /// Per spec line 2083 「reps / weight 不動、保留 user 已 log 的值」 —
    /// we only clear `loggedSetIds` and any active row/cell highlight;
    /// `editedValues` (committed cell edits) stay intact so the user
    /// can re-tap ✓ on the same values.
    private func resetExerciseInMemory() {
        let myIds = Set(exercise.sets.map { $0.setId })
        state.loggedSetIds.subtract(myIds)
        if let active = state.activeSetId, myIds.contains(active) {
            state.activeSetId = nil
            state.activeCell = nil
        }
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
///
/// Phase F (gap 2) — left-swipe on a `{}` Active row deletes it, per D11
/// spec line 1592 「{} Active | swipe left row | row deleted」. The gesture
/// is gated on the row being Active so a non-Active row's horizontal swipe
/// still reaches the TabView for page paging (spec line 1576-1577
/// 「非 {} Active 區域 → swipe-to-page」). Warmup + working rows only —
/// cluster sub-sets keep their min-2 invariant and are removed by deleting
/// the whole exercise via the ⋯ menu.
private struct InteractiveSetRow<Content: View>: View {
    @ObservedObject var state: SessionInteractionState
    let setId: String
    let hasCheckmark: Bool
    @ViewBuilder let content: () -> Content

    /// Live horizontal offset while a left-swipe-to-delete is in progress.
    /// 0 at rest; tracks the finger left, then animates to a large negative
    /// value (slide-out) on commit or springs back to 0 on cancel.
    @State private var dragOffset: CGFloat = 0

    private var rowIsActive: Bool { state.isActive(setId: setId) }

    var body: some View {
        ZStack(alignment: .trailing) {
            // Red delete affordance revealed in the trailing gap as the
            // row slides left. Absent at rest (no peek-through).
            if dragOffset < -6 {
                Image(systemName: "trash.fill")
                    .font(.body)
                    .foregroundStyle(.red)
                    .padding(.trailing, 10)
            }

            rowContent
                .offset(x: dragOffset)
        }
        .padding(.vertical, 1)
        // `.highPriorityGesture` so the Active row's left-swipe wins over
        // the ancestor TabView page swipe (spec: Active row swipe = delete,
        // NOT page). `including:` masks the gesture OFF when not Active
        // (`.subviews` → only the content's tap-to-activate / cell taps run,
        // and the horizontal swipe falls through to the TabView for paging).
        // minimumDistance 14 means a tap (≈0 movement) never starts the drag
        // → cell taps + ◯ taps are unaffected.
        .highPriorityGesture(
            deleteDragGesture,
            including: rowIsActive ? .all : .subviews
        )
    }

    private var rowContent: some View {
        HStack(spacing: 4) {
            content()
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(
                            rowIsActive ? Color.green : Color.clear,
                            lineWidth: 2.0
                        )
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    // Only activate the row on tap-anywhere when not
                    // already Active. Once Active, cells own the taps
                    // (so they can route to `[]` Active per Phase C).
                    if !rowIsActive {
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
        // Opaque-ish hit area so a horizontal drag anywhere on the row is
        // captured (and the red affordance never bleeds through at rest).
        .background(Color.black.opacity(0.001))
    }

    private var deleteDragGesture: some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                // Track only a horizontal-dominant LEFT drag; ignore
                // vertical (that's a scroll) and rightward motion.
                guard value.translation.width < 0,
                      abs(value.translation.width) > abs(value.translation.height)
                else { return }
                dragOffset = max(value.translation.width, -120)
            }
            .onEnded { value in
                let committedLeft = value.translation.width < -55
                    && abs(value.translation.width) > abs(value.translation.height)
                if committedLeft {
                    // Slide the row out, then remove from state.
                    withAnimation(.easeOut(duration: 0.18)) {
                        dragOffset = -400
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                        state.deleteSet(setId: setId)
                    }
                } else {
                    // Didn't cross the threshold — spring back.
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        dragOffset = 0
                    }
                }
            }
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
