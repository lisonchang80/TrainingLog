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
import WatchKit

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

    // MARK: - Reorder (Phase F long-press drag) state
    //
    // Move-mode highlight + live offset live in each row's OWN `@GestureState`
    // (see `ReorderableRow`) so they AUTO-RESET the instant the finger lifts —
    // a plain `@State` left the orange frame STUCK when the user long-pressed
    // without dragging (the sequenced gesture's `.onEnded` doesn't fire with no
    // drag), which also blocked cell taps (device bug 2026-05-31). Here we only
    // cache each group's midY (in the "exerciseReorder" space, via a
    // PreferenceKey) so the drop-target index can be computed from the finger's
    // Y. A whole D cluster moves as one unit (members renumber contiguously).
    @State private var reorderMidYs: [Int: CGFloat] = [:]

    /// Grouped rows for rendering. Consecutive `dropset` rows are
    /// folded into a `cluster` group with the first dropset as the
    /// cluster header and the remaining ones as sub-sets.
    ///
    /// Phase F: left-swipe-deleted sets are filtered out and right-swipe-
    /// added sets are merged in (by WATCH display order) BEFORE grouping,
    /// so the rows + progress bar + working-set numbering recompute off the
    /// live set list automatically. Shared with the live-mirror projection
    /// via `LiveMirror.mergeSets` so card + iPhone agree on membership.
    private var rowGroups: [SetRowGroup] {
        let merged = LiveMirror.mergeSets(
            base: exercise.sets,
            deletedSets: state.deletedSetIds,
            addedSets: state.addedSets,
            kindOverrides: state.setKindOverrides,
            rankOverrides: state.setRankOverrides,
            sessionExerciseId: exercise.sessionExerciseId
        )
        return SetRowGroup.group(sets: merged)
    }

    /// tap 編號 → cycle this row's type (工作→熱→D→工作). `set` is the merged
    /// (effective-kind) set from `rowGroups`, so its id/kind already reflect
    /// any prior cycle. The state method owns the renumber + D add/remove.
    private func cycleType(_ set: SessionSnapshotSet) {
        state.cycleSetKind(
            setId: set.setId,
            sessionExerciseId: exercise.sessionExerciseId,
            baseSets: exercise.sets
        )
    }

    /// +1 set (right-swipe → ＋ on row `set`). Insert a new set right AFTER
    /// that row (「新增至下一行」), prefilled with the swiped row's CURRENT
    /// displayed weight/reps + same kind (「同種類的下一個」). The new set
    /// becomes Active and is editable / loggable / deletable like any other.
    private func addSet(from set: SessionSnapshotSet) {
        let weight = state.displayValue(
            setId: set.setId, field: .weight, fallback: set.weight
        )
        let repsValue = state.displayValue(
            setId: set.setId, field: .reps, fallback: set.reps.map { Double($0) }
        )
        state.addSet(
            sessionExerciseId: exercise.sessionExerciseId,
            afterSetId: set.setId,
            baseSets: exercise.sets,
            weight: weight,
            reps: repsValue.map { Int($0.rounded()) },
            setKind: set.setKind
        )
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
            // Identify rows by the group's STABLE id (setId / cluster header
            // setId), NOT the enumeration offset. With `\.offset`, deleting a
            // set re-indexed every following row's view identity → the
            // per-row @State (swipe-reveal flag) misattached to the wrong
            // row, which is what let one swipe-delete take out two sets.
            ForEach(Array(rowGroups.enumerated()), id: \.element.id) { idx, group in
                if idx > 0 {
                    Divider()
                        .padding(.vertical, 2)
                }
                // The reorder gesture + move-mode highlight live INSIDE
                // `ReorderableRow` (its `@GestureState` auto-clears on lift —
                // no stale orange / blocked taps). `isActive` masks the gesture
                // to `.subviews` on idle rows so they scroll / tap-to-activate
                // normally (only an Active row arms reorder). The midY reader is
                // applied OUTSIDE the wrapper so the dragged row's `.offset`
                // (a non-layout transform) doesn't skew the cached slot Y used
                // for drop-target math.
                ReorderableRow(
                    groupIndex: idx,
                    isActive: state.isActive(setId: groupMembers(group).first ?? ""),
                    onCommit: { from, translationY in
                        let to = reorderTargetIndex(from: from, translationY: translationY)
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            commitReorder(from: from, to: to)
                        }
                    }
                ) { isReordering in
                    groupRow(group, isReordering: isReordering)
                }
                .background(groupMidYReader(idx))
            }
        }
        .padding(.horizontal, 4)
        .coordinateSpace(name: "exerciseReorder")
        .onPreferenceChange(GroupMidYKey.self) { reorderMidYs = $0 }
    }

    // MARK: - Reorder helpers (Phase F long-press drag)

    /// The setIds a render group owns, in internal order — single set for
    /// working/warmup; header + sub-sets for a D cluster (so the cluster
    /// moves as one unit).
    private func groupMembers(_ g: SetRowGroup) -> [String] {
        switch g {
        case .warmup(let s): return [s.setId]
        case .working(let s, _): return [s.setId]
        case .cluster(let h, let subs, _): return [h.setId] + subs.map { $0.setId }
        }
    }

    /// Reports a group's midY (in the "exerciseReorder" space) up via a
    /// preference so the drop target can be computed from the finger's Y.
    private func groupMidYReader(_ idx: Int) -> some View {
        GeometryReader { proxy in
            Color.clear.preference(
                key: GroupMidYKey.self,
                value: [idx: proxy.frame(in: .named("exerciseReorder")).midY]
            )
        }
    }

    /// Insertion index (among the OTHER groups) for the current finger Y.
    private func reorderTargetIndex(from idx: Int, translationY: CGFloat) -> Int {
        let fingerY = (reorderMidYs[idx] ?? 0) + translationY
        var target = 0
        for (i, midY) in reorderMidYs where i != idx {
            if midY < fingerY { target += 1 }
        }
        return target
    }

    /// Commit: move the group at `from` to position `to` (index among the
    /// OTHER groups) and hand the new display order to the state, which
    /// renumbers the rank overrides (display) — wire ordinals re-derive from
    /// the present pool in the projection so the iPhone history follows.
    private func commitReorder(from: Int, to: Int) {
        var members = rowGroups.map { groupMembers($0) }
        guard from >= 0, from < members.count else { return }
        let moved = members.remove(at: from)
        let t = max(0, min(to, members.count))
        members.insert(moved, at: t)
        state.applyReorder(orderedGroups: members)
        WKInterfaceDevice.current().play(.click)
    }

    @ViewBuilder
    private func groupRow(_ group: SetRowGroup, isReordering: Bool) -> some View {
        switch group {
        case .warmup(let set):
            // Phase B: warmup gets `{}` Active + ✓ toggle just like
            // working rows. (Per spec lines 1531/1582 — any row.)
            // Phase C: warmup cells are non-editable (no onTap wired).
            InteractiveSetRow(
                state: state,
                setId: set.setId,
                hasCheckmark: true,
                isReordering: isReordering,
                onAddSet: { addSet(from: set) },
                content: { SetRowWarmupContent(set: set, state: state, onCycleType: { cycleType(set) }) }
            )

        case .working(let set, let index):
            InteractiveSetRow(
                state: state,
                setId: set.setId,
                hasCheckmark: true,
                isReordering: isReordering,
                onAddSet: { addSet(from: set) },
                content: { SetRowWorkingContent(set: set, displayIndex: index, state: state, onCycleType: { cycleType(set) }) }
            )

        case .cluster(let header, let subs, let clusterIndex):
            // Cluster is a single Active unit: tap any sub-row
            // activates the whole cluster, tap header ✓ logs the
            // whole cluster. tap header 編號 D1 → deconstruct (→工作).
            // [＋]/[－] on a follower add/remove a dropset child.
            ClusterSetGroup(
                state: state,
                header: header,
                subs: subs,
                clusterIndex: clusterIndex,
                isReordering: isReordering,
                onCycleHeaderType: { cycleType(header) },
                onAddChild: { afterId in addDropsetChild(afterSetId: afterId, headSetId: header.setId) },
                onRemoveChild: { childId in state.deleteSet(setId: childId) }
            )
        }
    }

    /// [＋] on a dropset follower → add another dropset child right after it,
    /// prefilled with that row's CURRENT displayed weight/reps (same kind →
    /// consecutive → folds into the same cluster). Keeps the cluster Active.
    /// Stage 1: rides the existing `addSet` (consecutive-dropset visual fold);
    /// `parent_set_id` threading for the iPhone one-cluster lands in stage 2.
    private func addDropsetChild(afterSetId: String, headSetId: String) {
        let merged = LiveMirror.mergeSets(
            base: exercise.sets,
            deletedSets: state.deletedSetIds,
            addedSets: state.addedSets,
            kindOverrides: state.setKindOverrides,
            rankOverrides: state.setRankOverrides,
            sessionExerciseId: exercise.sessionExerciseId
        )
        guard let anchor = merged.first(where: { $0.setId == afterSetId }) else { return }
        let w = state.displayValue(setId: anchor.setId, field: .weight, fallback: anchor.weight)
        let r = state.displayValue(setId: anchor.setId, field: .reps,
                                   fallback: anchor.reps.map { Double($0) })
        state.addSet(
            sessionExerciseId: exercise.sessionExerciseId,
            afterSetId: afterSetId,
            baseSets: exercise.sets,
            weight: w,
            reps: r.map { Int($0.rounded()) },
            setKind: "dropset",
            activateNew: false,
            // New child belongs to the SAME chain → parent is the head, not the
            // follower the ＋ was tapped on.
            parentSetId: headSetId
        )
    }
}

