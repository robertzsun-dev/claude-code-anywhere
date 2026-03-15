import SwiftUI

struct InputBarView: View {
    @Binding var inputText: String
    var viewModel: ConversationViewModel

    /// Detect if the last assistant message looks like a plan
    private var lastMessageLooksPlanLike: Bool {
        guard let last = viewModel.messages.last else { return false }
        if case .assistant(let blocks) = last.content {
            let text = blocks.compactMap { block -> String? in
                if case .text(let t) = block { return t }
                return nil
            }.joined()
            let lower = text.lowercased()
            // Heuristic: numbered steps or explicit plan language
            if lower.contains("1.") && lower.contains("2.") { return true }
            if lower.contains("plan") && lower.contains("step") { return true }
            if lower.contains("here's my plan") || lower.contains("here is my plan") { return true }
            if lower.contains("implementation plan") { return true }
        }
        return false
    }

    /// Show plan actions when waiting for input and response looks plan-like
    private var showPlanActions: Bool {
        viewModel.isWaitingForInput && lastMessageLooksPlanLike
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            // Plan acceptance bar (when Claude presents a plan)
            if showPlanActions {
                HStack(spacing: 8) {
                    Image(systemName: "doc.text")
                        .font(.caption)
                        .foregroundStyle(.purple)
                    Text("Plan ready")
                        .font(.caption)
                        .foregroundStyle(.purple)
                        .fontWeight(.medium)

                    Spacer()

                    planButton("Accept", icon: "checkmark", color: .green) {
                        viewModel.sendInput("yes")
                    }
                    planButton("Edit", icon: "pencil", color: .blue) {
                        viewModel.sendInput("edit")
                    }
                    planButton("Reject", icon: "xmark", color: .red) {
                        viewModel.sendInput("no")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.purple.opacity(0.05))

                Divider()
            }

            // Quick actions
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    quickActionButton("Accept", icon: "checkmark", color: .green) {
                        viewModel.sendAccept()
                    }
                    quickActionButton("Reject", icon: "xmark", color: .red) {
                        viewModel.sendReject()
                    }
                    quickActionButton(modeLabel, icon: modeIcon, color: modeColor) {
                        viewModel.cycleMode()
                    }
                    quickActionButton("Interrupt", icon: "stop.fill", color: .orange) {
                        viewModel.sendInterrupt()
                    }
                    quickActionButton("Esc", icon: "escape", color: .secondary) {
                        viewModel.sendEscape()
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }

            Divider()

            // Text input
            HStack(spacing: 8) {
                TextField("Type a message...", text: $inputText)
                    .textFieldStyle(.plain)
                    .onSubmit {
                        sendMessage()
                    }

                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(inputText.isEmpty ? Color.secondary : Color.blue)
                }
                .disabled(inputText.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    // MARK: - Plan Button

    private func planButton(_ title: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(title)
                    .font(.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Quick Action Button

    private func quickActionButton(_ title: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Mode

    private var modeLabel: String {
        switch viewModel.currentMode {
        case "plan": "Plan"
        case "auto-accept": "Auto"
        default: "Normal"
        }
    }

    private var modeIcon: String {
        switch viewModel.currentMode {
        case "plan": "doc.text"
        case "auto-accept": "bolt"
        default: "circle"
        }
    }

    private var modeColor: Color {
        switch viewModel.currentMode {
        case "plan": .purple
        case "auto-accept": .green
        default: .blue
        }
    }

    // MARK: - Send

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        viewModel.sendInput(text)
        inputText = ""
    }
}
