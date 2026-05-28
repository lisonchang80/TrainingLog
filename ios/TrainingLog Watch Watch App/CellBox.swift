//
//  CellBox.swift
//  TrainingLog Watch
//
//  Slice 13d D11 Phase B polish — reusable value cell visual.
//  Per user feedback 2026-05-28:
//    - "[]只是示意，實際是框" — render an actual rounded box,
//      not literal brackets in the text.
//    - "kg & 次 縮很小，放在框內右上" — unit label is smaller and
//      sits at the top-right corner inside the box; the number
//      itself is the primary content centered below.
//
//  Used by working / cluster header / cluster sub-set rows.
//  Warmup rows use `WarmupCellBox` variant (no border, dim text,
//  matches the parens "( ... )" idle visual per spec line 1384).
//

import SwiftUI

/// Standard editable cell box: number centered, unit small top-right.
/// Stroked rounded rectangle implies this is a tappable target that
/// enters `[]` Active (cell edit) in Phase C when the parent row is
/// `{}` Active.
///
/// Phase C wiring: when `onTap` is non-nil, the box is tappable; when
/// `isActive` is true, the border thickens + tints to indicate this
/// cell is currently being edited (the `▌▐` highlight in spec line
/// 1429).
struct CellBox: View {
    let value: String
    let unit: String

    /// Minimum width keeps cells of the same family (weight or reps)
    /// column-aligned across rows — weight boxes share `weightMinWidth`,
    /// reps boxes share `repsMinWidth`. This lets D1 / sub-1 / sub-2
    /// cluster rows align vertically without per-row width pinning.
    var minWidth: CGFloat = 0

    /// When true the box renders an `[]` Active highlight (thicker
    /// accent-color border). Phase C: set by parent when this cell
    /// is `state.activeCell`.
    var isActive: Bool = false

    /// Optional tap handler. When `nil`, the box is non-interactive
    /// (idle row / `{}` Active but cell mode not yet enabled). When
    /// non-nil, the box accepts taps and the parent routes to
    /// `state.activateCell(...)`.
    var onTap: (() -> Void)? = nil

    var body: some View {
        let strokeColor: Color = isActive
            ? Color.green
            : Color.secondary.opacity(0.5)
        let strokeWidth: CGFloat = isActive ? 1.6 : 0.8

        return ZStack(alignment: .topTrailing) {
            // Center: value digits
            Text(value)
                .font(.body)
                .monospacedDigit()
                .padding(.top, 8)   // leave headroom for the unit
                .padding(.bottom, 2)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)

            // Top-right inside the box: small unit label
            Text(unit)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
                .padding(.top, 1)
                .padding(.trailing, 4)
        }
        .frame(minWidth: minWidth)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .stroke(strokeColor, lineWidth: strokeWidth)
        )
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
        .onTapGesture {
            onTap?()
        }
    }
}

/// Warmup cell — no border, dim text, parens style per spec line 1384
/// `( 40 kg ) ( 12 次 )`. Warmup is non-editable in the canonical flow
/// (planned only), but Phase D will allow type-cycle warmup→working.
struct WarmupCellBox: View {
    let value: String
    let unit: String

    var minWidth: CGFloat = 0

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text("(")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            Text(unit)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            Text(")")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: minWidth, alignment: .center)
    }
}

// MARK: - Column-width constants

/// Shared widths so the same cell family aligns vertically across
/// rows of varying digit counts (`80` vs `40` vs `8` vs `12`).
enum CellMetrics {
    static let weightWidth: CGFloat = 52
    static let repsWidth: CGFloat = 40
}

// MARK: - Previews

#Preview("CellBox variants") {
    VStack(spacing: 6) {
        HStack(spacing: 4) {
            Text("1").font(.caption).frame(width: 20)
            CellBox(value: "80", unit: "kg", minWidth: CellMetrics.weightWidth)
            CellBox(value: "8", unit: "次", minWidth: CellMetrics.repsWidth)
            Image(systemName: "circle").frame(width: 28, height: 28)
        }
        HStack(spacing: 4) {
            Text("D1").font(.caption).frame(width: 20)
            CellBox(value: "80", unit: "kg", minWidth: CellMetrics.weightWidth)
            CellBox(value: "8", unit: "次", minWidth: CellMetrics.repsWidth)
            Image(systemName: "circle").frame(width: 28, height: 28)
        }
        HStack(spacing: 4) {
            Text("").frame(width: 20)
            CellBox(value: "40", unit: "kg", minWidth: CellMetrics.weightWidth)
            CellBox(value: "8", unit: "次", minWidth: CellMetrics.repsWidth)
        }
        HStack(spacing: 4) {
            Text("熱").font(.caption2).foregroundStyle(.secondary).frame(width: 20)
            WarmupCellBox(value: "40", unit: "kg", minWidth: CellMetrics.weightWidth)
            WarmupCellBox(value: "12", unit: "次", minWidth: CellMetrics.repsWidth)
            Image(systemName: "circle")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 28, height: 28)
        }
    }
    .padding()
}
