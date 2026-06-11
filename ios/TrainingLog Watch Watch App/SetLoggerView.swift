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

    /// D29 — Watch live-mirror producer. Projects `snapshotForRender` over
    /// `interactionState` (logged ✓ + edited weight/reps) and pushes the
    /// merged `SessionSnapshot` to iPhone via
    /// `coordinator.updateLiveMirror` on a 15s debounce + dirty flag
    /// (Q6=a). Configured + driven in `.task` below; force-flushed on the
    /// [完成] keep-path (NOT on discard/abort). See LiveMirrorProducer.swift.
    @StateObject private var liveMirror = LiveMirrorProducer()

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
                    //   - `onAbort` — D31 wave 2 (2026-05-29 late) wire-in.
                    //     End local HK lifecycle, then fire discard-session
                    //     TUI envelope so iPhone hard-deletes the session
                    //     row (cascades sets / session_exercise /
                    //     achievement_unlock / edit-snapshot in one txn).
                    //     Distinct from onCommit's end-session: end-session
                    //     preserves the row in history, discard-session
                    //     deletes it. User explicit intent: "this session
                    //     never happened".
                    FinishPageView(
                        snapshot: snapshotForRender,
                        onCommit: {
                            let sid = snapshotForRender.sessionId
                            guard !sid.isEmpty else { return }
                            // D29 — flush the latest logged state to iPhone
                            // BEFORE the end-session signal, so end-session
                            // reconcile sees any sub-15s-window edits the
                            // throttled loop hasn't pushed yet. Keep-path
                            // ONLY — never on [放棄]/abort (a late mirror
                            // would re-create a row iPhone is hard-deleting).
                            liveMirror.emitFinal()
                            // E2 (Q1/Q2): carry the final authoritative tree
                            // so iPhone reconciles-by-membership (purges sets/
                            // exercises deleted on the Watch). Conflict-abort
                            // path (L~436) passes no snapshot → finalize-only.
                            let finalSnap = liveMirror.currentSnapshot()
                            Task {
                                await coordinator.sendEndToiPhone(
                                    sessionId: sid,
                                    finalSnapshot: finalSnap
                                )
                            }
                        },
                        // #312 — real HR/kcal tiles: read the live HK
                        // builder (still collecting while the finish
                        // page is visible; ends only after [完成]/[放棄]).
                        liveStats: { sessionController.liveWorkoutStats() },
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
                        onAbort: {
                            let sid = snapshotForRender.sessionId
                            Task {
                                // End local HK first (state machine
                                // .active → .ended with full
                                // stopActivity + endCollection + discard
                                // chain — see SessionController.swift
                                // 2026-05-29 late-evening fix).
                                await sessionController.end()
                                // Tell iPhone to delete the session row
                                // (silent no-op if iPhone never received
                                // the original start-from-watch yet —
                                // FIFO TUI guarantees start arrives first
                                // so iPhone ends up creating then deleting,
                                // not orphaning).
                                if !sid.isEmpty {
                                    coordinator.sendDiscardToiPhone(sessionId: sid)
                                }
                                // Pop the nav stack all the way back to
                                // PickerRootView (parity with the [完成]
                                // success path).
                                if let onSessionEnd {
                                    onSessionEnd()
                                } else {
                                    dismiss()
                                }
                            }
                        }
                    )
                    .tag(0)

                    // Page 1 — Session card list (D11 main, default landing).
                    SessionCardListPage(
                        snapshot: snapshotForRender,
                        state: interactionState,
                        // #311-A — build the 📊 history pull closure HERE (where
                        // the coordinator lives) and thread it down: the history
                        // sub-page opens inside a card's ⋯ `.sheet`, which does
                        // NOT inherit `@EnvironmentObject`, so capturing the
                        // coordinator in a closure is the way it reaches the view.
                        historyLoad: { exerciseId in
                            await coordinator.requestExerciseHistory(exerciseId: exerciseId)
                        }
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
            // 2026-05-29 late-evening polish — hide the auto-injected
            // "<" back chevron at top-leading of the nav bar. User
            // reported accidental taps on the back button during an
            // active SetLoggerView session (typically when reaching
            // up to scroll the card list). The session has explicit
            // termination paths ([完成] / [放棄] / iPhone-led end /
            // D31 conflict alert) — all of which call onSessionEnd /
            // dismiss() programmatically — so the back chevron is
            // pure UX hazard.
            .navigationBarBackButtonHidden(true)
            .toolbar {
                // Hide the ⚙ while a cell is in `[]` Active — the 2026-05-31
                // full-screen keypad owns the screen and the gear must not
                // peek over it (per user「不需要齒輪」). Crown mode hides it
                // too (harmless — you don't reach for settings mid-edit).
                if interactionState.activeCell == nil {
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
            // D29 — start the live-mirror producer. Separate .task so its
            // 15s poll loop runs concurrently with (and independently of)
            // the HK lifecycle .task above; both auto-cancel on unmount.
            // configure() binds the immutable base snapshot + the live
            // interaction overlay + the outbound coordinator; run() does
            // the initial full-tree push then the throttled loop.
            .task {
                liveMirror.configure(
                    base: snapshotForRender,
                    interaction: interactionState,
                    coordinator: coordinator
                )
                await liveMirror.run()
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
                    // D31 wave 2 iter 2 (2026-05-29 late, real-device
                    // smoke ❹(e) fix v2) — two-envelope sequence
                    // WITH explicit delay between them:
                    //   (1) start-resolve → iPhone's
                    //       `addUserInfoListener('discard-session')`
                    //       handler runs `discardSession` (SQL DELETE
                    //       cascade, ~50-200ms transaction).
                    //   (2) 800ms wait — long enough that iPhone's
                    //       discard txn definitely commits before
                    //       resend lands.
                    //   (3) start-from-watch (resend) → iPhone's
                    //       `addUserInfoListener('start-from-watch')`
                    //       handler runs `getActiveSession` → null
                    //       (A' gone) → INSERT B-W ✓.
                    //
                    // iter 1 (without delay) was insufficient — iPhone's
                    // two handlers ran concurrently; the resend's
                    // `getActiveSession` race read A' before discard's
                    // SQL commit landed → conflict reply again →
                    // INSERT never happened. Smoke ❹(e) still failed
                    // (Watch saved data but iPhone had no row).
                    //
                    // 800ms is generous on real device (iPhone 18.7.8
                    // SQLite single-row delete benches < 50ms). User
                    // doesn't perceive lag because alert dismisses
                    // immediately + Watch UI stays on the active
                    // SetLoggerView throughout.
                    let local = payload.localSessionId
                    let existing = payload.existingSessionId
                    coordinator.sendStartResolveToiPhone(
                        localSessionId: local,
                        existingSessionId: existing
                    )
                    conflictAlert = nil
                    Task {
                        try? await Task.sleep(nanoseconds: 800_000_000)
                        await MainActor.run {
                            coordinator.resendStartFromWatch()
                        }
                    }
                }
                Button("中止 Watch 保留 iPhone", role: .destructive) {
                    // 2026-05-29 late-evening real-device smoke fix —
                    // initial implementation called `sessionController.end()`
                    // directly inside the alert button's Task closure; on
                    // real device the HK active-workout icon stayed on
                    // after the alert dismissed (smoke path 1 step 1.4
                    // (3)(4) both ❌). Hypothesis: SwiftUI alert auto-
                    // dismiss interacts poorly with the Task's await
                    // suspension point inside the button closure (the
                    // `await sessionController.end()` resumes after the
                    // alert has torn down and may end up no-op'ing on
                    // a state-machine that races with the still-running
                    // `.task { sessionController.start() }`).
                    //
                    // Fix: route through `coordinator.sendEndToiPhone`,
                    // the SAME code path the [完成] button uses
                    // (FinishPageView.onCommit above). That path is
                    // validated by the D11 HK lifecycle smoke (2026-
                    // 05-29 evening: icon disappears + raise-wrist
                    // returns to watch face). Internally that helper
                    // does `await sessionController.end()` itself + an
                    // additional WC end-session envelope to iPhone with
                    // the local W- sessionId; iPhone's
                    // `finalizeEndAndRoute` for an unknown sessionId is
                    // a defensive no-op (the row was never created
                    // because of conflict), so the WC tail is a
                    // best-effort no-op rather than harmful.
                    let sid = payload.localSessionId
                    Task {
                        await coordinator.sendEndToiPhone(sessionId: sid)
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
    // 2026-05-29 late-evening real-device smoke fix —
    // Pre-fix: empty `snapshot.exercises` (e.g. user picked a
    // template with no 動作 yet) fell back to
    // `SetLoggerMockData.mockSnapshot()` which contains hardcoded
    //「推日（A）+ 深蹲」demo data. Same root-cause class as the
    // PickerViewModel.startFromWatch mock fallback (which is also
    // removed) — together they masked real empty-template state
    // behind misleading mock data. See PickerViewModel for the
    // 3-bug cascade detail.
    //
    // Now: render the snapshot verbatim. Empty exercises trigger
    // the「尚無動作 / 請至手機加動作」empty state in
    // SessionCardListPage below, matching the iPhone behavior
    // (which shows the same hint in the idle empty-session card).
    private var snapshotForRender: SessionSnapshot {
        return snapshot
    }
}

// MARK: - Page 1: Session card list (D11 main)

private struct SessionCardListPage: View {
    let snapshot: SessionSnapshot
    @ObservedObject var state: SessionInteractionState

    /// #311-A — 📊 history pull closure, threaded down to each card (see the
    /// instantiation in `SetLoggerView`). Cards forward it to `ExerciseHistoryView`.
    let historyLoad: ExerciseHistoryLoad

    /// 2026-06-01 — the Digital Crown now drives VERTICAL SCROLL of this
    /// ScrollView (its native behaviour) instead of editing numbers: weight/
    /// reps are keypad-only, which frees the crown to scroll the card list —
    /// including while a set is `{}` Active, where the highPriority horizontal
    /// swipe-reveal still claims left/right drags. The old
    /// `.digitalCrownRotation` cell-edit hijack + the keypad/crown input-mode
    /// toggle were removed (user 2026-06-01: 卷軸上下移動交給轉動表冠、重量
    /// 次數完全依靠鍵盤、齒輪取消切換鍵盤/轉動).
    ///
    /// Phase F: exercises the user hasn't deleted on the Watch. Drives
    /// both the empty-state branch and the card `ForEach` so a deleted
    /// card disappears immediately (and the shrunk tree is what the
    /// live-mirror projection pushes for the E2 end-session purge).
    private var visibleExercises: [SessionSnapshotExercise] {
        snapshot.exercises.filter { !state.isExerciseDeleted($0.sessionExerciseId) }
    }

    /// D15 — a rendered card is either a solo exercise or a superset PAIR.
    private enum CardUnit: Identifiable {
        case solo(SessionSnapshotExercise)
        case superset(a: SessionSnapshotExercise, b: SessionSnapshotExercise)
        var id: String {
            switch self {
            case .solo(let ex):
                return ex.sessionExerciseId
            case .superset(let a, let b):
                return "ss-\(a.sessionExerciseId)-\(b.sessionExerciseId)"
            }
        }
    }

    /// Fold the visible exercises into card units: two ADJACENT exercises that
    /// share the same non-nil `reusableSupersetId` become one superset card
    /// (a Reusable Superset is a fixed-2 entity exploded into consecutive rows,
    /// per ADR-0018). Grouping by RS id (not parent_id) needs no id remap — the
    /// id is a foreign key copied verbatim through the fat-tree build. A = the
    /// lower-`ordering` side. Everything else renders solo.
    private var cardUnits: [CardUnit] {
        let ex = visibleExercises
        var out: [CardUnit] = []
        var i = 0
        while i < ex.count {
            let cur = ex[i]
            if let rs = cur.reusableSupersetId, !rs.isEmpty,
               i + 1 < ex.count,
               ex[i + 1].reusableSupersetId == rs {
                let next = ex[i + 1]
                let a = cur.ordering <= next.ordering ? cur : next
                let b = cur.ordering <= next.ordering ? next : cur
                out.append(.superset(a: a, b: b))
                i += 2
            } else {
                out.append(.solo(cur))
                i += 1
            }
        }
        return out
    }

    var body: some View {
        // 2026-06-01 (build7): HR pane pinned ABOVE the scroll list in a VStack
        // — NOT `.safeAreaInset`, which interfered with `proxy.scrollTo` so the
        // auto-scroll landed on the exercise's FIRST row instead of the active
        // set. With the pane outside the ScrollView, scrollTo .top aligns the
        // active set to the ScrollView's top = just under the pane.
        VStack(spacing: 0) {
            HRFrozenPane()
            ScrollViewReader { proxy in
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

                // 2026-05-29 late-evening real-device smoke fix —
                // Empty state when user picks a template with no 動作.
                // Pre-fix: empty exercises array silently rendered as
                // an empty ScrollView (after the mock-fallback removal);
                // user had no signal what to do.
                if visibleExercises.isEmpty {
                    VStack(alignment: .center, spacing: 6) {
                        Image(systemName: "dumbbell")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                        Text("尚無動作")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("請至 iPhone 加動作")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                } else {
                    // Card list (continuous vertical scroll). Phase F: deleted
                    // exercises filtered out (visibleExercises). D15: adjacent
                    // same-RS pairs fold into one SupersetCard (see cardUnits).
                    ForEach(cardUnits) { unit in
                        switch unit {
                        case .solo(let ex):
                            ExerciseCard(exercise: ex, state: state, historyLoad: historyLoad)
                        case .superset(let a, let b):
                            SupersetCard(state: state, exerciseA: a, exerciseB: b, historyLoad: historyLoad)
                        }
                    }
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
            // Auto-scroll the freshly `{}` Active set to the top via a DEDICATED
            // per-row anchor (`anchor-<setId>`, placed in
            // ExerciseCard.setRowsSection) — a UNIQUE id that doesn't collide
            // with the ForEach id, so scrollTo reliably lands on the active row
            // (set-id targets hit the exercise's first row instead). Crown
            // scrolls the ScrollView natively (no `.digitalCrownRotation`).
            .onChange(of: state.activeSetId) { _, newId in
                guard let id = newId else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo("anchor-\(id)", anchor: .top)
                }
            }
            }
        }
    }
}

// MARK: - Frozen HR pane (reserved placeholder)

/// Pinned top strip on the session card page reserving space for the live
/// heart-rate readout (user 2026-06-01「HR 凍結窗格保留區」). Sits ABOVE the
/// ScrollView in a VStack so it stays put while the card list scrolls beneath
/// it, and a freshly-activated set auto-scrolls to just below it (build7 moved
/// it off `.safeAreaInset`, which had broken `proxy.scrollTo`).
///
/// Placeholder for now — HealthKitController doesn't publish a live HR value
/// yet (only auth status); the real value wires in with the D10 in-session
/// top bar (NEW-Q32 ♥/🔥 Row 2). Kept deliberately compact (~one row).
private struct HRFrozenPane: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "heart.fill")
                .font(.caption)
                .foregroundStyle(.red)
            Text("--")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.primary)
            Text("bpm")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Divider()
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
