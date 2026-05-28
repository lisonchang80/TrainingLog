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

/// Destination push values for the menu's NavigationLink chain.
/// Solo card has 1 history sub-page; superset has 2 (one per side).
enum DotsMenuDestination: Hashable {
    /// Show history for an exercise. `sideLabel` is the locale name
    /// shown in the back chevron / title (e.g. "深蹲" or "臥推").
    case history(exerciseName: String)
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

    /// Superset only: the two child exercise names for split A/B
    /// history. Ignored when `isCluster == false`. Expected order:
    /// `[A, B]`.
    let clusterChildren: [String]?

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

    /// 📊 查看歷史 — `side` is 0 for solo / A, 1 for B. Caller usually
    /// pushes `ExerciseHistoryView`.
    let onShowHistory: (_ side: Int) -> Void

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

                if isCluster, let kids = clusterChildren, kids.count >= 2 {
                    historyButton(label: "查看\(kids[0])歷史", side: 0)
                    historyButton(label: "查看\(kids[1])歷史", side: 1)
                } else {
                    historyButton(label: "查看歷史", side: 0)
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

    private func historyButton(label: String, side: Int) -> some View {
        menuButton(systemImage: "chart.bar.doc.horizontal", label: label) {
            onShowHistory(side)
            // Do NOT dismiss — caller pushes a NavigationLink and we
            // want the menu underneath so back-chevron returns here
            // per spec line 2148 「‹ 退出回 D15 menu」.
        }
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
        .buttonStyle(.plain)
    }
}

// MARK: - Previews

#Preview("Solo — normal") {
    DotsMenuView(
        exerciseName: "深蹲",
        isCluster: false,
        isSkipped: false,
        clusterChildren: nil,
        onReset: {},
        onSkip: {},
        onDelete: {},
        onShowHistory: { _ in }
    )
}

#Preview("Solo — skipped") {
    DotsMenuView(
        exerciseName: "深蹲",
        isCluster: false,
        isSkipped: true,
        clusterChildren: nil,
        onReset: {},
        onSkip: {},
        onDelete: {},
        onShowHistory: { _ in }
    )
}

#Preview("Superset") {
    DotsMenuView(
        exerciseName: "臥推 ＋ 划船",
        isCluster: true,
        isSkipped: false,
        clusterChildren: ["臥推", "划船"],
        onReset: {},
        onSkip: {},
        onDelete: {},
        onShowHistory: { _ in }
    )
}
