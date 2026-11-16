import Foundation
import Testing
@testable import Hop

@Suite("Deep links")
struct HopDeepLinkTests {
    @Test func readsTheAppsOwnLinks() throws {
        #expect(HopDeepLink(url: try #require(URL(string: "com.onmyhop.app://event"))) == .eventStage)
        #expect(HopDeepLink(url: try #require(URL(string: "com.onmyhop.app://qr"))) == .qrCode)
        #expect(HopDeepLink(url: HopDeepLink.qrCode.url) == .qrCode)
        #expect(EventActivityAttributes.stageURL == HopDeepLink.eventStage.url)
    }

    @Test func ignoresAnythingElse() throws {
        // The sign-in callback shares the scheme; it isn't a link to follow.
        #expect(HopDeepLink(url: try #require(URL(string: "com.onmyhop.app:/auth/callback?code=x"))) == nil)
        #expect(HopDeepLink(url: try #require(URL(string: "com.onmyhop.app://elsewhere"))) == nil)
        #expect(HopDeepLink(url: try #require(URL(string: "https://onmyhop.com/qr"))) == nil)
    }
}

@MainActor
@Suite("Widget card")
struct HopCardTests {
    let defaults = UserDefaults(suiteName: "card-tests-\(UUID().uuidString)")!

    private func me(handle: String? = "alex") throws -> Me {
        try JSONDecoder().decode(Me.self, from: Data(meJSON(handle: handle).utf8))
    }

    @Test func savesLoadsAndClears() throws {
        let card = try #require(HopCard(me: me()))
        #expect(card.handle == "alex")
        #expect(card.link.absoluteString.hasSuffix("/alex"))
        #expect(card.color == "grape")

        #expect(HopCard.save(card, to: defaults))
        #expect(HopCard.load(from: defaults) == card)
        // Saving the same card again changes nothing, so widgets aren't reloaded.
        #expect(!HopCard.save(card, to: defaults))

        #expect(HopCard.save(nil, to: defaults))
        #expect(HopCard.load(from: defaults) == nil)
        #expect(!HopCard.save(nil, to: defaults))
    }

    @Test func noCardWithoutAClaimedHandle() throws {
        #expect(HopCard(me: try me(handle: nil)) == nil)
        #expect(HopCard(me: nil) == nil)
    }

    @Test func publishingSignedOutClearsTheCard() throws {
        HopCard.publish(try me(), to: defaults)
        #expect(HopCard.load(from: defaults)?.handle == "alex")
        HopCard.publish(nil, to: defaults)
        #expect(HopCard.load(from: defaults) == nil)
    }
}
