import SwiftUI

/// One event's clips as a grid of tall tiles, newest first, loading more as
/// they scroll.
struct HopView: View {
    let hopId: String
    let model: InboxModel

    @Environment(Session.self) private var session
    @State private var viewing: Selection?

    private struct Selection: Identifiable {
        let id: String
    }

    private var hop: Hop? { model.hops.first { $0.id == hopId } }
    private var list: InboxModel.ClipList { model.clips[hopId] ?? InboxModel.ClipList() }

    var body: some View {
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
                        viewing = Selection(id: clip.id)
                    } label: {
                        ClipTile(clip: clip)
                    }
                    .buttonStyle(.plain)
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
        .navigationTitle(hop?.title ?? "")
        .navigationSubtitle(hop?.summary ?? "")
        .background(Theme.canvas)
        .refreshable {
            await model.refresh(api: session.api, activeHopId: session.me?.activeHopId)
        }
        .task { if !list.loadedOnce { await loadMore() } }
        .fullScreenCover(item: $viewing) { selection in
            ClipViewer(hopId: hopId, startAt: selection.id, model: model)
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
