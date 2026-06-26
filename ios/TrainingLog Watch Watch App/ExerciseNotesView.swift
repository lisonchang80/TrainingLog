//
//  ExerciseNotesView.swift
//  TrainingLog Watch
//
//  Goal 3a (2026-06-26) — 備註 view-notes sub-page, opened from an in-session
//  exercise card's ⋯ menu. DISPLAY-ONLY (the Watch has no note editor; editing
//  stays on the iPhone library detail / session card — Goal 4).
//
//  Mirrors `ExerciseHistoryView` (#311-A pull-on-tap, 2026-06-09) almost exactly,
//  for a SINGLE per-exercise note string instead of a history record list:
//    - Q1 pull-on-tap: the sub-page fetches its note when it appears (after the
//      user taps 備註 → navigation push). `.task(id: exerciseId)` owns the round
//      trip; nothing is prefetched. The per-exercise note can't ride the Stage 1
//      prefetch (envelope cap, see `loadTemplateExerciseTree`), so it is pulled
//      on demand exactly like history (拍板 3a).
//    - Four states, error distinct from genuine-empty (same as history Q2):
//        .loading        → spinner
//        .loaded(note)   → the note text (read-only)
//        .empty          → genuine "no note for this exercise" (ok:true, '')
//        .error          → transport failure / ok:false / unparseable (retry)
//    - The `load` closure is INJECTED (not @EnvironmentObject) because this
//      sub-page lives inside the ⋯ `.sheet`, which doesn't inherit the
//      environment. `SetLoggerView` builds it from `coordinator.requestExercise
//      Notes` and threads it down through the cards; previews pass a canned one.
//

import SwiftUI

/// Mirror of TS `WatchNotesReplyPayload` (`src/adapters/watch/watchNotes.ts`):
///   `{ requestId: string; exerciseId: string; ok: boolean; notes: string }`
///
/// This reply rides the `sendMessage` replyHandler ack — it is NOT a modelled
/// WC kind (per the request-reply PULL pattern); only the OUTBOUND
/// `notes-request` is a WCMessageKind.
struct ExerciseNotesReply {
    let requestId: String
    let exerciseId: String
    let ok: Bool
    /// The exercise's global note. '' when the exercise has no note (the wire
    /// never sends null — NSNull would make WCSession reject the reply).
    let notes: String

    /// Parse a WC reply dict. Returns nil when the shape is wrong OR the
    /// `requestId` doesn't echo the one we sent (drop stale / cross-talk replies).
    static func parse(
        from reply: [String: Any],
        expectedRequestId: String
    ) -> ExerciseNotesReply? {
        guard
            let requestId = reply["requestId"] as? String,
            requestId == expectedRequestId,
            let exerciseId = reply["exerciseId"] as? String,
            let ok = reply["ok"] as? Bool
        else { return nil }
        let notes = (reply["notes"] as? String) ?? ""
        return ExerciseNotesReply(
            requestId: requestId,
            exerciseId: exerciseId,
            ok: ok,
            notes: notes
        )
    }
}

/// Pull one exercise's global note over WC (Watch → iPhone). Returns nil on
/// transport failure / framework reply timeout / unreachable → the view maps nil
/// to its `.error` state. Injected from `SetLoggerView` (real
/// `coordinator.requestExerciseNotes`) down through the cards; previews pass a
/// canned closure.
typealias ExerciseNotesLoad = (String) async -> ExerciseNotesReply?

/// The four display states of the notes sub-page (error is its OWN state,
/// distinct from a genuine-empty note — same contract as history).
enum NotesLoadState: Equatable {
    case loading
    case loaded(String)
    case empty
    case error
}

struct ExerciseNotesView: View {

    /// Display name for the header (e.g. `槓鈴臥推`). For cluster sides callers
    /// pass the single-side name (mirrors history's per-side 備註A/備註B).
    let exerciseName: String

    /// The FK the note pivots on (NOT the display name) — `exercise.id`.
    let exerciseId: String

    /// Pull closure (see `ExerciseNotesLoad`). Injected so the view can fetch
    /// from inside a `.sheet` (no environment inheritance) and so previews /
    /// tests can supply canned data.
    let load: ExerciseNotesLoad

    @State private var state: NotesLoadState = .loading

    var body: some View {
        content
            // SHORT nav title (parity with history's「歷史」) — a long exercise
            // name in the inline title crowds out the leading back chevron on
            // watchOS. The name lives in the content header instead.
            .navigationTitle("備註")
            .navigationBarTitleDisplayMode(.inline)
            // Q1 pull-on-tap — fetch when the sub-page appears. `id: exerciseId`
            // re-pulls if this view instance is reused for another exercise.
            .task(id: exerciseId) {
                state = .loading
                state = Self.mapState(await load(exerciseId))
            }
    }

    /// Map a WC reply to a display state. nil / ok:false → `.error`; ok:true with
    /// an empty note → `.empty`; otherwise the note text.
    static func mapState(_ reply: ExerciseNotesReply?) -> NotesLoadState {
        guard let reply, reply.ok else { return .error }
        return reply.notes.isEmpty ? .empty : .loaded(reply.notes)
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingState
        case .loaded(let note):
            noteContent(note)
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

    private func noteContent(_ note: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(exerciseName)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(note)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.secondary.opacity(0.15))
                    )
                // Read-only hint — editing lives on the iPhone (Goal 4).
                HStack(spacing: 4) {
                    Image(systemName: "lock")
                        .font(.system(size: 10))
                    Text("唯讀，請至 iPhone 編輯")
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
    }

    /// Genuine empty — the pull SUCCEEDED (ok:true) but the exercise has no note.
    /// Distinct from `.error` (mirrors history's empty-vs-error split). With
    /// pull-on-tap the Watch can't know emptiness upfront, so the 備註 menu item
    /// is always enabled and this state is the "no note yet" answer (拍板 3a).
    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "note.text")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            Text("尚無備註")
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
            Text("可在 iPhone 的動作詳情頁新增")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    /// Error — the pull FAILED (iPhone unreachable / app closed / framework reply
    /// timeout / ok:false / unparseable). Recoverable: a 重試 button re-pulls.
    private var errorState: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            Text("無法取得備註")
                .font(.body)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
            // Neutral wording (mirror history #2): the request itself
            // background-wakes a killed iPhone app, so a plain retry usually
            // succeeds without the user opening anything.
            Text("iPhone 未回應\n請確認 iPhone 在附近後重試")
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

#Preview("Has note") {
    NavigationStack {
        ExerciseNotesView(
            exerciseName: "槓鈴臥推",
            exerciseId: "ex-bench",
            load: { id in
                ExerciseNotesReply(
                    requestId: "preview",
                    exerciseId: id,
                    ok: true,
                    notes: "胸口下沿啟動，手肘約 45 度，離心 3 秒，肩胛收緊。"
                )
            }
        )
    }
}

#Preview("Empty state") {
    NavigationStack {
        ExerciseNotesView(
            exerciseName: "槓鈴臥推",
            exerciseId: "ex-empty",
            load: { id in
                ExerciseNotesReply(requestId: "p", exerciseId: id, ok: true, notes: "")
            }
        )
    }
}

#Preview("Error state") {
    NavigationStack {
        ExerciseNotesView(
            exerciseName: "槓鈴臥推",
            exerciseId: "ex-err",
            load: { _ in nil }
        )
    }
}
