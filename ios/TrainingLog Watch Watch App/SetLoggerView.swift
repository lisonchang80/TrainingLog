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
        ZStack(alignment: .bottom) {
            // Page order per user 2026-05-28 polish + spec line 1483
            // 「完成頁（右滑進入）」:
            //   - "右滑" (finger slides right) reveals the page on the
            //     LEFT (lower tag) → 完成頁 must be the lowest tag.
            //   - Music is reached by the opposite swipe direction
            //     (finger slides left) → music is the highest tag.
            //   - Session card sits in the middle as the default landing.
            TabView(selection: $selectedPage) {
                // Page 0 — 完成頁 (left). Reached via finger right-swipe.
                // Per ADR-0019 § Slice 13d D14 spec (line 1809-1962).
                // Real WC end-session push + abort path deferred to
                // D7/D9 wire-in (channel #11); for now both callbacks
                // pop back to the session card list (page 1).
                FinishPageView(
                    snapshot: snapshotForRender,
                    onFinishComplete: { selectedPage = 1 },
                    onAbort: { selectedPage = 1 }
                )
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

            // Phase C `[]` Active cell-edit overlay. Sits on top of
            // the TabView; only renders when `state.activeCell != nil`.
            // Keypad slides up from bottom; crown shows a centered modal
            // with dim backdrop (per spec line 1422-1446).
            CellEditOverlay(state: interactionState)
        }
        .animation(.easeInOut(duration: 0.18), value: interactionState.activeCell)
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

    @AppStorage(InputMode.storageKey) private var inputModeRaw: String = InputMode.keypad.rawValue

    /// Crown rotation value mirrored back into `state.activeCell.buffer`
    /// when crown mode + a cell is `[]` Active. The `.digitalCrownRotation`
    /// modifier requires a non-optional Binding<Double>; we wire it
    /// to this @State, then propagate via `.onChange`.
    @State private var crownValue: Double = 0
    @FocusState private var crownFocused: Bool

    private var isInlineCrownActive: Bool {
        state.activeCell != nil && inputModeRaw == InputMode.crown.rawValue
    }

    private var crownStep: Double {
        guard let cell = state.activeCell else { return 1 }
        return cell.field == .weight ? 0.5 : 1
    }
    private var crownUpper: Double {
        guard let cell = state.activeCell else { return 100 }
        return cell.field == .weight ? 500 : 100
    }

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
                // `{}` Active OR commit `[]` Active (inline crown).
                // Per spec line 1592: tap 框外 → Idle.
                Color.clear
                    .frame(height: 60)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if state.activeCell != nil {
                            // Commit the in-flight cell edit (live for
                            // crown, latest buffer for keypad if user
                            // tapped outside instead of Done).
                            state.commitActiveCell()
                        } else {
                            state.deactivate()
                        }
                    }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 12)
        }
        // Inline crown input — only active when cell is `[]` Active AND
        // input mode is crown. Per user 2026-05-29 polish 4: «轉動表冠
        // 模式：重量或組的框變綠（Active）、表冠旋轉即轉換數字、不要
        // 跳出東西». No popup; the active cell's green border + live
        // displayValue do all the work.
        .focusable(isInlineCrownActive)
        .focused($crownFocused)
        .digitalCrownRotation(
            $crownValue,
            from: 0,
            through: crownUpper,
            by: crownStep,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onChange(of: state.activeCell) { _, newCell in
            // When a cell freshly enters `[]` Active in crown mode,
            // seed the crown value from the cell's buffer and grab focus.
            guard let cell = newCell, inputModeRaw == InputMode.crown.rawValue else {
                crownFocused = false
                return
            }
            crownValue = Double(cell.buffer) ?? 0
            // Defer focus to next runloop tick so SwiftUI has applied
            // the .focusable(...) change before we set @FocusState.
            DispatchQueue.main.async {
                crownFocused = true
            }
        }
        .onChange(of: crownValue) { _, newValue in
            // Mirror rotation back into the state buffer; displayValue
            // surfaces this live on the active cell.
            guard isInlineCrownActive else { return }
            state.updateActiveCellBuffer(formatCrownValue(newValue, field: state.activeCell?.field ?? .weight))
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
