import Foundation
import Testing
@testable import Hop

private func clip(_ id: String = "fil_1") throws -> Clip {
    try JSONDecoder().decode(Clip.self, from: Data("""
        {"id":"\(id)","hopId":"hop_1","name":"IMG.MOV","mime":"video/quicktime","size":10,
         "hasThumbnail":false,"contributorName":"Troll","contributorVerified":false,
         "note":null,"createdAt":1}
        """.utf8))
}

@MainActor
@Suite("Reports and blocks", .serialized)
struct ModerationTests {
    let server = StubServer(host: "moderation-\(UUID().uuidString.lowercased()).test")

    private func body(_ index: Int) throws -> [String: AnyHashable] {
        let data = server.requests[index].body
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: AnyHashable])
    }

    @Test func reportsAClipWithItsReasonAndNote() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        try await Moderation.report(clip(), reason: .harassment, note: "  Keeps sending this \n", api: server.client(token: "hs_test"))
        let request = try #require(server.requests.first?.request)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/me/files/fil_1/report")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer hs_test")
        #expect(try body(0) == ["reason": "harassment", "note": "Keeps sending this"])
    }

    @Test func leavesOutAnEmptyNoteAndShortensALongOne() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        try await Moderation.report(clip(), reason: .spam, note: "   ", api: server.client())
        #expect(try body(0) == ["reason": "spam"])

        try await Moderation.report(clip(), reason: .other, note: String(repeating: "😀", count: 300), api: server.client())
        #expect((try body(1)["note"] as? String)?.utf16.count == Moderation.maxNoteLength)
    }

    @Test func limitsNotesAsTheAPICountsThemWithoutSplittingCharacters() throws {
        let ascii = String(repeating: "a", count: 499)
        // 499 letters and an emoji (two UTF-16 units) is 501: the emoji goes whole.
        #expect(Moderation.limited(ascii + "😀") == ascii)
        // 498 and the emoji is exactly 500: kept.
        let fits = String(repeating: "a", count: 498) + "😀"
        #expect(Moderation.limited(fits) == fits)
        // A family emoji is one character of many units: never cut through.
        let family = "👨‍👩‍👧‍👦"
        let limited = Moderation.limited(String(repeating: "a", count: 495) + family)
        #expect(limited == String(repeating: "a", count: 495))
        #expect(Moderation.limited(String(repeating: "😀", count: 300)).utf16.count == 500)
        // Trimmed first, then limited; empty means none.
        #expect(Moderation.noteForAPI("   \n ") == nil)
        #expect(Moderation.noteForAPI("  hi  ") == "hi")
    }

    @Test func passesOnWhyAReportWasRefused() async throws {
        server.reply = { _ in (429, #"{"error":"rate_limited","message":"Too many reports. Try again in a minute."}"#) }
        await #expect {
            try await Moderation.report(clip(), reason: .spam, note: "", api: server.client())
        } throws: { error in
            (error as? APIError)?.message == "Too many reports. Try again in a minute."
        }
    }

    @Test func blocksWhoeverSentAClipAndSaysWhichClipsWent() async throws {
        server.reply = { _ in (200, #"{"ok":true,"removed":2,"removedIds":["fil_9","fil_7"]}"#) }
        let removed = try await Moderation.block(clip("fil_9"), api: server.client(token: "hs_test"))
        #expect(removed == ["fil_9", "fil_7"])
        let request = try #require(server.requests.first?.request)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/me/files/fil_9/block")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func explainsASenderThatCantBeBlocked() async throws {
        server.reply = { _ in (422, #"{"error":"cant_block","message":"This clip's sender can't be blocked. You can report it."}"#) }
        await #expect {
            try await Moderation.block(clip(), api: server.client())
        } throws: { error in
            (error as? APIError)?.code == "cant_block"
        }
    }

    private func serveBlocks(unblock: @escaping @Sendable () -> (Int, String) = { (200, #"{"ok":true}"#) }) {
        server.reply = { request in
            switch request.httpMethod {
            case "GET":
                (200, #"{"blocks":[{"id":"blk_2","label":"Troll","createdAt":2},{"id":"blk_1","label":null,"createdAt":1}]}"#)
            case "DELETE": unblock()
            default: (404, "{}")
            }
        }
    }

    @Test func listsAndUnblocks() async throws {
        serveBlocks()
        let model = BlockedSenders(api: server.client())
        await model.load()
        #expect(model.senders?.map(\.name) == ["Troll", "Someone"])

        let troll = try #require(model.senders?.first)
        await model.unblock(troll)
        #expect(model.senders?.map(\.id) == ["blk_1"])
        let request = try #require(server.requests.last?.request)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path == "/api/me/blocks/blk_2")
    }

    @Test func putsThemBackWhenUnblockingFails() async throws {
        serveBlocks(unblock: { (500, #"{"error":"internal","message":"Something broke."}"#) })
        let model = BlockedSenders(api: server.client())
        await model.load()
        let troll = try #require(model.senders?.first)
        await model.unblock(troll)
        #expect(model.senders?.map(\.id) == ["blk_2", "blk_1"])
        #expect(model.problem == "Something broke.")
    }

    @Test func countsAnAlreadyUnblockedSenderAsUnblocked() async throws {
        serveBlocks(unblock: { (404, #"{"error":"not_found"}"#) })
        let model = BlockedSenders(api: server.client())
        await model.load()
        let troll = try #require(model.senders?.first)
        await model.unblock(troll)
        #expect(model.senders?.map(\.id) == ["blk_1"])
        #expect(model.problem == nil)
    }
}

@MainActor
@Suite("Dropping blocked clips")
struct DropClipsTests {
    let server = StubServer(host: "drop-\(UUID().uuidString.lowercased()).test")

    @Test func takesThemOutOfEveryEventAndItsCounts() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops":
                (200, #"{"hops":[{"id":"hop_1","slug":"a","title":"A","status":"open","createdAt":2,"fileCount":3,"totalBytes":30},{"id":"hop_2","slug":"b","title":"B","status":"open","createdAt":1,"fileCount":1,"totalBytes":10}]}"#)
            case "/api/me/files":
                request.url?.query?.contains("hop_2") == true
                    ? (200, #"{"files":[\#(clipJSON("fil_4", size: 10))],"nextCursor":null}"#)
                    : (200, #"{"files":[\#(clipJSON("fil_1", size: 10)),\#(clipJSON("fil_2", size: 10)),\#(clipJSON("fil_3", size: 10))],"nextCursor":null}"#)
            default: (404, "{}")
            }
        }
        let model = InboxModel()
        await model.refresh(api: server.client(), activeHopId: nil)
        model.drop(["fil_1", "fil_3", "fil_4", "fil_unloaded"])
        #expect(model.clips["hop_1"]?.items.map(\.id) == ["fil_2"])
        #expect(model.clips["hop_2"]?.items.isEmpty == true)
        #expect(model.hops.map(\.fileCount) == [1, 0])
        #expect(model.hops.map(\.totalBytes) == [10, 0])
    }
}

private func clipJSON(_ id: String, size: Int) -> String {
    """
    {"id":"\(id)","hopId":"x","name":"IMG.MOV","mime":"video/quicktime","size":\(size),
     "hasThumbnail":false,"contributorName":"Troll","contributorVerified":false,"note":null,"createdAt":1}
    """
}

@MainActor
@Suite("Dropped clips stay dropped", .serialized)
struct DroppedClipsTests {
    let server = StubServer(host: "dropped-\(UUID().uuidString.lowercased()).test")

    @Test func aPageRequestedBeforeTheBlockDoesntBringThemBack() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops":
                (200, #"{"hops":[{"id":"hop_1","slug":"a","title":"A","status":"open","createdAt":1,"fileCount":2,"totalBytes":20}]}"#)
            case "/api/me/files":
                (200, #"{"files":[\#(droppedClipJSON("fil_1")),\#(droppedClipJSON("fil_2"))],"nextCursor":null}"#)
            default: (404, "{}")
            }
        }
        let model = InboxModel()
        // The page is on its way when the block lands.
        server.held = ["/api/me/files"]
        let refresh = Task { await model.refresh(api: server.client(), activeHopId: nil) }
        try await server.waitForRequest("/api/me/files")
        model.drop(["fil_1"])
        server.release()
        await refresh.value
        #expect(model.clips["hop_1"]?.items.map(\.id) == ["fil_2"])
        #expect(model.clips["hop_1"]?.isLoading == false)
    }
}

private func droppedClipJSON(_ id: String) -> String {
    """
    {"id":"\(id)","hopId":"hop_1","name":"IMG.MOV","mime":"video/quicktime","size":10,
     "hasThumbnail":false,"contributorName":"Troll","contributorVerified":false,"note":null,"createdAt":1}
    """
}
