//
//  WatchOnboarding.swift
//  TrainingLog Watch
//
//  ADR-0030 — Watch 首啟引導（two-part just-in-time guide）。
//
//  The iPhone has a 5-step onboarding wizard (ADR-0029) + a coach/help
//  overlay system, but the Watch had ZERO onboarding infrastructure.
//  This file adds a lightweight, watch-native full-screen card carousel
//  shown in two moments:
//
//    Part A (picker intro)   — auto once on first picker appear.
//                              Teaches "how to start" + "where the list
//                              comes from". Does NOT mention starting on
//                              the iPhone (per user, 2026-07-02).
//    Part B (gesture guide)  — auto once the first time a SetLoggerView
//                              mounts (any entry path — Watch-led OR an
//                              iPhone cast). Teaches the wrist gestures:
//                              green-frame select (edit gate), tap-to-log
//                              / edit, swipe add/delete, long-press orange
//                              reorder + notes, the 3-page swipe, finish.
//
//  A ⓘ button on the picker (top-leading) re-runs the FULL guide (A + B)
//  as one review carousel — the Watch settings sheet is in-session only,
//  so it can't host a re-run entry (ADR-0030 §Re-run).
//
//  No spotlight/coach-mark on the Watch: the screen is tiny and there's no
//  overlay infra. Full-screen instructional cards are the watch-native
//  form. All copy is hardcoded zh (the Watch app has no i18n layer — every
//  other Watch string is a zh literal too).
//

import SwiftUI

// MARK: - Storage keys (first-launch seen-once flags)

/// `@AppStorage` keys for the two auto-trigger flags. Namespaced alongside
/// the other Watch UserDefaults keys (see WatchSettingsKey). Both default to
/// `false` (unset) → the guide auto-shows once, then the flag pins `true`.
enum WatchOnboardingKey {
    /// Part A — picker intro carousel, auto-shown once on first picker appear.
    static let pickerSeen = "watch_onboarding_picker_seen"
    /// Part B — set-logger gesture carousel, auto-shown once on first session.
    static let gesturesSeen = "watch_onboarding_gestures_seen"
}

// MARK: - Which guide to present

/// Drives the `.fullScreenCover(item:)` on PickerRootView. `.gestures` is
/// presented from SetLoggerView via a plain `isPresented` bool, so it's not
/// used as a picker item — kept here for symmetry / a future single host.
enum WatchGuideMode: Int, Identifiable {
    case pickerIntro   // Part A only (first launch)
    case gestures      // Part B only (first session)
    case full          // A + B (manual re-run from the ⓘ button)

    var id: Int { rawValue }

    var cards: [WatchOnboardingCard] {
        switch self {
        case .pickerIntro: return WatchOnboardingCard.partA
        case .gestures: return WatchOnboardingCard.partB
        case .full: return WatchOnboardingCard.partA + WatchOnboardingCard.partB
        }
    }
}

// MARK: - Card catalogue

/// One card per teaching. Order within each part is the reading order.
enum WatchOnboardingCard: Int, Identifiable, CaseIterable {
    // Part A — picker intro
    case aWelcome
    case aHowToStart
    case aWhereList
    // Part B — gesture guide
    case bSelect
    case bLogEdit
    case bCycleType
    case bSwipe
    case bLongPress
    case bPages
    case bFinish

    var id: Int { rawValue }

    static let partA: [WatchOnboardingCard] = [.aWelcome, .aHowToStart, .aWhereList]
    static let partB: [WatchOnboardingCard] = [.bSelect, .bLogEdit, .bCycleType, .bSwipe, .bLongPress, .bPages, .bFinish]
}

// MARK: - Carousel host

/// Full-screen paged carousel. Advances via swipe (native `.page` dots) OR
/// the on-card CTA button. Calls `onDone` when the last card's CTA is tapped.
struct WatchOnboardingView: View {
    let cards: [WatchOnboardingCard]
    let onDone: () -> Void

    @State private var index = 0

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(cards.enumerated()), id: \.element.id) { i, card in
                WatchOnboardingCardView(
                    card: card,
                    isLast: i == cards.count - 1,
                    onNext: { advance(from: i) }
                )
                .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .automatic))
    }

    private func advance(from i: Int) {
        if i >= cards.count - 1 {
            onDone()
        } else {
            withAnimation { index = i + 1 }
        }
    }
}

