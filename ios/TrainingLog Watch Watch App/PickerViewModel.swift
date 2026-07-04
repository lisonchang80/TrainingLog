//
//  PickerViewModel.swift
//  TrainingLog Watch
//
//  Slice 13d D8 — picker view-state owner.
//
//  Phase 1 (skeleton 73b2dfc): hardcoded mock data factories only.
//  Phase 2 (Path A minimal): coordinator integration + Stage 1
//  handshake wire — templates only.
//  Phase 2.5 (this commit): Stage 1 reply extension landed —
//  programs + per-program intensities + today's planned-day now
//  flow from the iPhone-side `loadProgramsPrefetchList` /
//  `loadTodayPlanned` builders. The hardcoded mock paths
//  (mockDefault / mockRestDay / mockNoProgram / mockNoTemplates /
//  mockAllEmpty) survive intact for `#Preview` invocations only.
//  See ADR-0019 NEW-Q44 for the staged-extension rationale.
//
//  Why @MainActor: SwiftUI views observe @Published mutations on the
//  main thread; the WC reply handler hops to MainActor before
//  mutating, same pattern as WatchConnectivityCoordinator.
//
//  Mock factories survive intact for `#Preview` invocations — they
//  bypass the coordinator and inject canned data directly.
//

import Foundation
import Combine

@MainActor
final class PickerViewModel: ObservableObject {

    /// Today's planned-row state.
    @Published var todayPlanned: TodayPlanned

    /// Templates list — populated from Stage 1 reply after handshake.
    /// Empty array → "請在手機創建模板" empty state.
    @Published var templates: [TemplateOption]

    /// Active programs the user can pick from in the 計劃 sheet.
    /// Phase 2.5 (this commit): populated from the Stage 1 reply's
    /// `prefetch.programs` field (which carries inline intensities per
    /// program). Older iPhone builds that don't send the field → init
    /// value (caller-provided mock OR empty `[]`) survives.
    @Published var programs: [ProgramOption]

    /// True while a handshake round-trip is in flight (cold bootstrap
    /// OR 🔄 refresh tap). Drives the toolbar icon's spin animation.
    @Published var isRefreshing: Bool = false

    // MARK: - Start-from-watch state (Phase 3)

    /// True while a start-from-watch round-trip is in flight. The
    /// Phase 3 placeholder view uses this to render a "creating
    /// session…" indicator.
    @Published var isStartingSession: Bool = false

    /// Result of the most recent `startFromWatch(...)` call. Cleared
    /// each time the picker root reappears (`resetSelection`).
    /// Cases:
    ///   - nil: no attempt yet
    ///   - .some(nil): WC transport failure (no reply / framework err)
    ///   - .some(reply) with isOK=true: iPhone created the session
    ///   - .some(reply) with isOK=false: iPhone replied, couldn't create
    @Published var startResult: StartFromWatchReply??

    /// Stage1 prefetch v3 (2026-06-13 Y-dup) — true when the most recent
    /// `startFromWatch` resolved a template selection whose (program,
    /// intensity) combo matched NO variant in the name group, so it fell
    /// back to the representative (newest) template. Mirrors iPhone's
    /// `planResolveTarget` fallback_with_alert. False for an exact match
    /// OR a back-compat payload with no variants at all (that's normal,
    /// not a user-facing miss). Cleared in `resetSelection`.
    @Published var lastResolveMissed: Bool = false

    // MARK: - App mode (slice 16 / ADR-0026 D2)

    /// True when the iPhone is in 極簡模式（`appMode == "minimal"`). Set
    /// from `reply.prefetch.appMode` in `applyStage1Reply`. When true,
    /// `PickerRootView` hides the 「計劃訓練」section and a template-row
    /// tap goes STRAIGHT into the set logger as 通用 (program=nil,
    /// intensity=nil) — skipping both ProgramPickerSheet and
    /// IntensityPickerSheet. Defaults to `false` (計劃模式 = today's full
    /// behaviour) so a pre-slice-16 iPhone payload (appMode key absent →
    /// nil) keeps the plan flow.
    @Published var isMinimal: Bool = false

    // MARK: - 3-tuple navigation state

    @Published var selectedTemplate: TemplateOption?
    @Published var selectedProgram: ProgramOption?
    @Published var selectedIntensity: IntensityOption?

    // MARK: - Coordinator dependency

