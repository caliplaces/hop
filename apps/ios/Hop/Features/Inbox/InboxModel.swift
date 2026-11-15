import Foundation
import Observation

/// The athlete's events and the clips in each, loaded a page at a time.
@Observable
final class InboxModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    /// The clips loaded so far for one event.
    struct ClipList: Equatable {
        var items: [Clip] = []
        var nextCursor: String?
        var loadedOnce = false
        var isLoading = false
        var failed: String?

        var hasMore: Bool { !loadedOnce || nextCursor != nil }
    }

    private(set) var hops: [Hop] = []
    private(set) var phase = Phase.loading
    private(set) var clips: [String: ClipList] = [:]

    /// Bumped each time an event's list starts over, so a page that was
    /// requested before can't be appended to the new list.
    private var generations: [String: Int] = [:]

    /// Reloads the events, then the first page of every event already shown.
    func refresh(api: APIClient, activeHopId: String?) async {
        if hops.isEmpty { phase = .loading }
        do {
            struct Reply: Decodable { let hops: [Hop] }
            let reply: Reply = try await api.get("api/me/hops")
            // The event the link uploads to comes first, then newest first.
            hops = reply.hops.sorted { a, b in
                if (a.id == activeHopId) != (b.id == activeHopId) { return a.id == activeHopId }
                return a.createdAt > b.createdAt
            }
            phase = .loaded
            clips = clips.filter { id, _ in hops.contains { $0.id == id } }
            await withTaskGroup(of: Void.self) { group in
                for hop in hops where clips[hop.id]?.loadedOnce == true || hop.fileCount > 0 {
                    group.addTask { await self.loadFirstPage(of: hop.id, api: api) }
                }
            }
        } catch {
            if hops.isEmpty { phase = .failed(error.localizedDescription) }
        }
    }

    /// The next page of an event's clips, if there is one.
    func loadMore(in hopId: String, api: APIClient) async {
        let list = clips[hopId] ?? ClipList()
        guard list.hasMore, !list.isLoading else { return }
        await load(hopId, cursor: list.nextCursor, replacing: false, api: api)
    }

    private func loadFirstPage(of hopId: String, api: APIClient) async {
        await load(hopId, cursor: nil, replacing: true, api: api)
    }

    private func load(_ hopId: String, cursor: String?, replacing: Bool, api: APIClient) async {
        if replacing { generations[hopId, default: 0] += 1 }
        let generation = generations[hopId, default: 0]
        clips[hopId, default: ClipList()].isLoading = true
        var query = [URLQueryItem(name: "hopId", value: hopId)]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        do {
            let page: ClipPage = try await api.get("api/me/files", query: query)
            guard generations[hopId, default: 0] == generation else { return }
            var list = clips[hopId] ?? ClipList()
            let known = replacing ? [] : list.items
            // A page can overlap the last if clips arrived meanwhile.
            list.items = known + page.files.filter { clip in !known.contains { $0.id == clip.id } }
            list.nextCursor = page.nextCursor
            list.loadedOnce = true
            list.failed = nil
            list.isLoading = false
            clips[hopId] = list
        } catch {
            guard generations[hopId, default: 0] == generation else { return }
            clips[hopId, default: ClipList()].isLoading = false
            clips[hopId, default: ClipList()].failed = error.localizedDescription
        }
    }

    /// Deletes a clip for good, and updates its event's totals.
    func delete(_ clip: Clip, api: APIClient) async throws {
        try await api.delete("api/me/files/\(clip.id)")
        clips[clip.hopId]?.items.removeAll { $0.id == clip.id }
        if let index = hops.firstIndex(where: { $0.id == clip.hopId }) {
            hops[index].fileCount = max(hops[index].fileCount - 1, 0)
            hops[index].totalBytes = max(hops[index].totalBytes - clip.size, 0)
        }
    }

    /// A short-lived link to stream the clip, or to download it.
    func url(for clip: Clip, download: Bool, api: APIClient) async throws -> URL {
        struct Reply: Decodable { let url: String }
        let query = download ? [URLQueryItem(name: "download", value: "1")] : []
        let reply: Reply = try await api.get("api/me/files/\(clip.id)/url", query: query)
        guard let url = api.resolve(reply.url) else { throw URLError(.badURL) }
        return url
    }
}
