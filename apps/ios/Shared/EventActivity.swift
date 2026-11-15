import ActivityKit
import Foundation

/// Event mode's Live Activity: the athlete's QR code on the Lock Screen, and
/// the clips that came in since Event mode started, there and in the
/// Dynamic Island.
nonisolated struct EventActivityAttributes: ActivityAttributes {
    /// What changes while the event runs.
    nonisolated struct ContentState: Codable, Hashable, Sendable {
        /// Clips sent since Event mode started.
        var clips: Int
        /// Who sent the latest one, as the inbox names them.
        var latest: String?
    }

    /// The event's name.
    var title: String
    /// The athlete's upload link, which the QR code encodes.
    var link: URL
    /// The athlete's palette colour id.
    var color: String
    var startedAt: Date

    /// Opens the app on the full-screen QR code. Tapping the Live Activity
    /// goes here.
    static let stageURL = URL(string: "com.onmyhop.app://event")!
}
