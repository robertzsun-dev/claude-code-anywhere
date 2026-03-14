import UserNotifications

final class NotificationService {
    static let shared = NotificationService()

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func notifyInputNeeded(sessionId: String, question: String? = nil) {
        let content = UNMutableNotificationContent()
        content.title = "Claude Code"
        content.body = question ?? "Input needed for session \(String(sessionId.prefix(8)))"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "input-\(sessionId)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func cancelNotification(sessionId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["input-\(sessionId)"]
        )
    }
}