// MARK: - Reorderable row wrapper (Phase F long-press drag)

/// Wraps one render group with the long-press → drag reorder gesture.
///
/// The move-mode highlight + live offset are driven by `@GestureState`, which
/// SwiftUI resets to `.inactive` the instant the gesture ends OR is cancelled —
/// including a long-press released WITHOUT a drag, the exact case where a
/// sequenced gesture's `.onEnded` does NOT fire. A plain `@State` there left
/// the orange frame STUCK and blocked cell taps (device bug 2026-05-31:
/// "橘框與綠框共存 / 橘色出現後無法點 #、重量、次數"). With `@GestureState`,
/// orange exists ONLY while the finger is down → green⇄orange on the SAME row,
/// never coexisting, and the row is fully tappable again the moment you lift.
///
/// `isActive` masks the gesture to `.subviews` on idle rows so the ScrollView
/// pan + tap-to-activate own the touch (Anomaly 1 fix) — only the Active row
/// arms reorder.
private struct ReorderableRow<Content: View>: View {
    let groupIndex: Int
    let isActive: Bool
    /// (fromIndex, finger-Y translation) — parent resolves the drop target.
    let onCommit: (Int, CGFloat) -> Void
    /// Built with the live move-mode flag so the row paints its border orange
    /// (replacing green) while dragging.
    @ViewBuilder let content: (_ isReordering: Bool) -> Content

