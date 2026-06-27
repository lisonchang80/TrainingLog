//
//  SessionInteractionState.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase B + C — interaction state for the set logger.
//  Per ADR-0019 § Slice 13d D11 spec (frozen 2026-05-28).
//
//  Phase B scope (already shipped):
//    - `activeSetId` — at most one row is `{}` Active at a time.
//    - `loggedSetIds` — set IDs marked ✓.
//
//  Phase C scope (this revision):
//    - `activeCell` — `(setId, field)` currently in `[]` Active state
//      with a typed buffer. Only entered FROM `{}` Active per spec
//      line 1424 「從 {} Active tap cell → cell highlight」.
//    - `editedValues` — committed cell edits, keyed by `setId:field`,
//      override the snapshot's planned weight/reps at display time.
//      Snapshot stays immutable (Phase H will diff `editedValues`
//      against snapshot and push deltas back to iPhone).
//    - Input-mode-aware commit semantics: keypad commits on Done
//      (explicit), crown commits live (tap-outside).
//
//  Phase F partial (2026-05-31 — delete + add set):
//    - `deletedExerciseIds` / `deletedSetIds` — deletion overlay. Both
//      render + live-mirror projection filter these out (snapshot stays
//      immutable). Unblocks the E2 end-session purge device verification.
//    - `addedSets` — +1-set overlay (right-swipe → ＋). Merged into the
//      exercise by render + projection. Same immutable-snapshot principle.
//
//  Still NOT managed here:
//    - Type cycling — Phase D
//    - -/+ cluster CRUD — Phase E
//    - Long-press reorder — Phase F
//    - Auto-advance after final ✓ — Phase H
//    - Persisting to repo — Phase H
//

import Foundation
import Combine

/// Which numeric field of a set row is being edited.
enum CellField: String, Equatable {
    case weight
    case reps

    var unit: String {
        switch self {
        case .weight: return "kg"
        case .reps: return "次"
        }
    }
}

/// The cell currently in `[]` Active state. Carries a string buffer
/// for keypad input (digits + optional decimal). Crown mode reads /
/// writes the same buffer, formatting via `formatCrown(...)`.
///
/// `hasUserInput` tracks whether the user has actually typed since
/// the cell was opened. When false, the first digit press REPLACES
/// the pre-loaded value (instead of appending) per user 2026-05-29
/// «鍵盤輸入改為取代原有數字». Backspace / dot also flip it true.
struct ActiveCell: Equatable {
    let setId: String
    let field: CellField
    var buffer: String
    var hasUserInput: Bool = false
}

/// Composite key for `editedValues`.
struct EditedValueKey: Hashable {
    let setId: String
    let field: CellField
}

/// A set the user added on the Watch (right-swipe → ＋ → tap, D11 spec
/// line 1593). Lives in an OVERLAY list — the immutable start snapshot
/// never gains rows; render + live-mirror projection MERGE these in.
///
/// Two ordering keys, deliberately decoupled:
///   - `ordinal` (Int, wire) — chosen at add time as `max(every ordinal in
///     the exercise, incl. tombstoned) + 1`, so it never collides with a
///     canonical set's ordinal → the iPhone reconcile (which matches sets
///     by `(session_exercise_id, ordinal)` VALUE) treats it as a Watch-
///     authored INSERT. (iPhone history therefore orders added sets after
///     the template sets — integer ordinals leave no room to insert
///     between canonical rows without renumbering, which would break the
///     value-match.)
///   - `displayRank` (Double, UI only) — places the row on the WATCH right
///     after the row it was added from (midpoint between that row's rank
///     and the next), so an inserted set shows at the next line, not last.
///
/// Editable / loggable / deletable by `id` like any other set.
struct AddedSet: Identifiable, Equatable {
    let id: String
    let sessionExerciseId: String
    var ordinal: Int
    var displayRank: Double
    var weight: Double?
    var reps: Int?
    var setKind: String
    /// Dropset-chain parent (the HEAD row's setId) when this added set is a
    /// dropset follower seeded by `cycleSetKind`/`addDropsetChild`; nil for a
    /// plain +1 set. Carried onto the wire so the iPhone folds the chain.
    var parentSetId: String? = nil

    /// Project to the wire/render set shape. weight/reps/isLogged here are
    /// only fallbacks — the live overlay (`editedValues` / `loggedSetIds`)
    /// overrides them downstream, same as for a base snapshot set.
    func asSnapshotSet() -> SessionSnapshotSet {
        SessionSnapshotSet(
            setId: id,
            ordinal: ordinal,
            weight: weight,
            reps: reps,
            rpe: nil,
            restSec: nil,
            notes: nil,
            setKind: setKind,
            isLogged: false,
            parentSetId: parentSetId
        )
    }
}

