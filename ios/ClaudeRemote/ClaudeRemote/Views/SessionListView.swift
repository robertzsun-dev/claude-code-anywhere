import SwiftUI

struct SessionListView: View {
    var viewModel: SessionListViewModel
    @Binding var selectedSessionId: String?
    var onNewSession: () -> Void

    var body: some View {
        List(selection: $selectedSessionId) {
            ForEach(viewModel.sessions) { session in
                SessionRowView(session: session)
                    .tag(session.id)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            viewModel.deleteSession(id: session.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.sidebar)
        .refreshable {
            viewModel.refreshSessions()
        }
        .overlay {
            if viewModel.sessions.isEmpty && viewModel.error == nil {
                ContentUnavailableView(
                    "No Sessions",
                    systemImage: "terminal",
                    description: Text("Start a new Claude Code session or wait for one to connect.")
                )
            }
            if let error = viewModel.error {
                ContentUnavailableView(
                    "Connection Error",
                    systemImage: "wifi.exclamationmark",
                    description: Text(error)
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: onNewSession) {
                    Image(systemName: "plus")
                }
            }
        }
    }
}
