import SwiftUI

struct ThinkingView: View {
    let text: String
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                #if os(iOS)
                .background(Color(.tertiarySystemBackground))
                #else
                .background(Color(nsColor: .textBackgroundColor))
                #endif
                .clipShape(RoundedRectangle(cornerRadius: 6))
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "brain")
                    .font(.caption)
                    .foregroundStyle(.indigo)
                Text("Thinking...")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.indigo)
            }
        }
        .tint(.indigo)
    }
}