// MARK: - Single card

private struct WatchOnboardingCardView: View {
    let card: WatchOnboardingCard
    let isLast: Bool
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 2) {
            // Content scrolls (crown) so multi-line copy never gets clipped on
            // the smallest 40mm face; the CTA hugs the bottom below it.
            ScrollView {
                VStack(spacing: 6) {
                    content
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
                // Generous bottom slack so the LAST line (caption) can scroll
                // fully clear of the pinned CTA — on 40mm a tall card otherwise
                // leaves the caption stuck against the button even at max scroll
                // (user 2026-07-02「滑到底還是被蓋住」).
                .padding(.bottom, 32)
            }
            Button(action: onNext) {
                Text(ctaLabel)
                    .font(.caption2.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.mini)   // smallest pill; sits low so content gets the room
            .tint(.blue)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 6)
        // Negative bottom padding lets the card bottom (and the CTA pinned to it)
        // drop into the TabView's page-indicator reserve band, seating the button
        // lower/closer to the dots — while keeping the dots visible
        // (user 2026-07-02「按鈕往下擺多一些」×2). Tuned to sit just above the dots
        // without overlapping them.
        .padding(.bottom, -20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: CTA label

    private var ctaLabel: String {
        if card == .aWelcome { return "開始" }
        if !isLast { return "下一步" }
        switch card {
        case .aWhereList: return "知道了"   // Part-A-only last card
        case .bFinish: return "開始訓練！"  // Part-B / full last card
        default: return "完成"
        }
    }

    // MARK: Content per card

    @ViewBuilder
    private var content: some View {
        switch card {
        case .aWelcome:
            Text("💪").font(.system(size: 34))
            Text("TrainingLog 手錶版").font(.headline)
            Text("在手腕上記錄每一組")
                .font(.footnote).foregroundStyle(.secondary)

        case .aHowToStart:
            title("怎麼開始訓練？")
            body2("點「計劃訓練」→ 今天排的課")
            body2("點「模板訓練」→ 你存的範本")
            hint("選下去就直接開始記錄")

        case .aWhereList:
            title("清單哪裡來？")
            body2("計劃與模板都在 iPhone 建好，會自動同步到手錶")
            hint("空的？先去手機建一個模板")

        case .bSelect:
            title("點一下 → 綠框")
            RealCardMock(border: .selected)
            hint("綠色外框＝已選取，才能編輯")

        case .bLogEdit:
            title("綠框下記錄 / 改值")
            RealCardMock(border: .selected, logged: true)
            hint("點 ◯ 打勾記錄；點 80 或 8 跳鍵盤改值")

        case .bCycleType:
            title("點號碼換組型")
            RealCardMock(border: .selected, numberHighlight: true)
            hint("點左側號碼循環：工作 → 暖身 → 遞減 D")

        case .bSwipe:
            title("滑整列 ＝ 加 / 刪")
            RealCardMock(border: .selected, reveal: .both)
            hint("右滑露出綠 ＋ 加一組；左滑露出紅 🗑 刪這組")

        case .bLongPress:
            title("長按 → 橘框")
            RealCardMock(border: .reorder)
            hint("橘色可上下拖曳換順序；有備註會一起顯示")

        case .bPages:
            title("這頁會左右滑換頁")
            pageDiagram
            hint("最左＝結束、最右＝音樂")

        case .bFinish:
            title("結束訓練")
            body2("滑到最左的「完成頁」，看統計 → 按〔完成〕")
            hint("⚙ 想調設定？記錄頁右上角")
        }
    }

    // MARK: Content builders

    private func title(_ s: String) -> some View {
        Text(s)
            .font(.headline)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func body2(_ s: String) -> some View {
        Text(s)
            .font(.caption)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func hint(_ s: String) -> some View {
        Text(s)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// 完成 ◀ 記錄 ▶ 音樂 three-page layout.
    private var pageDiagram: some View {
        HStack(spacing: 3) {
            pageBox("✓", "完成")
            arrow
            pageBox("●", "記錄", highlight: true)
            arrow
            pageBox("♪", "音樂")
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.left.and.right")
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
    }

    private func pageBox(_ glyph: String, _ label: String, highlight: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(glyph).font(.caption2)
            Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 5)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(highlight ? Color.blue : Color.gray.opacity(0.5),
                        lineWidth: highlight ? 2 : 1)
        )
    }
}

// MARK: - Faithful set-card replica (Part B)

/// A miniature that mirrors the REAL `ExerciseCard` + `InteractiveSetRow` +
/// `CellBox` so the gesture cards look like what the user actually sees in the
/// set logger (per user 2026-07-02 "畫得跟實際一樣"). Verified against
/// ExerciseCard.swift / CellBox.swift:
///   card   = RoundedRectangle(10).fill(secondary.opacity(0.15)), pad v6/h4
///   (header 動作名 + progress bar were dropped 2026-07-02 to give the caption
///    below the card more room — only the interactive `row` is shown now.)
///   row    = [號碼 20 .caption] [CellBox 重量 52] [CellBox 次數 40] [✓ .body],
///            wrapped in a rounded-4 border: .green(selected) / .orange(reorder)
///   reveal = `plus.circle.fill`(.green) leading / `trash.fill`(.red) trailing
///   cell   = rounded-4 stroke secondary.opacity(0.5), value .body monospaced,
///            unit size-8 top-trailing (widths 52 / 40 per CellMetrics).
private struct RealCardMock: View {
    enum Border { case selected, reorder }
    enum Reveal { case none, add, delete, both }

    var border: Border = .selected
    var logged: Bool = false
    var reveal: Reveal = .none
    var numberHighlight: Bool = false

    var body: some View {
        // Onboarding gesture cards show ONLY the set row — the exercise-name
        // header (胸推) and the progress bar are dropped so the caption below the
        // card gets more room (user 2026-07-02「把胸推與進度條都切掉」). None of the
        // gesture lessons (green/orange border, ✓, number highlight, ＋/🗑 reveal)
        // depend on the header or bar; `logged` still drives the row's ✓.
        VStack(alignment: .leading, spacing: 0) {
            row
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.15))
        )
    }

    private var borderColor: Color {
        border == .reorder ? .orange : .green
    }

    private var row: some View {
        HStack(spacing: 4) {
            HStack(spacing: 4) {
                Text("1")
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .frame(width: 20, alignment: .center)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(numberHighlight ? Color.green.opacity(0.35) : Color.clear)
                    )
                cell("80", "kg", width: 52)
                cell("8", "次", width: 40)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(borderColor, lineWidth: border == .reorder ? 2.5 : 2.0)
            )
            // Swipe-reveal actions ride ON the row's edges, mirroring the real
            // swipe-to-reveal (green ＋ slides in from leading, 🗑 from trailing)
            // so the demo never overflows the 40mm width.
            .overlay(alignment: .leading) {
                if reveal == .add || reveal == .both {
                    Image(systemName: "plus.circle.fill")
                        .font(.body)
                        .foregroundStyle(.green)
                        .padding(.leading, 3)
                }
            }
            .overlay(alignment: .trailing) {
                if reveal == .delete || reveal == .both {
                    Image(systemName: "trash.fill")
                        .font(.body)
                        .foregroundStyle(.red)
                        .padding(.trailing, 3)
                }
            }
            if reveal == .none {
                Image(systemName: logged ? "checkmark.circle.fill" : "circle")
                    .font(.body)
                    .foregroundStyle(logged ? Color.green : Color.secondary)
            }
        }
        .padding(.vertical, 1)
    }

    private func cell(_ value: String, _ unit: String, width: CGFloat) -> some View {
        ZStack(alignment: .topTrailing) {
            Text(value)
                .font(.body)
                .monospacedDigit()
                .padding(.top, 8)
                .padding(.bottom, 2)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)
            Text(unit)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
                .padding(.top, 1)
                .padding(.trailing, 4)
        }
        .frame(width: width)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.secondary.opacity(0.5), lineWidth: 0.8)
        )
    }
}

#Preview("Part A") {
    WatchOnboardingView(cards: WatchOnboardingCard.partA, onDone: {})
}

#Preview("Part B") {
    WatchOnboardingView(cards: WatchOnboardingCard.partB, onDone: {})
}