@MainActor
final class SessionInteractionState: ObservableObject {

    // MARK: - Phase B state

    /// ID of the row currently in `{}` Active state, or `nil` for
    /// fully idle. Per spec only one row is Active at a time.
    @Published var activeSetId: String? = nil

    /// IDs of set rows marked ✓ (logged). For a cluster, only the
    /// cluster header's set ID appears here — per spec sub-sets
    /// have no individual ✓.
    @Published var loggedSetIds: Set<String> = []

    // MARK: - Phase C state

    /// The cell currently in `[]` Active state. `nil` when no cell
    /// is being edited. Entering `[]` Active also keeps the row in
    /// `{}` Active (cell mode is a sub-state of row mode).
    @Published var activeCell: ActiveCell? = nil

    /// Per-cell edited values. Display layer prefers these over the
    /// snapshot's planned values via `displayValue(setId:field:fallback:)`.
    @Published var editedValues: [EditedValueKey: Double] = [:]

    // MARK: - Phase F deletion state (D11 Phase F partial — delete only)

    /// IDs of `session_exercise` rows the user deleted on the Watch
    /// (via the D15 ⋯ menu → 刪除 → confirm). Like the rest of this
    /// class these are an OVERLAY over the immutable start snapshot:
    /// the render path (`SessionCardListPage`) and the live-mirror
    /// projection (`LiveMirror.project`) both FILTER these out, leaving
    /// `snapshot` itself untouched. A shrunk live-mirror snapshot is what
    /// lets the iPhone end-session reconcile purge the deleted rows (E2 —
    /// ADR-0019 § "WC Ship-Blocker Fixes").
    @Published var deletedExerciseIds: Set<String> = []

    /// IDs of individual `set` rows the user deleted on the Watch (left-
    /// swipe on a `{}` Active working/warmup row — D11 spec line 1592).
    /// Same overlay semantics as `deletedExerciseIds`. NOTE: the iPhone
    /// reconcile matches sets by `(session_exercise_id, ordinal)` VALUE,
    /// so the projection must keep the SURVIVING sets' original `ordinal`
    /// (it filters, never re-indexes) — that is what makes a mid-list set
    /// delete purge the right row at end-session.
    @Published var deletedSetIds: Set<String> = []

    /// Sets the user added on the Watch (right-swipe → ＋). Overlay list
    /// MERGED into each exercise by render + projection (sorted by
    /// `ordinal`). See `AddedSet`.
    @Published var addedSets: [AddedSet] = []

    /// Per-set `set_kind` override (D11 Phase F — # type cycling, grill
    /// 2026-05-31 line 1548-1558). Tapping a row's number cycles
    /// 工作→熱→D→工作; the chosen kind is stored here keyed by setId. Render
    /// (`LiveMirror.mergeSets`) + projection apply it, so `SetRowGroup.group`
    /// re-derives the working-set numbering + progress bar automatically and
    /// the iPhone reconcile UPDATEs the mirror-bound `set_kind` column.
    /// Entering / leaving `dropset` additionally adds / removes the cluster's
    /// sub-sets — see `cycleSetKind`.
    @Published var setKindOverrides: [String: String] = [:]

    /// Per-set DISPLAY-rank override (D11 Phase F — long-press reorder). When
    /// present it replaces the natural rank (base = ordinal, added =
    /// displayRank) that `LiveMirror.mergeSets` sorts by — that is the entire
    /// Watch-side reorder. Decoupled from the WIRE ordinal: the projection
    /// re-derives wire ordinals from the present ordinal pool in display
    /// order, so the iPhone history follows WITHOUT introducing new ordinal
    /// values (delete-purge / add-INSERT value-match stays intact).
    @Published var setRankOverrides: [String: Double] = [:]

    // MARK: - Phase C-core reverse-sync overlay (2026-06-26)
    //
    // iPhone→Watch live projection. The iPhone producer
    // (`iphoneLiveMirrorProducer.ts`) pushes a wire SessionSnapshot;
    // `applyRemoteSnapshot` folds it into THIS overlay (base stays
    // immutable). These three are the fields the per-set overlays above
    // can't express. Written ONLY inside the producer's `applyingRemote`
    // gate so the resulting @Published mutations don't bounce back out.

    /// iPhone-originated exercises absent from the immutable base. Render
    /// (`SetLoggerView.visibleExercises`) + the forward projection MERGE
    /// these like `addedSets` does for sets. Identity = `sessionExerciseId`
    /// (iPhone canonical — NO id-adoption here, that's C-id). The Watch
    /// never edits these structurally (read-only mirror); their own per-set
    /// logged/edited values ride along inside the SessionSnapshotSet rows.
    @Published var addedExercises: [SessionSnapshotExercise] = []

