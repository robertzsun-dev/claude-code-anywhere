import Foundation

enum ConnectionState: Sendable {
    case disconnected
    case connecting
    case connected
    case reconnecting
}

@Observable
@MainActor
final class WebSocketService {
    private(set) var connectionState: ConnectionState = .disconnected
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession = SSLTrustDelegate.shared.makeSession()
    private var sessionId: String?
    private var reconnectDelay: TimeInterval = 1.0
    private var shouldReconnect = false
    private var messageHandler: ((ServerMessage) -> Void)?
    private let log = FileLogger.shared

    func connect(sessionId: String, onMessage: @escaping (ServerMessage) -> Void) {
        log.log("connect: sessionId=\(sessionId)")
        self.sessionId = sessionId
        self.messageHandler = onMessage
        self.shouldReconnect = true
        self.reconnectDelay = 1.0
        performConnect()
    }

    func disconnect() {
        log.log("disconnect: sessionId=\(sessionId ?? "nil")")
        shouldReconnect = false
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        connectionState = .disconnected
    }

    func send(_ message: OutgoingMessage) {
        guard let data = message.toData(),
              let string = String(data: data, encoding: .utf8) else {
            log.log("send: failed to serialize message")
            return
        }
        log.log("send: \(string.prefix(200))")
        webSocketTask?.send(.string(string)) { [weak self] error in
            if let error {
                self?.log.log("send: ERROR \(error)")
            }
        }
    }

    // MARK: - Private

    private func performConnect() {
        guard let sessionId else {
            log.log("performConnect: no sessionId, aborting")
            return
        }

        connectionState = connectionState == .disconnected ? .connecting : .reconnecting
        log.log("performConnect: state=\(connectionState) sessionId=\(sessionId)")

        Task {
            let url = await ServerAPI.shared.webSocketURL(sessionId: sessionId)
            log.log("performConnect: opening WebSocket to \(url.absoluteString)")

            let task = session.webSocketTask(with: url)
            task.maximumMessageSize = 100 * 1024 * 1024 // 100 MB — server sends large session-attached messages with full event history
            self.webSocketTask = task

            log.log("performConnect: resuming task (maxMessageSize=\(task.maximumMessageSize))")
            task.resume()

            await receiveMessages(task: task)
        }
    }

    private func receiveMessages(task: URLSessionWebSocketTask) async {
        log.log("receiveMessages: starting receive loop, task.state=\(task.state.rawValue)")
        var receivedFirst = false
        var messageCount = 0

        while task.state == .running {
            do {
                let message = try await task.receive()
                messageCount += 1

                // Mark connected on first successful receive
                if !receivedFirst {
                    receivedFirst = true
                    connectionState = .connected
                    reconnectDelay = 1.0
                    log.log("receiveMessages: first message received, now connected")
                }

                switch message {
                case .string(let text):
                    if messageCount <= 5 || messageCount % 50 == 0 {
                        log.log("receiveMessages: msg #\(messageCount) string len=\(text.count) preview=\(text.prefix(300))")
                    }
                    if let data = text.data(using: .utf8),
                       let serverMsg = ServerMessage(data: data) {
                        self.messageHandler?(serverMsg)
                    } else {
                        log.log("receiveMessages: FAILED to parse message: \(text.prefix(500))")
                    }
                case .data(let data):
                    log.log("receiveMessages: msg #\(messageCount) binary len=\(data.count)")
                    if let serverMsg = ServerMessage(data: data) {
                        self.messageHandler?(serverMsg)
                    } else {
                        log.log("receiveMessages: FAILED to parse binary message")
                    }
                @unknown default:
                    log.log("receiveMessages: unknown message type")
                    break
                }
            } catch {
                log.log("receiveMessages: ERROR after \(messageCount) messages — \(error)")
                log.log("receiveMessages: error details — \(String(describing: error))")
                let nsErr = error as NSError
                log.log("receiveMessages: NSError domain=\(nsErr.domain) code=\(nsErr.code)")
                if let underlying = nsErr.userInfo[NSUnderlyingErrorKey] as? NSError {
                    log.log("receiveMessages: underlying domain=\(underlying.domain) code=\(underlying.code) desc=\(underlying.localizedDescription)")
                }
                break
            }
        }

        log.log("receiveMessages: loop exited, task.state=\(task.state.rawValue) received=\(messageCount)")
        connectionState = .disconnected

        if shouldReconnect {
            let delay = reconnectDelay
            reconnectDelay = min(reconnectDelay * 2, 30)
            log.log("receiveMessages: will reconnect in \(delay)s")
            try? await Task.sleep(for: .seconds(delay))
            if shouldReconnect {
                log.log("receiveMessages: reconnecting now")
                messageHandler?(ServerMessage(data: """
                {"type":"__system","text":"Reconnecting..."}
                """.data(using: .utf8)!)!)
                performConnect()
            }
        }
    }
}
