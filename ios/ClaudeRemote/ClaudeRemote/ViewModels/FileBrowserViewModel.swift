import Foundation

@Observable
final class FileBrowserViewModel {
    var currentPath: String = ""
    var items: [BrowseItem] = []
    var isLoading = false
    var error: String?
    var isStartingSession = false
    var startSessionResult: String?

    func browse(path: String? = nil) {
        Task { @MainActor in
            isLoading = true
            error = nil
            do {
                let browsePath = path ?? (currentPath.isEmpty ? nil : currentPath)
                let response = try await ServerAPI.shared.browse(path: browsePath)
                self.currentPath = response.currentPath
                self.items = response.items
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func startSession() {
        guard !currentPath.isEmpty else { return }
        Task { @MainActor in
            isStartingSession = true
            error = nil
            do {
                let response = try await ServerAPI.shared.startSession(workingDir: currentPath)
                if response.success {
                    startSessionResult = response.message
                } else {
                    error = response.error ?? "Failed to start session"
                }
            } catch {
                self.error = error.localizedDescription
            }
            isStartingSession = false
        }
    }
}
