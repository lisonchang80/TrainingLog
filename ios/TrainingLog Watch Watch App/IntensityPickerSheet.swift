//
//  IntensityPickerSheet.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — 強度 sheet (sheet 3 in the picker flow).
//  Per ADR-0019 § Slice 13d D8 spec line 1717-1735.
//
//  Visual structure (matching ASCII mock line 1719-1728):
//
//    ┌──────────────────────────────────┐
//    │ ← 強度（Linear progression）     │   ← title carries program
//    │ ─────────────────────────────    │
//    │  • 通用                          │   ← virtual fallback row
//    │ ─────────────────────────────    │
//    │  • Volume day                    │
//    │  • Intensity day                 │
//    │  • Deload                        │
//    └──────────────────────────────────┘
//
//  Behavior:
//    - title 帶 program 名 disambiguates "which program's intensity"
//    - tap「通用」→ emit (template, program, nil)  ← bypass-style fallback
//    - tap any real intensity → emit (template, program, intensity)
//    - either path terminates the drill-down and enters Set logger
//

import SwiftUI

struct IntensityPickerSheet: View {
    let template: TemplateOption
    let program: ProgramOption

    /// Callback. `intensity == nil` ⇔ user tapped "通用" fallback.
    let onPick: (
        _ template: TemplateOption,
        _ program: ProgramOption,
        _ intensity: IntensityOption?
    ) -> Void

    var body: some View {
        List {
            // "通用" virtual fallback — per spec line 1733: each
            // program's 強度 sheet has its own "通用" fallback even
            // though "通用" is also already an option at the 計劃
            // sheet level. They're not the same thing: 計劃-通用
            // bypasses both sheets entirely; 強度-通用 means
            // "this program, but no specific intensity".
            Section {
                Button {
                    onPick(template, program, nil)
                } label: {
                    PlanRowLabel(marker: "•", text: "通用")
                }
                .buttonStyle(.plain)
            }

            // Real intensities. May be empty (program author didn't
            // configure any intensity 副標籤 on iPhone) — in that
            // case only "通用" is shown, which is still valid.
            if !program.intensities.isEmpty {
                Section {
                    ForEach(program.intensities) { intensity in
                        Button {
                            onPick(template, program, intensity)
                        } label: {
                            PlanRowLabel(marker: "•", text: intensity.name)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.carousel)
        .navigationTitle("強度（\(program.name)）")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Shared row label (duplicated, see ProgramPickerSheet.swift)

private struct PlanRowLabel: View {
    let marker: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 12, alignment: .center)
            Text(text)
                .font(.body)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Previews

#Preview("有 intensities") {
    NavigationStack {
        IntensityPickerSheet(
            template: TemplateOption(id: "t1", name: "推日（A）"),
            program: ProgramOption(
                id: "p1",
                name: "Linear progression W3",
                intensities: [
                    IntensityOption(id: "i1", name: "Volume day"),
                    IntensityOption(id: "i2", name: "Intensity day"),
                    IntensityOption(id: "i3", name: "Deload"),
                ]
            ),
            onPick: { _, _, _ in }
        )
    }
}

#Preview("只有通用 (intensities 空)") {
    NavigationStack {
        IntensityPickerSheet(
            template: TemplateOption(id: "t1", name: "推日（A）"),
            program: ProgramOption(
                id: "p1",
                name: "PPL W5",
                intensities: []
            ),
            onPick: { _, _, _ in }
        )
    }
}