    /// Per-set notes pushed from iPhone — DISPLAY-ONLY (拍板 Q6/Q1). Keyed by
    /// setId. The Watch has no notes editor. Data is populated here regardless
    /// of whether the on-card notes UI is wired yet (visual ref pending).
    @Published var notesOverride: [String: String] = [:]

    /// C-core 動作層 reorder — the iPhone's exercise display order as a list
    /// of `sessionExerciseId`. Empty ⇒ render in base order. Pure display
    /// override, mirrors `setRankOverrides`' philosophy for the set level.
    @Published var exerciseOrderOverride: [String] = []

    /// C-core — session title pushed from iPhone. The Watch renders the title
    /// from the IMMUTABLE base snapshot, so an iPhone rename can't reach it
    /// without this overlay. nil ⇒ render the base title. (2026-06-26 device
    /// smoke: ④ title was not syncing because there was no override field.)
    @Published var titleOverride: String? = nil

    /// Goal 3b (2026-06-26) — the setId whose per-set note is shown in the top
    /// overlay box (covering the HR/time pane) WHILE its row is in long-press
    /// (orange / reorder) mode. nil ⇒ no overlay. `ReorderableRow` pushes the
    /// group's first member setId here when `drag.isMoving` turns true and nil on
    /// release — so the box rides the EXACT same signal as the orange highlight
    /// (按住變橘→冒方塊、放手兩者一起消). Display-only: the box reads
    /// `notesOverride[setId]` and shows nothing when that set has no note.
    @Published var longPressNoteSetId: String? = nil

    /// Monotonic counter for minting unique `AddedSet` ids within this
    /// session. Survives view re-mounts (the state object outlives them).
    private var addCounter = 0

    // MARK: - Active row (Phase B)

    func activate(setId: String) {
        // Switching to a DIFFERENT row — implicit-commit any in-flight
        // cell edit, then defensive-clear the cell pointer.
        //
        // Without this, the OLD cell's `[]` Active green border would
        // linger after the user tapped a new row (because activeCell
        // still pointed at the old setId+field), leading to multiple
        // green borders showing simultaneously per user 2026-05-29
        // «更換 row active 時、要取消原本重量/次數 active».
        //
        // Implicit commit (vs discard) preserves any value the user
        // already entered — they were obviously interacting with that
        // cell, so save the work before bailing.
        //
        // Defensive double-clear `activeCell = nil` AFTER commit even
        // though commitActiveCell already sets it. Pure paranoia
        // against any edge where commit early-returned.
        if activeSetId != setId {
            if activeCell != nil {
                commitActiveCell()
            }
            activeCell = nil
        }
        activeSetId = setId
    }

    func deactivate() {
        activeSetId = nil
        // Bailing the row also bails any cell edit (per spec line 1592).
        activeCell = nil
    }

    func isActive(setId: String) -> Bool {
        activeSetId == setId
    }

    // MARK: - Logged (✓) state (Phase B)

    func isLogged(setId: String) -> Bool {
        loggedSetIds.contains(setId)
    }

    /// 投影 Watch (2026-06-27) — seed the ✓ overlay from a handed-over snapshot.
    /// `loggedSetIds` is otherwise EMPTY on mount (the Watch-led assumption: a
    /// session starts with nothing logged, and `isLogged(setId:)` reads ONLY
    /// this overlay, never the snapshot's `isLogged`). When the iPhone CASTS an
    /// in-progress session (`pushCastToWatch`), some sets already carry
    /// `isLogged == true`; without seeding the Watch renders them un-checked AND
    /// the producer's initial full-tree push echoes the empty state back → the
    /// iPhone clears its own ✓s (device 2026-06-27: "兩邊都變未打勾"). Idempotent
    /// for the Watch-led path (all sets isLogged=false → empty set). Call BEFORE
    /// the live-mirror producer attaches its `$loggedSetIds` sink so this seed
    /// doesn't `markDirty` a spurious forward emit.
    func seedLoggedFromSnapshot(_ snapshot: SessionSnapshot) {
        loggedSetIds = Set(
            snapshot.exercises
                .flatMap(\.sets)
                .filter(\.isLogged)
                .map(\.setId)
        )
    }

    func toggleLogged(setId: String) {
        if loggedSetIds.contains(setId) {
            loggedSetIds.remove(setId)
        } else {
            loggedSetIds.insert(setId)
        }
        // Per spec line 1593 tap ◯/✓ exits both row + cell Active state.
        activeSetId = nil
        activeCell = nil
    }

