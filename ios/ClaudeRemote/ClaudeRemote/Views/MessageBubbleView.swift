import SwiftUI

struct MessageBubbleView: View {
    let message: Message
    var viewModel: ConversationViewModel

    var body: some View {
        switch message.content {
        case .user(let text):
            userBubble(text: text)
        case .assistant(let blocks):
            if hasVisibleContent(blocks) {
                assistantBubble(blocks: blocks)
            }
        case .system(let text):
            systemBubble(text: text)
        case .requestInfo:
            EmptyView()
        case .askUserQuestion(let toolUseId, let questions):
            AskUserQuestionView(
                toolUseId: toolUseId,
                questions: questions,
                viewModel: viewModel
            )
        }
    }

    private func hasVisibleContent(_ blocks: [ContentBlock]) -> Bool {
        blocks.contains { block in
            switch block {
            case .text(let text): !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case .toolUse: true
            case .thinking(let text): !text.isEmpty
            }
        }
    }

    // MARK: - User

    private func userBubble(text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("You", systemImage: "person")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundStyle(.blue)

            MarkdownTextView(text: text)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(.blue.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Assistant

    private func assistantBubble(blocks: [ContentBlock]) -> some View {
        let toolBlocks = blocks.compactMap { block -> (String, String, String)? in
            if case .toolUse(let name, let id, let input) = block { return (name, id, input) }
            return nil
        }
        let thinkingBlocks = blocks.compactMap { block -> String? in
            if case .thinking(let text) = block, !text.isEmpty { return text }
            return nil
        }
        let textBlocks = blocks.compactMap { block -> String? in
            if case .text(let text) = block,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
            return nil
        }

        return ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 4) {
                // Thinking (collapsible)
                ForEach(Array(thinkingBlocks.enumerated()), id: \.offset) { _, text in
                    ThinkingView(text: text)
                }

                // Text content
                ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, text in
                    MarkdownTextView(text: text)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            // Extra bottom-right padding so the tool badge doesn't overlap text
            .padding(.bottom, !toolBlocks.isEmpty ? 4 : 0)

            // Tiny tool badge in bottom-right corner
            if !toolBlocks.isEmpty {
                ToolBadgeView(tools: toolBlocks)
                    .padding(4)
            }
        }
        #if os(iOS)
        .background(Color(.secondarySystemBackground))
        #else
        .background(Color(nsColor: .controlBackgroundColor))
        #endif
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - System

    private func systemBubble(text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .italic()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
    }
}

// MARK: - Tool Badge (bottom-right popover)

struct ToolBadgeView: View {
    let tools: [(name: String, id: String, input: String)]
    @State private var showSheet = false

    var body: some View {
        Button {
            showSheet.toggle()
        } label: {
            HStack(spacing: 2) {
                Image(systemName: "gearshape")
                    .font(.system(size: 8))
                Text("\(tools.count)")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 8))
            }
            .foregroundStyle(.orange.opacity(0.7))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(.orange.opacity(0.1))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showSheet) {
            ToolListSheet(tools: tools)
        }
    }
}

struct ToolListSheet: View {
    let tools: [(name: String, id: String, input: String)]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(tools.count) Tool Calls")
                    .font(.headline)
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
            }
            .padding()

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(tools.enumerated()), id: \.offset) { _, tool in
                        ToolUseView(name: tool.name, input: tool.input)
                    }
                }
                .padding()
            }
        }
        .frame(minWidth: 400, minHeight: 300, maxHeight: 600)
    }
}
