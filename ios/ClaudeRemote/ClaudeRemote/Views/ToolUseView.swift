import SwiftUI

struct ToolUseView: View {
    let name: String
    let input: String
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if !input.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(formatJSON(input))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(8)
                #if os(iOS)
                .background(Color(.tertiarySystemBackground))
                #else
                .background(Color(nsColor: .textBackgroundColor))
                #endif
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "gearshape")
                    .font(.caption)
                    .foregroundStyle(.orange)
                Text(name)
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.medium)
                    .foregroundStyle(.orange)
            }
        }
        .tint(.orange)
    }

    private func formatJSON(_ str: String) -> String {
        guard let data = str.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
              let result = String(data: pretty, encoding: .utf8) else {
            return str
        }
        return result
    }
}
