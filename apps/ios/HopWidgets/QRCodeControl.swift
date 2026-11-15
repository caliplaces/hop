import AppIntents
import SwiftUI
import WidgetKit

/// "My Hop QR" in Control Center and on the Lock Screen: opens the athlete's
/// QR code full screen.
struct QRCodeControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "hop.qr.control") {
            ControlWidgetButton(action: ShowQRCodeIntent()) {
                Label("My Hop QR", systemImage: "qrcode")
            }
        }
        .displayName("Show my Hop QR code")
        .description("Opens your QR code full screen, ready to scan.")
    }
}