    /// WC coordinator used to send `handshake` outbound. Weak to break
    /// the retain cycle (ContentView holds the coordinator strongly
    /// via @StateObject; VM is owned by PickerRootView's @StateObject
    /// which is held by the picker NavigationStack — without weak the
    /// coordinator would never deinit even if the picker tree is
    /// unmounted).
    ///
    /// Nil ⇔ Preview / unit-test mode → `refresh()` falls back to a
    /// 0.5s fake spin without touching WC.
    private weak var coordinator: WatchConnectivityCoordinator?

    /// True after the first cold-launch handshake has run (regardless
    /// of success). Used by `bootstrap()` to make it idempotent so
    /// `.task` doesn't re-fire on every onAppear.
    private var hasBootstrapped: Bool = false

    // MARK: - Inits

    /// Production init: takes a coordinator. Starts in an empty state
    /// — caller invokes `bootstrap()` after mount to populate via
    /// handshake.
    init(coordinator: WatchConnectivityCoordinator) {
        self.coordinator = coordinator
        self.todayPlanned = .noActiveProgram
        self.templates = []
        self.programs = []
    }

    /// Mock init: bypasses coordinator. Used by `#Preview` factories.
    init(
        todayPlanned: TodayPlanned,
        templates: [TemplateOption],
        programs: [ProgramOption]
    ) {
        self.coordinator = nil
        self.todayPlanned = todayPlanned
        self.templates = templates
        self.programs = programs
    }

    // MARK: - Lifecycle

    /// Idempotent cold-launch entry point. Called from
    /// `PickerRootView.task { … }` so the first handshake fires on
    /// initial appear; subsequent appears are no-ops.
    ///
    /// `.task` cancels on view disappear, so the in-flight handshake
    /// will be cancelled if the user dismisses the picker mid-trip.
    /// The coordinator's `withCheckedContinuation` doesn't observe
    /// cancellation by itself; the never-hang guarantee is the
    /// coordinator's explicit 6s watchdog + `WCReplyOnce` resume-once
    /// box (NOT a WC framework timeout — device-falsified 2026-06-11:
    /// `errorHandler` only covers delivery failure, so against a
    /// killed-but-still-"reachable" iPhone app NEITHER closure fires;
    /// see `requestHandshake` and skill `wc-add-envelope-kind`).
    func bootstrap() async {
        guard !hasBootstrapped else { return }
        hasBootstrapped = true
        guard let coordinator else {
            // Preview / no-coordinator — mirror refresh()'s cosmetic spin.
            try? await Task.sleep(nanoseconds: 500_000_000)
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }
        // Cold-start RETRY (2026-06-28). On a Watch reopen the WCSession isn't
        // `.activated` and the iPhone isn't `isReachable` yet at this first
        // `.task` tick, so `requestHandshake` self-skips → returns nil → the
        // iPhone never gets the handshake → never RE-CASTS its active session →
        // the Watch sits on the picker until the user taps 🔄. Those two guards
        // return INSTANTLY while not-ready, so retry until the handshake actually
        // lands (a successful reply means the iPhone also fired its re-cast in the
        // same listener → the cast arrives → PickerRootView auto-routes into the
        // session). Bounded; once it succeeds we stop (one re-cast only). A truly
        // asleep iPhone exhausts the budget → picker stays, 🔄 still available.
        for _ in 0..<8 {
            if let reply = await coordinator.requestHandshake() {
                applyStage1Reply(reply)
                return
            }
            try? await Task.sleep(nanoseconds: 400_000_000) // 0.4s between tries
        }
    }

    /// Force a fresh handshake regardless of `hasBootstrapped` state.
    /// Wired to the 🔄 toolbar button. Failures (no coordinator, no
    /// reply, decode fail) silently leave existing data in place —
    /// the spinning animation provides the only user-visible signal.
    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        // Preview / no-coordinator path: cosmetic 0.5s spin only.
        guard let coordinator else {
            try? await Task.sleep(nanoseconds: 500_000_000)
            return
        }