    // MARK: - Cell edit (Phase C)

    /// Enter `[]` Active for a cell. Only valid when the row is
    /// already `{}` Active (per spec line 1424). Pre-loads the
    /// buffer with the current displayed value so the user can
    /// either type to replace or backspace-edit.
    func activateCell(setId: String, field: CellField, currentValue: Double?) {
        // Defensive: only allow entering [] Active from {} Active.
        // For clusters, the row Active ID is the cluster header, but
        // individual sub-set cells share the cluster's Active-row id —
        // we accept any cell whose containing row's Active-id matches.
        activeCell = ActiveCell(
            setId: setId,
            field: field,
            buffer: formatBuffer(currentValue, field: field)
        )
    }

    func isCellActive(setId: String, field: CellField) -> Bool {
        guard let cell = activeCell else { return false }
        return cell.setId == setId && cell.field == field
    }

    // MARK: - Keypad mutators

    /// Append a single digit to the buffer.
    /// **First-digit-replace semantics**: when `hasUserInput == false`
    /// (cell freshly opened with pre-loaded value), the first digit
    /// REPLACES the buffer rather than appending. Subsequent digits
    /// append normally. Per user 2026-05-29 polish.
    func appendDigit(_ d: String) {
        guard var cell = activeCell else { return }
        if !cell.hasUserInput {
            cell.buffer = d
            cell.hasUserInput = true
        } else {
            // Cap at 5 chars to keep watch UI readable (e.g. "999.5").
            guard cell.buffer.count < 5 else { return }
            // Treat a leading "0" as placeholder — replace on first digit.
            if cell.buffer == "0" {
                cell.buffer = d
            } else {
                cell.buffer += d
            }
        }
        activeCell = cell
    }

    /// Append a decimal point. Only for weight (reps is integer).
    /// No-op if buffer already contains a dot. Sets `hasUserInput`
    /// so subsequent digits append rather than replace.
    func appendDot() {
        guard var cell = activeCell, cell.field == .weight else { return }
        guard !cell.buffer.contains(".") else { return }
        cell.buffer = cell.buffer.isEmpty ? "0." : cell.buffer + "."
        cell.hasUserInput = true
        activeCell = cell
    }

    /// Delete the last char in the buffer. Sets `hasUserInput` so
    /// the user can erase the pre-loaded value char-by-char then
    /// have new digits append from empty.
    func backspace() {
        guard var cell = activeCell else { return }
        if !cell.buffer.isEmpty {
            cell.buffer.removeLast()
        }
        cell.hasUserInput = true
        activeCell = cell
    }

    /// Replace the buffer wholesale — used by crown mode to write
    /// the current crown value back into the buffer. Sets
    /// `hasUserInput` so subsequent keypad presses (if user switches
    /// modes mid-edit) append properly.
    func updateActiveCellBuffer(_ newBuffer: String) {
        guard var cell = activeCell else { return }
        cell.buffer = newBuffer
        cell.hasUserInput = true
        activeCell = cell
    }

    // MARK: - Cell commit / discard

    /// Commit the current buffer to `editedValues` and exit `[]` Active.
    /// Used by keypad Done button + crown tap-outside.
    /// `activeSetId` stays — row remains in `{}` Active so the user
    /// can immediately tap another cell or ◯.
    func commitActiveCell() {
        guard let cell = activeCell else { return }
        if let value = parseBuffer(cell.buffer, field: cell.field) {
            let key = EditedValueKey(setId: cell.setId, field: cell.field)
            editedValues[key] = value
        }
        activeCell = nil
    }

    /// Discard the current buffer without saving. Used if we add a
    /// Cancel button later (Phase C does not expose this in UI).
    func discardActiveCell() {
        activeCell = nil
    }

    // MARK: - Deletion (Phase F)

    func isExerciseDeleted(_ id: String) -> Bool {
        deletedExerciseIds.contains(id)
    }

    func isSetDeleted(_ id: String) -> Bool {
        deletedSetIds.contains(id)
    }

    /// Delete a single set row. A Watch-added set is simply dropped from
    /// the `addedSets` overlay (it was never in the base snapshot, so it
    /// needs no tombstone); a base set is tombstoned in `deletedSetIds`
    /// (render + projection filter it out). Either way scrub the other
    /// overlays that referenced it so a stale ✓ / edited value / active
    /// highlight can't linger on a row the user just removed.
    func deleteSet(setId: String) {
        if let idx = addedSets.firstIndex(where: { $0.id == setId }) {
            addedSets.remove(at: idx)
        } else {
            deletedSetIds.insert(setId)
        }
        loggedSetIds.remove(setId)
        editedValues = editedValues.filter { $0.key.setId != setId }
        setKindOverrides[setId] = nil
        setRankOverrides[setId] = nil
        if activeSetId == setId { activeSetId = nil }
        if activeCell?.setId == setId { activeCell = nil }
    }

