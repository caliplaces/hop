import SwiftUI

/// The mark next to a Hop+ member's name, here and on their page.
/// Deliberately not a check: paying doesn't prove who someone is.
struct HopPlusBadge: View {
    let color: PaletteColor

    var body: some View {
        Text(verbatim: "Hop+")
            .font(.system(.caption2, design: .rounded, weight: .heavy))
            .foregroundStyle(color.onColor)
            .padding(.horizontal, 7)
            .padding(.vertical, 2.5)
            .background(color.color.gradient, in: .capsule)
            .accessibilityLabel("Hop+ member")
    }
}

#Preview {
    HStack {
        Text(verbatim: "Maya Rivera").font(.headline)
        HopPlusBadge(color: Palette.brand)
    }
}
