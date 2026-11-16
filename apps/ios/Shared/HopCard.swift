import Foundation

/// The athlete's link as the widgets show it, shared with them through the
/// app group. Written by the app when the profile changes, and cleared when
/// the athlete signs out, so a widget never shows someone else's QR code.
nonisolated struct HopCard: Codable, Equatable, Sendable {
    /// onmyhop.com/<handle>, which the QR code encodes.
    let link: URL
    let handle: String
    let name: String?
    /// A palette colour id.
    let color: String

    /// The app group the app and its widgets share.
    static let appGroup = "group.com.onmyhop.app"
    /// The QR code widget, to reload when the card changes.
    static let widgetKind = "hop.qr"
    private static let key = "hop.card"

    static var shared: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func load(from defaults: UserDefaults? = shared) -> HopCard? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(HopCard.self, from: data)
    }

    /// Stores the card, or clears it with nil. Returns whether anything
    /// changed, so callers only reload widgets when they need to.
    @discardableResult
    static func save(_ card: HopCard?, to defaults: UserDefaults? = shared) -> Bool {
        guard let defaults, card != load(from: defaults) else { return false }
        if let card, let data = try? JSONEncoder().encode(card) {
            defaults.set(data, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
        return true
    }
}
