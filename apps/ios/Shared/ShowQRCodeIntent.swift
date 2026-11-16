import AppIntents
import Foundation

/// "Show my Hop QR code": opens the app on the athlete's QR code, full
/// screen. For Siri, Shortcuts, the Action button and Control Center. It
/// opens a link rather than running in the app, so the widget extension can
/// offer it too.
struct ShowQRCodeIntent: AppIntent {
    static let title: LocalizedStringResource = "Show my Hop QR code"
    static let description = IntentDescription(
        "Opens your Hop QR code full screen, ready for people to scan."
    )

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(HopDeepLink.qrCode.url))
    }
}
