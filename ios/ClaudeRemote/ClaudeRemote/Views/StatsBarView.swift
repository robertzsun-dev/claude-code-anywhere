import SwiftUI

struct StatsBarView: View {
    var viewModel: ConversationViewModel

    private var maxContext: Int {
        contextWindowSize(for: viewModel.currentModel)
    }

    private var usableLimit: Int { Int(Double(maxContext) * 0.80) }

    private var contextPercent: Double {
        guard usableLimit > 0 else { return 0 }
        return min(Double(viewModel.latestContextTokens) / Double(usableLimit) * 100, 100)
    }

    private var contextColor: Color {
        if contextPercent > 90 { return .red }
        if contextPercent > 70 { return .orange }
        return .blue
    }

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 12) {
                if !viewModel.currentModel.isEmpty {
                    statLabel(viewModel.currentModel, icon: "cpu")
                }

                statLabel("\(viewModel.apiCalls) calls", icon: "arrow.up.arrow.down")
                statLabel("\(viewModel.toolCalls) tools", icon: "gearshape")
                statLabel(contextString, icon: "text.word.spacing")

                Spacer()

                statLabel("\(viewModel.eventCount) events", icon: "bolt")

                #if os(macOS)
                Circle()
                    .fill(connectionColor)
                    .frame(width: 8, height: 8)
                #endif
            }

            // Context meter
            if viewModel.latestContextTokens > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            #if os(iOS)
                            .fill(Color(.systemGray5))
                            #else
                            .fill(Color(nsColor: .separatorColor))
                            #endif
                        RoundedRectangle(cornerRadius: 2)
                            .fill(contextColor)
                            .frame(width: geo.size.width * contextPercent / 100)
                    }
                }
                .frame(height: 4)
                .padding(.horizontal, 4)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }

    private var contextString: String {
        let ctx = formatTokens(viewModel.latestContextTokens)
        let limit = formatTokens(maxContext)
        return "\(ctx)/\(limit)"
    }

    private func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return "\(n / 1_000_000)M" }
        if n >= 1_000 { return "\(n / 1_000)k" }
        return "\(n)"
    }

    private func statLabel(_ text: String, icon: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 9))
            Text(text)
                .font(.system(size: 10, design: .monospaced))
        }
        .foregroundStyle(.secondary)
    }

    #if os(macOS)
    private var connectionColor: Color {
        switch viewModel.connectionState {
        case .connected: .green
        case .connecting, .reconnecting: .orange
        case .disconnected: .red
        }
    }
    #endif

    /// Map model ID to context window size in tokens
    private func contextWindowSize(for model: String) -> Int {
        let m = model.lowercased()

        // Opus 4.6 defaults to 1M context
        if m.contains("opus-4-6") || m.contains("opus-4.6") { return 1_000_000 }

        // Explicit 1M suffix
        if m.contains("1m") { return 1_000_000 }

        // Older Opus (4, 4.5) default to 200K
        if m.contains("opus") { return 200_000 }

        // Sonnet family
        if m.contains("sonnet") { return 200_000 }

        // Haiku family
        if m.contains("haiku") { return 200_000 }

        // Default fallback
        return 200_000
    }
}
