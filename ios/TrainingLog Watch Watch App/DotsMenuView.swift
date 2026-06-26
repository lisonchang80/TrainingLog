//
//  DotsMenuView.swift
//  TrainingLog Watch
//
//  Slice 13d D15 — per-exercise ⋯ context menu.
//  Per ADR-0019 § Slice 13d D15 Spec (line 1963-2221, frozen 2026-05-28).
//
//  Scope (this revision):
//    - Solo menu root (4 項): 重置 / 跳過 / 歷史 / 刪除
//    - Superset menu root (5 項): 重置 / 跳過 / 歷史A / 歷史B / 刪除
//    - Dynamic skip label: ⏭ 跳過 ↔ ↩ 取消跳過
//    - 🗑 進 DotsMenuConfirmView (separate view, not destructive yet)
//    - 📊 push ExerciseHistoryView via NavigationLink value
//    - Order lock: 非破壞性在上、destructive 在下、紅色文字
//
//  Out of scope (deferred):
//    - D9: real DB reset / skip / DELETE wire (currently only in-memory
//      callbacks invoked by caller)
//    - Crown highlight rotation polish (spec line 2168)
//
//  Anti-patterns avoided (per skill watch-swiftui-phase-ship):
//    - Whole button red bg → only text/icon red; border stays secondary.
//    - Empty .onTapGesture pitfalls → all buttons use Button { ... }.
//

import SwiftUI

/// Value pushed by the menu's 📊 NavigationLink; the card registers a
/// matching `.navigationDestination(for:)` on the stack root. Value-based
/// navigation keeps push state INSIDE the NavigationStack — the previous
/// `navigationDestination(isPresented:)` bridged card-level @State through
/// a computed Binding, and a card re-render (live-mirror tick / set log)
/// racing the push made watchOS occasionally mount the history page as
/// stack ROOT (centered title, no back chevron; bug ③ 2026-06-11).
/// Solo card has 1 history target; superset has 2 (one per side).
struct DotsMenuHistoryTarget: Hashable {
    let exerciseId: String
    let exerciseName: String
}

/// Value pushed by the menu's 備註 NavigationLink (Goal 3a, 2026-06-26). The
/// card registers a matching `.navigationDestination(for:)` building an
/// `ExerciseNotesView`. Mirrors `DotsMenuHistoryTarget` exactly — solo card has
/// 1 notes target, superset has 2 (one per side). Distinct type from the history
/// target so the two `navigationDestination(for:)` handlers don't collide.
struct DotsMenuNotesTarget: Hashable {
    let exerciseId: String
    let exerciseName: String
}

struct DotsMenuView: View {

    /// Target exercise name (locale-aware, comes from caller).
    /// For superset use the combined "A ＋ B" form.
    let exerciseName: String

    /// `true` when this card represents a superset (cluster). Drives
    /// label wording 「此動作」→「此超級組」+ history split into A/B.
    let isCluster: Bool

    /// `true` when the exercise is currently marked skipped. Drives
    /// menu item 2 label: false → ⏭ 跳過、true → ↩ 取消跳過.
    let isSkipped: Bool

    /// History push targets — solo: `[self]`, superset: `[A, B]`. The
    /// 📊 rows render as `NavigationLink(value:)`; the card's stack root
    /// resolves them via `.navigationDestination(for:)`.
    let historyTargets: [DotsMenuHistoryTarget]

    /// Notes push targets (Goal 3a) — solo: `[self]`, superset: `[A, B]`, mirror
    /// of `historyTargets`. The 備註 rows render as `NavigationLink(value:)`; the
    /// card resolves them via `.navigationDestination(for: DotsMenuNotesTarget)`.
    let notesTargets: [DotsMenuNotesTarget]

    // MARK: - Callbacks
    //
    // The caller dispatches these. The menu does not directly mutate
    // any SessionInteractionState — keeps this view free of read-write
    // coupling per skill anti-pattern (sub-views shouldn't mutate
    // shared @ObservedObject).

    /// 重置此動作 / 重置此超級組 — caller flips all set is_logged → false.
    let onReset: () -> Void

    /// 跳過此動作 / 取消跳過 — caller toggles skipped flag.
    let onSkip: () -> Void

    /// 🗑 刪除動作 / 刪除此超級組 — caller already showed confirm dialog
    /// before calling this. See `DotsMenuConfirmView`.
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // Target header (動作名).
                Text(exerciseName)
                    .font(.headline)
                    .lineLimit(2)
                    .padding(.horizontal, 4)
                    .padding(.top, 4)
                    .padding(.bottom, 2)

                // Non-destructive items (in spec order).
                resetButton
                skipButton

                if isCluster && historyTargets.count >= 2 {
                    historyLink(label: "查看\(historyTargets[0].exerciseName)歷史", value: historyTargets[0])
                    historyLink(label: "查看\(historyTargets[1].exerciseName)歷史", value: historyTargets[1])
                } else if let target = historyTargets.first {
                    historyLink(label: "查看歷史", value: target)
                }

