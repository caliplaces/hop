import SwiftUI

/// Soft glows of colour drifting slowly over the canvas. The backdrop for
/// full-screen moments, so glass has something to refract.
struct Aura: View {
    var colors: [Color]
    /// Scales every glow's strength; 1 is the default.
    var intensity: Double = 1

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            Canvas { canvas, size in
                // Glows read stronger on black, so they're dimmer in dark mode.
                let strength: Double = (colorScheme == .dark ? 0.34 : 0.30) * intensity
                let reach: Double = max(size.width, size.height)
                for (index, color) in colors.enumerated() {
                    let phase = Double(index) * 2.1
                    let x: Double = 0.5 + 0.42 * sin(time * 0.07 + phase)
                    let y: Double = 0.5 + 0.38 * cos(time * 0.05 + phase * 1.3)
                    let center = CGPoint(x: size.width * x, y: size.height * y)
                    let radius: Double = reach * (0.5 + 0.08 * sin(time * 0.11 + phase))
                    canvas.fill(
                        Path(ellipseIn: CGRect(
                            x: center.x - radius, y: center.y - radius,
                            width: radius * 2, height: radius * 2
                        )),
                        with: .radialGradient(
                            Gradient(colors: [color.opacity(strength), color.opacity(0)]),
                            center: center, startRadius: 0, endRadius: radius
                        )
                    )
                }
            }
        }
        .background(Theme.canvas)
    }
}

#Preview {
    Aura(colors: [Palette.grape.color, Palette.sky.color, Palette.bubblegum.color])
        .ignoresSafeArea()
}
