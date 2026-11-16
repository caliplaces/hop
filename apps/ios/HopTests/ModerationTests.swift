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

        try await Moderation.report(clip(), reason: .other, note: String(repeating: "x", count: 600), api: server.client())
        #expect((try body(1)["note"] as? String)?.count == Moderation.maxNoteLength)
    }

    @Test func passesOnWhyAReportWasRefused() async throws {
        server.reply = { _ in (429, #"{"error":"rate_limited","message":"Too many reports. Try again in a minute."}"#) }
        await #expect {
            try await Moderation.report(clip(), reason: .spam, note: "", api: server.client())
        } throws: { error in
            (error as? APIError)?.message == "Too many reports. Try again in a minute."
        }
    }

    @Test func blocksWhoeverSentAClip() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        try await Moderation.block(clip("fil_9"), api: server.client(token: "hs_test"))
        let request = try #require(server.requests.first?.request)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/me/files/fil_9/block")
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
