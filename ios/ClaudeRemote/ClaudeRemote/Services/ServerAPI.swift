import Foundation

actor ServerAPI {
    static let shared = ServerAPI()
    private let log = FileLogger.shared

    private var session: URLSession = SSLTrustDelegate.shared.makeSession()

    var baseURL: String {
        UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:8085"
    }

    // MARK: - Health

    func fetchHealth() async throws -> HealthResponse {
        let urlStr = "\(baseURL)/health"
        log.log("fetchHealth: GET \(urlStr)")
        let url = URL(string: urlStr)!
        do {
            let (data, response) = try await session.data(from: url)
            let http = response as? HTTPURLResponse
            log.log("fetchHealth: status=\(http?.statusCode ?? -1) bytes=\(data.count)")
            if let body = String(data: data, encoding: .utf8) {
                log.log("fetchHealth: body=\(body.prefix(500))")
            }
            return try JSONDecoder().decode(HealthResponse.self, from: data)
        } catch {
            log.log("fetchHealth: ERROR \(error)")
            log.log("fetchHealth: error details — \(String(describing: error))")
            throw error
        }
    }

    // MARK: - Sessions

    func fetchSessions() async throws -> [Session] {
        let urlStr = "\(baseURL)/sessions"
        log.log("fetchSessions: GET \(urlStr)")
        let url = URL(string: urlStr)!
        do {
            let (data, response) = try await session.data(from: url)
            let http = response as? HTTPURLResponse
            log.log("fetchSessions: status=\(http?.statusCode ?? -1) bytes=\(data.count)")
            if let body = String(data: data, encoding: .utf8) {
                log.log("fetchSessions: body=\(body.prefix(1000))")
            }
            let decoded = try JSONDecoder().decode(SessionsResponse.self, from: data)
            log.log("fetchSessions: decoded \(decoded.sessions.count) sessions")
            return decoded.sessions
        } catch {
            log.log("fetchSessions: ERROR \(error)")
            log.log("fetchSessions: error details — \(String(describing: error))")
            throw error
        }
    }

    func deleteSession(id: String) async throws {
        let urlStr = "\(baseURL)/sessions/\(id)"
        log.log("deleteSession: DELETE \(urlStr)")
        let url = URL(string: urlStr)!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        do {
            let (data, response) = try await session.data(for: request)
            let http = response as? HTTPURLResponse
            log.log("deleteSession: status=\(http?.statusCode ?? -1) bytes=\(data.count)")
            guard http?.statusCode == 200 else {
                log.log("deleteSession: unexpected status code")
                throw APIError.deleteFailed
            }
        } catch {
            log.log("deleteSession: ERROR \(error)")
            throw error
        }
    }

    // MARK: - Browse

    func browse(path: String?) async throws -> BrowseResponse {
        var components = URLComponents(string: "\(baseURL)/browse")!
        if let path, !path.isEmpty {
            components.queryItems = [URLQueryItem(name: "path", value: path)]
        }
        let url = components.url!
        log.log("browse: GET \(url.absoluteString)")
        do {
            let (data, response) = try await session.data(from: url)
            let http = response as? HTTPURLResponse
            log.log("browse: status=\(http?.statusCode ?? -1) bytes=\(data.count)")
            return try JSONDecoder().decode(BrowseResponse.self, from: data)
        } catch {
            log.log("browse: ERROR \(error)")
            throw error
        }
    }

    // MARK: - Start Session

    func startSession(workingDir: String, cols: Int = 120, rows: Int = 40) async throws -> StartSessionResponse {
        let urlStr = "\(baseURL)/start-session"
        log.log("startSession: POST \(urlStr) workingDir=\(workingDir)")
        let url = URL(string: urlStr)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["workingDir": workingDir, "cols": cols, "rows": rows]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await session.data(for: request)
            let http = response as? HTTPURLResponse
            log.log("startSession: status=\(http?.statusCode ?? -1) bytes=\(data.count)")
            if let respBody = String(data: data, encoding: .utf8) {
                log.log("startSession: body=\(respBody.prefix(500))")
            }
            return try JSONDecoder().decode(StartSessionResponse.self, from: data)
        } catch {
            log.log("startSession: ERROR \(error)")
            throw error
        }
    }

    // MARK: - WebSocket URL

    func webSocketURL(sessionId: String) -> URL {
        let base = baseURL
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        let url = URL(string: "\(base)/?role=viewer&session=\(sessionId)")!
        log.log("webSocketURL: \(url.absoluteString)")
        return url
    }

    enum APIError: Error, LocalizedError {
        case deleteFailed

        var errorDescription: String? {
            switch self {
            case .deleteFailed: return "Failed to delete session"
            }
        }
    }
}
