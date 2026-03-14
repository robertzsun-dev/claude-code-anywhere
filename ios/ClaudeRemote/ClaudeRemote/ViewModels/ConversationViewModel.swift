import Foundation

@Observable
@MainActor
final class ConversationViewModel {
    // MARK: - Published State

    var messages: [Message] = []
    var connectionState: ConnectionState = .disconnected
    var currentSessionId: String?
    var suggestionText: String?
    var currentMode: String = "normal"

    // Stats
    var inputTokens: Int = 0
    var outputTokens: Int = 0
    var apiCalls: Int = 0
    var toolCalls: Int = 0
    var eventCount: Int = 0
    var latestContextTokens: Int = 0
    var currentModel: String = ""

    // MARK: - Private State

    private let webSocket = WebSocketService()
    private var currentRequestInternal = false
    private var currentRequestSuggestion = false
    private var currentMessageBlocks: [Int: BlockState] = [:]
    private var activeBlockIndex = -1
    private var lastUserText: String?
    private var isReplayingHistory = false

    private struct BlockState {
        var type: String // "text", "tool_use", "thinking"
        var text: String = ""
        var id: String?
        var name: String?
        var input: String = ""
        var thinking: String = ""
    }

    // MARK: - Connection

    func connect(sessionId: String) {
        disconnect()
        currentSessionId = sessionId
        messages = []
        resetStats()
        webSocket.connect(sessionId: sessionId) { [weak self] msg in
            self?.handleMessage(msg)
        }
    }

    func disconnect() {
        webSocket.disconnect()
        currentSessionId = nil
        connectionState = .disconnected
    }

    // MARK: - Input

    func sendInput(_ text: String) {
        webSocket.send(.input(text))
        webSocket.send(.input("\r"))
    }

    func sendAccept() {
        webSocket.send(.input("y"))
    }

    func sendReject() {
        webSocket.send(.input("n"))
    }

    func sendInterrupt() {
        webSocket.send(.input("\u{03}"))
    }

    func sendEscape() {
        webSocket.send(.input("\u{1b}"))
    }

    func sendTab() {
        webSocket.send(.input("\t"))
        suggestionText = nil
    }

    func cycleMode() {
        let modes = ["normal", "plan"]
        let idx = modes.firstIndex(of: currentMode) ?? 0
        currentMode = modes[(idx + 1) % modes.count]
        webSocket.send(.setMode(currentMode))
    }

    func sendAskAnswer(toolUseId: String, questions: [(question: String, selectedLabel: String)], hasMultiSelect: Bool = false) {
        webSocket.send(.askAnswer(toolUseId: toolUseId, questions: questions, hasMultiSelect: hasMultiSelect))
    }

    func closeSession() {
        webSocket.send(.closeSession)
    }

    // MARK: - Message Handling

    private func handleMessage(_ msg: ServerMessage) {
        connectionState = webSocket.connectionState

        if !isReplayingHistory {
            NSLog("[ConversationVM] live message: %@", msg.type)
        }

        switch msg.type {
        case "session-attached":
            handleSessionAttached(msg)
        case "api_request":
            handleApiRequest(msg)
        case "sse_event":
            handleSSEEvent(msg)
        case "api_response":
            handleApiResponse(msg)
        case "api_error":
            handleApiError(msg)
        case "mode-change":
            if let mode = msg.mode {
                currentMode = mode
            }
        case "input-echo":
            break
        case "wrapper-disconnected":
            messages.append(.system(text: "Session disconnected"))
        case "interceptor-reconnected":
            messages.append(.system(text: "Session reconnected"))
        case "exit":
            let code = msg.exitCode ?? 0
            messages.append(.system(text: "Process exited with code \(code)"))
        case "session-reaped":
            messages.append(.system(text: "Session ended: \(msg.reason ?? "unknown")"))
        case "error":
            messages.append(.system(text: "Error: \(msg.error ?? "unknown")"))
        case "server-shutdown":
            messages.append(.system(text: "Server shutting down"))
        case "__system":
            if let text = msg.raw["text"] as? String {
                messages.append(.system(text: text))
            }
        default:
            break
        }
    }

    // MARK: - Session Attached

