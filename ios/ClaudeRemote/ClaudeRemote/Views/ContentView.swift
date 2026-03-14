import SwiftUI

struct ContentView: View {
    @State private var sessionListVM = SessionListViewModel()
    @State private var conversationVM = ConversationViewModel()
    @State private var showSettings = false
    @State private var showFileBrowser = false

    var body: some View {
        NavigationSplitView {
            SessionListView(
                viewModel: sessionListVM,
                selectedSessionId: $sessionListVM.selectedSessionId,
                onNewSession: { showFileBrowser = true }
            )
            .navigationTitle("Sessions")
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gear")
                    }
                }
                #else
                ToolbarItem(placement: .automatic) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gear")
                    }
                }
                #endif
            }
        } detail: {
            if let sessionId = sessionListVM.selectedSessionId {
                ConversationView(viewModel: conversationVM)
                    .onChange(of: sessionListVM.selectedSessionId) { _, newValue in
                        if let id = newValue {
                            conversationVM.connect(sessionId: id)
                        } else {
                            conversationVM.disconnect()
                        }
                    }
                    .onAppear {
                        conversationVM.connect(sessionId: sessionId)
                    }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("Select a session")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("Choose a session from the sidebar or start a new one")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
            }
        }
        .sheet(isPresented: $showFileBrowser) {
            NavigationStack {
                FileBrowserView(onSessionStarted: {
                    showFileBrowser = false
                    sessionListVM.refreshSessions()
                })
            }
        }
        .alert(
            "Invalid Certificate",
            isPresented: $sessionListVM.showSSLAlert
        ) {
            Button("Connect Anyway", role: .destructive) {
                sessionListVM.acceptInvalidCertificate()
            }
            Button("Abort", role: .cancel) {}
        } message: {
            Text("The server's TLS certificate is not trusted. It may be self-signed or expired.\n\nDo you want to ignore this and connect anyway?")
        }
        .onAppear {
            sessionListVM.startPolling()
            NotificationService.shared.requestPermission()
        }
        .onDisappear {
            sessionListVM.stopPolling()
        }
    }
}
