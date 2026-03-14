import SwiftUI

struct AskUserQuestionView: View {
    let toolUseId: String
    let questions: [AskQuestion]
    var viewModel: ConversationViewModel

    @State private var selections: [String: Set<String>] = [:]
    @State private var submitted = false
    @State private var showOtherAlert = false
    @State private var otherText = ""
    @State private var otherQuestionKey = ""

    private var tertiaryBackground: Color {
        #if os(iOS)
        Color(.tertiarySystemBackground)
        #else
        Color(nsColor: .textBackgroundColor)
        #endif
    }

    private var isSingleSimpleQuestion: Bool {
        questions.count == 1 && !questions[0].multiSelect
    }

    private var hasMultiSelect: Bool {
        questions.contains { $0.multiSelect }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Question", systemImage: "questionmark.circle")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.green)

            ForEach(questions) { question in
                questionSection(question)
            }

            if !isSingleSimpleQuestion && !submitted {
                Button("Submit Selections") {
                    submitAll()
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(!allQuestionsAnswered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.green.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .alert("Custom Answer", isPresented: $showOtherAlert) {
            TextField("Enter your answer", text: $otherText)
            Button("Submit") {
                handleOtherSubmit()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter a custom response")
        }
    }

    // MARK: - Question Section

    @ViewBuilder
    private func questionSection(_ question: AskQuestion) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let header = question.header {
                Text(header)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
            }

            Text(question.question)
                .font(.subheadline)

            ForEach(question.options) { option in
                optionButton(
                    option: option,
                    question: question
                )
            }

            // Other option
            Button {
                otherQuestionKey = question.question
                showOtherAlert = true
            } label: {
                HStack {
                    Image(systemName: "pencil")
                    Text("Other...")
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(tertiaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .disabled(submitted)
            .buttonStyle(.plain)
        }
    }

    // MARK: - Option Button

    private func optionButton(option: AskOption, question: AskQuestion) -> some View {
        let isSelected = selections[question.question]?.contains(option.label) ?? false

        return Button {
            handleOptionTap(option: option, question: question)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    if !option.description.isEmpty {
                        Text(option.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: question.multiSelect ? "checkmark.square.fill" : "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Image(systemName: question.multiSelect ? "square" : "circle")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(isSelected ? .green.opacity(0.1) : tertiaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .disabled(submitted)
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func handleOptionTap(option: AskOption, question: AskQuestion) {
        if question.multiSelect {
            // Toggle selection
            var current = selections[question.question] ?? []
            if current.contains(option.label) {
                current.remove(option.label)
            } else {
                current.insert(option.label)
            }
            selections[question.question] = current
        } else if isSingleSimpleQuestion {
            // Immediate submit
            submitted = true
            viewModel.sendAskAnswer(
                toolUseId: toolUseId,
                questions: [(question: question.question, selectedLabel: option.label)]
            )
        } else {
            // Single select in multi-question mode
            selections[question.question] = [option.label]
        }
    }

    private func submitAll() {
        submitted = true
        let answers = questions.map { q in
            let selected = selections[q.question] ?? []
            return (question: q.question, selectedLabel: selected.joined(separator: ", "))
        }
        viewModel.sendAskAnswer(
            toolUseId: toolUseId,
            questions: answers,
            hasMultiSelect: hasMultiSelect
        )
    }

    private func handleOtherSubmit() {
        guard !otherText.isEmpty else { return }
        if isSingleSimpleQuestion {
            submitted = true
            viewModel.sendAskAnswer(
                toolUseId: toolUseId,
                questions: [(question: otherQuestionKey, selectedLabel: otherText)]
            )
        } else {
            selections[otherQuestionKey] = [otherText]
        }
        otherText = ""
    }

    private var allQuestionsAnswered: Bool {
        questions.allSatisfy { q in
            !(selections[q.question] ?? []).isEmpty
        }
    }
}
