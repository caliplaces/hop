import SwiftUI

/// One of the colours an athlete picks for their Hop. Used as a fill or a tint,
/// never as text on the canvas.
nonisolated struct PaletteColor: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let hex: UInt32

    var color: Color { Color(hex: hex) }
}

/// The athlete palette, mirrored from packages/shared/src/colors.ts.
/// `PaletteTests` fails if the two drift apart.
nonisolated enum Palette {
    static let coral = PaletteColor(id: "coral", name: "Coral", hex: 0xFF6B5B)
    static let tangerine = PaletteColor(id: "tangerine", name: "Tangerine", hex: 0xFF9F1C)
    static let sunflower = PaletteColor(id: "sunflower", name: "Sunflower", hex: 0xFFC93C)
    static let mint = PaletteColor(id: "mint", name: "Mint", hex: 0x3DDC97)
    static let teal = PaletteColor(id: "teal", name: "Teal", hex: 0x14B8A6)
    static let sky = PaletteColor(id: "sky", name: "Sky", hex: 0x38BDF8)
    static let ocean = PaletteColor(id: "ocean", name: "Ocean", hex: 0x2563EB)
    static let indigo = PaletteColor(id: "indigo", name: "Indigo", hex: 0x5B5BF0)
    static let grape = PaletteColor(id: "grape", name: "Grape", hex: 0x7C4DFF)
    static let bubblegum = PaletteColor(id: "bubblegum", name: "Bubblegum", hex: 0xF472B6)
    static let cherry = PaletteColor(id: "cherry", name: "Cherry", hex: 0xE11D48)
    static let graphite = PaletteColor(id: "graphite", name: "Graphite", hex: 0x3F3F46)

    static let all = [
        coral, tangerine, sunflower, mint, teal, sky, ocean, indigo, grape, bubblegum, cherry, graphite,
    ]

    /// Hop's own colour, for screens that don't belong to an athlete yet.
    static let brand = grape
}
