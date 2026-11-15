import SwiftUI
import UIKit

/// What the pass shows under the name: clips received and events, across
/// all of the athlete's events.
nonisolated struct PassStats: Equatable, Sendable {
    let clips: Int
    let events: Int

    init(hops: [Hop]) {
        clips = hops.reduce(0) { $0 + $1.fileCount }
        events = hops.count
    }

    init(clips: Int, events: Int) {
        self.clips = clips
        self.events = events
    }

    var clipsText: String {
        clips == 1 ? String(localized: "1 clip") : String(localized: "\(clips) clips")
    }

    var eventsText: String {
        events == 1 ? String(localized: "1 event") : String(localized: "\(events) events")
    }
}

/// The Hop pass: the athlete's card, in their colour with a holographic foil,
/// and Bobble peeking over its top edge. The QR code sits on white, clear of
/// the foil, so it always scans.
struct HopPass: View {
    let me: Me
    let link: URL
    var stats: PassStats?
    /// -1…1 on each axis; moves the foil, the sheen and the glare.
    var tilt: CGPoint = .zero

    private var color: PaletteColor { me.paletteColor }

    var body: some View {
        ZStack(alignment: .top) {
            color.bobble
                .resizable()
                .scaledToFit()
                .frame(width: 104, height: 104)
                .offset(x: tilt.x * -6, y: tilt.y * -4)
                .accessibilityHidden(true)
            card
                .padding(.top, 78)
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: "hop")
                    .font(.system(size: 24, weight: .black, design: .rounded))
                Spacer()
                Text("ATHLETE PASS")
                    .font(.caption2.weight(.heavy))
                    .tracking(1.8)
                    .opacity(0.8)
            }

            QRCodeView(text: link.absoluteString, padding: 12, cornerRadius: 22)
                .frame(maxWidth: 190)
                .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
                .padding(.top, 20)

            VStack(spacing: 2) {
                Text(me.name ?? me.handle.map { "@\($0)" } ?? "")
                    .font(.title2.bold())
                Text(verbatim: link.spoken)
                    .font(.subheadline.weight(.semibold))
                    .opacity(0.78)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.top, 16)

            Rectangle()
                .fill(color.onColor.opacity(0.22))
                .frame(height: 1)
                .padding(.top, 16)

            HStack {
                if let stats {
                    Text(stats.clipsText)
                    Spacer()
                    Text(stats.eventsText)
                } else {
                    Text("Upload it on my Hop")
                    Spacer()
                }
            }
            .font(.footnote.weight(.semibold))
            .monospacedDigit()
            .opacity(0.85)
            .padding(.top, 12)
        }
        .padding(22)
        .foregroundStyle(color.onColor)
        .background { foil }
        .clipShape(.rect(cornerRadius: 34))
        .overlay {
            // A bright edge, like the rim of a laminated card.
            RoundedRectangle(cornerRadius: 34)
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.55), .white.opacity(0.08), .white.opacity(0.3)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.2
                )
        }
        .shadow(color: color.color.opacity(0.35), radius: 28, y: 16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Your Hop pass")
        .accessibilityValue(accessibilityValue)
    }

    /// The card's background: the athlete's colour, a soft gradient, the
    /// holographic foil and a glare that follows the light.
    private var foil: some View {
        LinearGradient(
            colors: [
                color.color.mix(with: .white, by: 0.22),
                color.color,
                color.color.mix(with: .black, by: 0.18),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .visualEffect { content, proxy in
            content.colorEffect(ShaderLibrary.holoFoil(
                .float2(proxy.size),
                .float2(tilt),
                .float(1)
            ))
        }
    }

    private var accessibilityValue: String {
        var parts = [me.name, link.spoken].compactMap(\.self)
        if let stats { parts += [stats.clipsText, stats.eventsText] }
        return parts.joined(separator: ", ")
    }
}

/// The pass on a story-sized backdrop (9:16), for sharing to Instagram
/// stories and the like: the link, and an invitation to send clips.
struct PassStory: View {
    let me: Me
    let link: URL
    var stats: PassStats?

    private var color: PaletteColor { me.paletteColor }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HopPass(me: me, link: link, stats: stats, tilt: CGPoint(x: 0.45, y: -0.3))
                .frame(width: 300)
                .rotation3DEffect(.degrees(-7), axis: (x: 0.4, y: 1, z: 0), perspective: 0.6)
            Text("Filmed me? Send me your clips")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .padding(.top, 36)
            Text(verbatim: link.spoken)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .opacity(0.7)
                .padding(.top, 6)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .frame(width: 360, height: 640)
        .background {
            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 0.5], [0.55, 0.45], [1, 0.5],
                    [0, 1], [0.5, 1], [1, 1],
                ],
                colors: [
                    .black, color.color.mix(with: .black, by: 0.55), .black,
                    color.color.mix(with: .black, by: 0.4), color.color.mix(with: .black, by: 0.15),
                    Palette.brand.color.mix(with: .black, by: 0.5),
                    .black, color.color.mix(with: .black, by: 0.6), .black,
                ]
            )
        }
        .environment(\.colorScheme, .dark)
    }

    /// The story as an image, 1080 × 1920 pixels.
    static func image(me: Me, link: URL, stats: PassStats?) -> UIImage? {
        let renderer = ImageRenderer(content: PassStory(me: me, link: link, stats: stats))
        renderer.scale = 3
        return renderer.uiImage
    }
}

#Preview {
    let me = Me(
        id: "usr_1", name: "Maya Rivera", email: nil, handle: "maya",
        activeHopId: nil, color: "coral", emailNewClips: true
    )
    VStack {
        HopPass(me: me, link: URL(string: "https://onmyhop.com/maya")!, stats: .init(clips: 128, events: 6))
            .frame(width: 320)
    }
    .padding()
}
