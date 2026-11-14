import SwiftUI

/// Text with a highlight sweeping across it, like "swipe up to open" on the
/// Lock Screen. Holds still when Reduce Motion is on.
struct ShimmerText: View {
    let text: LocalizedStringKey

    init(_ text: LocalizedStringKey) {
        self.text = text
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            Text(text).foregroundStyle(.primary.opacity(0.8))
        } else {
            TimelineView(.animation) { context in
                // Sweep for the first 70% of each period, then rest.
                let period = 2.8
                let cycle = context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: period) / period
                let x = -0.5 + 2 * min(cycle / 0.7, 1)
                Text(text)
                    .foregroundStyle(
                        LinearGradient(
                            stops: [
                                .init(color: .primary.opacity(0.42), location: 0),
                                .init(color: .primary, location: 0.5),
                                .init(color: .primary.opacity(0.42), location: 1),
                            ],
                            startPoint: UnitPoint(x: x - 0.4, y: 0.5),
                            endPoint: UnitPoint(x: x + 0.4, y: 0.5)
                        )
                    )
            }
        }
    }
}

#Preview {
    ShimmerText("Swipe up to start")
        .font(.title3.weight(.semibold))
}
