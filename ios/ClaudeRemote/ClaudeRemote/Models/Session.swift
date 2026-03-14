import Foundation

struct SessionMetadata: Codable, Sendable {
    var interceptor: Bool?
    var pid: Int?
    var cwd: String?
    var hostname: String?
    var user: String?
    var platform: String?
    var nodeVersion: String?
    var cols: Int?
    var rows: Int?
    var command: String?
}

struct Session: Codable, Identifiable, Sendable {
    let id: String
    var type: String?
    var created: String?
    var lastActivity: String?
    var metadata: SessionMetadata?

    var shortId: String {
        String(id.prefix(8))
    }

    var age: String {
        guard let created, let date = ISO8601DateFormatter().date(from: created) else {
            return "unknown"
        }
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "\(Int(interval))s ago" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }
}

struct SessionsResponse: Codable {
    let sessions: [Session]
}

struct HealthResponse: Codable {
    let status: String
    let sessions: Int
    let clients: Int
}

struct BrowseItem: Codable, Identifiable {
    let name: String
    let path: String
    let isDirectory: Bool
    var isParent: Bool?

    var id: String { path }
}

struct BrowseResponse: Codable {
    let currentPath: String
    let items: [BrowseItem]
}

struct StartSessionResponse: Codable {
    let success: Bool
    let sessionId: String?
    let tmuxSession: String?
    let workingDir: String?
    let message: String?
    let error: String?
}
