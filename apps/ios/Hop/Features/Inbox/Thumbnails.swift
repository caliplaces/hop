import SwiftUI
import UIKit

/// Clip thumbnails. They need the session to load, so they can't use
/// AsyncImage; they're kept in memory only, and dropped on sign-out.
final class Thumbnails {
    static let shared = Thumbnails()

    typealias Loader = @Sendable (Clip, APIClient) async -> UIImage?

    private let load: Loader

    init(load: @escaping Loader = Thumbnails.fetch) {
        self.load = load
    }

    nonisolated static func fetch(_ clip: Clip, api: APIClient) async -> UIImage? {
        guard let data = try? await api.data("api/me/files/\(clip.id)/thumbnail") else { return nil }
        return UIImage(data: data)
    }

    private let cache = NSCache<NSString, UIImage>()
    private var loading: [String: Task<UIImage?, Never>] = [:]
    /// Bumped by `removeAll()`, so a load that finishes afterwards is dropped.
    private var generation = 0

    func cached(_ clip: Clip) -> UIImage? {
        cache.object(forKey: clip.id as NSString)
    }

    func image(for clip: Clip, api: APIClient) async -> UIImage? {
        guard clip.hasThumbnail else { return nil }
        if let image = cached(clip) { return image }
        let started = generation
        let task = loading[clip.id] ?? Task<UIImage?, Never> { [load] in await load(clip, api) }
        loading[clip.id] = task
        let image = await task.value
        // Signed out while it loaded: it belongs to someone who's gone.
        guard generation == started else { return nil }
        loading[clip.id] = nil
        if let image { cache.setObject(image, forKey: clip.id as NSString) }
        return image
    }

    func removeAll() {
        generation += 1
        cache.removeAllObjects()
        loading.values.forEach { $0.cancel() }
        loading = [:]
    }
}

/// A clip's thumbnail, filling its frame, with a quiet placeholder until it
/// loads or when there isn't one.
struct ThumbnailView: View {
    let clip: Clip

    @Environment(Session.self) private var session
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(Theme.surface)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                } else {
                    Image(systemName: clip.isVideo ? "film" : "photo")
                        .font(.title2)
                        .foregroundStyle(Theme.muted.opacity(0.6))
                }
            }
            .clipped()
            .task(id: clip.id) {
                image = Thumbnails.shared.cached(clip)
                guard image == nil else { return }
                let loaded = await Thumbnails.shared.image(for: clip, api: session.api)
                withAnimation(.smooth(duration: 0.25)) { image = loaded }
            }
            .accessibilityHidden(true)
    }
}
