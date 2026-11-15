import Foundation
import WidgetKit

extension HopCard {
    /// The card for this profile; nil without one, or before a handle is claimed.
    init?(me: Me?) {
        guard let me, let handle = me.handle, let link = me.link else { return nil }
        self.init(link: link, handle: handle, name: me.name, color: me.color)
    }

    /// Shares the profile with the widgets, or clears it on sign-out, and
    /// reloads the QR code widget when anything changed.
    static func publish(_ me: Me?, to defaults: UserDefaults? = shared) {
        guard save(HopCard(me: me), to: defaults) else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
    }
}
