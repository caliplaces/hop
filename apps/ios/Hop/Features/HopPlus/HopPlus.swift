import Foundation
import Observation

/// Hop+ on this device: the athlete's plan as the API sees it, and every
/// App Store transaction handed to the API, which decides what it's worth.
///
/// A transaction is only finished once the API has answered for it. Until
/// then StoreKit keeps it, and it's sent again on the next launch, so a
/// purchase made offline or during an outage still counts.
@Observable
final class HopPlus {
    /// Why a purchase from this Apple ID didn't count for this account.
    enum Problem: Equatable {
        /// It belongs to another Hop account.
        case otherAccount
        /// A sandbox purchase (TestFlight), which production doesn't honour.
        case testPurchase
        /// The API couldn't verify it.
        case unverified
    }

    /// What became of a transaction sent to the API.
    enum Outcome: Equatable {
        case counted
        case refused(Problem)
        /// Not confirmed yet (offline, say). StoreKit keeps it, and it's sent again.
        case later
    }

    private(set) var status: PlanStatus?
    private(set) var problem: Problem?
    /// Whether the plan couldn't be loaded, with the reason.
    private(set) var loadError: String?

    private let source: any PurchaseSource
    /// Bumped when the athlete signs out, so late replies are dropped.
    private var generation = 0

    init(source: any PurchaseSource = StoreKitPurchases()) {
        self.source = source
    }

    /// Loads the plan, sends what this Apple ID has, then follows new
    /// transactions until cancelled. Runs while someone is signed in.
    func run(api: APIClient) async {
        await refresh(api: api)
        await sync(api: api)
        for await purchase in source.updates() {
            await send(purchase, api: api)
        }
    }

    /// Reloads the plan, for fresh storage numbers.
    func refresh(api: APIClient) async {
        let asked = generation
        do {
            let status: PlanStatus = try await api.get("api/me/plan")
            guard asked == generation else { return }
            self.status = status
            loadError = nil
        } catch {
            guard asked == generation else { return }
            loadError = error.localizedDescription
        }
    }

    /// Sends every Hop+ transaction this Apple ID has to the API.
    func sync(api: APIClient) async {
        for purchase in await source.current() {
            await send(purchase, api: api)
        }
    }

    /// Asks the App Store for this Apple ID's purchases, then sends them.
    func restore(api: APIClient) async throws {
        try await source.restore()
        await sync(api: api)
    }

    /// Hands a transaction to the API, which decides what it's worth.
    @discardableResult
    func send(_ purchase: Purchase, api: APIClient) async -> Outcome {
        let asked = generation
        do {
            let status: PlanStatus = try await api.post(
                "api/me/subscriptions/apple",
                body: TransactionBody(transaction: purchase.jws)
            )
            await purchase.finish()
            guard asked == generation else { return .counted }
            self.status = status
            problem = nil
            return .counted
        } catch let error as APIError where [400, 403].contains(error.status) {
            // A definite no. StoreKit keeps the subscription either way; it
            // just doesn't count here, and asking again won't change that.
            await purchase.finish()
            let problem: Problem = switch error.code {
            case "other_account": .otherAccount
            case "test_purchase": .testPurchase
            default: .unverified
            }
            if asked == generation { self.problem = problem }
            return .refused(problem)
        } catch {
            // Offline, signed out meanwhile, or the server is having a
            // moment: StoreKit keeps it unfinished, and it's sent again.
            return .later
        }
    }

    /// Forgets the plan when the athlete signs out.
    func reset() {
        generation += 1
        status = nil
        problem = nil
        loadError = nil
    }

    private struct TransactionBody: Encodable {
        let transaction: String
    }
}