        if let reply = await coordinator.requestHandshake() {
            applyStage1Reply(reply)
        }
    }

    // MARK: - Stage 1 reply application

    /// Map Stage 1 reply onto view state. Phase 2 wired only
    /// `templates`; Phase 2.5 (this commit) extends to `programs` +
    /// `todayPlanned` from the iPhone-side `loadProgramsPrefetchList`
    /// + `loadTodayPlanned` builders (`src/adapters/watch/handshake.ts`).
    ///
    /// Optional-field semantics:
    ///   - `reply.prefetch.programs == nil` (older iPhone build) →
    ///     leave existing `self.programs` in place (init value = `[]`,
    ///     or whatever the caller's mock factory seeded).
    ///   - `reply.prefetch.todayPlanned == nil` (older iPhone build) →
    ///     leave existing `self.todayPlanned` in place.
    ///   - Both fields populated → overwrite verbatim.
    func applyStage1Reply(_ reply: Stage1Reply) {
        // NEW-Q50 D29 — propagate fat-tree exercises into TemplateOption
        // so the tap path can build a SessionSnapshot offline (without
        // a second round-trip).
        templates = reply.prefetch.templates.map { summary in
            TemplateOption(
                id: summary.templateId,
                name: summary.name,
                exercises: summary.exercises,
                // Stage1 prefetch v3 (2026-06-13 Y-dup) — carry the name
                // group's variants so the tap path resolves the concrete
                // (program, intensity) variant before building the snapshot.
                variants: summary.variants
            )
        }
        // Phase 2.5 — programs with inline intensities.
        if let programDTOs = reply.prefetch.programs {
            programs = programDTOs.map { p in
                ProgramOption(
                    id: p.id,
                    name: p.name,
                    intensities: p.intensities.map { i in
                        IntensityOption(id: i.id, name: i.name)
                    }
                )
            }
        }
        // Phase 2.5 + NEW-Q50 D29 — today's planned-day, now with
        // templateId + exercises fat-tree for offline snapshot build.
        if let plannedDTO = reply.prefetch.todayPlanned {
            switch plannedDTO {
            case let .planned(label, templateName, programName, intensity, programDayId, templateId, exercises):
                todayPlanned = .planned(
                    label: label,
                    templateName: templateName,
                    programName: programName,
                    intensity: intensity,
                    programDayId: programDayId,
                    templateId: templateId,
                    exercises: exercises
                )
            case .restDay:
                todayPlanned = .restDay
            case .noActiveProgram:
                todayPlanned = .noActiveProgram
            }
        }
        // Slice 16 / ADR-0026 D2 — app-wide mode. Tolerant: the field is
        // optional on the wire; a pre-slice-16 iPhone omits it (nil) →
        // treat as "plan" (isMinimal = false = today's full behaviour).
        // Only the exact string "minimal" flips us into 極簡模式.
        isMinimal = reply.prefetch.appMode == "minimal"
        // NB: reply.hasActiveSession is intentionally ignored in
        // Phase 2. Phase 3 will branch here to auto-adopt the
        // iPhone-initiated session (skip picker → jump to set logger).
        // Until D11 is built, there's no set logger to jump to.
    }

    // MARK: - Start-from-watch (Phase 3)

    /// NEW-Q50 D29 — Watch standalone offline-first start.
    ///
    /// Pre-Q50 model (D8 P3): await iPhone's reply via sendMessage,
    /// requires `isReachable=true` (iPhone foregrounded). On failure
    /// Watch showed 「傳輸失敗 (iPhone 未配對)」 red screen.
    ///
    /// New model (this commit): Watch mints its own sessionId locally,
    /// transitions to SetLogger IMMEDIATELY (no await), then fires
    /// `start-from-watch` envelope to iPhone via `transferUserInfo`
    /// (queued by iOS — survives iPhone background / kill / out-of-
    /// range). iPhone's `onStartFromWatch` orchestrator INSERT OR IGNORE
    /// keyed on sessionId (per Q5 first-write-wins).
    ///
    /// iPhone confirms (or surfaces conflict) via a reverse-TUI
    /// `start-reconcile` envelope; coordinator.$lastReconcile receives
    /// it. D31 will subscribe + show conflict UI; D29/D30 just publish
    /// for diagnostic.
    ///
    /// Snapshot population: D29 uses `SetLoggerMockData.mockSnapshot()`
    /// as a placeholder. Real exercise data (from template fat-tree
    /// or appContext mirror) lands in D32.
    ///
    /// HK lifecycle: NOT touched here per D11 ownership boundary.
    func startFromWatch(selection: PickerSelection) async {
        isStartingSession = true
        defer { isStartingSession = false }

        // Mint local sessionId. Convention per ADR-0019 NEW-Q50: `W-`
        // prefix marks Watch-originated; 8-char base32-ish suffix from
        // the leading hex of a UUID for compactness in debug logs.
        let uuid = UUID().uuidString
        let suffix = uuid
            .replacingOccurrences(of: "-", with: "")
            .prefix(12)
            .lowercased()
        let localSessionId = "W-\(suffix)"

        // NEW-Q50 D29 (extended) — build local SessionSnapshot from
        // the fat-tree exercises carried in Stage1Reply. Two source
        // paths:
        //   • Template tap path  → selection.template.exercises
        //   • Planned-row path   → todayPlanned.planned.exercises
        //                          (selection is all-nil per
        //                          PickerRootView.planSection convention)
        //
        // Falls back to SetLoggerMockData.mockSnapshot() when neither
        // source has exercises (pre-Q50 iPhone payload OR genuinely
        // empty template) so SetLoggerView still mounts.
        // Freshness at start (2026-07-04 device-bug) — the tap path below
        // builds the snapshot from the prefetch cached at the LAST handshake
        // / 🔄 (`bootstrap` is once-only: `guard !hasBootstrapped`). An iPhone
        // template edit made AFTER that cache (e.g. change rest 90→120, then
        // immediately start on the wrist) is invisible → the Watch session
        // used a STALE rest/reps/weight while the phone was correct (phone
        // reads the DB fresh at start via sessionFromTemplate). Do ONE fresh
        // handshake here so EVERY template field (rest_sec + reps + weight +
        // sets) reflects the latest edit — the same start-time data path as
        // all the other info, just made current. `isStartingSession` is
        // already true so the 過場頁 syncing view covers this await. On an
        // unreachable/asleep iPhone `requestHandshake` self-skips → nil → we
        // fall through on the cached prefetch (offline-first tap preserved).
        if let coordinator, let reply = await coordinator.requestHandshake() {
            applyStage1Reply(reply)
        }
        let (resolvedTitle, resolvedSubtitle, resolvedExercises, resolvedTemplateId, missed) = resolveSelectionExercises(selection)
        // Stage1 prefetch v3 (2026-06-13 Y-dup) — surface a one-line
        // 過場頁 notice when the (program, intensity) combo had no variant
        // and we fell back to the representative (mirrors iPhone A1
        // alert-and-proceed). Consumed by PickerSetLoggerPlaceholderView.
        //
        // ADR-0026 D3 (slice 16) — 極簡模式靜音 resolve-miss 提示，鏡像
        // iPhone（app/(tabs)/index.tsx onStartMinimalTemplate 丟掉
        // resolved.alert）。代換解析本身（representative fallback）照常發生
        // ——僅靜音「通知」：清掉 lastResolveMissed → 過場頁不顯示橘色 ⚠。
        // 注意：極簡 tap 命中 strict 通用 (NULL,NULL) variant，並不會走
        // representative short-circuit（不重蹈 #48）。
        let noticeMissed = missed && !isMinimal
        lastResolveMissed = noticeMissed
        // Grill Q2=A — on a resolve MISS, hold the transitional 過場頁
        // ~1.5s so the user actually SEES the "no matching variant, using
        // newest" notice before we drop into the set logger. The
        // offline-first happy path has no await below, so isStartingSession
        // flips true→false synchronously and the 過場頁 normally renders
        // for ~0ms; this await is the ONLY thing that lets syncingView
        // paint. Skipped entirely on a match → match path stays instant.
        // ADR-0026 D3 — 極簡模式無提示可看 → 不 hold（保持 instant）。
        if noticeMissed {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
        }
        // 2026-05-29 late-evening real-device smoke fix —
        // Pre-fix: empty exercises (user picked a template with no
        // 動作 yet, OR a fat-tree wire that hadn't landed) fell back
        // to `SetLoggerMockData.mockSnapshot()` which contains the
        // hardcoded「推日（A）+ 深蹲」demo data. Three bugs cascade:
        //   (1) Watch title shows「推日（A）」for an empty template C
        //   (2) sessionId is the mock's hardcoded value, not our
        //       locally-minted W- id → iPhone end-session handler
        //       can't match → 同步結束 broken
        //   (3) iPhone-side template edits don't reflect on Watch
        //       (cached mock + sessionId mismatch永遠 sync 不上)
        //
        // Fix: build the snapshot with REAL title + sessionId + an
        // empty exercises array. SetLoggerView's empty state renders
        //「無動作 / 請至手機加動作」(see SessionCardListPage below).
        // FinishPage still works — sets count is 0/0, [完成] still
        // ends the iPhone-side session correctly because sessionId
        // matches the localW- id iPhone INSERT OR IGNORE'd.
        let snapshot = buildSnapshotFromFatTree(
            sessionId: localSessionId,
            title: resolvedTitle,
            subtitle: resolvedSubtitle,
            exercises: resolvedExercises
        )
        let localReply = StartFromWatchReply(
            sessionId: localSessionId,
            snapshot: snapshot
        )
        startResult = .some(localReply)

        // Preview / no-coordinator path: stop here — no WC to send.
        guard let coordinator else { return }

        // Fire-and-forget to iPhone. transferUserInfo queues even if
        // iPhone is unreachable; iOS handles persistence + retry.
        // No `await` — we already transitioned UI above.
        //
        // For planned-row path: templateId comes from
        // todayPlanned.planned.templateId so iPhone-side reconcile can
        // build a matching session_exercise tree from the same source.
        //
        // Stage1 prefetch v3 (2026-06-13 Y-dup) — send `resolvedTemplateId`
        // (the variant resolveVariant picked), NOT `selection.template?.id`
        // (which is the name-group REPRESENTATIVE). This is the whole
        // point of the fix: iPhone opens the session from the same variant
        // the Watch built its snapshot from, so the in-session 副標題 +
        // tree + live-mirror all line up.
        // Phase C-id (2026-07-05) — ship the session_exercise / set ids the
        // Watch just minted so the iPhone adopts them verbatim. Position-
        // aligned to `ordering ASC` / `position ASC` (the order the snapshot
        // was built in AND the order iPhone's startSessionFromTemplate walks).
        // Derived from the SAME snapshot the Watch renders → guaranteed
        // consistent with what the user sees. Absent (freestyle / no exercises)
        // is harmless: an empty tree makes the iPhone mint its own ids.
        let idTree: [String: Any] = [
            "seIds": snapshot.exercises.map { $0.sessionExerciseId },
            "setIds": snapshot.exercises.map { ex in ex.sets.map { $0.setId } },
        ]
        coordinator.sendStartFromWatchTUI(
            sessionId: localSessionId,
            templateId: resolvedTemplateId,
            programCycleId: selection.program?.id,
            intensityId: selection.intensity?.id,
            idTree: idTree
        )
    }

    // MARK: - NEW-Q50 D29 — Fat-tree → SessionSnapshot

    /// Resolve which fat-tree exercises + title + templateId to use
    /// based on the selection state. Returns empty exercises when no
    /// source matches (pre-Q50 fallback path).
    ///
    /// Tuple shape: (title, exercises, templateIdForWire, missed).
    /// `missed` is true only when a template selection's (program,
    /// intensity) combo matched no variant in the name group and fell
    /// back to the representative — surfaced to the user (Q2).
    private func resolveSelectionExercises(_ selection: PickerSelection)
        -> (title: String, subtitle: String?, exercises: [Stage1TemplateExerciseDTO], templateId: String?, missed: Bool)
    {
        // Template-tap path — template was selected via the 模板訓練
        // section row, possibly drilled through 計劃 + 強度 sheets.
        //
        // 2026-05-29 late-evening polish — bake the full 3-tuple into
        // the title ("模板 · 計劃 · 強度") so FinishPageView's subtitle
        // shows the real selection instead of the D14 hardcoded
        // placeholder "· Linear W3 · 中度日". Fall back to "通用" when
        // program / intensity are nil (user picked the 通用 row in the
        // 計劃 / 強度 sheets — bypass means no specific cycle/intensity).
        if let selectedTemplate = selection.template {
            // Freshness (2026-07-04) — `startFromWatch` re-handshakes before
            // calling us, so prefer the freshly-loaded template from
            // `self.templates` (matched by its stable id) over the selection's
            // captured copy → a just-saved iPhone edit (rest_sec / reps /
            // weight / sets, carried on the fat tree) is honoured. Fall back
            // to the captured copy if the id vanished from the refreshed list
            // (template deleted between fetch and start).
            let template = templates.first { $0.id == selectedTemplate.id } ?? selectedTemplate
            let programName = selection.program?.name ?? "通用"
            let intensityName = selection.intensity?.name ?? "通用"
            // Q3=a — title always reflects the USER's selected (program,
            // intensity), even on a fallback miss (it represents intent;
            // the resolved variant's own triple may differ).
            //
            // 2026-06-26 Goal 2d — split the old single「模板 · 計劃 · 強度」title
            // into TWO fields: line 1 = the template name (= the editable session
            // title, matches iPhone session.title), line 2 = the immutable identity
            // badge. The Watch has no editor so both stay read-only on the wrist.
            //
            // ADR-0026 D1 (slice 16) — 極簡模式整個「計劃」概念在 UI 消失，
            // program / intensity 必為 nil → 不組第二行（subtitle = nil 即隱藏），
            // 與極簡模式各處藏「計劃·強度」一致。FinishPageView 副標題 fallback 回
            // title；過場頁 selectionSubtitle 自行重建、與此處無關。
            let title = template.name
            let subtitle: String? = isMinimal
                ? nil
                : "\(template.name) · \(programName) · \(intensityName)"
            // Stage1 prefetch v3 (2026-06-13 Y-dup) — resolve the concrete
            // variant from the user's (program, intensity) so the snapshot
            // tree AND the wire templateId come from the SAME variant.
            // Two-end same-source tree is the precondition for
            // replaceLiveMirror's exercise_id+occurrence natural key
            // (mismatched source → Bug X parallel-row corruption).
            let resolved = resolveVariant(
                template: template,
                program: selection.program,
                intensity: selection.intensity
            )
            return (title, subtitle, resolved.exercises, resolved.templateId, resolved.missed)
        }
        // Planned-row path — selection is all-nil per PickerRootView's
        // planSection planned-case (the program-day already carries the
        // 3-tuple from iPhone). Pull exercises from todayPlanned. The
        // planned label is typically already a meaningful display string
        // (e.g. "推日 W3D1（今日）") so we don't synthesize a 3-tuple.
        if case .planned(_, _, _, _, _, let templateId, let exercises) = todayPlanned, !exercises.isEmpty {
            let label = plannedLabel ?? "今日訓練"
            // Planned label is already a meaningful display string (e.g.
            // "推日 W3D1（今日）") — no separate 3-tuple second line.
            return (label, nil, exercises, templateId.isEmpty ? nil : templateId, false)
        }
        return ("自由訓練", nil, [], nil, false)
    }

    /// Stage1 prefetch v3 (2026-06-13 Y-dup) — resolve the concrete
    /// template variant the user picked, mirroring iPhone's
    /// `planResolveTarget` (src/domain/template/resolveTargetTemplate.ts).
    ///
    /// The picker row is now ONE entry per template NAME (Y-dup fix); the
    /// user's (program, intensity) selection picks which variant in the
    /// `template.variants` group to actually start.
    ///
    /// Matching is STRICT and id-based:
    ///   • `program == nil` (通用) matches ONLY a variant whose
    ///     `programId == nil` (NULL column) — NOT a wildcard, and NOT a
    ///     "通用 → representative" short-circuit (that was iPhone bug #48,
    ///     grill Q6). Same for `intensity == nil` ↔ `subTag == nil` (Q7).
    ///   • id-based, never name-based → a rename between handshake and
    ///     start can't break resolution (grill Q10).
    ///
    /// Returns (templateId, exercises, missed):
    ///   • match → that variant's id + its tree (representative omits its
    ///     tree on the wire for 64 KB dedup → nil ⇒ use the group tree).
    ///   • no variants at all (pre-v3 payload, Q12) → representative,
    ///     `missed = false` (normal back-compat, not a user-facing miss).
    ///   • variants present but none match → representative fallback,
    ///     `missed = true` (mirrors iPhone fallback_with_alert; caller
    ///     surfaces a one-line 過場頁 notice).
    private func resolveVariant(
        template: TemplateOption,
        program: ProgramOption?,
        intensity: IntensityOption?
    ) -> (templateId: String, exercises: [Stage1TemplateExerciseDTO], missed: Bool) {
        // No variants on the wire (older iPhone build) → use the
        // representative exactly as before. Not a user-facing miss.
        guard !template.variants.isEmpty else {
            return (template.id, template.exercises, false)
        }
        let wantedProgram = program?.id   // nil = 通用 → matches NULL programId
        let wantedSubTag = intensity?.id  // nil = 通用 → matches NULL subTag
        if let variant = template.variants.first(where: {
            $0.programId == wantedProgram && $0.subTag == wantedSubTag
        }) {
            // Representative (variants[0]) omits its tree on the wire
            // (dedup): nil exercises ⇒ use the group's top-level tree.
            let tree = variant.exercises ?? template.exercises
            return (variant.templateId, tree, false)
        }
        // Variants present but the user's (program, intensity) combo has
        // none → representative fallback + user-facing miss notice.
        return (template.id, template.exercises, true)
    }

    /// Convenience accessor for the planned label string (when
    /// todayPlanned is .planned). Returns nil for restDay /
    /// noActiveProgram.
    private var plannedLabel: String? {
        if case .planned(let label, _, _, _, _, _, _) = todayPlanned {
            return label
        }
        return nil
    }

    /// Build a SessionSnapshot from a fat-tree exercise list.
    /// Per Stage1TemplateExercise → SessionSnapshotExercise:
    ///   • sessionExerciseId — synthesised as `SE-<index>` for local
    ///     use; iPhone-side reconcile will own the real persisted ID.
    ///   • plannedSets / sets — two paths depending on whether the
    ///     fat-tree wire carried per-row `template_set` data:
    ///       - **Preferred (post 2026-05-29 SetLogger sets[] fix):**
    ///         when `ex.sets.count > 0`, use those rows verbatim
    ///         (per-set weight/reps/setKind). plannedSets =
    ///         `ex.sets.count` so the SetLoggerView shows the real
    ///         planned row count, not the deprecated `default_sets`
    ///         summary.
    ///       - **Fallback (back-compat):** when `ex.sets.isEmpty`
    ///         (older iPhone payload, or template_exercise truly has
    ///         no template_set rows), use the legacy default_*
    ///         summary to pre-populate `defaultSets` empty rows —
    ///         same shape as pre-fix behaviour, which renders
    ///         "— kg / 0 次" if defaults are null.
    ///
    /// startedAt = current epoch ms.
    private func buildSnapshotFromFatTree(
        sessionId: String,
        title: String,
        subtitle: String?,
        exercises: [Stage1TemplateExerciseDTO]
    ) -> SessionSnapshot {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let snapshotExercises: [SessionSnapshotExercise] = exercises.map { ex in
            let snapshotSets: [SessionSnapshotSet]
            let plannedCount: Int
            if !ex.sets.isEmpty {
                // Preferred path — fat-tree carried template_set rows.
                snapshotSets = ex.sets.enumerated().map { (setIdx, s) in
                    SessionSnapshotSet(
                        // Phase C-id (2026-07-05) — mint a REAL uuid per set so
                        // the iPhone can adopt it verbatim (both devices share
                        // ids from the first frame → the reverse mirror matches
                        // by id even for template starts). The idTree the VM
                        // ships alongside is derived from these same ids in wire
                        // order (position ASC); `setIdx + 1` is the display
                        // ordinal (loader ORDER BYs position ASC).
                        setId: UUID().uuidString,
                        ordinal: setIdx + 1,
                        // Pass `weightKg` / `reps` through verbatim;
                        // a literal `0` from the v009 migration is
                        // surfaced as a real 0 (user can fix in the
                        // template editor on iPhone).
                        weight: s.weightKg,
                        reps: s.reps,
                        rpe: nil,
                        // Per-exercise rest (2026-07-03) — denormalised onto every
                        // set so a Watch-LED session's rest timer uses the template's
                        // rest_seconds (nil → the timer's 60s default).
                        restSec: ex.restSec,
                        notes: nil,
                        setKind: s.setKind,
                        isLogged: false
                    )
                }
                plannedCount = ex.sets.count
            } else {
                // Fallback — legacy default_* path. Same shape as
                // pre-2026-05-29 behaviour: pre-populate
                // `defaultSets` empty rows; weight/reps may be nil.
                snapshotSets = (0..<max(1, ex.defaultSets)).map { setIdx in
                    SessionSnapshotSet(
                        // Phase C-id — real uuid (see the preferred path above).
                        setId: UUID().uuidString,
                        ordinal: setIdx + 1,
                        weight: ex.defaultWeightKg,
                        reps: ex.defaultReps,
                        rpe: nil,
                        // Per-exercise rest (2026-07-03) — denormalised onto every
                        // set so a Watch-LED session's rest timer uses the template's
                        // rest_seconds (nil → the timer's 60s default).
                        restSec: ex.restSec,
                        notes: nil,
                        setKind: "working",
                        isLogged: false
                    )
                }
                plannedCount = ex.defaultSets
            }
            return SessionSnapshotExercise(
                // Phase C-id — real uuid so the iPhone adopts the
                // session_exercise id verbatim (position-aligned via idTree).
                sessionExerciseId: UUID().uuidString,
                exerciseId: ex.exerciseId,
                exerciseName: ex.exerciseName,
                ordering: ex.ordering,
                plannedSets: plannedCount,
                sets: snapshotSets,
                // D15 superset card — carry the RS id so SetLoggerView can fold
                // an adjacent same-RS pair into one card. `parentId` stays nil:
                // the template's parent_id points at a template_exercise id that
                // doesn't map to the freshly minted `SE-…` id, and grouping uses
                // `reusableSupersetId` + `ordering`, so no remap is needed.
                parentId: nil,
                reusableSupersetId: ex.reusableSupersetId,
                // Per-exercise rest (2026-07-04 device-bug真修) — thread the
                // template's rest onto the EXERCISE too, not just each set. The
                // ⋯選單「休息秒數」editor reads `exercise.restSec` (ExerciseCard
                // onEditRest); leaving it nil made the keypad pre-fill the 60s
                // default even though the rest TIMER (which reads per-set
                // `set.restSec`) was already correct. `SessionSnapshotExercise.
                // init` defaults restSec to nil, so this call site had silently
                // dropped it since the fat-tree path was written.
                restSec: ex.restSec
            )
        }
        return SessionSnapshot(
            sessionId: sessionId,
            title: title,
            subtitle: subtitle,
            startedAt: nowMs,
            exercises: snapshotExercises
        )
    }

    // MARK: - Selection helpers

    /// Reset 3-tuple slots when user leaves the drill-down. Also
    /// clears any prior start-from-watch result.
    func resetSelection() {
        selectedTemplate = nil
        selectedProgram = nil
        selectedIntensity = nil
        startResult = nil
        isStartingSession = false
        lastResolveMissed = false
    }

    /// Convenience for "user picked today's planned row".
    func selectTodayPlanned() {
        resetSelection()
    }
}

