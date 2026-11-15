import Foundation
import Testing
@testable import Hop

private let token = "c2a116f4-3b55-4213-83ec-d9218d028acb"
private let gib: Int64 = 1024 * 1024 * 1024

private func planJSON(plan: String = "free", used: Int64 = 0, subscription: String = "null") -> String {
    let limit = plan == "free" ? 15 * gib : 200 * gib
    let retention = plan == "free" ? "30" : "null"
    return #"{"plan":"\#(plan)","storage":{"usedBytes":\#(used),"limitBytes":\#(limit)},"retentionDays":\#(retention),"subscription":\#(subscription),"appAccountToken":"\#(token)","plans":{"free":{"storageBytes":\#(15 * gib),"retentionDays":30},"plus":{"storageBytes":\#(200 * gib),"retentionDays":null}}}"#
}

private let plusSubscription = #"{"productId":"hop_plus","expiresAt":4102444800000,"graceExpiresAt":null,"autoRenew":true,"environment":"Production"}"#

/// Hands out purchases the test makes, and records which were finished.
nonisolated final class FakePurchases: PurchaseSource, @unchecked Sendable {
    private let lock = NSLock()
    private var held: [Purchase] = []
    private var done: [UInt64] = []
    private var restores = 0
    private let stream: AsyncStream<Purchase>
    let continuation: AsyncStream<Purchase>.Continuation

    init() {
        (stream, continuation) = AsyncStream.makeStream()
    }

    var finished: [UInt64] { lock.withLock { done } }
    var restored: Int { lock.withLock { restores } }

    func make(_ id: UInt64) -> Purchase {
        Purchase(id: id, productID: "hop_plus", jws: "jws-\(id)") { [weak self] in
            guard let self else { return }
            lock.withLock { done.append(id) }
        }
    }

    func have(_ ids: UInt64...) {
        let purchases = ids.map(make)
        lock.withLock { held = purchases }
    }

    func current() async -> [Purchase] { lock.withLock { held } }
    func updates() -> AsyncStream<Purchase> { stream }
    func restore() async throws { lock.withLock { restores += 1 } }
}

@MainActor
@Suite("Hop+", .serialized)
struct HopPlusTests {
    let server = StubServer(host: "hop-plus-\(UUID().uuidString.lowercased()).test")
    let purchases = FakePurchases()

    private var api: APIClient { server.client(token: "hs_t") }

