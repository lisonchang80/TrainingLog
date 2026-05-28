//
//  CellEditOverlay.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase C — `[]` Active cell-edit overlay.
//  Per ADR-0019 § Slice 13d D11 spec line 1422-1446 + 1522-1527.
//
//  Two input modes:
//    - .keypad — numeric keypad with explicit Done button. Commits
//      on Done only. Default for Phase C.
//    - .crown  — Digital Crown rotation, live commit, tap-outside
//      to exit.
//
//  Mode controlled by `@AppStorage("inputMode")` per spec line 1602
//  「Input mode toggle: keypad / crown (global)」. The Settings sheet
//  (D16, separate slice) will surface this toggle to the user; Phase
//  C exposes a small debug-mode chip on the keypad header so smoke
//  testing both modes is possible before D16 lands.
//

import SwiftUI

/// Storage backing for the global input mode toggle. String-backed
/// so `@AppStorage` can persist trivially.
enum InputMode: String {
    case keypad
    case crown
}

extension InputMode {
    static let storageKey = "inputMode"
    static var current: InputMode {
        let raw = UserDefaults.standard.string(forKey: storageKey) ?? InputMode.keypad.rawValue
        return InputMode(rawValue: raw) ?? .keypad
    }
}

// MARK: - Top-level overlay

/// Wraps the session-card list and conditionally renders the cell
/// edit overlay when `state.activeCell != nil`. Placed in the ZStack
/// inside `SessionCardListPage` so it covers the lower portion of
/// the screen while leaving the top scrollable.
struct CellEditOverlay: View {
    @ObservedObject var state: SessionInteractionState
    @AppStorage(InputMode.storageKey) private var inputModeRaw: String = InputMode.keypad.rawValue

    private var inputMode: InputMode {
        InputMode(rawValue: inputModeRaw) ?? .keypad
    }

    var body: some View {
        if let cell = state.activeCell {
            switch inputMode {
            case .keypad:
                // Per user 2026-05-29 polish: entire screen blacks out
                // during keypad mode — only buffer + keypad visible.
                ZStack(alignment: .bottom) {
                    Color.black.ignoresSafeArea()
                    KeypadOverlay(cell: cell, state: state, inputModeRaw: $inputModeRaw)
                }
            case .crown:
                // Per user 2026-05-29 polish 4: crown mode is INLINE —
                // no popup. The cell's green `[]` Active border + live
                // value display (via displayValue → activeCell.buffer)
                // provide all the feedback the user needs. Crown is
                // captured at SessionCardListPage level via
                // `.digitalCrownRotation`. Tap-outside commits.
                EmptyView()
            }
        }
    }
}

// MARK: - Keypad overlay

private enum KeypadKey: Hashable {
    case digit(String)
    case dot
    case backspace
    case done

    var label: String {
        switch self {
        case .digit(let s): return s
        case .dot: return "."
        case .backspace: return "⌫"
        case .done: return "Done"
        }
    }

    static let layout: [[KeypadKey]] = [
        [.digit("1"), .digit("2"), .digit("3")],
        [.digit("4"), .digit("5"), .digit("6")],
        [.digit("7"), .digit("8"), .digit("9")],
        [.backspace, .digit("0"), .dot, .done],
    ]
}

private struct KeypadOverlay: View {
    let cell: ActiveCell
    @ObservedObject var state: SessionInteractionState
    @Binding var inputModeRaw: String

    var body: some View {
        VStack(spacing: 3) {
            bufferDisplay
            ForEach(KeypadKey.layout.indices, id: \.self) { rowIdx in
                HStack(spacing: 2) {
                    ForEach(KeypadKey.layout[rowIdx].indices, id: \.self) { colIdx in
                        keyButton(KeypadKey.layout[rowIdx][colIdx])
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity)
        // Per user 2026-05-29 polish: opaque full-bleed keypad backdrop
        // — earlier the session list under the keypad area (below the
        // Done row) showed through 0.92 alpha, looking noisy. Now the
        // background fills the entire bottom strip including the safe
        // area so nothing peeks past the Done row.
        .background(
            Color.black.ignoresSafeArea(edges: .bottom)
        )
        .transition(.move(edge: .bottom))
    }

    private var bufferDisplay: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(cell.buffer.isEmpty ? "0" : cell.buffer)
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(.primary)
            Text(cell.field.unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            // Mode-switch chip — Phase C debug affordance until D16
            // settings sheet lands. Tap to flip keypad ↔ crown.
            Button {
                inputModeRaw = InputMode.crown.rawValue
            } label: {
                Text("↻")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }

    @ViewBuilder
    private func keyButton(_ key: KeypadKey) -> some View {
        Button {
            tap(key)
        } label: {
            Text(key.label)
                .font(key == .done ? .caption : .body)
                .monospacedDigit()
                .foregroundStyle(key == .done ? Color.green : Color.primary)
                .frame(maxWidth: .infinity, minHeight: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.secondary.opacity(0.18))
        )
        // Hide the dot key for reps (integer-only).
        .opacity(key == .dot && cell.field == .reps ? 0.3 : 1.0)
        .disabled(key == .dot && cell.field == .reps)
    }

    private func tap(_ key: KeypadKey) {
        switch key {
        case .digit(let d): state.appendDigit(d)
        case .dot: state.appendDot()
        case .backspace: state.backspace()
        case .done: state.commitActiveCell()
        }
    }
}

// Crown mode is now handled INLINE at the page level (see
// SetLoggerView → SessionCardListPage). No overlay view needed —
// the active cell's green `[]` Active border + live displayValue
// is the only visual the user sees. Removed `CrownOverlay` struct
// 2026-05-29 per user «不要跳出東西».
//
// Shared crown formatting helper, used by the inline crown handler.
func formatCrownValue(_ v: Double, field: CellField) -> String {
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

// MARK: - Previews

#Preview("Keypad – weight") {
    let state = SessionInteractionState()
    state.activeSetId = "s-1"
    state.activeCell = ActiveCell(setId: "s-1", field: .weight, buffer: "80")
    return CellEditOverlay(state: state)
        .frame(width: 200, height: 220)
        .background(Color.black)
}

#Preview("Keypad – reps (dot disabled)") {
    let state = SessionInteractionState()
    state.activeSetId = "s-1"
    state.activeCell = ActiveCell(setId: "s-1", field: .reps, buffer: "8")
    return CellEditOverlay(state: state)
        .frame(width: 200, height: 220)
        .background(Color.black)
}
