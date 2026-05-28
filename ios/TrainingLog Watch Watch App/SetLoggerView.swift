//
//  SetLoggerView.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase A — root view that replaces
//  `PickerSetLoggerPlaceholderView` after start-from-watch
//  succeeds. Per ADR-0019 § Slice 13d D11 spec + D10 in-session
//  shell spec.
//
//  D10 spec (frozen 0f4a6e0) defines a 3-page TabView shell:
//    page 1 (left)  — 音樂 (native NowPlaying placeholder)
//    page 2 (center) — Session card list (this is where D11 lives)
//    page 3 (right) — 完成頁 (D14, frozen 9d522e7)
//  per spec lines 1575-1576: 「Pages: 音樂 ← session card → 完成頁」.
//
//  Phase A scope: TabView shell + ExerciseCard list rendering only.
//  All interactions (Phase B+), HK lifecycle hooks (Phase H), and
//  D14 完成頁 content (separate slice) are out of scope.
//
//  watchOS `.tabViewStyle(.page)` provides horizontal page paging
//  with a dot indicator — matches D8 line 1573 swipe semantics. The
//  swipe-to-page gating against `{}` Active rows lands in Phase F.
//

import SwiftUI

struct SetLoggerView: View {
    /// SessionSnapshot received from iPhone via start-from-watch
    /// reply. Phase A ignores the snapshot's content and renders
    /// the mock data instead. Phase B reads it directly.
    let snapshot: SessionSnapshot

    /// Center-page selection on initial mount. TabView selection
    /// is stored on the view so swipes naturally update it; pre-
    /// setting to 1 means the user lands on the session card list
    /// rather than on the music or finish page.
    @State private var selectedPage: Int = 1

    /// Phase B interaction state. Survives across page swipes —
    /// `{}` Active row + ✓ logged set IDs persist until view
    /// unmount. Per spec the state is per-session, not per-card.
    @StateObject private var interactionState = SessionInteractionState()

    var body: some View {
        // Page order per user 2026-05-28 polish + spec line 1483
        // 「完成頁（右滑進入）」:
        //   - "右滑" (finger slides right) reveals the page on the
        //     LEFT (lower tag) → 完成頁 must be the lowest tag.
        //   - Music is reached by the opposite swipe direction
        //     (finger slides left) → music is the highest tag.
        //   - Session card sits in the middle as the default landing.
        // Earlier ordering (music=0, finish=2) was backwards; this
        // commit swaps them.
        TabView(selection: $selectedPage) {
            // Page 0 — 完成頁 (left). Reached via finger right-swipe.
            FinishPagePlaceholder(snapshot: snapshotForRender)
                .tag(0)

            // Page 1 — Session card list (D11 main, default landing).
            SessionCardListPage(
                snapshot: snapshotForRender,
                state: interactionState
            )
            .tag(1)

            // Page 2 — 音樂 (right). Reached via finger left-swipe.
            NowPlayingPlaceholderPage()
                .tag(2)
        }
        .tabViewStyle(.page)
        .navigationBarHidden(true)
    }

    // Phase A renders the mock when the passed-in snapshot is empty
    // (caller still wires WC plumbing but uses placeholder data);
    // when the caller passes real data we render that. This lets the
    // picker → start-from-watch flow drive real iPhone-supplied
    // exercises without changing the view contract.
    private var snapshotForRender: SessionSnapshot {
        if snapshot.exercises.isEmpty {
            return SetLoggerMockData.mockSnapshot()
        }
        return snapshot
    }
}

// MARK: - Page 1: Session card list (D11 main)

private struct SessionCardListPage: View {
    let snapshot: SessionSnapshot
    @ObservedObject var state: SessionInteractionState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // Session title (Phase A: read from snapshot).
                if !snapshot.title.isEmpty {
                    Text(snapshot.title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.top, 2)
                }

                // ExerciseCard list (continuous vertical scroll).
                ForEach(snapshot.exercises, id: \.sessionExerciseId) { ex in
                    ExerciseCard(exercise: ex, state: state)
                }

                // Trailing space — also catches "tap 框外" to dismiss
                // `{}` Active. Per spec line 1592: tap 框外 → Idle.
                Color.clear
                    .frame(height: 60)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        state.deactivate()
                    }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 12)
        }
    }
}

// MARK: - Page 0: 音樂 placeholder

private struct NowPlayingPlaceholderPage: View {
    var body: some View {
        VStack(alignment: .center, spacing: 8) {
            Spacer()
            Image(systemName: "music.note")
                .font(.title3)
                .foregroundStyle(.secondary)
            Text("音樂")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("(原生 NowPlaying — 後續接)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Page 2: 完成頁 placeholder

private struct FinishPagePlaceholder: View {
    let snapshot: SessionSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Session 完成？")
                .font(.headline)
            Text("(D14 完成頁 — 後續實作)")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Divider().padding(.vertical, 2)
            Text("session=\(String(snapshot.sessionId.prefix(8)))…")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("動作數：\(snapshot.exercises.count)")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Previews

#Preview("D11 Phase A — full") {
    SetLoggerView(snapshot: SetLoggerMockData.mockSnapshot())
}

#Preview("D11 Phase A — empty snapshot") {
    SetLoggerView(snapshot: SessionSnapshot(
        sessionId: "empty",
        title: "",
        startedAt: 0,
        exercises: []
    ))
}
