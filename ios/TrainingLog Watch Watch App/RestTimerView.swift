//
//  RestTimerView.swift
//  TrainingLog Watch
//
//  Watch rest timer popup (2026-07-02). Full-screen, watch-native:
//  circular progress ring + mm:ss countdown + exercise name + "第 N 組完成"
//  + single [跳過]. A `TimelineView(.periodic)` re-derives the ring + label
//  from the controller's wall-clock `endAt` every second, so the countdown
//  is glanceable and self-correcting. Driven by RestTimerController; the
//  controller auto-dismisses on the finished edge (00:00) after a 0.4s flash.
//
//  Design (grill 2026-07-02): 全螢幕彈窗 (mirror iPhone + 對齊「彈窗」設定名)
//  / 環+數字 / 到 0 只震動 (「震動即可」) / 轉表冠·點跳過皆可提早關.
//

import SwiftUI

struct RestTimerView: View {
    @ObservedObject var controller: RestTimerController

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = context.date
            let remaining = RestTimerLogic.remainingSeconds(endAt: controller.endAt, now: now)
            let progress = RestTimerLogic.progress(
                endAt: controller.endAt, totalSec: controller.totalSec, now: now)
            let done = controller.finished || remaining <= 0

            VStack(spacing: 5) {
                Text(done
                     ? "✓ 休息結束！"
                     : "\(controller.exerciseName) · 休息中")
                    .font(.caption2)
                    .foregroundStyle(done ? Color.green : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                ZStack {
                    Circle()
                        .stroke(Color.secondary.opacity(0.25), lineWidth: 6)
                    // Remaining arc shrinks as time elapses (1 - elapsed).
                    Circle()
                        .trim(from: 0, to: max(0.001, 1 - progress))
                        .stroke(done ? Color.green : Color.blue,
                                style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.25), value: progress)
                    Text(RestTimerLogic.formatRemaining(remaining))
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(done ? Color.green : Color.primary)
                }
                .frame(width: 92, height: 92)

                Text(done ? "下一組開始" : "第 \(controller.setOrdinal) 組完成")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                if !done {
                    Button {
                        controller.skip()
                    } label: {
                        Text("跳過")
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.blue)
                    .padding(.top, 1)
                }
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
