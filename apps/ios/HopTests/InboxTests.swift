import Foundation
import Testing
import UIKit
@testable import Hop

private func hopJSON(_ id: String, title: String, createdAt: Int, files: Int, bytes: Int = 1_000_000) -> String {
    #"{"id":"\#(id)","slug":"\#(id)","title":"\#(title)","status":"open","createdAt":\#(createdAt),"fileCount":\#(files),"totalBytes":\#(bytes)}"#
}

private func clipJSON(_ id: String, hop: String, size: Int = 1000, createdAt: Int = 1_700_000_000_000) -> String {
    #"{"id":"\#(id)","hopId":"\#(hop)","name":"IMG_1.MOV","mime":"video/mp4","size":\#(size),"hasThumbnail":true,"contributorName":"@mia","contributorVerified":true,"note":null,"createdAt":\#(createdAt)}"#
}

private func clip(_ id: String, at createdAt: Int) throws -> Clip {
    try JSONDecoder().decode(Clip.self, from: Data(clipJSON(id, hop: "jam", createdAt: createdAt).utf8))
}

@MainActor
@Suite("Inbox", .serialized)
struct InboxModelTests {
    let server = StubServer(host: "inbox.test")

    @Test func putsTheLiveEventFirstThenNewest() async {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops":
                (200, #"{"hops":[\#(hopJSON("old", title: "Old", createdAt: 1, files: 0)),\#(hopJSON("new", title: "New", createdAt: 3, files: 0)),\#(hopJSON("live", title: "Live", createdAt: 2, files: 0))]}"#)
            default: (404, "{}")
            }
        }
        let model = InboxModel()
        await model.refresh(api: server.client(token: "hs_t"), activeHopId: "live")
        #expect(model.hops.map(\.id) == ["live", "new", "old"])
        #expect(model.phase == .loaded)
    }

    @Test func loadsFirstPagesAndThenMore() async throws {
        server.reply = { request in
            let url = request.url!
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let cursor = query.first { $0.name == "cursor" }?.value
            switch url.path {
            case "/api/me/hops":
                return (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 3))]}"#)
            case "/api/me/files" where cursor == nil:
                return (200, #"{"files":[\#(clipJSON("a", hop: "jam")),\#(clipJSON("b", hop: "jam"))],"nextCursor":"2:b"}"#)
            case "/api/me/files" where cursor == "2:b":
                // Overlaps the first page, as when a clip arrives meanwhile.
                return (200, #"{"files":[\#(clipJSON("b", hop: "jam")),\#(clipJSON("c", hop: "jam"))],"nextCursor":null}"#)
            default:
                return (404, "{}")
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        #expect(model.clips["jam"]?.items.map(\.id) == ["a", "b"])
        #expect(model.clips["jam"]?.hasMore == true)

        await model.loadMore(in: "jam", api: api)
        #expect(model.clips["jam"]?.items.map(\.id) == ["a", "b", "c"])
        #expect(model.clips["jam"]?.hasMore == false)

        let files = server.requests.filter { $0.request.url?.path == "/api/me/files" }
        #expect(files.allSatisfy { $0.request.url?.query()?.contains("hopId=jam") == true })
        #expect(files.allSatisfy { $0.request.value(forHTTPHeaderField: "Authorization") == "Bearer hs_t" })

        // Nothing more to load: no further request.
        await model.loadMore(in: "jam", api: api)
        #expect(server.requests.filter { $0.request.url?.path == "/api/me/files" }.count == files.count)
    }

    @Test func deletingAClipUpdatesTheEventsTotals() async throws {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case (_, "/api/me/hops"):
                (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 2, bytes: 3000))]}"#)
            case (_, "/api/me/files"):
                (200, #"{"files":[\#(clipJSON("a", hop: "jam", size: 1000)),\#(clipJSON("b", hop: "jam", size: 2000))],"nextCursor":null}"#)
            case ("DELETE", "/api/me/files/a"):
                (200, #"{"ok":true}"#)
            default:
                (404, "{}")
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        let clip = try #require(model.clips["jam"]?.items.first)
        try await model.delete(clip, api: api)
        #expect(model.clips["jam"]?.items.map(\.id) == ["b"])
        #expect(model.hops.first?.fileCount == 1)
        #expect(model.hops.first?.totalBytes == 2000)
    }

    @Test func aFailedDeleteKeepsTheClip() async throws {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case (_, "/api/me/hops"):
                (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 1))]}"#)
            case (_, "/api/me/files"):
                (200, #"{"files":[\#(clipJSON("a", hop: "jam"))],"nextCursor":null}"#)
            default:
                (500, #"{"error":"internal_error"}"#)
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        let clip = try #require(model.clips["jam"]?.items.first)
        await #expect(throws: APIError.self) { try await model.delete(clip, api: api) }
        #expect(model.clips["jam"]?.items.count == 1)
        #expect(model.hops.first?.fileCount == 1)
    }

    @Test func resolvesRelativeAndAbsoluteClipURLs() async throws {
        server.reply = { request in
            request.url?.query()?.contains("download=1") == true
                ? (200, #"{"url":"https://bucket.example/clip?X-Amz-Signature=abc"}"#)
                : (200, #"{"url":"/api/dev/object?token=t"}"#)
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        let clip = try JSONDecoder().decode(Clip.self, from: Data(clipJSON("a", hop: "jam").utf8))
        let stream = try await model.url(for: clip, download: false, api: api)
        #expect(stream.absoluteString == "https://inbox.test/api/dev/object?token=t")
        let download = try await model.url(for: clip, download: true, api: api)
        #expect(download.host() == "bucket.example")
    }

    @Test func aRefreshDropsAPageRequestedBeforeIt() async throws {
        server.reply = { request in
            let query = request.url?.query() ?? ""
            switch request.url?.path {
            case "/api/me/hops":
                return (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 6))]}"#)
            case "/api/me/files" where query.contains("cursor=2"):
                return (200, #"{"files":[\#(clipJSON("c", hop: "jam")),\#(clipJSON("d", hop: "jam"))],"nextCursor":"4:d"}"#)
            case "/api/me/files" where query.contains("cursor=4"):
                return (200, #"{"files":[\#(clipJSON("e", hop: "jam")),\#(clipJSON("f", hop: "jam"))],"nextCursor":null}"#)
            default:
                return (200, #"{"files":[\#(clipJSON("a", hop: "jam")),\#(clipJSON("b", hop: "jam"))],"nextCursor":"2:b"}"#)
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        await model.loadMore(in: "jam", api: api)
        #expect(model.clips["jam"]?.items.map(\.id) == ["a", "b", "c", "d"])

        // Page three is on its way when they pull to refresh, and the
        // refreshed first page lands first.
        server.held = ["/api/me/files"]
        let pageThree = Task { await model.loadMore(in: "jam", api: api) }
        try await server.waitForRequests { $0.url?.query()?.contains("cursor=4") == true }
        let refreshing = Task { await model.refresh(api: api, activeHopId: nil) }
        let firstPages = { (request: URLRequest) in
            request.url?.path == "/api/me/files" && request.url?.query()?.contains("cursor") != true
        }
        try await server.waitForRequests(count: 2, where: firstPages)
        server.release(where: firstPages)
        await refreshing.value
        server.release()
        await pageThree.value

        // Page three must not land after the new first page, skipping c and d.
        #expect(model.clips["jam"]?.items.map(\.id) == ["a", "b"])
        #expect(model.clips["jam"]?.nextCursor == "2:b")
    }

    @Test func theViewerKeepsTheClipShowingWhenARefreshDropsIt() async throws {
        let arrived = Locked(false)
        server.reply = { request in
            let query = request.url?.query() ?? ""
            switch request.url?.path {
            case "/api/me/hops":
                return (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 4))]}"#)
            case "/api/me/files" where query.contains("cursor="):
                return (200, #"{"files":[\#(clipJSON("c", hop: "jam", createdAt: 3)),\#(clipJSON("d", hop: "jam", createdAt: 2))],"nextCursor":null}"#)
            default:
                return arrived.value
                    ? (200, #"{"files":[\#(clipJSON("n", hop: "jam", createdAt: 9)),\#(clipJSON("a", hop: "jam", createdAt: 5))],"nextCursor":"5:a"}"#)
                    : (200, #"{"files":[\#(clipJSON("a", hop: "jam", createdAt: 5)),\#(clipJSON("b", hop: "jam", createdAt: 4))],"nextCursor":"4:b"}"#)
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        await model.loadMore(in: "jam", api: api)
        let watched = try #require(model.clips["jam"]?.items.first { $0.id == "d" })

        // A clip lands during Event mode: the refresh brings a new first page
        // and drops the later ones, so it's fresh and nothing is missed...
        arrived.value = true
        await model.refresh(api: api, activeHopId: nil)
        let items = model.clips["jam"]?.items ?? []
        #expect(items.map(\.id) == ["n", "a"])

        // ...while the viewer keeps "d", the clip being watched, in its place,
        #expect(InboxModel.clips(items, keeping: watched).map(\.id) == ["n", "a", "d"])
        #expect(model.clips["jam"]?.refreshes == 2)

        // ...and loads the pages up to it again, so swiping on still works.
        await model.load(upTo: watched, in: "jam", api: api)
        #expect(model.clips["jam"]?.items.map(\.id) == ["n", "a", "c", "d"])

        // A clip that's gone for good: it pages to the end, then stops.
        let gone = try clip("zz", at: 0)
        let requests = server.requests.count
        await model.load(upTo: gone, in: "jam", api: api)
        #expect(server.requests.count == requests)
        #expect(model.clips["jam"]?.hasMore == false)
    }

    @Test func catchingUpStopsWhenARefreshStartsOverAndCancellingIsntAFailure() async throws {
        let firstPage = Locked(#"{"files":[\#(clipJSON("a", hop: "jam", createdAt: 5)),\#(clipJSON("b", hop: "jam", createdAt: 4))],"nextCursor":"4:b"}"#)
        server.reply = { request in
            let query = request.url?.query() ?? ""
            switch request.url?.path {
            case "/api/me/hops":
                return (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 6))]}"#)
            case "/api/me/files" where query.contains("cursor="):
                return (200, #"{"files":[\#(clipJSON("c", hop: "jam", createdAt: 3))],"nextCursor":"3:c"}"#)
            default:
                return (200, firstPage.value)
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        let watched = try clip("z", at: 1)
        let pages = { (request: URLRequest) in request.url?.query()?.contains("cursor=") == true }

        // Catching up towards "z", a page is on its way when a refresh starts over.
        server.held = ["/api/me/files"]
        let catchingUp = Task { await model.load(upTo: watched, in: "jam", api: api) }
        try await server.waitForRequests(where: pages)
        server.held = []
        // A clip landed: the new first page pages on from somewhere else.
        firstPage.value = #"{"files":[\#(clipJSON("n", hop: "jam", createdAt: 9)),\#(clipJSON("a", hop: "jam", createdAt: 5))],"nextCursor":"5:a"}"#
        await model.refresh(api: api, activeHopId: nil)
        server.release()
        await catchingUp.value
        // Its late page is dropped, and it asks for no more for the new list.
        #expect(server.requests.filter { pages($0.request) }.count == 1)
        #expect(model.clips["jam"]?.items.map(\.id) == ["n", "a"])

        // A load cancelled because its view went away isn't a failure.
        server.held = ["/api/me/files"]
        let leaving = Task { await model.load(upTo: watched, in: "jam", api: api) }
        try await server.waitForRequests(count: 2, where: pages)
        leaving.cancel()
        await leaving.value
        server.release()
        #expect(model.clips["jam"]?.failed == nil)
        #expect(model.clips["jam"]?.isLoading == false)
    }

    @Test func loadsTheNextPageOnceTheClipShowingIsAmongTheLast() async throws {
        let ids = ["a", "b", "c", "d", "e"]
        let page = ids.enumerated().map { clipJSON($1, hop: "jam", createdAt: 10 - $0) }.joined(separator: ",")
        server.reply = { request in
            let query = request.url?.query() ?? ""
            switch request.url?.path {
            case "/api/me/hops":
                return (200, #"{"hops":[\#(hopJSON("jam", title: "Jam", createdAt: 1, files: 6))]}"#)
            case "/api/me/files" where query.contains("cursor="):
                return (200, #"{"files":[\#(clipJSON("f", hop: "jam", createdAt: 1))],"nextCursor":null}"#)
            default:
                return (200, #"{"files":[\#(page)],"nextCursor":"6:e"}"#)
            }
        }
        let model = InboxModel()
        let api = server.client(token: "hs_t")
        await model.refresh(api: api, activeHopId: nil)
        let pages = { (request: URLRequest) in request.url?.query()?.contains("cursor=") == true }

        // Well before the end: nothing to load yet.
        await model.loadMore(in: "jam", near: try clip("a", at: 10), api: api)
        #expect(!server.requests.contains { pages($0.request) })

        // Among the last few, as when recovery lands on the last loaded clip.
        await model.loadMore(in: "jam", near: try clip("e", at: 6), api: api)
        #expect(model.clips["jam"]?.items.map(\.id) == ["a", "b", "c", "d", "e", "f"])
    }

    @Test func keepsTheClipShowingInTheAPIsOrder() throws {
        let items = try [clip("a", at: 6), clip("b", at: 5), clip("c", at: 3)]
        #expect(InboxModel.clips(items, keeping: nil).map(\.id) == ["a", "b", "c"])
        #expect(InboxModel.clips(items, keeping: try clip("b", at: 5)).map(\.id) == ["a", "b", "c"])
        #expect(InboxModel.clips(items, keeping: try clip("x", at: 9)).map(\.id) == ["x", "a", "b", "c"])
        #expect(InboxModel.clips(items, keeping: try clip("m", at: 4)).map(\.id) == ["a", "b", "m", "c"])
        #expect(InboxModel.clips(items, keeping: try clip("z", at: 1)).map(\.id) == ["a", "b", "c", "z"])
        // Same time: by id, as the API breaks ties.
        #expect(InboxModel.clips(items, keeping: try clip("bb", at: 5)).map(\.id) == ["a", "bb", "b", "c"])
    }

    @Test func showsAFailureOnlyWhenThereIsNothingToShow() async {
        server.reply = { _ in (500, #"{"error":"internal_error"}"#) }
        let model = InboxModel()
        await model.refresh(api: server.client(), activeHopId: nil)
        guard case .failed = model.phase else {
            Issue.record("Expected a failure, got \(model.phase)")
            return
        }
    }
}

@Suite("Inbox formatting")
struct InboxFormattingTests {
    @Test func summarisesAnEvent() throws {
        let hop = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("h", title: "Jam", createdAt: 1, files: 1, bytes: 0).utf8))
        #expect(hop.summary == "1 clip")
        let full = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("h", title: "Jam", createdAt: 1, files: 12, bytes: 1_200_000_000).utf8))
        #expect(full.summary.hasPrefix("12 clips · "))
    }

    @Test(arguments: [
        ("IMG_4801.MOV", "IMG_4801.MOV"),
        ("../../etc/passwd", "clip..-..-etc-passwd"),
        ("a/b\\c:d", "a-b-c-d"),
        ("", "clip"),
        (".hidden", "clip.hidden"),
    ])
    func keepsDownloadNamesInsideTheirFolder(name: String, expected: String) {
        let safe = ClipTransfer.safeFilename(name)
        #expect(safe == expected)
        #expect(!safe.contains("/"))
        #expect(!safe.hasPrefix("."))
    }
}

/// A 1×1 PNG, so the thumbnail decodes.
private let pixelPNG = "base64:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

@MainActor
@Suite("Thumbnails", .serialized)
struct ThumbnailTests {
    let server = StubServer(host: "thumbs.test")

    private func clip(_ id: String) throws -> Clip {
        try JSONDecoder().decode(Clip.self, from: Data(clipJSON(id, hop: "jam").utf8))
    }

    @Test func cachesAfterTheFirstLoad() async throws {
        server.reply = { _ in (200, pixelPNG) }
        let thumbnails = Thumbnails()
        let api = server.client(token: "hs_t")
        let a = try clip("a")
        #expect(await thumbnails.image(for: a, api: api) != nil)
        #expect(await thumbnails.image(for: a, api: api) != nil)
        #expect(server.requests.count == 1)
    }

    /// The load finishes, but whoever was waiting hasn't resumed yet when
    /// they sign out. Cancelling can't help then; the image must still be dropped.
    @Test func aLoadFinishingAfterSignOutIsDropped() async throws {
        let gate = Gate()
        let thumbnails = Thumbnails { _, _ in await gate.wait() }
        let a = try clip("a")
        let loading = Task { await thumbnails.image(for: a, api: server.client()) }
        try await gate.waitUntilWaiting()
        thumbnails.removeAll()
        gate.open(with: UIImage(systemName: "star"))
        #expect(await loading.value == nil)
        #expect(thumbnails.cached(a) == nil)
    }
}

/// Holds a load until the test lets it finish; ignores cancellation, as a
/// load that has already finished would.
private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<UIImage?, Never>?

    func wait() async -> UIImage? {
        await withCheckedContinuation { continuation in
            lock.withLock { self.continuation = continuation }
        }
    }

    func waitUntilWaiting() async throws {
        for _ in 0..<400 {
            if lock.withLock({ continuation != nil }) { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw URLError(.timedOut)
    }

    func open(with image: UIImage?) {
        lock.withLock { continuation }?.resume(returning: image)
    }
}

@MainActor
@Suite("Clip transfers", .serialized)
struct ClipTransferTests {
    let server = StubServer(host: "files.test")
    let folder = FileManager.default.temporaryDirectory.appending(path: "transfer-tests-\(UUID().uuidString)")

    private func clip() throws -> Clip {
        try JSONDecoder().decode(Clip.self, from: Data(clipJSON("a", hop: "jam").utf8))
    }

    private func leftovers() -> [String] {
        let folders = (try? FileManager.default.contentsOfDirectory(atPath: folder.path())) ?? []
        return folders.flatMap { name in
            (try? FileManager.default.contentsOfDirectory(atPath: folder.appending(path: name).path())) ?? []
        }
    }

    @Test func downloadsAFileToShareUnderItsOwnName() async throws {
        server.reply = { _ in (200, "video bytes") }
        let transfer = ClipTransfer(folder: folder, configuration: server.configuration())
        let file = try #require(await transfer.fileToShare(try clip(), from: server.baseURL.appending(path: "clip")))
        #expect(file.lastPathComponent == "IMG_1.MOV")
        #expect(try String(contentsOf: file, encoding: .utf8) == "video bytes")
        #expect(transfer.clipId == "a")
        #expect(transfer.state == .idle)
    }

    @Test func aFailedDownloadLeavesNothingBehind() async throws {
        server.reply = { _ in (500, "{}") }
        let transfer = ClipTransfer(folder: folder, configuration: server.configuration())
        #expect(await transfer.fileToShare(try clip(), from: server.baseURL.appending(path: "clip")) == nil)
        guard case .failed = transfer.state else {
            Issue.record("Expected a failure, got \(transfer.state)")
            return
        }
        #expect(leftovers().isEmpty)
    }
}
