import SwiftUI

/// Every clip people sent, by event: each one a card with its latest clips
/// as the cover.
struct InboxView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @State private var model = InboxModel()

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }
    private var totalClips: Int { model.hops.reduce(0) { $0 + $1.fileCount } }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Inbox")
                .toolbar { AccountMenu() }
                .navigationDestination(for: Hop.self) { hop in
                    HopView(hopId: hop.id, model: model)
                }
                .background(Theme.canvas)
        }
        // Reloads when the link moves to another event, and as clips land
        // during Event mode.
        .task(id: Reload(activeHopId: session.me?.activeHopId, eventClips: eventMode.clips)) {
            await refresh()
        }
    }

    @ViewBuilder private var content: some View {
        if model.hops.isEmpty, model.phase == .loading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.hops.isEmpty, case let .failed(message) = model.phase {
            ContentUnavailableView {
                Label("Couldn’t load your clips", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") { Task { await refresh() } }
                    .buttonStyle(.glass)
            }
        } else if totalClips == 0 {
            EmptyInbox(color: color, link: session.me?.link)
                .refreshable { await refresh() }
        } else {
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(model.hops) { hop in
                        NavigationLink(value: hop) {
                            EventCard(
                                hop: hop,
                                cover: Array((model.clips[hop.id]?.items ?? []).prefix(3)),
                                isLive: hop.id == session.me?.activeHopId,
                                color: color
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .refreshable { await refresh() }
        }
    }

    private func refresh() async {
        await model.refresh(api: session.api, activeHopId: session.me?.activeHopId)
    }

    private struct Reload: Equatable {
        let activeHopId: String?
        let eventClips: Int
    }
}

/// One event: its latest clips as a cover, its name and how much is in it.
struct EventCard: View {
    let hop: Hop
    let cover: [Clip]
    /// Whether the athlete's link uploads into this event right now.
    let isLive: Bool
    let color: PaletteColor

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Mosaic(clips: cover, color: color)
            LinearGradient(
                colors: [.clear, .black.opacity(0.72)],
                startPoint: .center, endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if isLive { badge("Your link", systemImage: "link") }
                    if hop.isClosed { badge("Closed", systemImage: "lock.fill") }
                }
                Text(hop.title)
                    .font(.title2.bold())
                Text(hop.summary)
                    .font(.subheadline)
                    .opacity(0.85)
            }
            .foregroundStyle(.white)
            .padding(18)
        }
        .frame(height: 236)
        .clipShape(.rect(cornerRadius: 28))
        .contentShape(.rect(cornerRadius: 28))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows this event’s clips")
    }

    private func badge(_ title: LocalizedStringKey, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .glassEffect(.regular.tint(color.color.opacity(0.55)), in: .capsule)
    }
}

/// Up to three thumbnails tiled as a cover, or Bobble when there are none.
struct Mosaic: View {
    let clips: [Clip]
    let color: PaletteColor

    var body: some View {
        GeometryReader { geometry in
            let gap: CGFloat = 2
            switch clips.count {
            case 0:
                ZStack {
                    LinearGradient(
                        colors: [color.color.opacity(0.55), color.color.opacity(0.15)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                    color.bobble
                        .resizable()
                        .scaledToFit()
                        .frame(height: geometry.size.height * 0.55)
                        .offset(y: -geometry.size.height * 0.08)
                }
            case 1:
                ThumbnailView(clip: clips[0])
            case 2:
                HStack(spacing: gap) {
                    ThumbnailView(clip: clips[0])
                    ThumbnailView(clip: clips[1])
                }
            default:
                HStack(spacing: gap) {
                    ThumbnailView(clip: clips[0])
                        .frame(width: geometry.size.width * 0.62)
                    VStack(spacing: gap) {
                        ThumbnailView(clip: clips[1])
                        ThumbnailView(clip: clips[2])
                    }
                }
            }
        }
    }
}

/// Nothing has arrived yet: a nudge to share the link.
private struct EmptyInbox: View {
    let color: PaletteColor
    let link: URL?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                color.bobble
                    .resizable()
                    .scaledToFit()
                    .frame(width: 140, height: 140)
                    .accessibilityHidden(true)
                Text("No clips yet")
                    .font(.title2.bold())
                Text("Share your Hop link at your next event. Clips people send you land here, sorted by event.")
                    .font(.body)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                if let link {
                    ShareLink(item: link) {
                        Label("Share my link", systemImage: "square.and.arrow.up")
                            .font(.headline)
                            .foregroundStyle(color.onColor)
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .tint(color.color)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 32)
            .padding(.top, 80)
            .frame(maxWidth: .infinity)
        }
    }
}
