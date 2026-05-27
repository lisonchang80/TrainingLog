//
//  ContentView.swift
//  TrainingLog Watch
//
//  Slice 13d D4 placeholder. D8 replaces this with the picker root
//  3-step UI per ADR-0019 NEW-Q29 + NEW-Q17.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("TrainingLog")
                .font(.headline)
            Text("D4 scaffold")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Picker UI ships in D8")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
