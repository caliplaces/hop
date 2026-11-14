import Foundation
import Testing
@testable import Hop

@Suite("Palette")
struct PaletteTests {
    /// The app's palette must match the website's, colour for colour.
    @Test func matchesTheSharedPalette() throws {
        // HopTests/ → ios/ → apps/ → repository root
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: root.appending(path: "packages/shared/src/colors.ts"),
            encoding: .utf8
        )
        let entry = /\{ id: "(\w+)", name: "([^"]+)", hex: "#([0-9A-Fa-f]{6})" \}/
        let shared = source.matches(of: entry).map {
            (id: String($0.1), name: String($0.2), hex: UInt32($0.3, radix: 16))
        }

        #expect(shared.count == Palette.all.count)
        for (app, web) in zip(Palette.all, shared) {
            #expect(app.id == web.id)
            #expect(app.name == web.name)
            #expect(app.hex == web.hex, "\(app.id)")
        }
    }

    @Test func brandIsGrape() {
        #expect(Palette.brand.id == "grape")
    }
}
