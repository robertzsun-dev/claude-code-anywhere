import Foundation

final class FileLogger: @unchecked Sendable {
    static let shared = FileLogger()

    private let logURL: URL
    private let queue = DispatchQueue(label: "com.clauderemote.filelogger")
    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return f
    }()

    init() {
        logURL = URL(fileURLWithPath: "/tmp/ClaudeRemote-debug.log")

        // Write header on launch
        let header = "\n\n========== ClaudeRemote launched at \(Date()) ==========\n"
        header.appendToFile(at: logURL)

        // Log the file location to console so user can find it
        NSLog("[FileLogger] Logging to: %@", logURL.path)
    }

    func log(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        let timestamp = dateFormatter.string(from: Date())
        let fileName = (file as NSString).lastPathComponent
        let entry = "[\(timestamp)] [\(fileName):\(line)] \(function) — \(message)\n"
        queue.async {
            entry.appendToFile(at: self.logURL)
        }
    }

    var logFilePath: String { logURL.path }
}

private extension String {
    func appendToFile(at url: URL) {
        if let data = self.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: url.path) {
                if let handle = try? FileHandle(forWritingTo: url) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                }
            } else {
                try? data.write(to: url)
            }
        }
    }
}
