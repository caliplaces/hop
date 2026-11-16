import SwiftUI
import WidgetKit

/// The athlete's QR code on the Home Screen, ready to scan, and on the Lock
/// Screen as a button that opens it full screen. Lock Screen widgets are drawn
/// in a single tint, which a QR code can't be scanned in, so they open the
/// app instead of showing it.
struct QRWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HopCard.widgetKind, provider: CardProvider()) { entry in
            QRWidgetView(card: entry.card)
        }
        .configurationDisplayName("My Hop QR code")
        .description("Your QR code, ready to scan. People who filmed you send their clips with it.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

nonisolated struct CardEntry: TimelineEntry {
    let date: Date
    let card: HopCard?
}

/// The card the app last shared. It only changes when the app writes a new
/// one, and the app reloads the widget then.
nonisolated struct CardProvider: TimelineProvider {
    func placeholder(in context: Context) -> CardEntry {
        CardEntry(date: .now, card: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (CardEntry) -> Void) {
        let card = HopCard.load() ?? (context.isPreview ? .sample : nil)
        completion(CardEntry(date: .now, card: card))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CardEntry>) -> Void) {
        completion(Timeline(entries: [CardEntry(date: .now, card: HopCard.load())], policy: .never))
    }
}

private extension HopCard {
    /// For the widget gallery, before the athlete has a link.
    nonisolated static let sample = HopCard(
        link: URL(string: "https://onmyhop.com/you")!,
        handle: "you",
        name: nil,
        color: Palette.brand.id
    )
}

struct QRWidgetView: View {
    let card: HopCard?
    @Environment(\.widgetFamily) private var family

    private var color: PaletteColor { Palette.color(id: card?.color) }

    var body: some View {
        content
            .widgetURL(HopDeepLink.qrCode.url)
            .containerBackground(for: .widget) {
                if family == .systemSmall || family == .systemMedium {
                    LinearGradient(
                        colors: [
                            color.color.mix(with: .white, by: 0.2),
                            color.color,
                            color.color.mix(with: .black, by: 0.18),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "qrcode")
                    .font(.title2.weight(.semibold))
            }
            .accessibilityLabel("Show my Hop QR code")
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "qrcode")
                    .font(.title.weight(.semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text("My Hop")
                        .font(.headline)
                        .widgetAccentable()
                    Text(card.map { "@\($0.handle)" } ?? String(localized: "Open Hop"))
                        .font(.caption)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        case .systemMedium:
            if let card { medium(card) } else { setup }
        default:
            if let card { small(card) } else { setup }
        }
    }

    private func small(_ card: HopCard) -> some View {
        VStack(spacing: 6) {
            QRCodeView(text: card.link.absoluteString, padding: 7, cornerRadius: 14)
            Text(verbatim: "@\(card.handle)")
                .font(.caption.weight(.bold))
                .foregroundStyle(color.onColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func medium(_ card: HopCard) -> some View {
        HStack(spacing: 14) {
            QRCodeView(text: card.link.absoluteString, padding: 8, cornerRadius: 16)
            VStack(alignment: .leading, spacing: 4) {
                Image("Face-\(color.id)")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 34, height: 34)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                Text("Filmed me?")
                    .font(.subheadline.weight(.semibold))
                    .opacity(0.8)
                Text("Send me your clips")
                    .font(.headline)
                Text(verbatim: card.link.spoken)
                    .font(.caption.weight(.semibold))
                    .opacity(0.8)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(color.onColor)
            Spacer(minLength: 0)
        }
    }

    /// No link yet: signed out, or a handle still to claim.
    private var setup: some View {
        VStack(spacing: 6) {
            Image("Face-\(Palette.brand.id)")
                .resizable()
                .scaledToFit()
                .frame(width: 40, height: 40)
                .accessibilityHidden(true)
            Text("Open Hop to get your link")
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(color.onColor)
    }
}
