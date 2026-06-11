//
//  SupersetCard.swift
//  TrainingLog Watch
//
//  Slice 13d D15 — superset card variant (ADR-0019 § "Visual: 超級組
//  (獨立卡片)", frozen 2026-05-28). Two DIFFERENT exercises (A + B)
//  alternated within one card:
//
//    ┌──────────────────────────────────┐
//    │ [超]                       [⋯]   │  Row 1: 超 tag + ⋯ menu
//    │ 臥推 ＋ 划船                     │  Row 2: A ＋ B names (phone locale)
//    │ ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱     │  Row 3: shared progress bar
//    │                                  │
//    │  1  A [ 80 kg ] [  8 次 ]  ◯    │  per set N: A row + B row, one ✓
//    │     B [ 60 kg ] [ 10 次 ]       │
//    │ ─────────────────────────────    │
//    │  2  A [ 80 kg ] [  8 次 ]  ◯    │
//    │     B [ 60 kg ] [ 10 次 ]       │
//    └──────────────────────────────────┘
//
//  Frozen-spec rules honoured here:
//    - {} Active wraps the row region only (NOT the header; the ⋯ stays
//      tappable). The ✓ sits OUTSIDE the active border in a top-right notch
//      (reusing `ClusterNotchedBorder`), exactly like the dropset cluster.
//    - One ✓ per set N marks the WHOLE pair — toggling it sets both A's and
//      B's `set` logged in lockstep ("cluster 整單元、sub-set 無個別 ✓").
//    - Type cycling supports 熱 / 工作 only — NEVER D (no dropset inside a
//      superset). Tapping the A-row number toggles warmup↔working on BOTH
//      sides. Warmup uses the SAME boxed cells as working (user 2026-06-01:
//      格子跟一般組一致) — only the 熱 label distinguishes it.
//    - Exercise names follow the phone locale (localised at the wire boundary).
//
//  Per-pair gestures (mirror the dropset cluster, but a superset pair has NO
//  child ＋/－ — it's a fixed A+B unit):
//    - LEFT-swipe → reveal 🗑 in the notch → tap = delete the WHOLE pair (both
//      A's and B's set at that index).
//    - RIGHT-swipe → reveal ＋ on the leading edge → tap = add a new pair after
//      this one (a set added to BOTH A and B, prefilled from this pair).
//    - LONG-press → reorder: the pair moves as one unit; both exercises' rank
//      overrides renumber in parallel so they stay paired.
//
//  Overlay model: like ExerciseCard, edits ride `SessionInteractionState` as an
//  overlay over the immutable snapshot. The card renders the MERGED set list
//  (`LiveMirror.mergeSets`) for A and B independently, then pairs them by index
//  — so added / deleted / reordered / kind-cycled sets show, and the existing
//  `LiveMirrorProducer` mirrors them to the iPhone with no extra wiring.
//

import SwiftUI

/// One displayed set row of the superset (A.sets[i] paired with B.sets[i]).
/// File-private so both SupersetCard and SupersetPairBox can use it.
private struct SupersetPair: Identifiable {
    /// "1", "2", … for working pairs; "熱" for a warmup pair.
    let displayNumber: String
    let isWarmup: Bool
    let aSet: SessionSnapshotSet?
    let bSet: SessionSnapshotSet?
    /// Canonical id for the pair's Active / logged state — A's setId (falls
    /// back to B's if the A side is short, then a synthetic id).
    let canonicalId: String
    let id: String
}

struct SupersetCard: View {
    @ObservedObject var state: SessionInteractionState
    /// A side — the parent / lower-`ordering` exercise of the pair.
    let exerciseA: SessionSnapshotExercise
    /// B side — the child / higher-`ordering` exercise of the pair.
    let exerciseB: SessionSnapshotExercise

    /// #311-A — pull a side's history over WC for the 📊 sub-page (per-side:
    /// the A or B exercise depending on which 📊 the user tapped). Threaded
    /// from `SetLoggerView` (real `coordinator.requestExerciseHistory`) because
    /// the history view lives inside the ⋯ `.sheet`. Defaults to a no-op so
    /// previews compile.
    var historyLoad: ExerciseHistoryLoad = { _ in nil }

    // D15 ⋯ menu state (chained sheets so swiping the inner confirm/history
    // returns to the menu).
    @State private var dotsMenuOpen: Bool = false
    @State private var isSkipped: Bool = false
    @State private var pendingConfirm: Bool = false

    /// Cached per-pair midY (in the "supersetReorder" space) for the long-press
    /// reorder drop-target math — same plumbing as ExerciseCard.
    @State private var reorderMidYs: [Int: CGFloat] = [:]

