//
//  ProgramPickerSheet.swift
//  TrainingLog Watch
//
//  Slice 13d D8 Phase 1 — 計劃 sheet (sheet 2 in the picker flow).
//  Per ADR-0019 § Slice 13d D8 spec line 1698-1716.
//
//  Visual structure (matching ASCII mock line 1700-1708):
//
//    ┌──────────────────────────────────┐
//    │ ← 計劃                           │   ← inline title
//    │ ─────────────────────────────    │
//    │  • 通用                          │   ← virtual fallback row
//    │ ─────────────────────────────    │
//    │  • Linear progression W3         │
//    │  • PPL W5                        │
//    │  ...
//    └──────────────────────────────────┘
//
//  Behavior (spec line 1714):
//    - tap「通用」→ bypass 強度 sheet, emit (template, nil, nil)
//    - tap any real program → drill into 強度 sheet with that program
//

import SwiftUI

struct ProgramPickerSheet: View {
    let template: TemplateOption
    let programs: [ProgramOption]

    /// Callback. `program == nil` ⇔ user tapped "通用" fallback.
    let onPick: (_ template: TemplateOption, _ program: ProgramOption?) -> Void

    var body: some View {
        List {
            // "通用" virtual fallback — always at top, in its own
            // section so a native section divider visually separates
            // it from real programs.
            Section {
                Button {
                    onPick(template, nil)
                } label: {
                    PlanRowLabel(marker: "•", text: "通用")
                }
                .buttonStyle(.plain)
            }

            // Real programs from data. May be empty (user has no
            // active program on iPhone) — in that case only "通用"
            // is shown, which is still a valid path.
            if !programs.isEmpty {
                Section {
                    ForEach(programs) { program in
                        Button {
                            onPick(template, program)
                        } label: {
                            PlanRowLabel(marker: "•", text: program.name)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.carousel)
        .navigationTitle("計劃")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Shared row label
//
// Mirror of PickerRootView's PlanRowLabel; intentionally duplicated
// (file-private in each view file) so each sheet can ship as a
// self-contained file. Phase 2 may consolidate into a shared row
// component if more sheets need the same layout.

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

#Preview("有 programs") {
    NavigationStack {
        ProgramPickerSheet(
            template: TemplateOption(id: "t1", name: "推日（A）"),
            programs: [
                ProgramOption(
                    id: "p1",
                    name: "Linear progression W3",
                    intensities: []
                ),
                ProgramOption(id: "p2", name: "PPL W5", intensities: []),
                ProgramOption(id: "p3", name: "PHUL W2", intensities: []),
            ],
            onPick: { _, _ in }
        )
    }
}

#Preview("只有通用 (programs 空)") {
    NavigationStack {
        ProgramPickerSheet(
            template: TemplateOption(id: "t1", name: "推日（A）"),
            programs: [],
            onPick: { _, _ in }
        )
    }
}
