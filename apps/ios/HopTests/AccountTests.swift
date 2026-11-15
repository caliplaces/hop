import Foundation
import Testing
@testable import Hop

@Suite("Handle rules")
struct HandleRulesTests {
    @Test func normalizesLikeTheServer() {
        #expect(HandleRules.normalize("  @Alex.Rider ") == "alex.rider")
    }

    @Test(arguments: ["al", "alex", "a_lex", "alex.rider", "a1", String(repeating: "a", count: 30)])
    func acceptsValidHandles(handle: String) {
        #expect(HandleRules.isValid(handle))
    }

    @Test(arguments: ["a", "_alex", "alex_", ".alex", "al..ex", "al ex", "Alex", "alex!", String(repeating: "a", count: 31)])
    func rejectsInvalidHandles(handle: String) {
        #expect(!HandleRules.isValid(handle))
    }

    @Test func suggestsFromTheNameOrEmail() {
        #expect(HandleRules.suggestion(name: "Alex Rider", email: nil) == "alexrider")
        #expect(HandleRules.suggestion(name: nil, email: "Rope.Jump+1@example.com") == "rope.jump1")
        #expect(HandleRules.suggestion(name: nil, email: nil) == "")
    }

    /// The pattern must be the website's, character for character.
    @Test func matchesTheSharedPattern() throws {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let source = try String(
            contentsOf: root.appending(path: "packages/shared/src/handles.ts"), encoding: .utf8
        )
        #expect(source.contains("export const HANDLE_PATTERN = /\(HandleRules.pattern)/;"))
    }
}

@MainActor
@Suite("Claiming a handle", .serialized)
struct ClaimHopModelTests {
    let server = StubServer(host: "claim.test")

    private func makeModel(name: String = "Alex Rider") throws -> ClaimHopModel {
        let me = try JSONDecoder().decode(
            Me.self, from: Data(meJSON(handle: nil, color: "mint").replacingOccurrences(of: "Alex Rider", with: name).utf8)
        )
        return ClaimHopModel(me: me, api: server.client(token: "hs_test"), debounce: .zero)
    }

    private func settle(_ model: ClaimHopModel) async {
        for _ in 0..<200 where model.status == .checking {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    @Test func suggestsAHandleAndKeepsTheirColour() async throws {
        server.reply = { _ in (200, #"{"handle":"alexrider","available":true,"problem":null}"#) }
        let model = try makeModel()
        #expect(model.input == "alexrider")
        #expect(model.color.id == "mint")
        await settle(model)
        #expect(model.status == .available)
        #expect(model.canClaim)
    }

    @Test func explainsTakenAndReservedHandles() async throws {
        server.reply = { request in
            request.url?.path == "/api/handles/admin"
                ? (200, #"{"handle":"admin","available":false,"problem":"reserved"}"#)
                : (200, #"{"handle":"x","available":false,"problem":"taken"}"#)
        }
        let model = try makeModel()
        await settle(model)
        #expect(model.status == .unavailable(ClaimHopModel.Reason.taken))
        model.input = "admin"
        await settle(model)
        #expect(model.status == .unavailable(ClaimHopModel.Reason.reserved))
        #expect(!model.canClaim)
    }

    @Test func rejectsInvalidHandlesWithoutAsking() async throws {
        let model = try makeModel()
        await settle(model)
        let asked = server.requests.count
        model.input = "no spaces"
        #expect(model.status == .unavailable(ClaimHopModel.Reason.invalid))
        model.input = ""
        #expect(model.status == .idle)
        #expect(server.requests.count == asked)
    }

    @Test func claimsWithTheChosenColour() async throws {
        server.reply = { request in
            request.httpMethod == "PUT"
                ? (200, #"{"me":\#(meJSON(handle: "alexrider", color: "coral"))}"#)
                : (200, #"{"handle":"alexrider","available":true,"problem":null}"#)
        }
        let model = try makeModel()
        await settle(model)
        model.color = Palette.coral
        let me = await model.claim()
        #expect(me?.handle == "alexrider")

        let claim = try #require(server.requests.last)
        #expect(claim.request.url?.path == "/api/me/handle")
        #expect(claim.request.value(forHTTPHeaderField: "Authorization") == "Bearer hs_test")
        let body = try JSONSerialization.jsonObject(with: claim.body) as? [String: String]
        #expect(body == ["handle": "alexrider", "color": "coral"])
    }

    @Test func aLateTakenReplyDoesNotMarkANewHandle() async throws {
        server.held = ["/api/me/handle"]
        server.reply = { request in
            request.httpMethod == "PUT"
                ? (409, #"{"error":"handle_taken","message":"That handle is taken."}"#)
                : (200, #"{"handle":"x","available":true,"problem":null}"#)
        }
        let model = try makeModel()
        await settle(model)
        let claiming = Task { await model.claim() }
        try await server.waitForRequest("/api/me/handle")
        model.input = "somethingelse"
        await settle(model)
        server.release()
        #expect(await claiming.value == nil)
        #expect(model.status == .available)
    }

    @Test func reportsAHandleTakenAtTheLastMoment() async throws {
        server.reply = { request in
            request.httpMethod == "PUT"
                ? (409, #"{"error":"handle_taken","message":"That handle is taken."}"#)
                : (200, #"{"handle":"alexrider","available":true,"problem":null}"#)
        }
        let model = try makeModel()
        await settle(model)
        #expect(await model.claim() == nil)
        #expect(model.status == .unavailable(ClaimHopModel.Reason.taken))
        #expect(model.problem == nil)
    }
}

@Suite("My Hop")
struct MyHopTests {
    @Test func linksAreSpokenWithoutTheScheme() {
        #expect(URL(string: "https://onmyhop.com/alex")!.spoken == "onmyhop.com/alex")
        #expect(URL(string: "http://127.0.0.1:8787/alex")!.spoken == "127.0.0.1:8787/alex")
    }

    @Test func drawsAScannableQRCode() throws {
        let image = try #require(QRCode.image(for: "https://onmyhop.com/alex"))
        // Version 2 or 3 at medium correction: a few dozen modules square.
        #expect(image.width == image.height)
        #expect((21...41).contains(image.width))
    }
}
