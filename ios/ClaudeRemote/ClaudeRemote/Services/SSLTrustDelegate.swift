import Foundation

final class SSLTrustDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = SSLTrustDelegate()
    private let log = FileLogger.shared

    var allowInvalidCertificates: Bool {
        UserDefaults.standard.bool(forKey: "allowInvalidCertificates")
    }

    func makeSession() -> URLSession {
        log.log("Creating URLSession (allowInvalidCerts=\(allowInvalidCertificates))")
        let config = URLSessionConfiguration.default
        // Disable ATS restrictions programmatically — Info.plist NSAllowsArbitraryLoads
        // is ignored on newer macOS versions
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    // Session-level challenge (covers all tasks)
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        handleChallenge(challenge, completionHandler: completionHandler)
    }

    // Task-level challenge (some requests only get task-level challenges)
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        handleChallenge(challenge, completionHandler: completionHandler)
    }

    private func handleChallenge(
        _ challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let method = challenge.protectionSpace.authenticationMethod
        let host = challenge.protectionSpace.host
        let port = challenge.protectionSpace.port

        log.log("Auth challenge: method=\(method) host=\(host) port=\(port)")

        guard method == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            log.log("Not a server trust challenge, using default handling")
            completionHandler(.performDefaultHandling, nil)
            return
        }

        if allowInvalidCertificates {
            log.log("Accepting invalid certificate for \(host):\(port)")
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            log.log("Using default certificate validation for \(host):\(port)")
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