    private func handleSessionAttached(_ msg: ServerMessage) {
        connectionState = .connected

        // Clear ALL state before replaying to prevent duplicates/garbling on reconnection
        messages = []
        resetStats()

        if let events = msg.events {
            NSLog("[ConversationVM] session-attached: replaying %d events", events.count)
            isReplayingHistory = true
            for (i, event) in events.enumerated() {
                if let data = try? JSONSerialization.data(withJSONObject: event),
                   let serverMsg = ServerMessage(data: data) {
                    handleMessage(serverMsg)
                } else {
                    let eventType = event["type"] as? String ?? "unknown"
                    NSLog("[ConversationVM] Failed to parse event %d: type=%@", i, eventType)
                }
            }
            isReplayingHistory = false
            NSLog("[ConversationVM] Replay done: %d messages, %d calls, %d events", messages.count, apiCalls, eventCount)
        } else {
            NSLog("[ConversationVM] session-attached: events field is nil (cast failed or missing)")
            if let rawEvents = msg.raw["events"] {
                NSLog("[ConversationVM]   raw events type: %@, isArray: %d", String(describing: type(of: rawEvents)), rawEvents is [Any] ? 1 : 0)
                if let arr = rawEvents as? [Any] {
                    NSLog("[ConversationVM]   array count: %d", arr.count)
                    if let first = arr.first {
                        NSLog("[ConversationVM]   first element type: %@", String(describing: type(of: first)))
                    }
                }
            } else {
                NSLog("[ConversationVM]   no 'events' key in raw message")
            }
        }
    }

    // MARK: - API Request

    private func handleApiRequest(_ msg: ServerMessage) {
        guard let data = msg.requestData else {
            NSLog("[ConversationVM] api_request: no requestData (data field missing or not a dict)")
            return
        }
        apiCalls += 1

        let model = data["model"] as? String ?? ""

        let isInternal = isInternalCall(data)
        currentRequestInternal = isInternal
        currentRequestSuggestion = isSuggestionRequest(data)

        if !model.isEmpty && !isInternal {
            currentModel = model
        }

        if currentRequestSuggestion { return }
        if isInternal { return }

        if let lastTurn = data["last_turn"] as? [[String: Any]] {
            extractUserMessages(from: lastTurn)
        }

        // No longer appending requestInfo messages - stats bar shows this info
    }

    private func isInternalCall(_ data: [String: Any]) -> Bool {
        if let model = data["model"] as? String, model.contains("haiku") {
            return true
        }
        if let tools = data["tools"] as? [String], !tools.isEmpty,
           tools.allSatisfy({ $0.hasPrefix("mcp__") }) {
            return true
        }
        return false
    }

    private func isSuggestionRequest(_ data: [String: Any]) -> Bool {
        guard let lastTurn = data["last_turn"] as? [[String: Any]] else { return false }
        for turn in lastTurn {
            if let text = turn["text"] as? String, text.contains("[SUGGESTION MODE:") {
                return true
            }
            if let blocks = turn["blocks"] as? [[String: Any]] {
                for block in blocks {
                    if let text = block["text"] as? String, text.contains("[SUGGESTION MODE:") {
                        return true
                    }
                }
            }
        }
        return false
    }

    private func extractUserMessages(from turns: [[String: Any]]) {
        for turn in turns {
            if let text = turn["text"] as? String, turn["type"] as? String == "text" {
                if text != lastUserText && !isInternalContent(text) {
                    lastUserText = text
                    messages.append(.user(text: text))
                }
                continue
            }

            if let blocks = turn["blocks"] as? [[String: Any]] {
                let hasToolResult = blocks.contains { ($0["type"] as? String) == "tool_result" }
                if hasToolResult { continue }

                let hasInternalText = blocks.contains {
                    if let t = $0["text"] as? String { return isInternalContent(t) }
                    return false
                }
                if hasInternalText { continue }

                for block in blocks {
                    if let text = block["text"] as? String,
                       (block["type"] as? String) == "text",
                       text != lastUserText && !isInternalContent(text) {
                        lastUserText = text
                        messages.append(.user(text: text))
                    }
                }
            }
        }
    }

    // MARK: - SSE Event

    private func handleSSEEvent(_ msg: ServerMessage) {
        eventCount += 1

        if currentRequestInternal { return }

        if currentRequestSuggestion {
            handleSuggestionSSE(msg)
            return
        }

        guard let eventType = msg.event else {
            NSLog("[ConversationVM] sse_event: missing event type")
            return
        }
        guard let dataStr = msg.dataString else {
            NSLog("[ConversationVM] sse_event %@: data is not a string (type: %@)", eventType, String(describing: type(of: msg.raw["data"] ?? "nil")))
            return
        }
        guard let jsonData = dataStr.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            NSLog("[ConversationVM] sse_event %@: failed to parse data JSON", eventType)
            return
        }

