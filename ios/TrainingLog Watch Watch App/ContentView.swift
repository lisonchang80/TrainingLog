//
//  ContentView.swift
//  TrainingLog Watch
//
//  Slice 13d D4 placeholder + D0 spike A harness UI.
//  D8 replaces the placeholder block with the real 3-step picker UI
//  per ADR-0019 NEW-Q29 + NEW-Q17. The spike UI is throwaway and
//  stays on branch slice/13d-d0-spike-a only.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var spikeA = SpikeAHarness()

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("TrainingLog")
                    .font(.headline)
                Text("D4 scaffold")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("Picker UI ships in D8")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Divider().padding(.vertical, 4)

                Text("D0 Spike A")
                    .font(.caption)
                    .bold()
                Text("Q28 trigger-only HK")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Button(action: {
                    Task { await spikeA.runSpike() }
                }) {
                    if spikeA.isRunning {
                        Text("Running…")
                    } else {
                        Text("Run Spike A")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(spikeA.isRunning)

                Text(spikeA.status)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if let r = spikeA.report {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("verdict")
                            Spacer()
                            Text(r.verdict.uppercased())
                                .bold()
                                .foregroundStyle(verdictColor(r.verdict))
                        }
                        HStack {
                            Text("total")
                            Spacer()
                            Text("\(r.totalMs) ms")
                        }
                        HStack {
                            Text("HR during")
                            Spacer()
                            Text("\(r.hrSamplesDuringSession)")
                        }
                        HStack {
                            Text("HR after")
                            Spacer()
                            Text("\(r.hrSamplesAfterDiscard)")
                        }
                        HStack {
                            Text("workouts")
                            Spacer()
                            Text("\(r.workoutEntriesFound)")
                                .foregroundStyle(r.workoutEntryWritten ? .red : .green)
                        }
                        Text(r.summary)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                    }
                    .font(.caption2)
                    .padding(8)
                    .background(.gray.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding()
        }
    }

    private func verdictColor(_ v: String) -> Color {
        switch v {
        case "pass": return .green
        case "partial": return .orange
        default: return .red
        }
    }
}

#Preview {
    ContentView()
}
