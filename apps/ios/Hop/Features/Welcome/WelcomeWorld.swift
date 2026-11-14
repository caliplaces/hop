import SwiftUI

/// What sits behind the welcome bubble: the aura, a field of dots and the pitch.
/// The bubble magnifies it as it passes over, which the dots make easy to see.
struct WelcomeWorld: View {
    let layout: BubbleLayout

    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 46

    var body: some View {
        ZStack(alignment: .topLeading) {
            Aura(
                colors: [Palette.grape.color, Palette.sky.color, Palette.bubblegum.color, Palette.mint.color],
                intensity: 0.8
            )
            DotField()
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Image(.bobbleFace)
                        .resizable()
                        .frame(width: 34, height: 34)
                        .accessibilityHidden(true)
                    Text("hop")
                        .font(.system(size: 26, weight: .bold))
                        .tracking(-0.5)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Hop")

                Text("Every clip from the crowd.")
                    .font(.system(size: titleSize, weight: .bold))
                    .tracking(-1.2)
                    .padding(.top, layout.size.height * 0.08)
                    .accessibilityAddTraits(.isHeader)

                Text("Say “upload it on my Hop”, and every video people take of you lands in one private inbox.")
                    .font(.title3)
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 14)
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 28)
            .padding(.top, layout.insets.top + 12)
        }
        .frame(width: layout.size.width, height: layout.size.height)
    }
}

/// A quiet grid of dots that fades in towards the bottom, where the bubble is.
private struct DotField: View {
    var body: some View {
        Canvas { canvas, size in
            let spacing: CGFloat = 20
            let dot: CGFloat = 2.2
            var path = Path()
            var y = spacing / 2
            while y < size.height {
                var x = spacing / 2
                while x < size.width {
                    path.addEllipse(in: CGRect(x: x - dot / 2, y: y - dot / 2, width: dot, height: dot))
                    x += spacing
                }
                y += spacing
            }
            canvas.fill(path, with: .color(Theme.ink.opacity(0.1)))
        }
        .mask {
            LinearGradient(
                stops: [.init(color: .clear, location: 0.3), .init(color: .black, location: 1)],
                startPoint: .top, endPoint: .bottom
            )
        }
        .accessibilityHidden(true)
    }
}