    @GestureState private var drag: ReorderDrag = .inactive
    /// Fires the move-mode haptic exactly ONCE per long-press success (not on
    /// every drag tick). Re-armed while still pressing / on end.
    @State private var didEnterMove = false

    var body: some View {
        content(drag.isMoving)
            // `.offset` is a non-layout transform → the parent's midY reader
            // (applied OUTSIDE this wrapper) still measures the static slot.
            .offset(y: drag.translation)
            .zIndex(drag.isMoving ? 1 : 0)
            // SIMULTANEOUS, not highPriority (device fix 2026-05-31): a
            // highPriority long-press on the Active row claimed EVERY touch
            // first, so quick cell taps (#/weight/reps) were swallowed and a
            // slightly-held tap flipped to orange — "點擊瞬間變橘色 / 無法點擊
            // #、重量、次數". Simultaneous lets the cell tap gestures recognise
            // INDEPENDENTLY: a quick tap reaches the cell immediately, while
            // only a deliberate 0.45s hold (no quick release) latches the
            // long-press into move mode. The `.sequenced` long-press also
            // pre-claims the touch on hold, so the drag still moves the row.
            // Idle rows stay inert via the `.subviews` mask (Anomaly 1 fix).
            .simultaneousGesture(reorderGesture, including: isActive ? .all : .subviews)
    }

