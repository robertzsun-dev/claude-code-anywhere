import SwiftUI

struct ConversationView: View {
    var viewModel: ConversationViewModel
    @State private var inputText = ""

    /// Merge tool-only assistant messages into the next text-bearing assistant message.
    /// Keep assistant messages with text as separate bubbles for readable conversation flow.
    private var displayMessages: [Message] {
        var result: [Message] = []
        // Accumulate tool/thinking blocks from tool-only assistant messages
        var pendingToolBlocks: [ContentBlock] = []

        for message in viewModel.messages {
            // Skip requestInfo entirely
            if case .requestInfo = message.content { continue }

            if case .assistant(let blocks) = message.content {
                let hasText = blocks.contains { block in
                    if case .text(let t) = block {
                        return !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    }
                    return false
                }

                if hasText {
                    // This assistant message has text - attach any pending tool blocks
                    let merged = pendingToolBlocks + blocks
                    pendingToolBlocks = []
                    result.append(Message(
                        id: message.id,
                        content: .assistant(blocks: merged)
                    ))
                } else {
                    // Tool-only or empty - accumulate for the next text message
                    pendingToolBlocks += blocks
                }
            } else {
                // Non-assistant message: flush any pending tool blocks first
                if !pendingToolBlocks.isEmpty {
                    result.append(.assistant(blocks: pendingToolBlocks))
                    pendingToolBlocks = []
                }
                result.append(message)
            }
        }

        // Flush any remaining pending tool blocks
        if !pendingToolBlocks.isEmpty {
            result.append(.assistant(blocks: pendingToolBlocks))
        }

        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            // Stats bar
            StatsBarView(viewModel: viewModel)

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(displayMessages.enumerated()), id: \.element.id) { index, message in
                            MessageBubbleView(
                                message: message,
                                viewModel: viewModel
                            )
                            .id(index)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    let count = displayMessages.count
                    if count > 0 {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(count - 1, anchor: .bottom)
                        }
                    }
                }
            }

            // Suggestion overlay
            if let suggestion = viewModel.suggestionText, !suggestion.isEmpty {
                HStack {
                    Text(suggestion)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer()
                    Button("Tab") {
                        viewModel.sendTab()
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal)
                .padding(.vertical, 6)
                .background(.bar)
            }

            // Input bar
            InputBarView(
                inputText: $inputText,
                viewModel: viewModel
            )
        }
        .navigationTitle(viewModel.currentSessionId.map { "Session \(String($0.prefix(8)))" } ?? "Session")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(connectionColor)
            }
        }
        #endif
    }

    #if os(iOS)
    private var connectionColor: Color {
        switch viewModel.connectionState {
        case .connected: .green
        case .connecting, .reconnecting: .orange
        case .disconnected: .red
        }
    }
    #endif
}
