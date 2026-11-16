import SwiftUI

/// One event's clips as a grid of tall tiles, newest first, loading more as
/// they scroll.
struct HopView: View {
    let hopId: String
    let model: InboxModel

    @Environment(Session.self) private var session
    @State private var viewing: Selection?
    /// The clip the viewer shows: it zooms open from its tile, and back into
    /// the tile of whichever clip it's on when it closes.
    @State private var showing: String?
    @Namespace private var zoom

    private struct Selection: Identifiable {
        let id: String
    }

    private var hop: Hop? { model.hops.first { $0.id == hopId } }
    private var list: InboxModel.ClipList { model.clips[hopId] ?? InboxModel.ClipList() }

    var body: some View {
        ScrollViewReader { scroller in
            grid
                // Keeps the tile of the clip showing on screen, so closing the
                // viewer zooms back into it: when the viewer moves on, and when
                // its tile comes back after a refresh dropped its page.
                .onChange(of: ReturnTile(id: showing, isLoaded: showingIsLoaded)) { _, tile in
                    guard let id = tile.id, tile.isLoaded, viewing != nil else { return }
                    scroller.scrollTo(id, anchor: .center)
                }
        }
        .navigationTitle(hop?.title ?? "")
        .navigationSubtitle(hop?.summary ?? "")
        .background(Theme.canvas)
        .refreshable {
            await model.refresh(api: session.api, activeHopId: session.me?.activeHopId)
        }
        .task { if !list.loadedOnce { await loadMore() } }
        .fullScreenCover(item: $viewing) { selection in
            ClipViewer(hopId: hopId, startAt: selection.id, model: model, showing: $showing)
                .navigationTransition(.zoom(sourceID: showing ?? selection.id, in: zoom))
        }
    }

    private var showingIsLoaded: Bool {
        guard let showing else { return false }
        return list.items.contains { $0.id == showing }
    }

    /// Where closing the viewer zooms back to, and whether its tile is there.
    private struct ReturnTile: Equatable {
        let id: String?
        let isLoaded: Bool
    }

    private var grid: some View {
        ScrollView {
            if list.loadedOnce, list.items.isEmpty {
                ContentUnavailableView(
                    "No clips here yet",
                    systemImage: "film.stack",
                    description: Text("Clips sent to this event will show up here.")
                )
                .padding(.top, 60)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 3)], spacing: 3) {
                ForEach(list.items) { clip in
                    Button {
                        showing = clip.id
                        viewing = Selection(id: clip.id)
                    } label: {
                        ClipTile(clip: clip)
                            .matchedTransitionSource(id: clip.id, in: zoom) { source in
                                source.clipShape(.rect(cornerRadius: 10))
                            }
                    }
                    .buttonStyle(.plain)
                    .id(clip.id)
                    .onAppear {
                        if clip.id == list.items.last?.id { Task { await loadMore() } }
                    }
                }
            }
            .padding(.horizontal, 3)
            if list.isLoading {
                ProgressView().padding(24)
            } else if let failed = list.failed {
                VStack(spacing: 8) {
                    Text(failed).font(.footnote).foregroundStyle(Theme.muted)
                    Button("Try Again") { Task { await loadMore() } }
                        .buttonStyle(.glass)
                }
                .padding(24)
            }
        }
    }

    private func loadMore() async {
        await model.loadMore(in: hopId, api: session.api)
    }
}

/// A clip in the grid: its thumbnail, who sent it, and whether it's a video.
struct ClipTile: View {
    let clip: Clip

    var body: some View {
        Color.clear
            .aspectRatio(9 / 16, contentMode: .fit)
            .overlay { ThumbnailView(clip: clip) }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 56)
            }
            .overlay(alignment: .bottomLeading) {
                ContributorLabel(clip: clip)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(7)
            }
            .overlay(alignment: .topTrailing) {
                if clip.isVideo {
                    Image(systemName: "play.fill")
                        .font(.caption2)
                        .foregroundStyle(.white)
                        .shadow(radius: 3)
                        .padding(7)
                }
            }
            .clipShape(.rect(cornerRadius: 10))
            .contentShape(.rect(cornerRadius: 10))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(clip.isVideo ? "Video from \(clip.contributor)" : "Photo from \(clip.contributor)"))
            .accessibilityValue(Text(clip.sentAt, format: .relative(presentation: .named)))
    }
}

/// Who sent a clip, with a seal when they were signed in.
struct ContributorLabel: View {
    let clip: Clip

    var body: some View {
        HStack(spacing: 3) {
            if clip.contributorVerified {
                Image(systemName: "checkmark.seal.fill")
                    .accessibilityLabel("Signed in")
            }
            Text(verbatim: clip.contributor)
                .lineLimit(1)
        }
    }
}
