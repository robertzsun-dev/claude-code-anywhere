import SwiftUI

struct StatsBarView: View {
    var viewModel: ConversationViewModel

    private let maxContext = 200_000
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
                statLabel(tokenString, icon: "number")

                Spacer()

                statLabel("\(viewModel.eventCount) events", icon: "bolt")
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

    private var tokenString: String {
        let inK = viewModel.inputTokens > 1000 ? "\(viewModel.inputTokens / 1000)k" : "\(viewModel.inputTokens)"
        let outK = viewModel.outputTokens > 1000 ? "\(viewModel.outputTokens / 1000)k" : "\(viewModel.outputTokens)"
        return "\(inK)/\(outK)"
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
}
