//
//  WatchSettingsView.swift
//  TrainingLog Watch
//
//  Slice 13d D16 ⚙ settings — sheet root + three picker sub-pages.
//  Per ADR-0019 § Slice 13d D16 spec (line 2223-2493).
//
//  Anatomy (frozen):
//    View 2 — D16 sheet root: 5-row list (2 toggle + 3 picker `›`)
//    View 3 — 「輸入方式」picker sub-page (keypad / crown)
//    View 4 — 「Rest timer 模式」picker sub-page (popup / off)
//    View 5 — 「觸覺回饋」picker sub-page (light / medium / heavy)
//
//  Out of scope (this commit):
//    - WC channel #12 settings-sync push at session end (D7/D9 wires it).
//    - WC unreachable ⚠ banner on D14 完成頁 (Agent A range).
//    - iPhone `app_settings` schema migration vXXX (impl 階段補).
//    - Real haptic strength gating (this view writes the setting;
//      the three haptic call sites still use `.click` until callers
//      switch over).
//

import SwiftUI
import WatchKit

// MARK: - Navigation destinations

/// Value-based navigation targets pushed from the root list.
/// `Hashable` is auto-derived from the enum's plain cases.
private enum WatchSettingsDestination: Hashable {
    case inputMode
    case restTimerMode
    case hapticStrength
}

// MARK: - Sheet root (View 2)

/// Sheet content shown when the D11 top bar ⚙ icon is tapped.
/// Wraps the list in its own `NavigationStack` so the three picker
/// sub-pages can push without leaking back to D11's nav stack.
struct WatchSettingsView: View {
    @State private var path: [WatchSettingsDestination] = []

    @AppStorage(WatchSettingsKey.inputMode)
    private var inputModeRaw: String = WatchSettingsDefault.inputMode

    @AppStorage(WatchSettingsKey.autoAdvance)
    private var autoAdvance: Bool = WatchSettingsDefault.autoAdvance

    @AppStorage(WatchSettingsKey.restTimerMode)
    private var restTimerModeRaw: String = WatchSettingsDefault.restTimerMode

    @AppStorage(WatchSettingsKey.hrZone5Alert)
    private var hrZone5Alert: Bool = WatchSettingsDefault.hrZone5Alert

    @AppStorage(WatchSettingsKey.hapticStrength)
    private var hapticStrengthRaw: String = WatchSettingsDefault.hapticStrength

    private var inputMode: InputMode {
        InputMode(rawValue: inputModeRaw) ?? .keypad
    }
    private var restTimerMode: RestTimerMode {
        RestTimerMode(rawValue: restTimerModeRaw) ?? .popup
    }
    private var hapticStrength: HapticStrength {
        HapticStrength(rawValue: hapticStrengthRaw) ?? .medium
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                // Row 1 — 輸入方式 (picker)
                SettingsPickerRow(
                    label: "輸入方式",
                    value: inputMode.shortLabel,
                    destination: .inputMode
                )

                // Row 2 — ✓ 後自動跳下組 (toggle)
                SettingsToggleRow(
                    label: "✓ 後自動跳下組",
                    isOn: $autoAdvance
                )

                // Row 3 — Rest timer 模式 (picker)
                SettingsPickerRow(
                    label: "Rest timer 模式",
                    value: restTimerMode.label,
                    destination: .restTimerMode
                )

                // Row 4 — HR 區間 5 警示 (toggle)
                SettingsToggleRow(
                    label: "HR 區間 5 警示",
                    isOn: $hrZone5Alert
                )

                // Row 5 — 觸覺回饋 (picker)
                SettingsPickerRow(
                    label: "觸覺回饋",
                    value: hapticStrength.shortLabel,
                    destination: .hapticStrength
                )
            }
            .navigationTitle("設定")
            .navigationDestination(for: WatchSettingsDestination.self) { dest in
                switch dest {
                case .inputMode:
                    InputModePickerView()
                case .restTimerMode:
                    RestTimerModePickerView()
                case .hapticStrength:
                    HapticStrengthPickerView()
                }
            }
        }
    }
}

// MARK: - Root row components

