import SwiftUI

struct MarkdownTextView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(parseBlocks(text).enumerated()), id: \.offset) { _, block in
                renderBlock(block)
            }
        }
    }

    // MARK: - Block Types

    private enum MarkdownBlock {
        case heading(level: Int, text: String)
        case codeBlock(language: String?, code: String)
        case bulletList(items: [String])
        case numberedList(items: [String])
        case blockquote(text: String)
        case horizontalRule
        case paragraph(text: String)
    }

    // MARK: - Parser

    private func parseBlocks(_ input: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = input.components(separatedBy: "\n")
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code block
            if trimmed.hasPrefix("```") {
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        i += 1
                        break
                    }
                    codeLines.append(lines[i])
                    i += 1
                }
                blocks.append(.codeBlock(
                    language: language.isEmpty ? nil : language,
                    code: codeLines.joined(separator: "\n")
                ))
                continue
            }

            // Heading
            if let headingMatch = trimmed.headingLevel() {
                blocks.append(.heading(level: headingMatch.level, text: headingMatch.text))
                i += 1
                continue
            }

            // Horizontal rule
            if trimmed.isHorizontalRule {
                blocks.append(.horizontalRule)
                i += 1
                continue
            }

            // Bullet list
            if trimmed.isBulletItem {
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.isBulletItem {
                        items.append(t.bulletText)
                        i += 1
                    } else if t.isEmpty && i + 1 < lines.count && lines[i + 1].trimmingCharacters(in: .whitespaces).isBulletItem {
                        i += 1
                    } else {
                        break
                    }
                }
                blocks.append(.bulletList(items: items))
                continue
            }

            // Numbered list
            if trimmed.isNumberedItem {
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.isNumberedItem {
                        items.append(t.numberedText)
                        i += 1
                    } else if t.isEmpty && i + 1 < lines.count && lines[i + 1].trimmingCharacters(in: .whitespaces).isNumberedItem {
                        i += 1
                    } else {
                        break
                    }
                }
                blocks.append(.numberedList(items: items))
                continue
            }

            // Blockquote
            if trimmed.hasPrefix(">") {
                var quoteLines: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix(">") {
                        let content = String(t.dropFirst()).trimmingCharacters(in: .whitespaces)
                        quoteLines.append(content)
                        i += 1
                    } else if t.isEmpty && i + 1 < lines.count && lines[i + 1].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                        quoteLines.append("")
                        i += 1
                    } else {
                        break
                    }
                }
                blocks.append(.blockquote(text: quoteLines.joined(separator: "\n")))
                continue
            }

            // Empty line - skip
            if trimmed.isEmpty {
                i += 1
                continue
            }

            // Paragraph - collect consecutive non-empty lines
            var paraLines: [String] = []
            while i < lines.count {
                let t = lines[i].trimmingCharacters(in: .whitespaces)
                if t.isEmpty || t.hasPrefix("```") || t.headingLevel() != nil || t.isHorizontalRule || t.isBulletItem || t.isNumberedItem || t.hasPrefix(">") {
                    break
                }
                paraLines.append(lines[i])
                i += 1
            }
            if !paraLines.isEmpty {
                blocks.append(.paragraph(text: paraLines.joined(separator: "\n")))
            }
        }

        return blocks
    }

    // MARK: - Renderers

    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            renderHeading(level: level, text: text)
        case .codeBlock(let language, let code):
            renderCodeBlock(language: language, code: code)
        case .bulletList(let items):
            renderBulletList(items: items)
        case .numberedList(let items):
            renderNumberedList(items: items)
        case .blockquote(let text):
            renderBlockquote(text: text)
        case .horizontalRule:
            Divider().padding(.vertical, 4)
        case .paragraph(let text):
            renderInlineMarkdown(text)
                .font(.subheadline)
        }
    }

    private func renderHeading(level: Int, text: String) -> some View {
        renderInlineMarkdown(text)
            .font(headingFont(level))
            .fontWeight(.semibold)
            .padding(.top, level <= 2 ? 4 : 2)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2
        case 2: .title3
        case 3: .headline
        default: .subheadline
        }
    }

    private func renderCodeBlock(language: String?, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let lang = language {
                Text(lang)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.top, 6)
                    .padding(.bottom, 2)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, language != nil ? 6 : 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        #if os(iOS)
        .background(Color(.tertiarySystemBackground))
        #else
        .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
        #endif
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(.quaternary, lineWidth: 0.5)
        )
    }

    private func renderBulletList(items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\u{2022}")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    renderInlineMarkdown(item)
                        .font(.subheadline)
                }
            }
        }
    }

    private func renderNumberedList(items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(index + 1).")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 18, alignment: .trailing)
                    renderInlineMarkdown(item)
                        .font(.subheadline)
                }
            }
        }
    }

    private func renderBlockquote(text: String) -> some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 1)
                .fill(.secondary.opacity(0.4))
                .frame(width: 3)

            renderInlineMarkdown(text)
                .font(.subheadline)
                .italic()
                .foregroundStyle(.secondary)
                .padding(.leading, 10)
        }
        .padding(.vertical, 2)
    }

    private func renderInlineMarkdown(_ input: String) -> Text {
        if let attributed = try? AttributedString(markdown: input, options: .init(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )) {
            return Text(attributed)
        }
        return Text(input)
    }
}

// MARK: - String Helpers

private extension String {
    struct HeadingMatch {
        let level: Int
        let text: String
    }

    func headingLevel() -> HeadingMatch? {
        var level = 0
        var idx = startIndex
        while idx < endIndex && self[idx] == "#" && level < 6 {
            level += 1
            idx = index(after: idx)
        }
        guard level > 0, idx < endIndex, self[idx] == " " else { return nil }
        let text = String(self[index(after: idx)...]).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return HeadingMatch(level: level, text: text)
    }

    var isHorizontalRule: Bool {
        let stripped = filter { !$0.isWhitespace }
        guard stripped.count >= 3 else { return false }
        return stripped.allSatisfy({ $0 == "-" }) || stripped.allSatisfy({ $0 == "*" }) || stripped.allSatisfy({ $0 == "_" })
    }

    var isBulletItem: Bool {
        if let first = first, (first == "-" || first == "*" || first == "+") {
            return count > 1 && self[index(after: startIndex)] == " "
        }
        return false
    }

    var bulletText: String {
        guard isBulletItem else { return self }
        return String(dropFirst(2))
    }

    var isNumberedItem: Bool {
        guard let dotIndex = firstIndex(of: ".") else { return false }
        let prefix = self[startIndex..<dotIndex]
        guard !prefix.isEmpty, prefix.allSatisfy({ $0.isNumber }) else { return false }
        let afterDot = index(after: dotIndex)
        return afterDot < endIndex && self[afterDot] == " "
    }

    var numberedText: String {
        guard let dotIndex = firstIndex(of: ".") else { return self }
        let afterDot = index(after: dotIndex)
        guard afterDot < endIndex else { return self }
        return String(self[index(after: afterDot)...])
    }
}
