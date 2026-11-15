import Foundation
import Testing
@testable import Hop

private func hopJSON(_ id: String, title: String, createdAt: Int, files: Int, bytes: Int = 1_000_000) -> String {
    #"{"id":"\#(id)","slug":"\#(id)","title":"\#(title)","status":"open","createdAt":\#(createdAt),"fileCount":\#(files),"totalBytes":\#(bytes)}"#
}

private func clipJSON(_ id: String, hop: String, size: Int = 1000) -> String {
    #"{"id":"\#(id)","hopId":"\#(hop)","name":"IMG_1.MOV","mime":"video/mp4","size":\#(size),"hasThumbnail":true,"contributorName":"@mia","contributorVerified":true,"note":null,"createdAt":1700000000000}"#
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
