import SwiftUI

struct SessionRowView: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(session.shortId)
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                if let type = session.type {
                    Text(type)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.blue.opacity(0.15))
                        .foregroundStyle(.blue)
                        .clipShape(Capsule())
                }

                Spacer()

                Text(session.age)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let meta = session.metadata {
                if let cwd = meta.cwd {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                            .font(.caption2)
                        Text(cwd)
                            .font(.caption)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .foregroundStyle(.secondary)
                }

                if let hostname = meta.hostname {
                    HStack(spacing: 4) {
                        Image(systemName: "desktopcomputer")
                            .font(.caption2)
                        Text(hostname)
                            .font(.caption)
                        if let user = meta.user {
                            Text("(\(user))")
                                .font(.caption)
                        }
                    }
                    .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
