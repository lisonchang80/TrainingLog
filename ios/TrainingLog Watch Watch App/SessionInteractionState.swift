//
//  SessionInteractionState.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase B — interaction state for the set logger.
//  Per ADR-0019 § Slice 13d D11 spec (frozen 2026-05-28).
//
//  Phase B scope:
//    - `activeSetId` — at most one row is `{}` Active at a time.
//      `nil` means all rows are idle. Per spec line 1582, tap row
//      middle on an idle row sets this; tap 框外 / tap ◯ clears it.
//    - `loggedSetIds` — set IDs marked ✓. Per spec line 1531, any
//      state allows tap ◯/✓ to toggle. Per spec line 1534, cluster
//      header ✓ marks the whole cluster — sub-sets share the header
//      ID, so tracking the header ID is sufficient.
//
//  Phase B does NOT manage:
//    - [] Active (cell edit) — Phase C
//    - Type cycling — Phase D
//    - -/+ cluster CRUD — Phase E
//    - Swipe gestures — Phase F
//    - Long-press reorder — Phase F
//    - Auto-advance after final ✓ — Phase H
//    - Persisting to repo — Phase H (state lives only in-memory)
//

import Foundation
import Combine

@MainActor
final class SessionInteractionState: ObservableObject {

    /// ID of the row currently in `{}` Active state, or `nil` for
    /// fully idle. Per spec only one row is Active at a time.
    @Published var activeSetId: String? = nil

    /// IDs of set rows marked ✓ (logged). For a cluster, only the
    /// cluster header's set ID appears here — per spec sub-sets
    /// have no individual ✓.
    @Published var loggedSetIds: Set<String> = []

    // MARK: - Active state

    /// Activate a row. If this is already the active row this is a
    /// no-op; if a different row is active it switches.
    func activate(setId: String) {
        activeSetId = setId
    }

    /// Clear `{}` Active state — used when tapping outside any row
    /// (per spec line 1592 「tap 框外 | Idle」).
    func deactivate() {
        activeSetId = nil
    }

    func isActive(setId: String) -> Bool {
        activeSetId == setId
    }

    // MARK: - Logged (✓) state

    func isLogged(setId: String) -> Bool {
        loggedSetIds.contains(setId)
    }

    /// Toggle ✓ for a row. Per spec line 1593 「tap ◯/✓ | Idle
    /// (✓ toggled) | exit Active + save」 — toggling also exits
    /// any `{}` Active state.
    func toggleLogged(setId: String) {
        if loggedSetIds.contains(setId) {
            loggedSetIds.remove(setId)
        } else {
            loggedSetIds.insert(setId)
        }
        activeSetId = nil
    }
}
