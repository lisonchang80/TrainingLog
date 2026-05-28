//
//  DotsMenuConfirmView.swift
//  TrainingLog Watch
//
//  Slice 13d D15 — 🗑 delete-exercise confirm dialog.
//  Per ADR-0019 § Slice 13d D15 View 4 (line 2048-2066, frozen 2026-05-28).
//
//  Strict two-choice modal layout:
//    ⚠ icon
//    刪除「{name}」？
//    本動作已記錄的 set 將遺失      (cluster variant: 整組 (A+B) 已記錄的 set 將遺失)
//    [取消] [刪除 (紅)]
//
//  Interaction (per spec line 2170-2176):
//    - tap [取消] / 框外 / 左滑 → dismiss, no destructive action
//    - tap [刪除] → invoke onConfirm + dismiss + back to D11 (caller's job)
//

import SwiftUI

struct DotsMenuConfirmView: View {

    /// Display name for the prompt. For cluster: pre-formatted as
    /// "臥推 ＋ 划船".
    let exerciseName: String

    /// Cluster variant changes the secondary line to «整組 (A+B) 已記錄
    /// 的 set 將遺失» (per spec line 2066).
    let isCluster: Bool

    /// Caller wires DB DELETE + CASCADE + auto-scroll. View just
    /// invokes this on [刪除] tap; no in-view state mutation.
    let onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                // ⚠ icon
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.yellow)
                    .padding(.top, 8)

                // 刪除「{name}」？
                Text("刪除「\(exerciseName)」？")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 6)

                // Secondary line.
                Text(isCluster
                    ? "整組 (A+B) 已記錄的 set 將遺失"
                    : "本動作已記錄的 set 將遺失")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)

                // Buttons: 取消 (neutral) + 刪除 (red destructive).
                HStack(spacing: 8) {
                    Button {
                        dismiss()
                    } label: {
                        Text("取消")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.secondary.opacity(0.4), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)

                    Button {
                        // Caller does the actual DELETE (+ CASCADE +
                        // auto-scroll). View just signals intent.
                        onConfirm()
                        dismiss()
                    } label: {
                        Text("刪除")
                            .font(.body)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.red.opacity(0.5), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 4)
            }
            .padding(.horizontal, 6)
        }
    }
}

// MARK: - Previews

#Preview("Solo confirm") {
    DotsMenuConfirmView(
        exerciseName: "深蹲",
        isCluster: false,
        onConfirm: {}
    )
}

#Preview("Cluster confirm") {
    DotsMenuConfirmView(
        exerciseName: "臥推 ＋ 划船",
        isCluster: true,
        onConfirm: {}
    )
}