    private let notchW: CGFloat = 32
    private let notchH: CGFloat = 30

    private var clusterName: String {
        // Fullwidth ＋ per the frozen spec mock ("臥推 ＋ 划船").
        "\(exerciseA.exerciseName) ＋ \(exerciseB.exerciseName)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            progressBar
            pairsSection
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.15))
        )
        .opacity(isSkipped ? 0.4 : 1.0)
        .sheet(isPresented: $dotsMenuOpen) { menuSheet }
    }

    // MARK: - Header (3-row: [超]+⋯ / A ＋ B / progress bar)

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text("超")
                    .font(.caption2)
                    .bold()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.purple.opacity(0.7)))
                Spacer(minLength: 0)
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
            Text(clusterName)
                .font(.headline)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    // MARK: - Progress bar (one segment per WORKING pair, filled when logged)

    private var progressBar: some View {
        HStack(spacing: 1) {
            ForEach(workingPairIds, id: \.self) { cid in
                Rectangle()
                    .fill(state.isLogged(setId: cid)
                        ? Color.green
                        : Color.secondary.opacity(0.3))
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 6)
        .animation(.easeInOut(duration: 0.15),
                   value: workingPairIds.map { state.isLogged(setId: $0) })
    }

    // MARK: - Paired set rows (with reorder wrapper)

    private var pairsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(pairs.enumerated()), id: \.element.id) { idx, pair in
                if idx > 0 {
                    Divider().padding(.vertical, 2)
                }
                // Scroll anchor so activating a pair scrolls it under the HR
                // pane (the page's ScrollViewReader targets "anchor-<activeId>").
                Color.clear
                    .frame(height: 0)
                    .id("anchor-\(pair.canonicalId)")
                ReorderableRow(
                    groupIndex: idx,
                    isActive: state.isActive(setId: pair.canonicalId),
                    onCommit: { from, translationY in
                        let to = reorderTargetIndex(from: from, translationY: translationY)
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            commitReorder(from: from, to: to)
                        }
                    }
                ) { isReordering in
                    SupersetPairBox(
                        state: state,
                        pair: pair,
                        notchW: notchW,
                        notchH: notchH,
                        isReordering: isReordering,
                        onCycleType: { toggleKindPair(pair) },
                        onToggleLogged: { toggleLoggedPair(pair) },
                        onAddPair: { addPair(after: pair) },
                        onDeletePair: { deletePair(pair) }
                    )
                }
                .background(midYReader(idx))
            }
        }
        .padding(.horizontal, 4)
        .coordinateSpace(name: "supersetReorder")
        .onPreferenceChange(GroupMidYKey.self) { reorderMidYs = $0 }
    }

    // MARK: - Reorder helpers (mirror ExerciseCard, pair = one unit)

    private func midYReader(_ idx: Int) -> some View {
        GeometryReader { proxy in
            Color.clear.preference(
                key: GroupMidYKey.self,
                value: [idx: proxy.frame(in: .named("supersetReorder")).midY]
            )
        }
    }

    private func reorderTargetIndex(from idx: Int, translationY: CGFloat) -> Int {
        let fingerY = (reorderMidYs[idx] ?? 0) + translationY
        var target = 0
        for (i, midY) in reorderMidYs where i != idx {
            if midY < fingerY { target += 1 }
        }
        return target
    }

    private func commitReorder(from: Int, to: Int) {
        // Each group = the pair's [aId, bId]. applyReorder renumbers rank
        // overrides 0..N-1 across all ids IN PAIR ORDER, so A's ids get
        // monotonically-increasing ranks AND B's do too → both exercises
        // re-sort into the same new pair order (stay paired). The projection
        // re-derives wire ordinals from the present pool so iPhone follows.
        var groups = pairs.map { [$0.aSet?.setId, $0.bSet?.setId].compactMap { $0 } }
        guard from >= 0, from < groups.count else { return }
        let moved = groups.remove(at: from)
        let t = max(0, min(to, groups.count))
        groups.insert(moved, at: t)
        state.applyReorder(orderedGroups: groups)
        WKInterfaceDevice.current().play(.click)
    }

    // MARK: - Pair mutations

    /// +1 pair (right-swipe ＋) — add a set to BOTH A and B right after this
    /// pair, prefilled from this pair's current values + kind. The two new sets
    /// get parallel ordinals / ranks so they pair by index. The new pair
    /// becomes Active.
    private func addPair(after pair: SupersetPair) {
        var newCanonical: String? = nil
        if let a = pair.aSet {
            let w = state.displayValue(setId: a.setId, field: .weight, fallback: a.weight)
            let r = state.displayValue(setId: a.setId, field: .reps, fallback: a.reps.map { Double($0) })
            newCanonical = state.addSet(
                sessionExerciseId: exerciseA.sessionExerciseId,
                afterSetId: a.setId,
                baseSets: exerciseA.sets,
                weight: w,
                reps: r.map { Int($0.rounded()) },
                setKind: a.setKind,
                activateNew: false
            )
        }
        if let b = pair.bSet {
            let w = state.displayValue(setId: b.setId, field: .weight, fallback: b.weight)
            let r = state.displayValue(setId: b.setId, field: .reps, fallback: b.reps.map { Double($0) })
            _ = state.addSet(
                sessionExerciseId: exerciseB.sessionExerciseId,
                afterSetId: b.setId,
                baseSets: exerciseB.sets,
                weight: w,
                reps: r.map { Int($0.rounded()) },
                setKind: b.setKind,
                activateNew: false
            )
        }
        if let newCanonical { state.activate(setId: newCanonical) }
    }

    /// Delete the whole pair (left-swipe 🗑) — both A's and B's set at this
    /// index. "整 pair 同進退".
    private func deletePair(_ pair: SupersetPair) {
        if let a = pair.aSet { state.deleteSet(setId: a.setId) }
        if let b = pair.bSet { state.deleteSet(setId: b.setId) }
    }

    /// Toggle the pair's ✓ — both A and B move together.
    private func toggleLoggedPair(_ pair: SupersetPair) {
        let ids = [pair.aSet?.setId, pair.bSet?.setId].compactMap { $0 }
        let isOn = state.isLogged(setId: pair.canonicalId)
        for id in ids {
            if isOn { state.loggedSetIds.remove(id) } else { state.loggedSetIds.insert(id) }
        }
        state.activeSetId = nil
        state.activeCell = nil
    }

    /// Cycle the pair's type 熱 ↔ 工作 (NEVER D). Same override on BOTH sides;
    /// `mergeSets` applies it, so numbering + progress bar re-derive and the
    /// iPhone reconcile UPDATEs the mirror-bound set_kind.
    private func toggleKindPair(_ pair: SupersetPair) {
        let next = pair.isWarmup ? "working" : "warmup"
        if let a = pair.aSet { state.setKindOverrides[a.setId] = next }
        if let b = pair.bSet { state.setKindOverrides[b.setId] = next }
    }

    // MARK: - ⋯ menu sheet (isCluster = true → 5-item menu w/ A & B history)

    private var menuSheet: some View {
        NavigationStack {
            DotsMenuView(
                exerciseName: clusterName,
                isCluster: true,
                isSkipped: isSkipped,
                historyTargets: [
                    DotsMenuHistoryTarget(
                        exerciseId: exerciseA.exerciseId,
                        exerciseName: exerciseA.exerciseName
                    ),
                    DotsMenuHistoryTarget(
                        exerciseId: exerciseB.exerciseId,
                        exerciseName: exerciseB.exerciseName
                    ),
                ],
                onReset: { resetSupersetInMemory() },
                onSkip: { isSkipped.toggle() },
                onDelete: { pendingConfirm = true }
            )
            // 📊 history push — value-based (see DotsMenuHistoryTarget).
            .navigationDestination(for: DotsMenuHistoryTarget.self) { target in
                ExerciseHistoryView(
                    exerciseName: target.exerciseName,
                    exerciseId: target.exerciseId,
                    load: historyLoad
                )
            }
            .sheet(isPresented: $pendingConfirm) {
                DotsMenuConfirmView(
                    exerciseName: clusterName,
                    isCluster: true,
                    onConfirm: {
                        dotsMenuOpen = false
                        DispatchQueue.main.async {
                            state.deleteExercise(
                                sessionExerciseId: exerciseA.sessionExerciseId,
                                setIds: exerciseA.sets.map { $0.setId }
                            )
                            state.deleteExercise(
                                sessionExerciseId: exerciseB.sessionExerciseId,
                                setIds: exerciseB.sets.map { $0.setId }
                            )
                        }
                    }
                )
            }
        }
    }

    // MARK: - In-memory side effects (mirror ExerciseCard; D9 wires to repo)

    /// 重置此超級組 — clear logged on every set of BOTH exercises; weight/reps
    /// (editedValues) untouched so the user can re-tap ✓ on the same values.
    private func resetSupersetInMemory() {
        let ids = Set(exerciseA.sets.map { $0.setId } + exerciseB.sets.map { $0.setId })
        state.loggedSetIds.subtract(ids)
        if let active = state.activeSetId, ids.contains(active) {
            state.activeSetId = nil
            state.activeCell = nil
        }
    }

    // MARK: - Merged set lists + pair model

    /// A side's sets with the interaction overlay applied (deleted filtered,
    /// added merged, kind/rank overridden, sorted by effective rank).
    private var mergedA: [SessionSnapshotSet] {
        LiveMirror.mergeSets(
            base: exerciseA.sets,
            deletedSets: state.deletedSetIds,
            addedSets: state.addedSets,
            kindOverrides: state.setKindOverrides,
            rankOverrides: state.setRankOverrides,
            sessionExerciseId: exerciseA.sessionExerciseId
        )
    }

    private var mergedB: [SessionSnapshotSet] {
        LiveMirror.mergeSets(
            base: exerciseB.sets,
            deletedSets: state.deletedSetIds,
            addedSets: state.addedSets,
            kindOverrides: state.setKindOverrides,
            rankOverrides: state.setRankOverrides,
            sessionExerciseId: exerciseB.sessionExerciseId
        )
    }

    private var pairs: [SupersetPair] {
        let a = mergedA
        let b = mergedB
        let n = max(a.count, b.count)
        var out: [SupersetPair] = []
        var working = 0
        for i in 0..<n {
            let aSet = i < a.count ? a[i] : nil
            let bSet = i < b.count ? b[i] : nil
            // mergeSets already applied any kind override, so read setKind
            // directly (A side drives the pair's kind; B follows in lockstep).
            let isWarmup = (aSet?.setKind ?? bSet?.setKind ?? "working") == "warmup"
            let number: String
            if isWarmup {
                number = "熱"
            } else {
                working += 1
                number = "\(working)"
            }
            let cid = aSet?.setId ?? bSet?.setId ?? "ss-\(i)"
            out.append(SupersetPair(
                displayNumber: number,
                isWarmup: isWarmup,
                aSet: aSet,
                bSet: bSet,
                canonicalId: cid,
                id: cid
            ))
        }
        return out
    }

    private var workingPairIds: [String] {
        pairs.filter { !$0.isWarmup }.map { $0.canonicalId }
    }
}

