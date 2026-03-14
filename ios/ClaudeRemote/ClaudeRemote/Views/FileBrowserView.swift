import SwiftUI

struct FileBrowserView: View {
    var onSessionStarted: () -> Void

    @State private var viewModel = FileBrowserViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Current path
            HStack {
                Image(systemName: "folder")
                    .foregroundStyle(.blue)
                Text(viewModel.currentPath)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.head)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            #if os(iOS)
            .background(Color(.secondarySystemBackground))
            #else
            .background(Color(nsColor: .controlBackgroundColor))
            #endif

            // File list
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxHeight: .infinity)
            } else {
                List(viewModel.items) { item in
                    Button {
                        if item.isDirectory {
                            viewModel.browse(path: item.path)
                        }
                    } label: {
                        HStack {
                            Image(systemName: item.isDirectory ? "folder.fill" : "doc")
                                .foregroundStyle(item.isDirectory ? .blue : .secondary)
                            Text(item.name)
                                .foregroundStyle(item.isDirectory ? .primary : .secondary)
                            Spacer()
                            if item.isDirectory {
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }

            if let error = viewModel.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding()
            }

            if let result = viewModel.startSessionResult {
                Text(result)
                    .font(.caption)
                    .foregroundStyle(.green)
                    .padding()
            }
        }
        .navigationTitle("Browse Files")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewModel.startSession()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        onSessionStarted()
                    }
                } label: {
                    Label("Start Here", systemImage: "play.fill")
                }
                .disabled(viewModel.currentPath.isEmpty || viewModel.isStartingSession)
            }
        }
        .onAppear {
            viewModel.browse(path: nil)
        }
    }
}
