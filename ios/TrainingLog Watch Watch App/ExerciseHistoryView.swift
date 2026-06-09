//
//  ExerciseHistoryView.swift
//  TrainingLog Watch
//
//  Slice 13d D15 — 📊 view-history sub-page.
//  Per ADR-0019 § Slice 13d D15 View 7 (line 2114-2149, frozen 2026-05-28)
//  + 2026-06-09 D15 amendment (#311-A real pull-on-tap over WC).
//
//  Rules (per spec Q5=A):
//    - Hard-locked to the last 3 sessions of the target exercise.
//      Crown cannot scroll past — `prefix(3)` enforced even if a
//      future DB query returns more rows.
//    - Read-only, no editing affordances.
//    - Display: `MM-DD (週次)` + 工作組數 + `weight×reps` joined by ` / `,
//      with warmup omitted (workingSetCount only).
//    - `‹` back chevron returns to D15 menu via NavigationStack pop.
//
//  #311-A (2026-06-09) — replaced the `ExerciseHistoryMock` with a real
//  pull over WatchConnectivity:
//    - Q1 = A1 pull-on-tap: the sub-page fetches when it appears (after
//      the user taps 📊 → navigation push). `.task(id: exerciseId)` owns
//      the round-trip; nothing is prefetched.
//    - Q2 = independent error state: a failed / unreachable / timed-out
//      pull renders a DISTINCT error view (with a 重試 button), NOT the
//      genuine-empty "first time doing this?" view. The four states:
//        .loading  → spinner
//        .loaded   → record list (≥1 session)
//        .empty    → genuine empty (ok:true, 0 records)
//        .error    → transport failure / ok:false / unparseable
//    - The records arrive DISPLAY-READY over the wire (date label localised,
//      kg/lb already converted) — the Watch has no i18n / unit table; iPhone
//      formats them in `onHistoryRequest`. The pivot is `exerciseId` (FK),
//      NOT the display name.
//    - The pull closure is INJECTED (`load`) rather than reaching for the
//      coordinator via `@EnvironmentObject`: this sub-page lives inside a
//      `.sheet` (the ⋯ menu), and SwiftUI sheets do NOT inherit the
//      environment. `SetLoggerView` (which holds the coordinator) builds the
//      closure and threads it down through the cards. Previews pass a canned
//      closure with no live coordinator.
//

import SwiftUI

/// One past session's record summary for the history list.
struct ExerciseHistoryRecord: Identifiable, Hashable {
    /// Stable id per row — `yyyy-MM-dd` of the session start.
    let id: String
    /// Pre-formatted date header, e.g. `2026-05-26 (二)` (weekday localised).
    let dateLabel: String
    /// Pre-formatted top-set highlight, e.g. `頂組：80kg×8（增肌）`. EMPTY string
    /// when the session has no eligible weighted working set — the view hides
    /// the line. (Wire uses '' not null: NSNull would make WCSession reject the
    /// reply; see the TS `WatchHistoryRecord.topSetLine`.)
    let topSetLine: String
    /// Working-set count (warmup excluded).
    let workingSetCount: Int
    /// Per-working-set display strings, e.g. ["80kg×8", "80kg×8"].
    let setLines: [String]
}

/// Mirror of TS `WatchHistoryReplyPayload` (`src/adapters/watch/watchHistory.ts`):
///   `{ requestId: string; exerciseId: string; ok: boolean; records: WatchHistoryRecord[] }`
/// Each record mirrors `WatchHistoryRecord` (`src/domain/watch/watchExerciseHistory.ts`):
///   `{ id: string; dateLabel: string; workingSetCount: number; setLines: string[] }`
///
/// This reply rides the `sendMessage` replyHandler ack — it is NOT a modelled
/// WC kind (per the request-reply PULL pattern); only the OUTBOUND
/// `history-request` is a WCMessageKind.
struct ExerciseHistoryReply {
    let requestId: String
    let exerciseId: String
    let ok: Bool
    let records: [ExerciseHistoryRecord]