    private var reorderGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.5)
            .sequenced(before: DragGesture(coordinateSpace: .named("exerciseReorder")))
            .updating($drag) { value, drag, _ in
                // Orange + offset ONLY in the `.second` phase — i.e. AFTER the
                // long-press genuinely COMPLETES. The earlier `.first(true)`
                // case was the bug behind "瞬間發動": `.first(...)` is the PRESS
                // phase, delivered from touch-DOWN (LongPressGesture's
                // isPressing), NOT completion — so the highlight + haptic fired
                // instantly, independent of `minimumDuration` (which is why
                // 0.45s→0.7s changed nothing). `.second` only arrives once the
                // 0.5s hold elapses.
                if case .second(true, let d) = value {
                    drag = .moving(d?.translation.height ?? 0)
                } else {
                    drag = .inactive
                }
            }
            .onChanged { value in
                // Haptic exactly once, when the press SUCCEEDS into move mode
                // (the first `.second`). Re-armed by the press phase (`.first`).
                switch value {
                case .second:
                    if !didEnterMove {
                        didEnterMove = true
                        WKInterfaceDevice.current().play(.start)
                    }
                default:
                    didEnterMove = false
                }
            }
            .onEnded { value in
                didEnterMove = false
                // Commit only when an actual drag followed the press. A press
                // with no drag falls through harmlessly — `@GestureState`
                // resets the highlight either way.
                if case .second(_, let d?) = value {
                    onCommit(groupIndex, d.translation.height)
                }
            }
    }
}

/// Move-mode state for `ReorderableRow`'s `@GestureState`.
private enum ReorderDrag {
    case inactive
    case moving(CGFloat)
    var isMoving: Bool { if case .moving = self { return true }; return false }
    var translation: CGFloat { if case .moving(let t) = self { return t }; return 0 }
}

// MARK: - Progress bar items

private struct ProgressBarItem: Identifiable, Equatable {
    let id: String
    let filled: Bool
}

// MARK: - Reorder support types

/// Collects each render group's midY (in the "exerciseReorder" coordinate
/// space) so the drop target index can be derived from the finger's Y.
private struct GroupMidYKey: PreferenceKey {
    static var defaultValue: [Int: CGFloat] = [:]
    static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
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
/// Phase F (gap 2 + +1) — swipe-to-reveal, per D11 spec lines 1592-1593 +
/// 2026-05-31 device feedback. Two-step (iOS-Mail style), both directions:
///   1. tap row → `{}` Active (green border)
///   2a. LEFT-swipe  → the trailing ◯ swaps to a red 🗑 → tap 🗑 = delete
///   2b. RIGHT-swipe → a green ＋ appears on the LEADING edge (`＋ 1 80 8`,
///       row shifts right) → tap ＋ = add a new set at the end of this
///       exercise (「新增最後一組」), prefilled with this row's weight/reps
///       (「同種類的下一個」).
/// Explicit tap (NOT swipe-past-threshold) so an over-eager swipe can't
/// nuke / spawn a set, and one swipe can't take out two.
///
/// Gated on the row being Active so a non-Active row's horizontal swipe
/// still pages the TabView (spec line 1576-1577). The reveal gesture uses
/// a LOW `minimumDistance` + `.highPriorityGesture` so the Active row
/// claims the horizontal drag BEFORE the ancestor TabView's page-swipe
/// threshold — that is the "Active set 左滑一直觸發換頁" fix.
///
/// Warmup + working rows only — cluster sub-sets keep their min-2
/// invariant and are removed by deleting the whole exercise via ⋯ menu.
private enum RowReveal {
    case none
    case delete
    case add
}

private struct InteractiveSetRow<Content: View>: View {
    @ObservedObject var state: SessionInteractionState
    let setId: String
    let hasCheckmark: Bool
    /// True while this row is in long-press move mode → border paints orange
    /// (replacing the Active green) so the two never coexist.
    var isReordering: Bool = false
    /// Invoked when the user taps the revealed ＋ (right-swipe). nil ⇒ the
    /// row offers no +1 affordance. The closure owns the add semantics
    /// (ordinal + prefill) — see `ExerciseCard.groupRow`.
    let onAddSet: (() -> Void)?
    @ViewBuilder let content: () -> Content

    /// Which trailing affordance (if any) the swipe has revealed. Cleared
    /// on tap-elsewhere / leaving Active / acting on it.
    @State private var reveal: RowReveal = .none

    private var rowIsActive: Bool { state.isActive(setId: setId) }

