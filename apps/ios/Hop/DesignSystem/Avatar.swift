import SwiftUI
import UIKit

/// Someone in the app: their photo, or their initial on their colour.
struct Avatar: View {
    enum Photo: Equatable {
        case none
        /// A saved photo, loaded from the site.
        case remote(URL)
        /// A photo picked but not saved yet.
        case local(UIImage)
    }

    let photo: Photo
    let initial: String
    let color: PaletteColor
    var size: CGFloat = 32

    @State private var loaded: (url: URL, image: UIImage)?

    init(me: Me?, size: CGFloat = 32) {
        photo = me?.avatarURL.map(Photo.remote) ?? .none
        initial = me?.initial ?? "?"
        color = me?.paletteColor ?? Palette.brand
        self.size = size
    }

    init(photo: Photo, initial: String, color: PaletteColor, size: CGFloat) {
        self.photo = photo
        self.initial = initial
        self.color = color
        self.size = size
    }

    private var image: UIImage? {
        switch photo {
        case .none: nil
        case let .local(image): image
        case let .remote(url): AvatarImages.shared.cached(url) ?? (loaded?.url == url ? loaded?.image : nil)
        }
    }

    var body: some View {
        Circle()
            .fill(color.color.gradient)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                } else {
                    Text(initial)
                        .font(.system(size: size * 0.44, weight: .bold, design: .rounded))
                        .foregroundStyle(color.onColor)
                        .transition(.opacity)
                }
            }
            .clipShape(.circle)
            .frame(width: size, height: size)
            .animation(.smooth(duration: 0.2), value: image)
            .accessibilityHidden(true)
            .task(id: photo) {
                guard case let .remote(url) = photo, AvatarImages.shared.cached(url) == nil else { return }
                if let image = await AvatarImages.shared.image(for: url) {
                    loaded = (url, image)
                }
            }
    }
}

/// Profile photos. They're public, but still kept apart: in memory and in a
/// small disk cache of their own, both emptied on sign-out. Each photo has
/// its own address for good (a new photo gets a new one), so a cached copy is
/// never out of date.
final class AvatarImages {
    static let shared = AvatarImages()

    private let memory = NSCache<NSURL, UIImage>()
    private let disk: URLCache
    private let session: URLSession
    private var loading: [URL: Task<UIImage?, Never>] = [:]
    /// Bumped by `removeAll()`, so a load that finishes afterwards is dropped.
    private var generation = 0

    init() {
        let directory = URL.cachesDirectory.appending(path: "Avatars", directoryHint: .isDirectory)
        disk = URLCache(memoryCapacity: 0, diskCapacity: 20 * 1024 * 1024, directory: directory)
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = disk
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration)
    }

    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(for url: URL) async -> UIImage? {
        if let image = cached(url) { return image }
        let started = generation
        let task = loading[url] ?? Task<UIImage?, Never> { [session] in
            await Self.fetch(url, session: session)
        }
        loading[url] = task
        let image = await task.value
        guard generation == started else { return nil }
        loading[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }

    func removeAll() {
        generation += 1
        memory.removeAllObjects()
        disk.removeAllCachedResponses()
        loading.values.forEach { $0.cancel() }
        loading = [:]
    }

    nonisolated private static func fetch(_ url: URL, session: URLSession) async -> UIImage? {
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return await UIImage(data: data)?.byPreparingForDisplay()
    }
}

#Preview {
    HStack {
        Avatar(me: nil)
        Avatar(me: nil, size: 56)
    }
}
