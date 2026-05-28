//
//  WatchSettingsKeys.swift
//  TrainingLog Watch
//
//  Slice 13d D16 ⚙ settings — central storage-key + enum
//  definitions for the five in-session settings.
//  Per ADR-0019 § Slice 13d D16 spec (line 2223-2493), default
//  values frozen at line 2403-2413.
//
//  NOTE: `InputMode` already exists in `CellEditOverlay.swift`
//  (D11 Phase C) with `storageKey = "inputMode"`. We MUST NOT
//  rename or redeclare it — D11 cell-edit overlay still reads
//  the same key. This file only adds the missing four settings.
//
//  TODO: iPhone `app_settings` schema migration vXXX (impl 階段
//  補 5 INSERT INTO ON CONFLICT IGNORE, per ADR-0019 line 2447-2459).
//

import Foundation

// MARK: - Storage keys

/// Central catalogue of `@AppStorage` keys for the D16 settings sheet.
/// String constants live in one place so the channel-#12 sync payload
/// and the SwiftUI views read/write the same key names.
enum WatchSettingsKey {
    /// Existing key from D11 Phase C (`CellEditOverlay`). Reused
    /// verbatim — renaming would break the existing keypad/crown
    /// binding.
    static let inputMode = "inputMode"

    static let autoAdvance = "autoAdvance"
    static let restTimerMode = "restTimerMode"
    static let hrZone5Alert = "hrZone5Alert"
    static let hapticStrength = "hapticStrength"
}

// MARK: - Default values (per spec line 2403-2413)

enum WatchSettingsDefault {
    /// `輸入方式` default = 鍵盤
    static let inputMode: String = "keypad"

    /// `✓ 後自動跳下組` default = ON
    static let autoAdvance: Bool = true

    /// `Rest timer 模式` default = 彈窗 (popup)
    static let restTimerMode: String = "popup"

    /// `HR 區間 5 警示` default = OFF
    static let hrZone5Alert: Bool = false

    /// `觸覺回饋` default = 中 (medium)
    static let hapticStrength: String = "medium"
}

// MARK: - Picker enums

/// `Rest timer 模式` options (per spec View 4, chip 已砍).
enum RestTimerMode: String, CaseIterable, Identifiable {
    case popup
    case off

    var id: String { rawValue }

    /// Localised label for picker rows.
    var label: String {
        switch self {
        case .popup: return "彈窗"
        case .off: return "關閉"
        }
    }
}

/// `觸覺回饋` strength options (per spec View 5 + line 2342-2345
/// WKHapticType mapping).
enum HapticStrength: String, CaseIterable, Identifiable {
    case light
    case medium
    case heavy

    var id: String { rawValue }

    /// Localised label for picker rows.
    var label: String {
        switch self {
        case .light: return "弱 (Light)"
        case .medium: return "中 (Medium)"
        case .heavy: return "強 (Heavy)"
        }
    }

    /// Short summary surfaced as the right-side value on the root
    /// list row (per spec View 2「觸覺回饋  中 ›」).
    var shortLabel: String {
        switch self {
        case .light: return "弱"
        case .medium: return "中"
        case .heavy: return "強"
        }
    }
}

// MARK: - InputMode option list

extension InputMode: CaseIterable, Identifiable {
    public static var allCases: [InputMode] { [.keypad, .crown] }

    public var id: String { rawValue }

    /// Localised label for picker rows (per spec View 3).
    var label: String {
        switch self {
        case .keypad: return "鍵盤"
        case .crown: return "滾輪 (Crown)"
        }
    }

    /// Short summary surfaced on the root list (per spec View 2
    /// 「輸入方式  鍵盤 ›」).
    var shortLabel: String {
        switch self {
        case .keypad: return "鍵盤"
        case .crown: return "滾輪"
        }
    }
}

// MARK: - Sync payload (channel #12 `settings-sync`)

/// Codable struct that channel #12 `settings-sync` will push to
/// iPhone `app_settings` SQLite mirror at session end. Field
/// names mirror the iPhone schema (`watch_*` columns, per spec
/// line 2447-2457).
///
/// Channel-#12 wire-in lives in D7/D9 — this struct is the
/// data shape only.
struct WatchSettingsSyncPayload: Codable, Equatable {
    let watchInputMode: String
    let watchAutoAdvance: Bool
    let watchRestTimerMode: String
    let watchHrZone5Alert: Bool
    let watchHapticStrength: String

    enum CodingKeys: String, CodingKey {
        case watchInputMode = "watch_input_mode"
        case watchAutoAdvance = "watch_auto_advance"
        case watchRestTimerMode = "watch_rest_timer_mode"
        case watchHrZone5Alert = "watch_hr_zone5_alert"
        case watchHapticStrength = "watch_haptic_strength"
    }
}

/// Read-only façade over the five `@AppStorage` keys. Used by the
/// sync layer to build a payload without coupling to SwiftUI views.
enum WatchSettings {
    /// Build a sync payload from the current `@AppStorage` values.
    /// Falls back to spec defaults for any unset key.
    ///
    /// TODO: D7/D9 wire channel #12 push at session end (per D14
    /// [完成] tap, ADR-0019 line 2415-2445).
    static func buildSyncPayload() -> WatchSettingsSyncPayload {
        let defaults = UserDefaults.standard

        let inputMode = defaults.string(forKey: WatchSettingsKey.inputMode)
            ?? WatchSettingsDefault.inputMode
        let restTimerMode = defaults.string(forKey: WatchSettingsKey.restTimerMode)
            ?? WatchSettingsDefault.restTimerMode
        let hapticStrength = defaults.string(forKey: WatchSettingsKey.hapticStrength)
            ?? WatchSettingsDefault.hapticStrength

        // BoolForKey returns false for unset keys — we need to
        // detect "unset" so we apply the spec default (autoAdvance
        // defaults to true, not false).
        let autoAdvance: Bool
        if defaults.object(forKey: WatchSettingsKey.autoAdvance) == nil {
            autoAdvance = WatchSettingsDefault.autoAdvance
        } else {
            autoAdvance = defaults.bool(forKey: WatchSettingsKey.autoAdvance)
        }

        let hrZone5Alert: Bool
        if defaults.object(forKey: WatchSettingsKey.hrZone5Alert) == nil {
            hrZone5Alert = WatchSettingsDefault.hrZone5Alert
        } else {
            hrZone5Alert = defaults.bool(forKey: WatchSettingsKey.hrZone5Alert)
        }

        return WatchSettingsSyncPayload(
            watchInputMode: inputMode,
            watchAutoAdvance: autoAdvance,
            watchRestTimerMode: restTimerMode,
            watchHrZone5Alert: hrZone5Alert,
            watchHapticStrength: hapticStrength
        )
    }
}