    /// Insert a new set into an exercise right AFTER `afterSetId` (the
    /// swiped row) — 「新增至下一行」. `baseSets` is the exercise's full set
    /// list from the immutable snapshot (the caller has it).
    ///   - `displayRank`: midpoint between the anchor's rank and the next
    ///     visible row's rank (or anchor+1 if the anchor is last), so the
    ///     new row shows at the NEXT line on the Watch.
    ///   - `ordinal` (wire): one past every ordinal in the exercise incl.
    ///     tombstoned ones — unique, never collides with a canonical row →
    ///     the iPhone reconcile INSERTs it.
    /// Prefills weight/reps from the swiped row (「同種類的下一個」) and
    /// MOVES the Active highlight onto the new set. Returns the new id.
    @discardableResult
    func addSet(
        sessionExerciseId: String,
        afterSetId: String,
        baseSets: [SessionSnapshotSet],
        weight: Double?,
        reps: Int?,
        setKind: String,
        activateNew: Bool = true,
        parentSetId: String? = nil
    ) -> String {
        // Display ranks of the CURRENT visible sets, honouring any reorder
        // override (so an added set lands correctly even after a reorder).
        let visibleIds: [String] = baseSets
            .filter { !deletedSetIds.contains($0.setId) }
            .map { $0.setId }
            + addedSets
                .filter { $0.sessionExerciseId == sessionExerciseId }
                .map { $0.id }
        let ranks: [(id: String, rank: Double)] = visibleIds.map {
            ($0, effectiveRank(setId: $0, baseSets: baseSets))
        }

        let anchorRank = ranks.first { $0.id == afterSetId }?.rank
            ?? (ranks.map { $0.rank }.max() ?? 0)
        let nextRank = ranks.map { $0.rank }.filter { $0 > anchorRank }.min()
        let displayRank = nextRank.map { ($0 + anchorRank) / 2 } ?? (anchorRank + 1)

        // Wire ordinal: count tombstoned base sets too (ordinals never
        // reused — a reused ordinal would re-match a purged canonical row).
        let baseMaxOrdinal = baseSets.map { $0.ordinal }.max() ?? 0
        let addedMaxOrdinal = addedSets
            .filter { $0.sessionExerciseId == sessionExerciseId }
            .map { $0.ordinal }
            .max() ?? 0
        let nextOrdinal = max(baseMaxOrdinal, addedMaxOrdinal) + 1

        addCounter += 1
        let id = "ADD-\(addCounter)"
        addedSets.append(
            AddedSet(
                id: id,
                sessionExerciseId: sessionExerciseId,
                ordinal: nextOrdinal,
                displayRank: displayRank,
                weight: weight,
                reps: reps,
                setKind: setKind,
                parentSetId: parentSetId
            )
        )
        // Active moves onto the freshly-added set (ready to edit) — unless
        // the caller opted out (type-cycling into D seeds a sub-set but keeps
        // the header Active, so a follow-up number-tap deconstructs the SAME
        // row).
        if activateNew {
            activeSetId = id
            activeCell = nil
        }
        return id
    }

    /// Delete a whole exercise (D15 ⋯ menu 刪除 → confirm). Marks the
    /// exercise deleted and cascades `deleteSet` over its set IDs so the
    /// per-set overlays are cleaned up too. The caller passes the set IDs
    /// from the immutable snapshot (`exercise.sets.map(\.setId)`); the
    /// class holds no exercise→sets map of its own.
    func deleteExercise(sessionExerciseId: String, setIds: [String]) {
        deletedExerciseIds.insert(sessionExerciseId)
        for sid in setIds {
            deleteSet(setId: sid)
        }
        // Drop any Watch-added sets that belonged to the removed exercise
        // (the projection already excludes the whole exercise, but keep the
        // overlay tidy so they can't resurface).
        addedSets.removeAll { $0.sessionExerciseId == sessionExerciseId }
    }

    // MARK: - Type cycling (Phase F — grill line 1548-1558)

