import Foundation

@Observable
final class SessionListViewModel {
    var sessions: [Session] = []
    var selectedSessionId: String?
    var isLoading = false
    var error: String?
    var showSSLAlert = false

    private var refreshTimer: Timer?
    private var sslAlertShown = false
    private let log = FileLogger.shared

    func startPolling() {
        log.log("startPolling")
        refreshSessions()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            self?.refreshSessions()
        }
    }

    func stopPolling() {
        log.log("stopPolling")
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refreshSessions() {
        log.log("refreshSessions: starting")
        Task { @MainActor in
            do {
                let fetched = try await ServerAPI.shared.fetchSessions()
                log.log("refreshSessions: got \(fetched.count) sessions")
                self.sessions = fetched
                self.error = nil
                self.sslAlertShown = false
            } catch {
                log.log("refreshSessions: ERROR \(error)")
                log.log("refreshSessions: error details — \(String(describing: error))")
                let nsErr = error as NSError
                log.log("refreshSessions: NSError domain=\(nsErr.domain) code=\(nsErr.code)")
                if let underlying = nsErr.userInfo[NSUnderlyingErrorKey] as? NSError {
                    log.log("refreshSessions: underlying domain=\(underlying.domain) code=\(underlying.code) desc=\(underlying.localizedDescription)")
                }
                if Self.isSSLError(error), !sslAlertShown {
                    log.log("refreshSessions: detected SSL error, showing alert")
                    self.showSSLAlert = true
                    self.sslAlertShown = true
                    self.error = "Certificate not trusted"
                } else {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    func acceptInvalidCertificate() {
        log.log("acceptInvalidCertificate")
        UserDefaults.standard.set(true, forKey: "allowInvalidCertificates")
        sslAlertShown = false
        refreshSessions()
    }

    func deleteSession(id: String) {
        log.log("deleteSession: \(id)")
        Task { @MainActor in
            do {
                try await ServerAPI.shared.deleteSession(id: id)
                sessions.removeAll { $0.id == id }
                if selectedSessionId == id {
                    selectedSessionId = nil
                }
            } catch {
                log.log("deleteSession: ERROR \(error)")
                self.error = error.localizedDescription
            }
        }
    }

    static func isSSLError(_ error: Error) -> Bool {
        let nsError = error as NSError
        let sslCodes: Set<Int> = [-1200, -1201, -1202, -1203, -1204]
        if sslCodes.contains(nsError.code) { return true }
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError,
           sslCodes.contains(underlying.code) { return true }
        return false
    }
}
