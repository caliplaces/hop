import AppIntents

/// Hop's shortcuts, for Siri, Spotlight, the Shortcuts app and the Action
/// button: press it at an event and the QR code is up.
struct HopShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ShowQRCodeIntent(),
            phrases: [
                "Show my \(.applicationName) QR code",
                "Show my \(.applicationName) code",
                "Open my \(.applicationName) QR code",
            ],
            shortTitle: "My QR Code",
            systemImageName: "qrcode"
        )
    }

    static let shortcutTileColor: ShortcutTileColor = .purple
}
