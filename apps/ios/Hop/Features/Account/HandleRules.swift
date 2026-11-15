import Foundation

/// What makes a handle (onmyhop.com/<handle>) acceptable before asking the
/// server, mirrored from packages/shared/src/handles.ts. The server also
/// rejects reserved and taken handles. `HandleRulesTests` keeps the pattern in
/// sync with the website's.
nonisolated enum HandleRules {
    /// The website's `HANDLE_PATTERN`, character for character.
    static let pattern = #"^[a-z0-9][a-z0-9_.]{0,28}[a-z0-9]$"#

    /// Trims, drops a leading "@" and lowercases, as the server does.
    static func normalize(_ input: String) -> String {
        var handle = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if handle.hasPrefix("@") { handle.removeFirst() }
        return handle.lowercased()
    }

    static func isValid(_ handle: String) -> Bool {
        handle.range(of: pattern, options: .regularExpression) != nil && !handle.contains("..")
    }

    /// A first guess from their name or email, like the website's.
    static func suggestion(name: String?, email: String?) -> String {
        let base = name ?? email?.split(separator: "@").first.map(String.init) ?? ""
        let handle = normalize(base.filter { !$0.isWhitespace })
        return String(handle.filter { "abcdefghijklmnopqrstuvwxyz0123456789_.".contains($0) }.prefix(30))
    }
}