    /// Cycle a row's `set_kind` on tapping its number: 工作 → 熱 → D → 工作.
    /// Effects are immediate (grill「即時生效」):
    ///   - the override drives `LiveMirror.mergeSets` → `SetRowGroup.group`
    ///     renumbers working sets 1..N + recomputes the progress bar
    ///     automatically (warmup穿插、cluster D1/D2 自動編號);
    ///   - entering `dropset` (D) seeds ONE sub-set with the header's current
    ///     values (grill「切到 D 預設: 1 sub-set、數值同 header」), keeping the
    ///     header Active;
    ///   - leaving `dropset` (tap header D1 → 工作) drops every consecutive
    ///     dropset sub-set after the header (grill「解構 D: sub-set 全砍」).
    /// `baseSets` is the exercise's immutable snapshot set list.
    func cycleSetKind(setId: String, sessionExerciseId: String, baseSets: [SessionSnapshotSet]) {
        // Display-ordered sets with the CURRENT effective kinds. Computed
        // before the flip below so the dropset-deconstruct branch still sees
        // the cluster it is tearing down.
        let ordered = LiveMirror.mergeSets(
            base: baseSets,
            deletedSets: deletedSetIds,
            addedSets: addedSets,
            kindOverrides: setKindOverrides,
            rankOverrides: setRankOverrides,
            sessionExerciseId: sessionExerciseId
        )
        guard let idx = ordered.firstIndex(where: { $0.setId == setId }) else { return }
        let current = ordered[idx].setKind
        let next: String
        switch current {
        case "working": next = "warmup"
        case "warmup": next = "dropset"
        case "dropset": next = "working"
        default: next = "warmup"
        }
        setKindOverrides[setId] = next

        if next == "dropset" {
            // Enter D — seed 1 sub-set with the header's current values,
            // inserted right after it; keep the header Active.
            let w = displayValue(setId: setId, field: .weight, fallback: ordered[idx].weight)
            let r = displayValue(setId: setId, field: .reps,
                                 fallback: ordered[idx].reps.map { Double($0) })
            addSet(
                sessionExerciseId: sessionExerciseId,
                afterSetId: setId,
                baseSets: baseSets,
                weight: w,
                reps: r.map { Int($0.rounded()) },
                setKind: "dropset",
                activateNew: false,
                // The cycled row IS the chain head → seed follower points at it.
                parentSetId: setId
            )
        } else if current == "dropset" {
            // Deconstruct D — drop the consecutive dropset sub-sets that
            // follow this header in display order.
            var j = idx + 1
            while j < ordered.count && ordered[j].setKind == "dropset" {
                deleteSet(setId: ordered[j].setId)
                j += 1
            }
        }
    }

    // MARK: - Reorder (Phase F — long-press drag)

    /// Effective DISPLAY rank of a set: the reorder override if present, else
    /// the base set's ordinal (as Double) or an added set's displayRank.
    /// Drives the merge sort order — decoupled from the WIRE ordinal (the
    /// projection re-derives those from the present pool).
    func effectiveRank(setId: String, baseSets: [SessionSnapshotSet]) -> Double {
        if let r = setRankOverrides[setId] { return r }
        if let a = addedSets.first(where: { $0.id == setId }) { return a.displayRank }
        if let b = baseSets.first(where: { $0.setId == setId }) { return Double(b.ordinal) }
        return 0
    }

    /// Commit a reorder. `orderedGroups` is the new DISPLAY order: each inner
    /// array is a render group's member setIds in their internal order
    /// (single set for working/warmup; header + sub-sets for a D cluster, so a
    /// cluster moves as one unit). Renumbers the rank overrides 0..N-1 —
    /// display only; the projection re-derives wire ordinals from the present
    /// ordinal pool so the iPhone history follows without breaking the
    /// delete-purge / add-INSERT value-match.
    func applyReorder(orderedGroups: [[String]]) {
        var rank = 0.0
        for group in orderedGroups {
            for sid in group {
                setRankOverrides[sid] = rank
                rank += 1
            }
        }
    }

    // MARK: - Reverse sync apply (Phase C-core — 2026-06-26)