    var body: some View {
        HStack(spacing: 4) {
            // Right-swipe reveals a ＋ on the LEADING edge (per user
            // 2026-05-31: ＋ comes from the left, pushing the row right —
            // iOS-Mail leading action). Tap = add a set.
            if reveal == .add {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) {
                        reveal = .none
                        onAddSet?()
                    }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.body)
                        .foregroundStyle(.green)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .transition(.move(edge: .leading).combined(with: .opacity))
            }

            content()
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(
                            isReordering ? Color.orange
                                : (rowIsActive ? Color.green : Color.clear),
                            lineWidth: isReordering ? 2.5 : 2.0
                        )
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    if !rowIsActive {
                        // Not Active yet → activate (cells own taps once Active).
                        state.activate(setId: setId)
                    } else if reveal != .none {
                        // Revealed → a tap on the row (not the 🗑/＋) cancels it.
                        withAnimation(.easeOut(duration: 0.15)) { reveal = .none }
                    }
                }

            trailingControl
        }
        .padding(.vertical, 1)
        // Opaque-ish hit area so a horizontal drag anywhere on the row is
        // captured by the reveal gesture below.
        .background(Color.black.opacity(0.001))
        // Reveal gesture — LOW minimumDistance + highPriority so the Active
        // row claims the horizontal drag before the TabView pages. Masked
        // OFF when not Active (`.subviews`) so a non-Active swipe pages.
        .highPriorityGesture(
            revealGesture,
            including: rowIsActive ? .all : .subviews
        )
        // Leaving Active (tap 框外 / 切到別 row / ✓) closes the reveal so a
        // stale 🗑/＋ can't linger on an idle row.
        .onChange(of: rowIsActive) { _, active in
            if !active && reveal != .none {
                withAnimation(.easeOut(duration: 0.15)) { reveal = .none }
            }
        }
    }

    /// Trailing slot: ◯ normally; swaps to a red 🗑 on a left-swipe. On a
    /// right-swipe (.add) the trailing ◯ is dropped — the ＋ shows on the
    /// LEADING edge instead (see `body`), matching `＋  1  80  8`.
    @ViewBuilder
    private var trailingControl: some View {
        switch reveal {
        case .delete:
            Button {
                // Explicit tap = delete (wrap so the row removal animates).
                withAnimation(.easeOut(duration: 0.2)) {
                    state.deleteSet(setId: setId)
                }
            } label: {
                Image(systemName: "trash.fill")
                    .font(.body)
                    .foregroundStyle(.red)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .transition(.move(edge: .trailing).combined(with: .opacity))

        case .add:
            // ＋ lives on the leading edge in this state; trailing is empty.
            EmptyView()

        case .none:
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
    }

    private var revealGesture: some Gesture {
        // minimumDistance 5: low enough to claim the drag before the TabView
        // pages, high enough that a tap (≈0 travel) never starts it → cell
        // taps + ◯ taps unaffected. Direction TOGGLES (per 2026-05-31):
        //   left  → 🗑 ; but if ＋ is showing, left RESTORES to ◯
        //   right → ＋ ; but if 🗑 is showing, right RESTORES to ◯
        DragGesture(minimumDistance: 5)
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height)
                else { return }
                let next: RowReveal
                if value.translation.width < -28 {
                    // Left-swipe: cancel a shown ＋, else reveal 🗑.
                    next = (reveal == .add) ? .none : .delete
                } else if value.translation.width > 28 {
                    // Right-swipe: cancel a shown 🗑, else reveal ＋ (if able).
                    next = (reveal == .delete) ? .none : (onAddSet != nil ? .add : .none)
                } else {
                    // Sub-threshold horizontal nudge — leave the state as-is.
                    return
                }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                    reveal = next
                }
            }
    }
}

// MARK: - Cluster group

