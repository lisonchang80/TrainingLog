//
//  ExerciseHistoryView.swift
//  TrainingLog Watch
//
//  Slice 13d D15 — 📊 view-history sub-page.
//  Per ADR-0019 § Slice 13d D15 View 7 (line 2114-2149, frozen 2026-05-28).
//
//  Rules (per spec Q5=A):
//    - Hard-locked to the last 3 sessions of the target exercise.
//      Crown cannot scroll past — `prefix(3)` enforced even if a
//      future DB query returns more rows.
//    - Read-only, no editing affordances.
//    - Display: `MM-DD (週次)` + 工作組數 + `weight×reps` joined by ` / `,
//      with warmup omitted (workingSetCount only).
//    - `‹` back chevron returns to D15 menu via NavigationStack pop.
//    - Empty state when zero history rows.
//
//  TODO: D9 wire real DB query — replace `ExerciseHistoryMock.fetch(...)`
//  with a real `Database` call that joins session_exercise → set rows
//  for the given Exercise.id (pivot: solo Exercise.id; cluster side
//  per A/B).
//

import SwiftUI

/// One past session's record summary for the history list.
struct ExerciseHistoryRecord: Identifiable, Hashable {
    /// Stable id per row — `yyyy-MM-dd` of the session start.
    let id: String
    /// Pre-formatted short date label, e.g. `05-26 (二)`.
    let dateLabel: String
    /// Working-set count (warmup excluded).
    let workingSetCount: Int
    /// Per-working-set display strings, e.g. ["80kg×8", "80kg×8"].
    let setLines: [String]
}

struct ExerciseHistoryView: View {

    /// Display name for the title header (e.g. `深蹲 歷史`). For
    /// cluster sides callers pass the single-side name (`臥推` or
    /// `划船`) per spec line 2149 「Superset A/B 歷史 = 各自獨立 sub-page、
    /// pivot 在 Exercise.id」.
    let exerciseName: String

    /// Records to display. Already filtered to the target exercise
    /// and date-sorted (most recent first). Hard-capped to 3 by this
    /// view via `prefix(3)` defensive regardless of caller's slice.
    let records: [ExerciseHistoryRecord]

    var body: some View {
        let displayed = Array(records.prefix(3))
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if displayed.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(displayed.enumerated()), id: \.element.id) { idx, rec in
                        if idx > 0 {
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(height: 0.5)
                                .padding(.vertical, 4)
                        }
                        recordRow(rec)
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
        .navigationTitle("\(exerciseName) 歷史")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func recordRow(_ rec: ExerciseHistoryRecord) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(rec.dateLabel)
                    .font(.caption)
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text("\(rec.workingSetCount) 工作組")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(rec.setLines.joined(separator: " / "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 2)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "list.clipboard")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            Text("沒有過往訓練紀錄")
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
            Text("第一次做這個動作？")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

// MARK: - Mock data

/// Phase-A mock provider for D15 history sub-page. Returns 3 hardcoded
/// records for any non-empty `exerciseName`, empty list for a
/// caller-injected sentinel name to demo the empty state.
///
/// TODO: D9 wire real DB query — replace with `Database` call that
/// joins session_exercise → set rows for the given Exercise.id.
enum ExerciseHistoryMock {

    /// Demo sentinel — caller passes this exerciseName to render the
    /// empty state preview / smoke.
    static let emptyStateSentinel = "__empty_demo__"

    static func fetch(exerciseName: String) -> [ExerciseHistoryRecord] {
        if exerciseName == emptyStateSentinel {
            return []
        }
        return [
            ExerciseHistoryRecord(
                id: "2026-05-26",
                dateLabel: "05-26 (二)",
                workingSetCount: 3,
                setLines: ["80kg×8", "80kg×8", "75kg×6"]
            ),
            ExerciseHistoryRecord(
                id: "2026-05-22",
                dateLabel: "05-22 (五)",
                workingSetCount: 4,
                setLines: ["75kg×10", "75kg×8", "70kg×8", "70kg×6"]
            ),
            ExerciseHistoryRecord(
                id: "2026-05-19",
                dateLabel: "05-19 (二)",
                workingSetCount: 3,
                setLines: ["75kg×8", "70kg×8", "70kg×8"]
            ),
        ]
    }
}

// MARK: - Previews

#Preview("Has records") {
    NavigationStack {
        ExerciseHistoryView(
            exerciseName: "深蹲",
            records: ExerciseHistoryMock.fetch(exerciseName: "深蹲")
        )
    }
}

#Preview("Empty state") {
    NavigationStack {
        ExerciseHistoryView(
            exerciseName: "深蹲",
            records: ExerciseHistoryMock.fetch(
                exerciseName: ExerciseHistoryMock.emptyStateSentinel
            )
        )
    }
}