    /// Inverse of `LiveMirror.project`: fold an iPhone-originated wire snapshot
    /// into THIS overlay, leaving the immutable `base` untouched. Writes ONLY
    /// overlay `@Published` fields → SwiftUI auto-redraws. MUST run inside the
    /// `LiveMirrorProducer.applyingRemote` gate (see `ReverseSyncApply`) so the
    /// resulting overlay mutations don't bounce back out through the forward
    /// producer.
    ///
    /// `base` is the immutable start snapshot (`SetLoggerView` holds it). Diff:
    ///   - exercise add (in snap, absent from base) → `addedExercises`
    ///   - exercise delete (in base, absent from snap) → `deletedExerciseIds`
    ///     (formUnion — MONOTONIC: never un-hides a Watch-local delete that the
    ///     iPhone still carries via its non-purge mirror)
    ///   - exercise display order → `exerciseOrderOverride`
    ///   - per-set logged / weight·reps edit / delete / mid-insert / notes →
    ///     the existing per-set overlays, over base exercises' sets.
    func applyRemoteSnapshot(_ snap: SessionSnapshot, base: SessionSnapshot) {
        // ⭐ Phase C-core fix (2026-06-26 device session — ⑤ logged / ③ reorder
        // never reached the Watch). ROOT CAUSE: a Watch-led TEMPLATE start makes
        // the iPhone mint FRESH session_exercise + session_set uuids
        // (`sessionFromTemplate.ts` `newSeId = snapshots[i].id` + `args.uuid()`),
        // so the inbound snapshot's ids NEVER match this Watch's immutable base.
        // The original C-core matched by id (`sessionExerciseId` / `setId`), so
        // EVERY exercise was misclassified as "added", the per-set loop was
        // `guard`-skipped, and `loggedSetIds` / `setRankOverrides` stayed empty —
        // while the renderer reads ✓/rank from those overlays by BASE id. ④ title
        // + 3a add-exercise worked because they don't depend on set-level base
        // matching; ⑤/③ didn't because they only populate inside the skipped loop.
        //
        // FIX: mirror the FORWARD reconcile (`replaceLiveMirror.ts`), which is
        // position/content-based precisely BECAUSE the ids diverge — match
        // exercises by `exerciseId` (occurrence order) and sets by `ordinal`,
        // resolving every incoming row to its BASE id so the overlays are keyed by
        // exactly what the renderer reads. `ordinal` is reorder-stable (the wire
        // ordinal is glued to identity; reorder rides `display_rank`), so ③ works.

        // 1. Claim base exercises by `exerciseId` occurrence (FIFO per id), the
        //    same identity the forward reconcile uses. matchedBase[i] = the base
        //    exercise the i-th snap exercise resolves to (nil = genuinely added).
        var baseQueues: [String: [SessionSnapshotExercise]] = [:]
        for ex in base.exercises { baseQueues[ex.exerciseId, default: []].append(ex) }
        var matchedBase: [SessionSnapshotExercise?] = []
        var claimedBaseIds = Set<String>()
        for ex in snap.exercises {
            if var q = baseQueues[ex.exerciseId], !q.isEmpty {
                let b = q.removeFirst()
                baseQueues[ex.exerciseId] = q
                matchedBase.append(b)
                claimedBaseIds.insert(b.sessionExerciseId)
            } else {
                matchedBase.append(nil)
            }
        }

        // 2. exercise add / delete (overlay only — base immutable). delete = base
        //    exercises never claimed (MONOTONIC formUnion: an iPhone-dropped base
        //    exercise never needs un-hiding; a Watch-local delete the iPhone still
        //    mirrors must not resurrect).
        deletedExerciseIds.formUnion(
            base.exercises.map(\.sessionExerciseId).filter { !claimedBaseIds.contains($0) }
        )
        addedExercises = zip(snap.exercises, matchedBase).compactMap { $0.1 == nil ? $0.0 : nil }

        // 3. exercise display order (動作層 reorder) — map each snap exercise to
        //    its RENDERED id (matched → BASE id, added → its own id) so the order
        //    override lines up with what `visibleExercises` renders. + ④ title.
        exerciseOrderOverride = zip(snap.exercises, matchedBase).map {
            $0.1?.sessionExerciseId ?? $0.0.sessionExerciseId
        }
        titleOverride = snap.title

        // 4. per-set diff. MATCHED exercise → resolve each snap set to its base
        //    set by `ordinal` and key overlays by the BASE setId (what the
        //    renderer reads); base sets whose ordinal is absent from snap are
        //    deletes. ADDED exercise → renders whole from the snapshot rows (their
        //    own ids), so seed logged/rank/notes keyed by the snap setId.
        var newLogged = loggedSetIds
        var newEdited = editedValues
        var newDeletedSets = deletedSetIds
        var newNotes = notesOverride
        var newAddedSets = addedSets
        var newRankOverrides = setRankOverrides
        var newKindOverrides = setKindOverrides

        for (i, ex) in snap.exercises.enumerated() {
            guard let baseEx = matchedBase[i] else {
                // ADDED exercise — surface its per-set ✓ / reorder / notes via the
                // overlay (the shared renderer reads `state.isLogged(setId)` /
                // `setRankOverrides[setId]` even for added exercises).
                for s in ex.sets {
                    if s.isLogged { newLogged.insert(s.setId) }
                    if let n = s.notes { newNotes[s.setId] = n }
                    if let dr = s.displayRank { newRankOverrides[s.setId] = dr }
                }
                continue
            }
            let baseByOrdinal = Dictionary(
                baseEx.sets.map { ($0.ordinal, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            let snapOrdinals = Set(ex.sets.map(\.ordinal))
            // base sets the iPhone deleted (ordinal absent from snap).
            for b in baseEx.sets where !snapOrdinals.contains(b.ordinal) {
                newDeletedSets.insert(b.setId)
            }
            for s in ex.sets {
                if let b = baseByOrdinal[s.ordinal] {
                    // resolve snap row → BASE setId → overlay key the renderer reads.
                    let id = b.setId
                    if s.isLogged { newLogged.insert(id) } else { newLogged.remove(id) }
                    if let w = s.weight, w != b.weight {
                        newEdited[EditedValueKey(setId: id, field: .weight)] = w
                    }
                    if let r = s.reps, r != b.reps {
                        newEdited[EditedValueKey(setId: id, field: .reps)] = Double(r)
                    }
                    if let n = s.notes { newNotes[id] = n }
                    if let dr = s.displayRank { newRankOverrides[id] = dr }
                    // set_kind sync (2026-06-27 device bug — iPhone「#/熱/D#」切換
                    // 沒反映到手錶). The matched branch synced logged / weight /
                    // reps / notes / display_rank but OMITTED set_kind, so an
                    // iPhone working→warmup left the row unchanged, and a
                    // working→warmup→dropset left the head as「working」while its
                    // inserted follower (new ordinal, no base match) fell to the
                    // added branch below and rendered as a stray「D1」head. Mirror
                    // the logged set/remove pattern: override when the iPhone kind
                    // differs from base, clear the override when it matches again
                    // (e.g. dropset→working revert). With the head's kind now
                    // flipped to「dropset」, `ExerciseCard` folds it + the follower
                    // into ONE cluster (the fold is array-adjacency by
                    // chain-head, so the follower needs no parent-id rewrite).
                    if s.setKind != b.setKind {
                        newKindOverrides[id] = s.setKind
                    } else {
                        newKindOverrides.removeValue(forKey: id)
                    }
                } else if !newAddedSets.contains(where: { $0.id == s.setId }) {
                    // snap set beyond base (iPhone added a set to this exercise) →
                    // addedSet under the BASE exercise's id so mergeSets folds it.
                    newAddedSets.append(AddedSet(
                        id: s.setId,
                        sessionExerciseId: baseEx.sessionExerciseId,
                        ordinal: s.ordinal,
                        displayRank: s.displayRank ?? Double(s.ordinal),
                        weight: s.weight,
                        reps: s.reps,
                        setKind: s.setKind,
                        parentSetId: s.parentSetId
                    ))
                    if s.isLogged { newLogged.insert(s.setId) }
                    if let n = s.notes { newNotes[s.setId] = n }
                    if let dr = s.displayRank { newRankOverrides[s.setId] = dr }
                }
            }
        }
        // Assign once each → ≤ one @Published willSet per field per apply.
        loggedSetIds = newLogged
        editedValues = newEdited
        deletedSetIds = newDeletedSets
        notesOverride = newNotes
        addedSets = newAddedSets
        setRankOverrides = newRankOverrides
        setKindOverrides = newKindOverrides
    }

    // MARK: - Display value

    /// The value to render in a cell.
    /// Priority: **active-cell buffer** (live preview during edit)
    /// → committed `editedValues` → snapshot `fallback`. The live-buffer
    /// branch is what makes inline-crown work — as the crown rotates,
    /// `updateActiveCellBuffer` writes back to `activeCell.buffer`,
    /// and this getter surfaces the new value on every render tick.
    func displayValue(setId: String, field: CellField, fallback: Double?) -> Double? {
        if let cell = activeCell, cell.setId == setId, cell.field == field,
           let live = parseBuffer(cell.buffer, field: field) {
            return live
        }
        let key = EditedValueKey(setId: setId, field: field)
        return editedValues[key] ?? fallback
    }

    // MARK: - Buffer / value formatting helpers

    /// Format a numeric value as a keypad buffer string.
    private func formatBuffer(_ v: Double?, field: CellField) -> String {
        guard let v else { return "" }
        switch field {
        case .reps:
            return String(Int(v.rounded()))
        case .weight:
            if v == v.rounded() {
                return String(format: "%.0f", v)
            }
            return String(format: "%.1f", v)
        }
    }

    /// Parse a buffer string into a numeric value.
    private func parseBuffer(_ s: String, field: CellField) -> Double? {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != "." else { return nil }
        switch field {
        case .reps:
            return Double(Int(trimmed) ?? 0)
        case .weight:
            return Double(trimmed)
        }
    }
}
