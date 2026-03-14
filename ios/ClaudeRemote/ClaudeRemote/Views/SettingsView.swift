import SwiftUI

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://localhost:8085"
    @AppStorage("allowInvalidCertificates") private var allowInvalidCertificates = false
    @State private var testResult: String?
    @State private var isTesting = false
    @State private var testSuccess = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $serverURL)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .font(.system(.body, design: .monospaced))

                Button {
                    testConnection()
                } label: {
                    HStack {
                        if isTesting {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                        Text("Test Connection")
                    }
                }
                .disabled(isTesting)

                if let result = testResult {
                    HStack {
                        Image(systemName: testSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(testSuccess ? .green : .red)
                        Text(result)
                            .font(.caption)
                    }
                }
            }

            Section {
                Toggle("Allow Invalid Certificates", isOn: $allowInvalidCertificates)
            } header: {
                Text("Security")
            } footer: {
                Text("Enable this to connect to servers with self-signed or expired TLS certificates. Only use on trusted networks.")
            }

            Section("About") {
                LabeledContent("App", value: "Claude Remote")
                LabeledContent("Version", value: "1.0.0")
            }
        }
        .navigationTitle("Settings")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func testConnection() {
        isTesting = true
        testResult = nil

        Task { @MainActor in
            do {
                let health = try await ServerAPI.shared.fetchHealth()
                testResult = "Connected - \(health.sessions) sessions, \(health.clients) clients"
                testSuccess = true
            } catch {
                testResult = error.localizedDescription
                testSuccess = false
            }
            isTesting = false
        }
    }
}