    /// Parse a WC reply dict. Returns nil when the shape is wrong OR the
    /// `requestId` doesn't echo the one we sent (drop stale / cross-talk
    /// replies for a previous request).
    static func parse(
        from reply: [String: Any],
        expectedRequestId: String
    ) -> ExerciseHistoryReply? {
        guard
            let requestId = reply["requestId"] as? String,
            requestId == expectedRequestId,
            let exerciseId = reply["exerciseId"] as? String,
            let ok = reply["ok"] as? Bool
        else { return nil }

        // `records` is absent / empty on the ok:false path — tolerate both.
        let rawRecords = (reply["records"] as? [[String: Any]]) ?? []
        let records: [ExerciseHistoryRecord] = rawRecords.compactMap { dict in
            guard
                let id = dict["id"] as? String,
                let dateLabel = dict["dateLabel"] as? String
            else { return nil }
            // workingSetCount crosses the wire as an NSNumber — tolerate both
            // Int and NSNumber unboxing (varies across iOS versions).
            let count: Int
            if let i = dict["workingSetCount"] as? Int {
                count = i
            } else if let n = dict["workingSetCount"] as? NSNumber {
                count = n.intValue
            } else {
                count = 0
            }
            let setLines = (dict["setLines"] as? [String]) ?? []
            // '' when absent (wire never sends null — see topSetLine doc).
            let topSetLine = (dict["topSetLine"] as? String) ?? ""
            return ExerciseHistoryRecord(
                id: id,
                dateLabel: dateLabel,
                topSetLine: topSetLine,
                workingSetCount: count,
                setLines: setLines
            )
        }
        return ExerciseHistoryReply(
            requestId: requestId,
            exerciseId: exerciseId,
            ok: ok,
            records: records
        )
    }
}

/// Pull one exercise's history over WC (Watch → iPhone). Returns nil on
/// transport failure / framework reply timeout / unreachable → the view maps
/// nil to its `.error` state. Injected from `SetLoggerView` (real
/// `coordinator.requestExerciseHistory`) down through the cards; previews pass
/// a canned closure.
typealias ExerciseHistoryLoad = (String) async -> ExerciseHistoryReply?

/// The four display states of the history sub-page (Q2 — error is its OWN
/// state, distinct from a genuine empty history).
enum HistoryLoadState: Equatable {
    case loading
    case loaded([ExerciseHistoryRecord])
    case empty
    case error
}

struct ExerciseHistoryView: View {

    /// Display name for the title header (e.g. `深蹲 歷史`). For cluster sides
    /// callers pass the single-side name (`臥推` / `划船`) per spec line 2149
    /// 「Superset A/B 歷史 = 各自獨立 sub-page、pivot 在 Exercise.id」.
    let exerciseName: String

    /// The FK the history query pivots on (NOT the display name). For a
    /// superset the caller passes the A-side or B-side `exerciseId` per which
    /// 📊 was tapped.
    let exerciseId: String

    /// Pull closure (see `ExerciseHistoryLoad`). Injected so the view can fetch
    /// from inside a `.sheet` (no environment inheritance) and so previews /
    /// tests can supply canned data.
    let load: ExerciseHistoryLoad

    @State private var state: HistoryLoadState = .loading

    var body: some View {
        content
            // SHORT nav title (was `\(exerciseName) 歷史`). A long exercise name
            // in an inline title crowds out / hides the leading back chevron on
            // watchOS (user 2026-06-09 ③「返回箭頭偶爾不見」, long names only).
            // The exercise name now lives in the content header (recordsList).
            .navigationTitle("歷史")
            .navigationBarTitleDisplayMode(.inline)
            // Q1 pull-on-tap — fetch when the sub-page appears. `id: exerciseId`
            // re-pulls if this view instance is reused for another exercise.
            // `.task` auto-cancels on disappear (back-chevron pop).
            .task(id: exerciseId) {
                state = .loading
                state = Self.mapState(await load(exerciseId))
            }
    }

