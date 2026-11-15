import Foundation

/// Links into the app, through its URL scheme: from the Live Activity, the
/// widgets, Control Center and Shortcuts.
nonisolated enum HopDeepLink: Equatable, Sendable {
    /// Event mode's full-screen QR code.
    case eventStage
    /// The athlete's QR code, full screen. Event mode's, if it's running.
    case qrCode

    static let scheme = "com.onmyhop.app"

    var url: URL {
        switch self {
        case .eventStage: URL(string: "\(Self.scheme)://event")!
        case .qrCode: URL(string: "\(Self.scheme)://qr")!
        }
    }

    init?(url: URL) {
        guard url.scheme == Self.scheme else { return nil }
        switch url.host() {
        case "event": self = .eventStage
        case "qr": self = .qrCode
        default: return nil
        }
    }
}