/// Cluster (dropset chain) acts as a single `{}` Active unit. The border
/// wraps the head + all follower rows; the ✓ on the head toggles the whole
/// chain's logged state. Per the 2026-05-31 grill the head ✓ sits OUTSIDE
/// the border (top-right) — the border is therefore NOTCHED there, a polygon
/// with the top-right corner cut out (`ClusterNotchedBorder`). Followers carry
/// `[－]` (remove this child) + `[＋]` (add a child) and have NO ✓ / no swipe
/// (per dropset-chain-semantics DR1). Active border is GREEN, consistent with
/// working rows (user Q1); orange while reordering.
///
/// The cluster's "active id" is the head's set ID — tapping any row inside
/// the cluster activates the whole group; whole-cluster swipe/long-press are
/// owned by the wrapping `ReorderableRow` / `InteractiveSetRow` layer.
private struct ClusterSetGroup: View {
    @ObservedObject var state: SessionInteractionState
    let header: SessionSnapshotSet
    let subs: [SessionSnapshotSet]
    let clusterIndex: Int
    /// True while the whole cluster is in long-press move mode → orange border.
    var isReordering: Bool = false
    /// tap header 編號 `D{n}` while the cluster is Active → deconstruct it
    /// back to a working set (sub-sets dropped). See `ExerciseCard.cycleType`.
    let onCycleHeaderType: () -> Void
    /// [＋] on a follower → add a new dropset child right after `afterSetId`.
    let onAddChild: (_ afterSetId: String) -> Void
    /// [－] on a follower → remove that child set.
    let onRemoveChild: (_ childSetId: String) -> Void

    private var groupId: String { header.setId }
    private var active: Bool { state.isActive(setId: groupId) }

    /// Notch reserved at the head row's trailing for the ✓ that sits OUTSIDE
    /// the border. Matches the ✓ button frame.
    private let notchW: CGFloat = 32
    private let notchH: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // Head: D# + cells. Reserve the notch on the right so the cells
            // don't run under the ✓.
            SetRowClusterHeaderContent(
                set: header,
                clusterIndex: clusterIndex,
                clusterId: groupId,
                state: state,
                onCycleType: onCycleHeaderType
            )

            // Followers: [－] cells [＋]. Full width (their [＋] sits below the
            // notch, not next to the ✓).
            ForEach(subs, id: \.setId) { sub in
                ClusterFollowerRow(
                    set: sub,
                    clusterId: groupId,
                    state: state,
                    canRemove: subs.count > 1,
                    onRemove: { onRemoveChild(sub.setId) },
                    onAdd: { onAddChild(sub.setId) }
                )
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(
            ClusterNotchedBorder(notchW: notchW, notchH: notchH, cornerRadius: 6)
                .stroke(
                    isReordering ? Color.orange
                        : (active ? Color.green : Color.secondary.opacity(0.3)),
                    lineWidth: isReordering ? 2.5 : 2.0
                )
        )
        // ✓ for the whole chain — lives in the notch, OUTSIDE the border.
        .overlay(alignment: .topTrailing) {
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
                    .frame(width: notchW, height: notchH)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            // Don't auto-activate on tap-anywhere when cluster is already
            // Active — that would steal cell taps.
            if !active { state.activate(setId: groupId) }
        }
        .padding(.vertical, 1)
    }
}

/// Rounded rect with the TOP-RIGHT corner notched out (an `notchW × notchH`
/// rectangle), so the cluster's ✓ can sit in the cut, OUTSIDE the stroke,
/// while the follower rows below extend to full width.
private struct ClusterNotchedBorder: Shape {
    var notchW: CGFloat
    var notchH: CGFloat
    var cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        // All six corners (incl. the two at the top-right notch) use the same
        // radius via tangent arcs, so the notch is blunted like every other
        // corner (user 2026-05-31: 右上兩個直角請鈍化跟其他直角一樣).
        let r = max(1, min(cornerRadius, min(rect.width, rect.height) / 4))
        let nW = max(r * 2, min(notchW, rect.width - r * 2))
        let nH = max(r * 2, min(notchH, rect.height - r * 2))
        // Notched-rectangle vertices, clockwise from the top-left.
        let v0 = CGPoint(x: rect.minX, y: rect.minY)              // top-left
        let v1 = CGPoint(x: rect.maxX - nW, y: rect.minY)        // notch top (A)
        let v2 = CGPoint(x: rect.maxX - nW, y: rect.minY + nH)   // notch inner (B)
        let v3 = CGPoint(x: rect.maxX, y: rect.minY + nH)        // right-edge top (C)
        let v4 = CGPoint(x: rect.maxX, y: rect.maxY)             // bottom-right
        let v5 = CGPoint(x: rect.minX, y: rect.maxY)            // bottom-left
        var p = Path()
        // Start mid-left edge (a non-corner point) so each corner is a clean
        // tangent-arc round.
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addArc(tangent1End: v0, tangent2End: v1, radius: r)
        p.addArc(tangent1End: v1, tangent2End: v2, radius: r)
        p.addArc(tangent1End: v2, tangent2End: v3, radius: r)
        p.addArc(tangent1End: v3, tangent2End: v4, radius: r)
        p.addArc(tangent1End: v4, tangent2End: v5, radius: r)
        p.addArc(tangent1End: v5, tangent2End: v0, radius: r)
        p.closeSubpath()
        return p
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
    /// tap 編號「熱」→ cycle type (active) / activate (idle).
    var onCycleType: () -> Void = {}

