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

    /// 2026-05-29 deep-night smoke polish (Issue 1 fix):
    /// When the session terminates (either Watch [完成] success or
    /// iPhone-led end-session via coordinator.$lastIncomingEnd),
    /// we want to pop ALL THE WAY back to PickerRootView root —
    /// not just one level (which is what `Environment.dismiss` does
    /// inside a NavigationStack; user observed "回到強度" sheet
    /// instead of root).
    ///
    /// Caller (PickerRootView) wires this to `path.removeAll()`.
    /// Optional with `nil` default for #Preview back-compat (preview
    /// instances mount outside a NavigationStack anyway).
    var onSessionEnd: (() -> Void)? = nil

    /// Center-page selection on initial mount. TabView selection
    /// is stored on the view so swipes naturally update it; pre-
    /// setting to 1 means the user lands on the session card list
    /// rather than on the music or finish page.
    @State private var selectedPage: Int = 1

    /// Phase B interaction state. Survives across page swipes —
    /// `{}` Active row + ✓ logged set IDs persist until view
    /// unmount. Per spec the state is per-session, not per-card.
    @StateObject private var interactionState = SessionInteractionState()

    /// D16 ⚙ settings sheet visibility.
    ///
    /// TODO: D10 in-session shell impl 時、搬到 top bar Row 2 最右
    /// (NEW-Q32 ⚙ icon)、移除這個 toolbar 暫位。
    /// Spec: ADR-0019 § D16 View 1 (line 2238-2252).
    @State private var showSettings: Bool = false

    /// 2026-05-29 deep-night smoke fix (Bug 3 + Bug 4 wire):
    ///   - Bug 3 — subscribe `coordinator.$lastIncomingEnd`; when iPhone
    ///     initiates session end the coordinator publishes the sessionId
    ///     and we pop the nav stack via `\.dismiss` if it matches ours.
    ///   - Bug 4 — FinishPageView's [完成] button now fires
    ///     `coordinator.sendEndToiPhone(sessionId:)` via the `onCommit`
    ///     closure injected below, then the success branch dismisses.
    /// Injected by ContentView via `.environmentObject(watchConn)`.
    @EnvironmentObject private var coordinator: WatchConnectivityCoordinator

    /// 2026-05-29 D11 HK lifecycle wire — needed so this view can call
    /// `sessionController.start()` in `.task` on mount (and the OS keeps
    /// the screen on / shows the active-workout indicator at the top of
    /// the watch face / lets the app keep running when wrist is lowered).
    /// `.end()` is fired from the coordinator's `sendEndToiPhone(...)`
    /// (Watch-led path) and the coordinator's `didReceiveMessage`
    /// end-session handler (iPhone-led path), so the body below
    /// intentionally does NOT call `.end()` directly — both end paths
    /// converge on the coordinator and the coordinator owns HK teardown.
    /// Injected by ContentView via `.environmentObject(session)`.
    @EnvironmentObject private var sessionController: SessionController

    /// Pops the NavigationStack back to PickerRootView. Used by both
    /// the iPhone-led end auto-dismiss path AND the Watch-led [完成]
    /// success path so SetLoggerView always unmounts cleanly after the
    /// session lifecycle terminates.
    @Environment(\.dismiss) private var dismiss

    /// D31 (2026-05-29 late) — conflict alert state cache.
    ///
    /// `coordinator.lastReconcile` is a published *event* (the latest
    /// reverse-TUI reply from iPhone); we mirror its `.conflict(...)`
    /// payload into a local @State so the alert presentation is driven
    /// by a stable identity. SwiftUI's `.alert(...presenting:)` needs
    /// a Hashable `item?` whose nil↔non-nil transition is the show/hide
    /// signal; we set it on `.onChange(of: lastReconcile)` and clear it
    /// when the user picks either button.
    ///
    /// Why not bind directly to `coordinator.lastReconcile` — `.created`
    /// + `.unparseable` cases must NOT show the alert; using a local
    /// @State lets us filter to `.conflict` only without leaking the
    /// other cases into the binding.
    @State private var conflictAlert: ConflictAlertState?

    var body: some View {
        // NEW-Q50 D29 smoke fix (2026-05-29): removed inner
        // `NavigationStack { ... }` wrapper. SetLoggerView is mounted as
        // a destination inside `PickerRootView`'s outer NavigationStack
        // (via `.navigationDestination(for: PickerDestination.self)`);
        // wrapping again with a second NavigationStack creates a
        // double-nested navigation context which watchOS handles poorly
        // — the inner stack's mere presence caused the OUTER stack to
        // immediately pop the destination on first appear (validated
        // on Apple Watch Ultra during D29 smoke). The `.toolbar` below
        // still works because it attaches to the ambient nav context
        // provided by the outer stack.
        //
        // D10 in-session shell will replace the toolbar + ⚙ TODO entry
        // with the proper top bar Row 2 layout — see TODO above.
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
                    //
                    // 2026-05-29 deep-night smoke fix (Bug 4 wire):
                    //   - `onCommit` — fires the moment user taps [完成],
                    //     synchronously hands off to coordinator.
                    //     `sendEndToiPhone(sessionId:)`. Fire-and-forget
                    //     (no await) — errors surface via
                    //     coordinator.lastOutbound for diagnostic only.
                    //   - `onFinishComplete` — invoked AFTER the 1.5s
                    //     spinner UX finishes; dismisses the nav stack so
                    //     user lands back on PickerRootView (parity with
                    //     iPhone-led end which uses the same `dismiss()`).
                    //   - `onAbort` — currently still cosmetic (pops back
                    //     to session card list page 1, no WC). Real abort
                    //     (DELETE session row + WC) ships with D31 abort
                    //     channel grill.
                    FinishPageView(
                        snapshot: snapshotForRender,
                        onCommit: {
                            let sid = snapshotForRender.sessionId
                            guard !sid.isEmpty else { return }
                            Task { await coordinator.sendEndToiPhone(sessionId: sid) }
                        },
                        onFinishComplete: {
                            // Issue 1 fix (Watch [完成] success path):
                            // prefer the parent-provided onSessionEnd
                            // closure (PickerRootView wires this to
                            // path.removeAll() — pops ALL the way back
                            // to picker root). Fall back to dismiss()
                            // only when no closure is provided (e.g.
                            // #Preview instances mounted outside a
                            // NavigationStack).
                            if let onSessionEnd {
                                onSessionEnd()
                            } else {
                                dismiss()
                            }
                        },
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

                // Phase C `[]` Active cell-edit overlay. Sits on top of
                // the TabView; only renders when `state.activeCell != nil`.
                // Keypad slides up from bottom; crown shows a centered modal
                // with dim backdrop (per spec line 1422-1446).
                CellEditOverlay(state: interactionState)
            }
            .animation(.easeInOut(duration: 0.18), value: interactionState.activeCell)
            // TODO: D10 — move this toolbar entry into top bar Row 2 最右
            // (NEW-Q32). Once D10 in-session shell lands, the ⚙ icon
            // belongs next to ♥/🔥 on Row 2, not as a nav-bar trailing
            // toolbar item. Remove this `.toolbar { ... }` block then.
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.body)
                    }
                    .accessibilityLabel("設定")
                }
            }
            .sheet(isPresented: $showSettings) {
                WatchSettingsView()
            }
            // 2026-05-29 deep-night smoke fix (Bug 3):
            // iPhone-initiated end-session arrives at the coordinator via
            // `didReceiveMessage`; coordinator publishes the sessionId on
            // `$lastIncomingEnd`. When the published id matches OUR
            // session, dismiss the nav stack so user pops back to
            // PickerRootView. Other sessions (e.g. stale broadcast for a
            // previous session) are ignored — guards against accidental
            // pops if the coordinator outlives the SetLogger mount.
            .onChange(of: coordinator.lastIncomingEnd) { _, newSid in
                guard let sid = newSid,
                      sid == snapshotForRender.sessionId else { return }
                // Issue 1 fix (iPhone-led end path): same logic as the
                // Watch [完成] success path above — pop all the way back
                // to picker root via the parent's path-reset closure.
                if let onSessionEnd {
                    onSessionEnd()
                } else {
                    dismiss()
                }
            }
            // 2026-05-29 D11 HK lifecycle wire — start the HKWorkoutSession
            // the moment SetLoggerView mounts. This is what unlocks:
            //   (1) screen stays on indefinitely (vs ~17s auto-sleep)
            //   (2) raise-wrist returns to TrainingLog (vs watch face)
            //   (3) "active workout" icon at the top of the watch face
            //   (4) app keeps running in background (not OS-suspended)
            // Idempotent: SessionController.start() guards on its state
            // machine (.idle/.ended/.failed → start; else no-op), so a
            // re-mount of the view during the same session is a safe
            // no-op. HK auth is requested inline on first start; if user
            // declined the iPhone Watch prompt, state transitions to
            // .failed and the behaviours above silently degrade — we do
            // NOT block the picker→set logger flow on auth (per ADR-0019
            // §Q22 Watch-side fallback).
            //
            // End-side wiring (intentionally not here): both end paths —
            // Watch-led (`coordinator.sendEndToiPhone(...)` invoked by
            // FinishPageView.onCommit above) and iPhone-led (coordinator
            // `didReceiveMessage(end-session)`) — route through the
            // coordinator which calls `sessionController.end()` itself.
            // See WatchConnectivityCoordinator.swift for both call sites.
            .task {
                await sessionController.start()
            }
            // D31 (2026-05-29 late) — conflict alert wire.
            //
            // When iPhone replies start-reconcile with `.conflict(...)`,
            // mirror the payload into local @State so the alert presents.
            // `.created` and `.unparseable` cases never set conflictAlert
            // — the alert stays nil and remains dismissed.
            .onChange(of: coordinator.lastReconcile) { _, newValue in
                guard case let .conflict(local, existing, title, startedAt) = newValue else {
                    return
                }
                conflictAlert = ConflictAlertState(
                    localSessionId: local,
                    existingSessionId: existing,
                    existingTitle: title,
                    existingStartedAt: startedAt
                )
            }
            // D31 conflict resolution sheet — non-dismissible (iOS HIG
            // .alert auto-includes no "X / swipe-to-close" affordance;
            // both buttons are explicit choices, no Cancel role). Per
            // NEW-Q50 Q5 / 2026-05-29 grill:
            //   - 「中止 Watch 保留 iPhone」 (.destructive) — abandon the
            //     local Watch session: end HKWorkoutSession + pop the
            //     nav stack back to picker so user can re-engage with
            //     the existing iPhone session (or whatever's next).
            //     No outbound — iPhone already has its row.
            //   - 「中止 iPhone 保留 Watch」 (.default) — fire start-resolve
            //     fire-and-forget TUI to iPhone so it discards the
            //     losing row; Watch continues training in this SetLogger.
            .alert(
                "iPhone 已有訓練中",
                isPresented: Binding(
                    get: { conflictAlert != nil },
                    set: { if !$0 { conflictAlert = nil } }
                ),
                presenting: conflictAlert
            ) { payload in
                Button("中止 iPhone 保留 Watch") {
                    coordinator.sendStartResolveToiPhone(
                        localSessionId: payload.localSessionId,
                        existingSessionId: payload.existingSessionId
                    )
                    conflictAlert = nil
                }
                Button("中止 Watch 保留 iPhone", role: .destructive) {
                    Task {
                        await sessionController.end()
                        conflictAlert = nil
                        if let onSessionEnd {
                            onSessionEnd()
                        } else {
                            dismiss()
                        }
                    }
                }
            } message: { payload in
                Text("「\(payload.existingTitle)」")
            }
    }

    // MARK: - D31 conflict alert state

    /// Hashable mirror of `StartReconcileResult.conflict(...)` so the
    /// SwiftUI `.alert(...presenting:)` modifier can drive presentation
    /// off a stable identity. Pulled out as a top-level struct rather
    /// than nested so the alert closures can reference it cleanly.
    private struct ConflictAlertState: Hashable {
        let localSessionId: String
        let existingSessionId: String
        let existingTitle: String
        let existingStartedAt: Int64
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
