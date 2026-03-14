import Foundation

enum ContentBlock: Identifiable {
    case text(String)
    case toolUse(name: String, id: String, input: String)
    case thinking(String)

    var id: String {
        switch self {
        case .text(let s): return "text-\(s.hashValue)"
        case .toolUse(_, let id, _): return "tool-\(id)"
        case .thinking(let s): return "thinking-\(s.hashValue)"
        }
    }
}

struct AskOption: Identifiable {
    let label: String
    let description: String
    var selected: Bool = false

    var id: String { label }
}

struct AskQuestion: Identifiable {
    let question: String
    let header: String?
    let multiSelect: Bool
    var options: [AskOption]

    var id: String { question }
}

struct Message: Identifiable {
    let id: String
    let content: MessageContent

    enum MessageContent {
        case user(text: String)
        case assistant(blocks: [ContentBlock])
        case system(text: String)
        case requestInfo(model: String, details: String)
        case askUserQuestion(toolUseId: String, questions: [AskQuestion])
    }

    static func user(text: String) -> Message {
        Message(id: "user-\(UUID().uuidString)", content: .user(text: text))
    }

    static func assistant(blocks: [ContentBlock]) -> Message {
        Message(id: "asst-\(UUID().uuidString)", content: .assistant(blocks: blocks))
    }

    static func system(text: String) -> Message {
        Message(id: "sys-\(UUID().uuidString)", content: .system(text: text))
    }

    static func requestInfo(model: String, details: String) -> Message {
        Message(id: "req-\(UUID().uuidString)", content: .requestInfo(model: model, details: details))
    }

    static func askUserQuestion(toolUseId: String, questions: [AskQuestion]) -> Message {
        Message(id: "ask-\(toolUseId)", content: .askUserQuestion(toolUseId: toolUseId, questions: questions))
    }
}
