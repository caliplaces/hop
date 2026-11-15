import SwiftUI
import UIKit

/// Hop's neutrals, the same values as the website's light and dark themes.
nonisolated enum Theme {
    static let canvas = Color(light: 0xFAFAF7, dark: 0x0B0B0C)
    static let surface = Color(light: 0xFFFFFF, dark: 0x151517)
    static let ink = Color(light: 0x0B0B0C, dark: 0xF4F4EF)
    static let muted = Color(light: 0x6B6B66, dark: 0xA1A19B)
}

nonisolated extension Color {
    /// An sRGB colour from a 0xRRGGBB literal.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// A colour that follows the system's light or dark appearance.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

nonisolated extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