// MARK: - One pair box (own @State for the swipe-reveal, like ClusterSetGroup)

private struct SupersetPairBox: View {
    @ObservedObject var state: SessionInteractionState
    fileprivate let pair: SupersetPair
    let notchW: CGFloat
    let notchH: CGFloat
    /// True while the pair is in long-press move mode → orange border.
    var isReordering: Bool = false
    let onCycleType: () -> Void
    let onToggleLogged: () -> Void
    let onAddPair: () -> Void
    let onDeletePair: () -> Void

    /// Which swipe affordance is revealed (mirrors ClusterSetGroup.reveal).
    @State private var reveal: RowReveal = .none

    private var cid: String { pair.canonicalId }
    private var active: Bool { state.isActive(setId: cid) }

    var body: some View {
        // `.top` so the trailing ◯/✓ aligns with the A row (per spec mock),
        // sitting OUTSIDE a plain rounded-rect border — NOT a notched polygon
        // (user 2026-06-01: 超級組沒有 child ＋/－、Active 框長方形即可).
        HStack(alignment: .top, spacing: 4) {
            // Right-swipe reveals ＋ on the LEADING edge (pair shifts right).
            if reveal == .add {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) {
                        reveal = .none
                        onAddPair()
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
            pairBox
            trailingControl
        }
        .padding(.vertical, 1)
        .background(Color.black.opacity(0.001))
        .highPriorityGesture(revealGesture, including: active ? .all : .subviews)
        .onChange(of: active) { _, isActive in
            if !isActive && reveal != .none {
                withAnimation(.easeOut(duration: 0.15)) { reveal = .none }
            }
        }
    }

    private var pairBox: some View {
        VStack(alignment: .leading, spacing: 3) {
            sideRow(
                number: pair.displayNumber,
                sideLabel: "A",
                set: pair.aSet,
                isNumberRow: true
            )
            sideRow(
                number: "",
                sideLabel: "B",
                set: pair.bSet,
                isNumberRow: false
            )
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(
            // Plain rounded rectangle — no notch (the ✓ lives OUTSIDE, to the
            // right). A superset pair is a fixed A+B unit with no child ＋/－,
            // so it doesn't need the dropset cluster's notched shape.
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    isReordering ? Color.orange
                        : (active ? Color.green : Color.secondary.opacity(0.3)),
                    lineWidth: isReordering ? 2.5 : 2.0
                )
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if !active {
                state.activate(setId: cid)
            } else if reveal != .none {
                withAnimation(.easeOut(duration: 0.15)) { reveal = .none }
            }
        }
    }

    @ViewBuilder
    private func sideRow(
        number: String,
        sideLabel: String,
        set: SessionSnapshotSet?,
        isNumberRow: Bool
    ) -> some View {
        HStack(spacing: 4) {
            Text(number)
                .font(.caption)
                .foregroundStyle(.primary)
                .frame(width: 20, alignment: .center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentShape(Rectangle())
                .onTapGesture {
                    if !active {
                        state.activate(setId: cid)
                    } else if isNumberRow {
                        onCycleType()
                    }
                }
            Text(sideLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 14, alignment: .leading)
            if let set {
                cells(set: set)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func cells(set: SessionSnapshotSet) -> some View {
        let dw = state.displayValue(setId: set.setId, field: .weight, fallback: set.weight)
        let dr = state.displayValue(setId: set.setId, field: .reps,
                                    fallback: set.reps.map { Double($0) })
        // Warmup + working share the SAME boxed cell style (user 2026-06-01).
        CellBox(
            value: formatWeight(dw),
            unit: "kg",
            minWidth: CellMetrics.weightWidth,
            isActive: state.isCellActive(setId: set.setId, field: .weight),
            onTap: active ? {
                state.activateCell(setId: set.setId, field: .weight, currentValue: dw)
            } : nil
        )
        .frame(width: CellMetrics.weightWidth)
        CellBox(
            value: "\(Int(dr?.rounded() ?? 0))",
            unit: "次",
            minWidth: CellMetrics.repsWidth,
            isActive: state.isCellActive(setId: set.setId, field: .reps),
            onTap: active ? {
                state.activateCell(setId: set.setId, field: .reps, currentValue: dr)
            } : nil
        )
        .frame(width: CellMetrics.repsWidth)
    }

    /// Trailing control OUTSIDE the box, aligned with the A row (HStack `.top`):
    /// ◯/✓ normally (toggle the whole pair); a red 🗑 on a left-swipe (delete
    /// the pair); empty on a right-swipe (the ＋ shows on the leading edge, so
    /// dropping this keeps the row within screen width → header never shifts).
    @ViewBuilder
    private var trailingControl: some View {
        switch reveal {
        case .delete:
            Button {
                withAnimation(.easeOut(duration: 0.2)) { onDeletePair() }
            } label: {
                Image(systemName: "trash.fill")
                    .font(.body)
                    .foregroundStyle(.red)
                    .frame(width: notchW, height: notchH)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        case .add:
            // The ＋ is on the leading edge; no trailing control (and no width
            // reserved here) so the pair stays within the screen.
            EmptyView()
        case .none:
            Button {
                onToggleLogged()
            } label: {
                Image(systemName: state.isLogged(setId: cid)
                    ? "checkmark.circle.fill"
                    : "circle")
                    .font(.body)
                    .foregroundStyle(state.isLogged(setId: cid)
                        ? Color.green
                        : Color.secondary)
                    .frame(width: notchW, height: notchH)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var revealGesture: some Gesture {
        DragGesture(minimumDistance: 5)
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height)
                else { return }
                let next: RowReveal
                if value.translation.width < -28 {
                    next = (reveal == .add) ? .none : .delete
                } else if value.translation.width > 28 {
                    next = (reveal == .delete) ? .none : .add
                } else {
                    return
                }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                    reveal = next
                }
            }
    }
}

// MARK: - Preview

#Preview("超級組 (臥推 ＋ 划船)") {
    func mockSet(_ id: String, _ ord: Int, _ w: Double, _ r: Int) -> SessionSnapshotSet {
        SessionSnapshotSet(
            setId: id, ordinal: ord, weight: w, reps: r, rpe: nil,
            restSec: nil, notes: nil, setKind: "working", isLogged: false
        )
    }
    let a = SessionSnapshotExercise(
        sessionExerciseId: "SE-A", exerciseId: "ex-bench", exerciseName: "臥推",
        ordering: 1, plannedSets: 2,
        sets: [mockSet("A1", 1, 80, 8), mockSet("A2", 2, 80, 8)],
        reusableSupersetId: "rs-preview"
    )
    let b = SessionSnapshotExercise(
        sessionExerciseId: "SE-B", exerciseId: "ex-row", exerciseName: "划船",
        ordering: 2, plannedSets: 2,
        sets: [mockSet("B1", 1, 60, 10), mockSet("B2", 2, 60, 10)],
        parentId: "SE-A", reusableSupersetId: "rs-preview"
    )
    return ScrollView {
        SupersetCard(state: SessionInteractionState(), exerciseA: a, exerciseB: b)
            .padding(8)
    }
}
