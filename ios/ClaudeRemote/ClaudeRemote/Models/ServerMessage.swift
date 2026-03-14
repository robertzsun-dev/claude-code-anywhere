import Foundation

// MARK: - Incoming WebSocket Messages

struct ServerMessage {
    let type: String
    let raw: [String: Any]

    init?(data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return nil
        }
        self.type = type
        self.raw = json
    }

    // session-attached
    var sessionId: String? { raw["sessionId"] as? String }
    var sessionType: String? { raw["sessionType"] as? String }
    var metadata: [String: Any]? { raw["metadata"] as? [String: Any] }
    var events: [[String: Any]]? { raw["events"] as? [[String: Any]] }

    // sse_event
    var event: String? { raw["event"] as? String }
    var dataString: String? { raw["data"] as? String }
    var reqId: String? { raw["reqId"] as? String }

    // api_request
    var requestData: [String: Any]? { raw["data"] as? [String: Any] }

    // api_response
    var responseData: [String: Any]? { raw["data"] as? [String: Any] }

    // api_error
    var error: String? { raw["error"] as? String }

    // exit
    var exitCode: Int? { raw["code"] as? Int }
    var signal: String? { raw["signal"] as? String }

    // mode-change
    var mode: String? { raw["mode"] as? String }

    // input-echo
    var inputData: String? { raw["data"] as? String }

    // ask-rewrite
    var toolUseId: String? { raw["toolUseId"] as? String }
    var answerPreview: String? { raw["answerPreview"] as? String }

    // session-reaped
    var reason: String? { raw["reason"] as? String }
}

// MARK: - Outgoing Messages

enum OutgoingMessage {
    case input(String)
    case rawInput(String)
    case askAnswer(toolUseId: String, questions: [(question: String, selectedLabel: String)], hasMultiSelect: Bool)
    case setMode(String)
    case closeSession

    func toData() -> Data? {
        var dict: [String: Any] = [:]
        switch self {
        case .input(let text):
            dict["type"] = "input"
            dict["data"] = text
        case .rawInput(let text):
            dict["type"] = "raw-input"
            dict["data"] = text
        case .askAnswer(let toolUseId, let questions, let hasMultiSelect):
            dict["type"] = "ask-answer"
            dict["toolUseId"] = toolUseId
            dict["questions"] = questions.map { ["question": $0.question, "selectedLabel": $0.selectedLabel] }
            if hasMultiSelect { dict["hasMultiSelect"] = true }
        case .setMode(let mode):
            dict["type"] = "set-mode"
            dict["mode"] = mode
        case .closeSession:
            dict["type"] = "close-session"
        }
        return try? JSONSerialization.data(withJSONObject: dict)
    }
}
