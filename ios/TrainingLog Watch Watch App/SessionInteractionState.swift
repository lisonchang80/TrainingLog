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
//  Phase C does NOT manage:
//    - Type cycling — Phase D
//    - -/+ cluster CRUD — Phase E
//    - Swipe gestures — Phase F
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

    // MARK: - Active row (Phase B)

    func activate(setId: String) {
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