    /// The transactions the app sent, in order.
    private var sent: [String] {
        server.requests
            .filter { $0.request.url?.path == "/api/me/subscriptions/apple" }
            .compactMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: String] }
            .compactMap { $0["transaction"] }
    }

    /// Answers the plan with `plan`, and purchases with `purchase`.
    private func serve(plan: String = planJSON(), purchase: Locked<(Int, String)> = Locked((200, planJSON(plan: "plus", subscription: plusSubscription)))) {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path ?? "") {
            case ("GET", "/api/me/plan"): (200, plan)
            case ("POST", "/api/me/subscriptions/apple"): purchase.value
            default: (404, "{}")
            }
        }
    }

    @Test func loadsThePlan() async {
        serve(plan: planJSON(used: 3 * gib))
        let hopPlus = HopPlus(source: purchases)
        await hopPlus.refresh(api: api)
        let status = try? #require(hopPlus.status)
        #expect(status?.plan == .free)
        #expect(status?.appAccountToken == UUID(uuidString: token))
        #expect(status?.storage.limitBytes.storageText == "15 GB")
        #expect(status?.plans.plus.storageBytes.storageText == "200 GB")
        #expect(status?.retentionDays == 30)
        #expect(status?.isNearlyFull == false)
    }

    @Test func aPurchaseThatCountsIsFinished() async {
        serve()
        let hopPlus = HopPlus(source: purchases)
        let outcome = await hopPlus.send(purchases.make(7), api: api)
        #expect(outcome == .counted)
        #expect(sent == ["jws-7"])
        #expect(purchases.finished == [7])
        #expect(hopPlus.status?.plan == .plus)
        #expect(hopPlus.problem == nil)
    }

    @Test func aRefusedPurchaseIsFinishedWithItsReason() async {
        let purchase = Locked((403, #"{"error":"other_account","message":"No."}"#))
        serve(purchase: purchase)
        let hopPlus = HopPlus(source: purchases)
        #expect(await hopPlus.send(purchases.make(1), api: api) == .refused(.otherAccount))
        #expect(hopPlus.problem == .otherAccount)

        purchase.value = (403, #"{"error":"test_purchase","message":"No."}"#)
        #expect(await hopPlus.send(purchases.make(2), api: api) == .refused(.testPurchase))

        purchase.value = (400, #"{"error":"invalid_transaction","message":"No."}"#)
        #expect(await hopPlus.send(purchases.make(3), api: api) == .refused(.unverified))

        // Asking again won't change a definite no, so StoreKit can let them go.
        #expect(purchases.finished == [1, 2, 3])
        #expect(hopPlus.status == nil)
    }

    @Test func anUnconfirmedPurchaseIsKeptForLater() async {
        let purchase = Locked((503, #"{"error":"unavailable"}"#))
        serve(purchase: purchase)
        let hopPlus = HopPlus(source: purchases)
        #expect(await hopPlus.send(purchases.make(1), api: api) == .later)
        // A session that expired meanwhile: it counts once they sign in again.
        purchase.value = (401, #"{"error":"unauthorized"}"#)
        #expect(await hopPlus.send(purchases.make(2), api: api) == .later)
        #expect(purchases.finished.isEmpty)
        #expect(hopPlus.problem == nil)

        // Sent again on the next sync, it counts and is finished.
        purchase.value = (200, planJSON(plan: "plus", subscription: plusSubscription))
        purchases.have(1, 2)
        await hopPlus.sync(api: api)
        #expect(purchases.finished == [1, 2])
        #expect(hopPlus.status?.plan == .plus)
    }

    @Test func runLoadsThePlanSendsWhatTheAppleIDHasAndFollowsUpdates() async throws {
        serve()
        purchases.have(1)
        let hopPlus = HopPlus(source: purchases)
        let running = Task { await hopPlus.run(api: api) }
        try await server.waitForRequests { $0.url?.path == "/api/me/subscriptions/apple" }
        #expect(server.requests.first?.request.url?.path == "/api/me/plan")

        // A renewal arrives while the app is open.
        purchases.continuation.yield(purchases.make(2))
        try await server.waitForRequests(count: 2) { $0.url?.path == "/api/me/subscriptions/apple" }
        #expect(sent == ["jws-1", "jws-2"])
        running.cancel()
        await running.value
    }

    @Test func restoreAsksTheAppStoreThenSendsWhatItFound() async throws {
        serve()
        purchases.have(5)
        let hopPlus = HopPlus(source: purchases)
        try await hopPlus.restore(api: api)
        #expect(purchases.restored == 1)
        #expect(sent == ["jws-5"])
        #expect(hopPlus.status?.plan == .plus)
    }

    @Test func aReplyForSomeoneWhoSignedOutIsDropped() async throws {
        serve()
        let hopPlus = HopPlus(source: purchases)
        server.held = ["/api/me/subscriptions/apple"]
        let sending = Task { await hopPlus.send(purchases.make(1), api: api) }
        try await server.waitForRequests { $0.url?.path == "/api/me/subscriptions/apple" }
        hopPlus.reset()
        server.release()
        #expect(await sending.value == .counted)
        // The purchase still counted for them on the server, so it's finished...
        #expect(purchases.finished == [1])
        // ...but this device no longer shows their plan.
        #expect(hopPlus.status == nil)
    }
}

@Suite("Hop+ store")
struct HopPlusStoreTests {
    @Test func yearlySavingIsRoundedDownAndOnlyShownWhenItMatters() {
        #expect(HopPlusHeader.yearlySaving(monthly: 5.99, yearly: 59.99) == 16)
        #expect(HopPlusHeader.yearlySaving(monthly: 4.99, yearly: 39.99) == 33)
        #expect(HopPlusHeader.yearlySaving(monthly: 5, yearly: 58) == nil)
        #expect(HopPlusHeader.yearlySaving(monthly: 5, yearly: 70) == nil)
        #expect(HopPlusHeader.yearlySaving(monthly: 0, yearly: 10) == nil)
    }
}

@Suite("Plan status")
struct PlanStatusTests {
    private func status(_ json: String) throws -> PlanStatus {
        try JSONDecoder().decode(PlanStatus.self, from: Data(json.utf8))
    }

    @Test func isNearlyFullFromFourFifthsOfTheFreePlan() throws {
        #expect(try status(planJSON(used: 11 * gib)).isNearlyFull == false)
        #expect(try status(planJSON(used: 12 * gib)).isNearlyFull == true)
        #expect(try status(planJSON(used: 15 * gib)).isFull == true)
        #expect(try status(planJSON(used: 15 * gib)).usedFraction == 1)
        // Hop+ never nags, however full.
        #expect(try status(planJSON(plan: "plus", used: 199 * gib, subscription: plusSubscription)).isNearlyFull == false)
    }

    @Test func knowsWhenHopPlusRunsOnInABillingGracePeriod() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let ms = Int64(now.timeIntervalSince1970 * 1000)
        let day: Int64 = 86_400_000
        func subscription(expires: Int64, grace: Int64?) -> String {
            #"{"productId":"hop_plus","expiresAt":\#(expires),"graceExpiresAt":\#(grace.map(String.init) ?? "null"),"autoRenew":true,"environment":"Production"}"#
        }
        let inGrace = try status(planJSON(plan: "plus", subscription: subscription(expires: ms - day, grace: ms + 3 * day)))
        #expect(inGrace.billingGraceEnds(at: now) == Date(milliseconds: ms + 3 * day))
        // Paid up, or past the grace period: no warning.
        let paid = try status(planJSON(plan: "plus", subscription: subscription(expires: ms + day, grace: ms + 3 * day)))
        #expect(paid.billingGraceEnds(at: now) == nil)
        let over = try status(planJSON(plan: "plus", subscription: subscription(expires: ms - 4 * day, grace: ms - day)))
        #expect(over.billingGraceEnds(at: now) == nil)
    }
}