        switch eventType {
        case "message_start":
            handleMessageStart(parsed)
        case "content_block_start":
            handleContentBlockStart(parsed)
        case "content_block_delta":
            handleContentBlockDelta(parsed)
        case "content_block_stop":
            handleContentBlockStop(parsed)
        case "message_delta":
            handleMessageDelta(parsed)
        case "message_stop":
            handleMessageStop()
        default:
            break
        }
    }

    private func handleSuggestionSSE(_ msg: ServerMessage) {
        guard let eventType = msg.event else { return }

        if eventType == "content_block_delta",
           let dataStr = msg.dataString,
           let jsonData = dataStr.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
           let delta = parsed["delta"] as? [String: Any],
           let text = delta["text"] as? String {
            suggestionText = (suggestionText ?? "") + text
        }
    }

    // MARK: - SSE Handlers

    private func handleMessageStart(_ parsed: [String: Any]) {
        currentMessageBlocks = [:]
        activeBlockIndex = -1

        if let message = parsed["message"] as? [String: Any],
           let usage = message["usage"] as? [String: Any] {
            let input = usage["input_tokens"] as? Int ?? 0
            let cacheRead = usage["cache_read_input_tokens"] as? Int ?? 0
            let cacheCreate = usage["cache_creation_input_tokens"] as? Int ?? 0
            inputTokens += input
            latestContextTokens = input + cacheRead + cacheCreate
        }

        messages.append(.assistant(blocks: []))
    }

    private func handleContentBlockStart(_ parsed: [String: Any]) {
        guard let index = parsed["index"] as? Int,
              let block = parsed["content_block"] as? [String: Any],
              let type = block["type"] as? String else { return }

        var state = BlockState(type: type)
        state.text = block["text"] as? String ?? ""
        state.id = block["id"] as? String
        state.name = block["name"] as? String
        state.thinking = block["thinking"] as? String ?? ""
        currentMessageBlocks[index] = state
        activeBlockIndex = index

        if type == "tool_use" {
            toolCalls += 1
        }

        updateCurrentAssistantMessage()
    }

    private func handleContentBlockDelta(_ parsed: [String: Any]) {
        guard let index = parsed["index"] as? Int,
              let delta = parsed["delta"] as? [String: Any],
              let deltaType = delta["type"] as? String else { return }

        switch deltaType {
        case "text_delta":
            if let text = delta["text"] as? String {
                currentMessageBlocks[index]?.text += text
            }
        case "input_json_delta":
            if let json = delta["partial_json"] as? String {
                currentMessageBlocks[index]?.input += json
            }
        case "thinking_delta":
            if let thinking = delta["thinking"] as? String {
                currentMessageBlocks[index]?.thinking += thinking
            }
        default:
            break
        }

        updateCurrentAssistantMessage()
    }

    private func handleContentBlockStop(_ parsed: [String: Any]) {
        guard let index = parsed["index"] as? Int,
              let block = currentMessageBlocks[index] else { return }

        if block.type == "tool_use" && block.name == "AskUserQuestion",
           let id = block.id {
            parseAskUserQuestion(input: block.input, toolUseId: id)
        }

        updateCurrentAssistantMessage()
    }

    private func handleMessageDelta(_ parsed: [String: Any]) {
        if let usage = parsed["usage"] as? [String: Any],
           let output = usage["output_tokens"] as? Int {
            outputTokens += output
        }
    }

    private func handleMessageStop() {
        // Check if the last assistant message is internal and should be removed
        if let lastIdx = messages.indices.last {
            if case .assistant(let blocks) = messages[lastIdx].content {
                let textBlocks = blocks.compactMap { block -> String? in
                    if case .text(let t) = block { return t }
                    return nil
                }
                let hasNonTextBlocks = blocks.contains { block in
                    if case .toolUse = block { return true }
                    if case .thinking = block { return true }
                    return false
                }
                let fullText = textBlocks.joined()

                if !hasNonTextBlocks && isInternalAssistantResponse(fullText) {
                    messages.removeLast()
                }
            }
        }

        currentMessageBlocks = [:]
        activeBlockIndex = -1
    }

    // MARK: - API Response (non-streaming)

    private func handleApiResponse(_ msg: ServerMessage) {
        guard let data = msg.responseData else { return }

        if let usage = data["usage"] as? [String: Any] {
            inputTokens += usage["input_tokens"] as? Int ?? 0
            outputTokens += usage["output_tokens"] as? Int ?? 0
            let input = usage["input_tokens"] as? Int ?? 0
            let cacheRead = usage["cache_read_input_tokens"] as? Int ?? 0
            let cacheCreate = usage["cache_creation_input_tokens"] as? Int ?? 0
            latestContextTokens = input + cacheRead + cacheCreate
        }

        if currentRequestInternal { return }
        if currentRequestSuggestion {
            if let content = data["content"] as? [[String: Any]] {
                for block in content {
                    if let text = block["text"] as? String {
                        suggestionText = (suggestionText ?? "") + text
                    }
                }
            }
            return
        }

        guard let content = data["content"] as? [[String: Any]] else { return }
        var blocks: [ContentBlock] = []
        for block in content {
            let type = block["type"] as? String ?? ""
            switch type {
            case "text":
                let text = block["text"] as? String ?? ""
                if !isInternalAssistantResponse(text) {
                    blocks.append(.text(text))
                }
            case "tool_use":
                let name = block["name"] as? String ?? ""
                let id = block["id"] as? String ?? ""
                let input = block["input"] as? String ?? ""
                toolCalls += 1
                blocks.append(.toolUse(name: name, id: id, input: input))
            default:
                break
            }
        }
        if !blocks.isEmpty {
            messages.append(.assistant(blocks: blocks))
        }
    }

    // MARK: - API Error

    private func handleApiError(_ msg: ServerMessage) {
        guard let error = msg.error else { return }
        if error.lowercased().contains("aborted") { return }
        messages.append(.system(text: "API Error: \(error)"))
    }

    // MARK: - AskUserQuestion

    private func parseAskUserQuestion(input: String, toolUseId: String) {
        guard let data = input.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let questionsArr = parsed["questions"] as? [[String: Any]] else {
            return
        }

        var questions: [AskQuestion] = []
        for q in questionsArr {
            let questionText = q["question"] as? String ?? ""
            let header = q["header"] as? String
            let multiSelect = q["multiSelect"] as? Bool ?? false
            let optionsArr = q["options"] as? [[String: Any]] ?? []

            var options: [AskOption] = []
            for opt in optionsArr {
                options.append(AskOption(
                    label: opt["label"] as? String ?? "",
                    description: opt["description"] as? String ?? ""
                ))
            }

            questions.append(AskQuestion(
                question: questionText,
                header: header,
                multiSelect: multiSelect,
                options: options
            ))
        }

        if !questions.isEmpty {
            messages.append(.askUserQuestion(toolUseId: toolUseId, questions: questions))

            if !isReplayingHistory {
                NotificationService.shared.notifyInputNeeded(
                    sessionId: currentSessionId ?? "",
                    question: questions.first?.question
                )
            }
        }
    }

    // MARK: - Helpers

    private func updateCurrentAssistantMessage() {
        let sortedKeys = currentMessageBlocks.keys.sorted()
        var blocks: [ContentBlock] = []
        for key in sortedKeys {
            guard let state = currentMessageBlocks[key] else { continue }
            switch state.type {
            case "text":
                blocks.append(.text(state.text))
            case "tool_use":
                blocks.append(.toolUse(
                    name: state.name ?? "unknown",
                    id: state.id ?? "",
                    input: state.input
                ))
            case "thinking":
                blocks.append(.thinking(state.thinking))
            default:
                break
            }
        }

        // Preserve the existing message id when updating streaming content
        if let lastIdx = messages.indices.last {
            if case .assistant = messages[lastIdx].content {
                let existingId = messages[lastIdx].id
                messages[lastIdx] = Message(id: existingId, content: .assistant(blocks: blocks))
            }
        }
    }

    private func isInternalContent(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.contains("<system-reminder>") { return true }
        if t.hasPrefix("<system") { return true }
        if t.contains("<command-name>") { return true }
        if t.contains("<local-command-") { return true }
        if t == "foo" { return true }
        return false
    }

    private func isInternalAssistantResponse(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return true }
        if t == "#" { return true }
        if t.hasPrefix("{") && t.contains("\"isNewTopic\"") { return true }
        if t.hasPrefix("<") && t.range(of: #"^<\w+>\s*\n"#, options: .regularExpression) != nil { return true }
        return false
    }

    private func resetStats() {
        inputTokens = 0
        outputTokens = 0
        apiCalls = 0
        toolCalls = 0
        eventCount = 0
        latestContextTokens = 0
        currentModel = ""
        currentMode = "normal"
        suggestionText = nil
        currentRequestInternal = false
        currentRequestSuggestion = false
        currentMessageBlocks = [:]
        activeBlockIndex = -1
        lastUserText = nil
    }
}
