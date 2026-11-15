import SwiftUI
import UIKit

/// The athlete's link: their Hop pass with the QR code, and ways to share it.
struct MyHopView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @State private var copied = false
    @State private var settingUpEvent = false
    @State private var stats: PassStats?
    /// The pass as a story-sized image, ready to share.
    @State private var story: Image?
    /// Set when the setup sheet started Event mode, to go on stage once
    /// the sheet is gone.
    @State private var startedEvent = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let me = session.me, let link = me.link {
                    content(me: me, link: link)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 300)
                }
            }
            .background {
                Aura(colors: [color.color, color.color, Palette.brand.color], intensity: 0.7)
                    .ignoresSafeArea()
            }
            .navigationTitle("My Hop")
            .toolbar { AccountMenu() }
            .sheet(isPresented: $settingUpEvent, onDismiss: {
                if startedEvent {
                    startedEvent = false
                    eventMode.isStagePresented = true
                }
            }) {
                EventSetupSheet { startedEvent = true }
            }
        }
    }

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    private func content(me: Me, link: URL) -> some View {
        VStack(spacing: 20) {
            TurningPass(me: me, link: link, stats: stats)
                .padding(.horizontal, 12)

            Text("Anyone can scan this or open the link to send you their clips. No app or account needed.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)

            eventModeButton(color: me.paletteColor)

            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    Button {
                        UIPasteboard.general.url = link
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(maxWidth: .infinity)
                    }
                    Menu {
                        ShareLink("Share link", item: link)
                        if let story {
                            ShareLink(
                                "Share pass image",
                                item: story,
                                preview: SharePreview("My Hop pass", image: story)
                            )
                        }
                    } label: {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    Link(destination: link) {
                        Label("Open", systemImage: "safari")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
        // Reloads when the profile changes, and as clips land in Event mode,
        // so the pass and its story image keep up.
        .task(id: StatsKey(me: me, eventClips: eventMode.clips)) { await loadStats() }
        .task(id: StoryKey(me: me, stats: stats)) {
            story = PassStory.image(me: me, link: link, stats: stats).map(Image.init(uiImage:))
        }
    }

    /// Clips and events, for the pass's footer.
    private func loadStats() async {
        struct Reply: Decodable { let hops: [Hop] }
        guard let reply: Reply = try? await session.api.get("api/me/hops") else { return }
        stats = PassStats(hops: reply.hops)
    }

    private struct StatsKey: Equatable {
        let me: Me
        let eventClips: Int
    }

    private struct StoryKey: Equatable {
        let me: Me
        let stats: PassStats?
    }

    /// Starts Event mode, or goes back to the one that's running.
    private func eventModeButton(color: PaletteColor) -> some View {
        Button {
            if eventMode.run != nil {
                eventMode.isStagePresented = true
            } else {
                settingUpEvent = true
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .symbolEffect(.variableColor.iterative, isActive: eventMode.run != nil)
                Text(eventMode.run != nil ? "Back to Event mode" : "Start Event mode")
            }
            .font(.headline)
            .foregroundStyle(color.onColor)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.extraLarge)
        .tint(color.color)
    }
}

/// The Hop pass, turning with the phone and under a finger. Its own view, so
/// motion updates (60 a second) redraw the pass alone.
private struct TurningPass: View {
    let me: Me
    let link: URL
    let stats: PassStats?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tilt = Tilt()
    /// How far a finger has turned the pass.
    @State private var drag = CGSize.zero

    var body: some View {
        let turn = reduceMotion ? .zero : CGPoint(
            x: max(-1, min(1, tilt.value.x + drag.width / 140)),
            y: max(-1, min(1, tilt.value.y + drag.height / 140))
        )
        HopPass(me: me, link: link, stats: stats, tilt: turn)
            .frame(maxWidth: 340)
            .rotation3DEffect(.degrees(turn.x * 14), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
            .rotation3DEffect(.degrees(turn.y * -12), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
            .gesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { drag = $0.translation }
                    .onEnded { _ in
                        withAnimation(.spring(response: 0.55, dampingFraction: 0.5)) { drag = .zero }
                    },
                isEnabled: !reduceMotion
            )
            .onAppear { if !reduceMotion { tilt.start() } }
            .onDisappear { tilt.stop() }
            // Turning Reduce Motion on or off while the pass is showing.
            .onChange(of: reduceMotion) { _, reduce in
                if reduce { tilt.stop() } else { tilt.start() }
            }
    }
}
