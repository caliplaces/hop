import SwiftUI

/// Someone in the app: their initial on their colour.
struct Avatar: View {
    let me: Me?
    var size: CGFloat = 32

    private var color: PaletteColor { me?.paletteColor ?? Palette.brand }

    var body: some View {
        Circle()
            .fill(color.color.gradient)
            .overlay {
                Text(initial)
                    .font(.system(size: size * 0.44, weight: .bold, design: .rounded))
                    .foregroundStyle(color.onColor)
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private var initial: String {
        let source = me?.name ?? me?.handle ?? me?.email ?? ""
        return source.first.map { String($0).uppercased() } ?? "?"
    }
}

#Preview {
    HStack {
        Avatar(me: nil)
        Avatar(me: nil, size: 56)
    }
}
