import SwiftUI
import WidgetKit

/// Hop's widgets: the QR code widget, the QR code control, and Event mode's
/// Live Activity.
@main
struct HopWidgetsBundle: WidgetBundle {
    var body: some Widget {
        QRWidget()
        QRCodeControl()
        EventLiveActivity()
    }
}