                // 備註 (Goal 3a) — grouped with 歷史 (both are "view" actions),
                // before the destructive 刪除. Always enabled: with pull-on-tap
                // the Watch can't know emptiness upfront, so an empty note opens
                // the「尚無備註」state (拍板 3a).
                if isCluster && notesTargets.count >= 2 {
                    notesLink(label: "\(notesTargets[0].exerciseName) 備註", value: notesTargets[0])
                    notesLink(label: "\(notesTargets[1].exerciseName) 備註", value: notesTargets[1])
                } else if let target = notesTargets.first {
                    notesLink(label: "備註", value: target)
                }

                // Destructive last (per spec Q6=A).
                deleteButton
            }
            .padding(.horizontal, 4)
        }
    }

    // MARK: - Buttons

    private var resetButton: some View {
        menuButton(
            systemImage: "arrow.counterclockwise",
            label: isCluster ? "重置此超級組" : "重置此動作"
        ) {
            onReset()
            dismiss()
        }
    }

    private var skipButton: some View {
        // Dynamic label swap per spec Q2 / Q4.
        let label: String
        let icon: String
        if isSkipped {
            label = "取消跳過"
            icon = "arrow.uturn.backward"
        } else if isCluster {
            label = "跳過此超級組"
            icon = "forward.end"
        } else {
            label = "跳過此動作"
            icon = "forward.end"
        }
        return menuButton(systemImage: icon, label: label) {
            onSkip()
            dismiss()
        }
    }

    /// 📊 row as a declarative NavigationLink — the push is owned by the
    /// NavigationStack (back-chevron guaranteed), menu stays underneath so
    /// `‹` returns here per spec line 2148 「‹ 退出回 D15 menu」.
    private func historyLink(label: String, value: DotsMenuHistoryTarget) -> some View {
        NavigationLink(value: value) {
            menuRowLabel(systemImage: "chart.bar.doc.horizontal", label: label)
        }
        .buttonStyle(.plain)
    }

    /// 備註 row (Goal 3a) — declarative NavigationLink, mirror of `historyLink`.
    /// The push (`ExerciseNotesView`) is owned by the NavigationStack so `‹`
    /// returns here, and the menu stays underneath.
    private func notesLink(label: String, value: DotsMenuNotesTarget) -> some View {
        NavigationLink(value: value) {
            menuRowLabel(systemImage: "note.text", label: label)
        }
        .buttonStyle(.plain)
    }

    private var deleteButton: some View {
        // Destructive: icon + text both red, border stays secondary
        // per anti-pattern note (don't bg-red the whole button).
        Button {
            onDelete()
            // Do NOT dismiss — caller shows confirm dialog; if user
            // cancels confirm they return to menu still open.
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "trash")
                    .foregroundStyle(.red)
                Text(isCluster ? "刪除此超級組" : "刪除動作")
                    .foregroundStyle(.red)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.4), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    /// Standard non-destructive menu row: icon + label, secondary
    /// border, default foreground.
    private func menuButton(
        systemImage: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            menuRowLabel(systemImage: systemImage, label: label)
        }
        .buttonStyle(.plain)
    }

    /// Shared row chrome for Button + NavigationLink variants.
    private func menuRowLabel(systemImage: String, label: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .foregroundStyle(.primary)
            Text(label)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.4), lineWidth: 1)
        )
    }
}

// MARK: - Previews

#Preview("Solo — normal") {
    NavigationStack {
        DotsMenuView(
            exerciseName: "深蹲",
            isCluster: false,
            isSkipped: false,
            historyTargets: [
                DotsMenuHistoryTarget(exerciseId: "ex-1", exerciseName: "深蹲")
            ],
            notesTargets: [
                DotsMenuNotesTarget(exerciseId: "ex-1", exerciseName: "深蹲")
            ],
            onReset: {},
            onSkip: {},
            onDelete: {}
        )
    }
}

#Preview("Solo — skipped") {
    NavigationStack {
        DotsMenuView(
            exerciseName: "深蹲",
            isCluster: false,
            isSkipped: true,
            historyTargets: [
                DotsMenuHistoryTarget(exerciseId: "ex-1", exerciseName: "深蹲")
            ],
            notesTargets: [
                DotsMenuNotesTarget(exerciseId: "ex-1", exerciseName: "深蹲")
            ],
            onReset: {},
            onSkip: {},
            onDelete: {}
        )
    }
}

#Preview("Superset") {
    NavigationStack {
        DotsMenuView(
            exerciseName: "臥推 ＋ 划船",
            isCluster: true,
            isSkipped: false,
            historyTargets: [
                DotsMenuHistoryTarget(exerciseId: "ex-a", exerciseName: "臥推"),
                DotsMenuHistoryTarget(exerciseId: "ex-b", exerciseName: "划船"),
            ],
            notesTargets: [
                DotsMenuNotesTarget(exerciseId: "ex-a", exerciseName: "臥推"),
                DotsMenuNotesTarget(exerciseId: "ex-b", exerciseName: "划船"),
            ],
            onReset: {},
            onSkip: {},
            onDelete: {}
        )
    }
}