    /// Map a WC reply to a display state. nil / ok:false → `.error`; ok:true
    /// with zero records → `.empty`; otherwise the (3-capped) record list.
    static func mapState(_ reply: ExerciseHistoryReply?) -> HistoryLoadState {
        guard let reply, reply.ok else { return .error }
        // Defensive 3-session cap — the iPhone builder already caps, this
        // guards against a future query that returns more.
        let capped = Array(reply.records.prefix(3))
        return capped.isEmpty ? .empty : .loaded(capped)
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingState
        case .loaded(let records):
            recordsList(records)
        case .empty:
            ScrollView {
                emptyState
                    .padding(.horizontal, 4)
                    .padding(.vertical, 4)
            }
        case .error:
            errorState
        }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("讀取中…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private func recordsList(_ records: [ExerciseHistoryRecord]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Exercise-name header — the nav title is the short "歷史", so the
                // name lives here (also serves the long-name back-chevron fix).
                Text(exerciseName)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .padding(.bottom, 6)
                ForEach(Array(records.enumerated()), id: \.element.id) { idx, rec in
                    if idx > 0 {
                        Rectangle()
                            .fill(Color.secondary.opacity(0.3))
                            .frame(height: 0.5)
                            .padding(.vertical, 4)
                    }
                    recordCard(rec)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
    }

    /// One past session, laid out to mirror the iPhone exercise-history card:
    /// bold `yyyy-MM-dd (週次)` date header (+ working-set count), the optional
    /// `頂組：…` highlight, then per-working-set rows numbered 1 / 2 / 3 …
    private func recordCard(_ rec: ExerciseHistoryRecord) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(rec.dateLabel)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text("\(rec.workingSetCount) 工作組")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            // 頂組 highlight — hidden when '' (no eligible weighted set).
            if !rec.topSetLine.isEmpty {
                Text(rec.topSetLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            // Per-working-set rows, numbered 1..N (warmup already excluded).
            ForEach(Array(rec.setLines.enumerated()), id: \.offset) { idx, line in
                HStack(spacing: 6) {
                    Text("\(idx + 1)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 14, alignment: .trailing)
                    Text(line)
                        .font(.caption2)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.vertical, 2)
    }

    /// Genuine empty — the pull SUCCEEDED (ok:true) but the exercise has no
    /// past logged working sets. Distinct from `.error` (Q2).
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

    /// Error — the pull FAILED (iPhone unreachable / app closed / framework
    /// reply timeout / ok:false / unparseable). Recoverable: a 重試 button
    /// re-pulls (the user can walk back into range / open the iPhone app).
    private var errorState: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            Text("無法取得歷史")
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
            // #2 (2026-06-09, option C「維持線上才有、只改文案」): history is
            // pulled live from iPhone, so spell out the requirement — the most
            // common cause is the iPhone app not being open / in range.
            Text("請開啟 iPhone 的 TrainingLog App\n並確認在附近後重試")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                Task {
                    state = .loading
                    state = Self.mapState(await load(exerciseId))
                }
            } label: {
                Text("重試")
                    .font(.caption)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

// MARK: - Previews

#Preview("Has records") {
    NavigationStack {
        ExerciseHistoryView(
            exerciseName: "深蹲",
            exerciseId: "ex-squat",
            load: { id in
                ExerciseHistoryReply(
                    requestId: "preview",
                    exerciseId: id,
                    ok: true,
                    records: [
                        ExerciseHistoryRecord(
                            id: "2026-05-26", dateLabel: "2026-05-26 (二)",
                            topSetLine: "頂組：80kg×8（增肌）",
                            workingSetCount: 3, setLines: ["80kg×8", "80kg×8", "75kg×6"]
                        ),
                        ExerciseHistoryRecord(
                            id: "2026-05-22", dateLabel: "2026-05-22 (五)",
                            topSetLine: "頂組：75kg×10（增肌）",
                            workingSetCount: 4, setLines: ["75kg×10", "75kg×8", "70kg×8", "70kg×6"]
                        ),
                        ExerciseHistoryRecord(
                            id: "2026-05-19", dateLabel: "2026-05-19 (二)",
                            topSetLine: "頂組：75kg×8（增肌）",
                            workingSetCount: 3, setLines: ["75kg×8", "70kg×8", "70kg×8"]
                        ),
                    ]
                )
            }
        )
    }
}

#Preview("Empty state") {
    NavigationStack {
        ExerciseHistoryView(
            exerciseName: "深蹲",
            exerciseId: "ex-empty",
            load: { id in
                ExerciseHistoryReply(requestId: "p", exerciseId: id, ok: true, records: [])
            }
        )
    }
}

#Preview("Error state") {
    NavigationStack {
        ExerciseHistoryView(
            exerciseName: "深蹲",
            exerciseId: "ex-err",
            load: { _ in nil }
        )
    }
}
