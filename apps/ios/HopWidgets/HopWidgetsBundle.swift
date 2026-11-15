import SwiftUI
import WidgetKit

/// Hop's widgets. For now, Event mode's Live Activity.
@main
struct HopWidgetsBundle: WidgetBundle {
    var body: some Widget {
        EventLiveActivity()
    }
}
