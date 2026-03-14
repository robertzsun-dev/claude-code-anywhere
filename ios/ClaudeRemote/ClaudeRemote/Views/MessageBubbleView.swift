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
        let textBlocks = blocks.filter { if case .text = $0 { return true }; return false }
        let toolBlocks = blocks.compactMap { block -> (String, String, String)? in
            if case .toolUse(let name, let id, let input) = block { return (name, id, input) }
            return nil
        }
        let thinkingBlocks = blocks.compactMap { block -> String? in
            if case .thinking(let text) = block { return text }
            return nil
        }

        return VStack(alignment: .leading, spacing: 4) {
            // Thinking (collapsible)
            ForEach(Array(thinkingBlocks.enumerated()), id: \.offset) { _, text in
                if !text.isEmpty {
                    ThinkingView(text: text)
                }
            }

            // Tool calls bundled into a single collapsible section
            if !toolBlocks.isEmpty {
                ToolCallsGroupView(tools: toolBlocks)
            }

            // Text content
            ForEach(Array(textBlocks.enumerated()), id: \.offset) { _, block in
                if case .text(let text) = block,
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    MarkdownTextView(text: text)
                        .textSelection(.enabled)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
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

// MARK: - Bundled Tool Calls

struct ToolCallsGroupView: View {
    let tools: [(name: String, id: String, input: String)]
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(tools.enumerated()), id: \.offset) { _, tool in
                    ToolUseView(name: tool.name, input: tool.input)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "gearshape")
                    .font(.system(size: 9))
                Text(toolSummary)
                    .font(.system(size: 10, design: .monospaced))
            }
            .foregroundStyle(.orange)
        }
        .tint(.orange)
    }

    private var toolSummary: String {
        let names = tools.map(\.name)
        let unique = NSOrderedSet(array: names).array as! [String]
        if unique.count <= 3 {
            return unique.joined(separator: ", ")
        }
        return "\(tools.count) tools"
    }
}
