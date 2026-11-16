import Foundation

/// The link name of an event (onmyhop.com/<handle>/<name>), made from its
/// title the way the website makes it: `slugify` in
/// packages/shared/src/handles.ts. `EventLinkTests` holds the two together.
nonisolated enum EventLink {
    /// Link names are at most this long (`HOP_SLUG_PATTERN`).
    static let maxLength = 40
    /// For a title with nothing a link can use, such as one in Chinese or emoji.
    static let fallback = "event"

    /// "Mistrovství ČR 2026" becomes "mistrovstvi-cr-2026".
    static func slug(_ title: String) -> String {
        // Accents come off ("č" is "c" plus a háček), then everything but
        // a–z and 0–9 separates words.
        let folded = title.decomposedStringWithCompatibilityMapping.unicodeScalars
            .filter { !(0x300...0x36F).contains($0.value) }
        let lowered = String(String.UnicodeScalarView(folded)).lowercased()
        var words: [String] = []
        var word = String.UnicodeScalarView()
        for scalar in lowered.unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                word.append(scalar)
            } else if !word.isEmpty {
                words.append(String(word))
                word = String.UnicodeScalarView()
            }
        }
        if !word.isEmpty { words.append(String(word)) }
        var slug = String(words.joined(separator: "-").prefix(maxLength))
        if slug.hasSuffix("-") { slug.removeLast() }
        return slug
    }

    /// A link name for a new event that none of `taken` has: the title's,
    /// or failing that "event", then numbered ("prague-open-2"), shortened
    /// where needed so the number always fits.
    static func free(for title: String, taken: Set<String>) -> String {
        let base = slug(title).isEmpty ? fallback : slug(title)
        if !taken.contains(base) { return base }
        var number = 2
        while true {
            let suffix = "-\(number)"
            var stem = String(base.prefix(maxLength - suffix.count))
            while stem.hasSuffix("-") { stem.removeLast() }
            let candidate = stem + suffix
            if !taken.contains(candidate) { return candidate }
            number += 1
        }
    }
}