// MARK: - Mock factories (Preview only)

extension PickerViewModel {

    /// Both sections populated. Same shape as Phase 1; used by every
    /// `#Preview` macro that needs non-empty data.
    static func mockDefault() -> PickerViewModel {
        PickerViewModel(
            todayPlanned: .planned(
                label: "推日 W3D1（今日）",
                templateName: "推日",
                programName: "PPL",
                intensity: "12RM",
                programDayId: "pd-1",
                templateId: "",
                exercises: []
            ),
            templates: [
                TemplateOption(id: "t1", name: "推日（A）"),
                TemplateOption(id: "t2", name: "拉日（B）"),
                TemplateOption(id: "t3", name: "腿日（C）"),
                TemplateOption(id: "t4", name: "全身"),
            ],
            programs: [
                ProgramOption(
                    id: "p1",
                    name: "Linear progression W3",
                    intensities: [
                        IntensityOption(id: "i1", name: "Volume day"),
                        IntensityOption(id: "i2", name: "Intensity day"),
                        IntensityOption(id: "i3", name: "Deload"),
                    ]
                ),
                ProgramOption(
                    id: "p2",
                    name: "PPL W5",
                    intensities: [
                        IntensityOption(id: "i4", name: "Heavy"),
                        IntensityOption(id: "i5", name: "Volume"),
                    ]
                ),
                ProgramOption(
                    id: "p3",
                    name: "PHUL W2",
                    intensities: [
                        IntensityOption(id: "i6", name: "Power"),
                        IntensityOption(id: "i7", name: "Hypertrophy"),
                    ]
                ),
            ]
        )
    }

    /// Rest day variant.
    static func mockRestDay() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .restDay
        return vm
    }

    /// No-active-program variant.
    static func mockNoProgram() -> PickerViewModel {
        let vm = mockDefault()
        vm.todayPlanned = .noActiveProgram
        vm.programs = []
        return vm
    }

    /// No templates variant.
    static func mockNoTemplates() -> PickerViewModel {
        let vm = mockDefault()
        vm.templates = []
        return vm
    }

    /// Both sections empty.
    static func mockAllEmpty() -> PickerViewModel {
        PickerViewModel(
            todayPlanned: .noActiveProgram,
            templates: [],
            programs: []
        )
    }
}