/// Toggle row used by the two boolean settings (`autoAdvance`,
/// `hrZone5Alert`). Tap on the entire row flips the binding —
/// matches spec line 2383 「tap toggle row」+ 輕觸覺.
private struct SettingsToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
            WKInterfaceDevice.current().play(.click)
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(.primary)
                Spacer()
                Text(isOn ? "ON" : "OFF")
                    .font(.caption)
                    .foregroundStyle(isOn ? Color.green : .secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

/// Picker row that pushes a sub-page. `›` chevron + current value
/// match spec View 2 「鍵盤 ›」.
private struct SettingsPickerRow: View {
    let label: String
    let value: String
    let destination: WatchSettingsDestination

    var body: some View {
        NavigationLink(value: destination) {
            HStack {
                Text(label)
                    .foregroundStyle(.primary)
                Spacer()
                Text(value)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - View 3: 輸入方式 picker

/// Sub-page for the two input modes (keypad / crown).
/// Per spec line 2390: tap option → ✓ + 即時生效 + auto-pop back.
private struct InputModePickerView: View {
    @AppStorage(WatchSettingsKey.inputMode)
    private var raw: String = WatchSettingsDefault.inputMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(InputMode.allCases) { mode in
                PickerOptionRow(
                    label: mode.label,
                    isSelected: mode.rawValue == raw
                ) {
                    raw = mode.rawValue
                    WKInterfaceDevice.current().play(.click)
                    dismiss()
                }
            }

            // Bottom hint mirrors spec View 3 footer.
            Section {
                Text("鍵盤：4×3 數字面板、Done 退出")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text("滾輪：Crown 旋轉即時生效")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .navigationTitle("輸入方式")
    }
}

// MARK: - View 4: Rest timer 模式 picker

/// Sub-page for the two rest-timer modes (popup / off).
/// Chip mode was struck per Q2=B (line 2322); only 2 options remain.
private struct RestTimerModePickerView: View {
    @AppStorage(WatchSettingsKey.restTimerMode)
    private var raw: String = WatchSettingsDefault.restTimerMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(RestTimerMode.allCases) { mode in
                PickerOptionRow(
                    label: mode == .popup ? "彈窗 (Modal)" : "關閉",
                    isSelected: mode.rawValue == raw
                ) {
                    raw = mode.rawValue
                    WKInterfaceDevice.current().play(.click)
                    dismiss()
                }
            }

            Section {
                Text("彈窗：✓ 後跳 modal、Crown 滾秒或 tap dismiss、震動+音")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text("關閉：完全不啟動 rest timer")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .navigationTitle("Rest timer 模式")
    }
}

// MARK: - View 5: 觸覺回饋 picker

/// Sub-page for the three haptic strengths (light / medium / heavy).
/// All three options play their corresponding `WKHapticType` on tap
/// so the user can preview the difference before committing.
private struct HapticStrengthPickerView: View {
    @AppStorage(WatchSettingsKey.hapticStrength)
    private var raw: String = WatchSettingsDefault.hapticStrength
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(HapticStrength.allCases) { strength in
                PickerOptionRow(
                    label: strength.label,
                    isSelected: strength.rawValue == raw
                ) {
                    raw = strength.rawValue
                    // Preview the chosen strength so user feels the diff.
                    // Per spec line 2342-2345 mapping.
                    switch strength {
                    case .light:
                        WKInterfaceDevice.current().play(.click)
                    case .medium:
                        WKInterfaceDevice.current().play(.success)
                    case .heavy:
                        WKInterfaceDevice.current().play(.notification)
                    }
                    dismiss()
                }
            }
        }
        .navigationTitle("觸覺回饋")
    }
}

// MARK: - Picker option row (shared by 3 sub-pages)

/// Single-tap row used inside picker sub-pages. Renders ✓ on the
/// currently-selected option. Per anti-patterns: avoid SwiftUI
/// `Picker` on watchOS (behaviour mismatched) — build manually
/// via List + tap action.
private struct PickerOptionRow: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: isSelected ? "checkmark" : "circle")
                    .font(.caption)
                    .foregroundStyle(isSelected ? Color.green : Color.secondary)
                    .frame(width: 18)
                Text(label)
                    .foregroundStyle(.primary)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Previews

#Preview("D16 sheet root") {
    WatchSettingsView()
}

#Preview("D16 — 輸入方式 picker") {
    NavigationStack {
        InputModePickerView()
    }
}

#Preview("D16 — Rest timer 模式 picker") {
    NavigationStack {
        RestTimerModePickerView()
    }
}

#Preview("D16 — 觸覺回饋 picker") {
    NavigationStack {
        HapticStrengthPickerView()
    }
}
