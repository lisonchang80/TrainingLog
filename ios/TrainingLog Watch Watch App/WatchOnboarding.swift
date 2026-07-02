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
    case bSwipe
    case bLongPress
    case bPages
    case bFinish

    var id: Int { rawValue }

    static let partA: [WatchOnboardingCard] = [.aWelcome, .aHowToStart, .aWhereList]
    static let partB: [WatchOnboardingCard] = [.bSelect, .bLogEdit, .bSwipe, .bLongPress, .bPages, .bFinish]
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
        VStack(spacing: 6) {
            // Content scrolls (crown) so multi-line copy never gets clipped on
            // the smallest 40mm face; the CTA stays pinned below it.
            ScrollView {
                VStack(spacing: 6) {
                    content
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            Button(action: onNext) {
                Text(ctaLabel)
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 6)
        .padding(.bottom, 2)
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
            Text("💪").font(.system(size: 40))
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
            title("先點一下 → 綠框")
            mockRow(border: .green)
            hint("綠框＝已選取，才能編輯")

        case .bLogEdit:
            title("綠框狀態下…")
            keyLine("點圓圈", "◯ → ✓ 記錄這組")
            keyLine("點 80 或 8", "跳鍵盤改數字")
            hint("沒選取時，點整列不會編輯")

        case .bSwipe:
            title("滑整列 ＝ 加 / 刪")
            keyLine("→ 右滑", "＋ 加一組")
            keyLine("← 左滑", "🗑 刪這組")
            hint("先點成綠框，再滑")

        case .bLongPress:
            title("長按 → 橘框")
            mockRow(border: .orange, trailing: "⋮")
            hint("長按已選的列 → 橘色可拖曳換順序；有備註會一起顯示")

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

    private func keyLine(_ lead: String, _ trail: String) -> some View {
        HStack(spacing: 4) {
            Text(lead).font(.caption).fontWeight(.semibold)
            Text(trail).font(.caption).foregroundStyle(.secondary)
        }
    }

    /// A miniature set-row with a coloured stroke to convey the select
    /// (green) / drag (orange) frame states.
    private func mockRow(border: Color, trailing: String = "◯") -> some View {
        HStack(spacing: 5) {
            Text("1").foregroundStyle(.secondary)
            Text("胸推")
            Spacer(minLength: 6)
            Text("80")
            Text("8")
            Text(trailing)
        }
        .font(.caption2)
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(border, lineWidth: 2)
        )
        .padding(.horizontal, 6)
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

#Preview("Part A") {
    WatchOnboardingView(cards: WatchOnboardingCard.partA, onDone: {})
}

#Preview("Part B") {
    WatchOnboardingView(cards: WatchOnboardingCard.partB, onDone: {})
}