    var body: some View {
        HStack(spacing: 4) {
            Text("熱")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentShape(Rectangle())
                .onTapGesture {
                    if rowIsActive { onCycleType() }
                    else { state.activate(setId: set.setId) }
                }
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
    /// tap 編號 → cycle type (active) / activate (idle).
    var onCycleType: () -> Void = {}

    var body: some View {
        HStack(spacing: 4) {
            Text("\(displayIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentShape(Rectangle())
                .onTapGesture {
                    if rowIsActive { onCycleType() }
                    else { state.activate(setId: set.setId) }
                }
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
    /// tap 編號 `D{n}` → deconstruct cluster (active) / activate (idle).
    var onCycleType: () -> Void = {}

    var body: some View {
        HStack(spacing: 4) {
            Text("D\(clusterIndex)")
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentShape(Rectangle())
                .onTapGesture {
                    if clusterActive { onCycleType() }
                    else { state.activate(setId: clusterId) }
                }
            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            .frame(width: CellMetrics.weightWidth)
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            .frame(width: CellMetrics.repsWidth)
            Spacer(minLength: 0)
            // Reserve the ◯ notch column INLINE (same as the followers' [＋]
            // column) so the head + follower cells share an identical layout
            // and line up. The actual ◯ is drawn by the parent's notch overlay.
            Color.clear.frame(width: 32, height: 22)
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

/// Cluster follower (dropset child) row — `[－] cells [＋]`. No ✓, no swipe
/// per dropset-chain-semantics DR1 (only the head carries the ✓; followers
/// are button-driven). `[－]` removes this child step, `[＋]` adds another
/// after it. Cells tappable when the cluster is `{}` Active.
private struct ClusterFollowerRow: View {
    let set: SessionSnapshotSet
    let clusterId: String
    @ObservedObject var state: SessionInteractionState
    /// False when this is the LAST remaining follower — a dropset chain keeps
    /// at least 1 child, so [－] greys out (user 2026-05-31 #3).
    let canRemove: Bool
    let onRemove: () -> Void
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            // Leading column — same width (20) as the head's `D{n}` so the
            // cells line up. [－] removes this child (Active only, #2); greyed
            // + disabled at the min-1-follower floor (#3).
            if clusterActive {
                Button(action: onRemove) {
                    Image(systemName: "minus.circle.fill")
                        .font(.caption)
                        .foregroundStyle(canRemove ? Color.red : Color.gray.opacity(0.4))
                        .frame(width: 20, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canRemove)
            } else {
                Color.clear.frame(width: 20, height: 22)
            }

            CellBox(
                value: formatWeight(displayWeight),
                unit: "kg",
                minWidth: CellMetrics.weightWidth,
                isActive: state.isCellActive(setId: set.setId, field: .weight),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .weight, currentValue: displayWeight)
                } : nil
            )
            .frame(width: CellMetrics.weightWidth)
            CellBox(
                value: "\(Int(displayReps?.rounded() ?? 0))",
                unit: "次",
                minWidth: CellMetrics.repsWidth,
                isActive: state.isCellActive(setId: set.setId, field: .reps),
                onTap: clusterActive ? {
                    state.activateCell(setId: set.setId, field: .reps, currentValue: displayReps)
                } : nil
            )
            .frame(width: CellMetrics.repsWidth)

            Spacer(minLength: 0)

            // Trailing column — same width as the head's ◯ notch so every row's
            // cells stay aligned. [＋] adds a child (Active only, #2); otherwise
            // a clear spacer keeps the alignment.
            if clusterActive {
                Button(action: onAdd) {
                    Image(systemName: "plus.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                        .frame(width: 32, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                Color.clear.frame(width: 32, height: 22)
            }
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
