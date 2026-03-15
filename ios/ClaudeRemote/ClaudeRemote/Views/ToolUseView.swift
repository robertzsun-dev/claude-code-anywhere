import SwiftUI

struct ToolUseView: View {
    let name: String
    let input: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "gearshape")
                    .font(.caption)
                    .foregroundStyle(.orange)
                Text(name)
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.medium)
                    .foregroundStyle(.orange)
            }

            if !input.isEmpty {
                Text(formatJSON(input))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(8)
                #if os(iOS)
                .background(Color(.tertiarySystemBackground))
                #else
                .background(Color(nsColor: .textBackgroundColor))
                #endif
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
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
