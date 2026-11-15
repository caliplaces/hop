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
    /// Bumped when the athlete signs out. Work started for them stops, and
    /// its late replies are dropped.
    private var generation = 0
    /// Plan reads are numbered as they start. Reads numbered up to
    /// `staleReads` may have read the plan before what's on show: a newer
    /// read, or a purchase the API saved before answering. Their late
    /// replies are dropped, so a slow read can't turn Hop+ back into Free.
    private var lastRead = 0
    private var staleReads = 0

    init(source: any PurchaseSource = StoreKitPurchases()) {
        self.source = source
    }

    /// Loads the plan, sends what this Apple ID has, then follows new
    /// transactions until cancelled. Runs while someone is signed in.
    func run(api: APIClient) async {
        let asked = generation
        await refresh(api: api)
        await sync(api: api, for: asked)
        for await purchase in source.updates() {
            guard asked == generation else { return }
            await send(purchase, api: api, for: asked)
        }
    }

    /// Reloads the plan, for fresh storage numbers.
    func refresh(api: APIClient) async {
        let asked = generation
        lastRead += 1
        let read = lastRead
        do {
            let status: PlanStatus = try await api.get("api/me/plan")
            guard asked == generation, read > staleReads else { return }
            staleReads = read
            self.status = status
            loadError = nil
        } catch {
            guard asked == generation, read > staleReads else { return }
            loadError = error.localizedDescription
        }
    }

    /// Sends every Hop+ transaction this Apple ID has to the API.
    func sync(api: APIClient) async {
        await sync(api: api, for: generation)
    }

    /// Asks the App Store for this Apple ID's purchases, then sends them.
    func restore(api: APIClient) async throws {
        let asked = generation
        try await source.restore()
        await sync(api: api, for: asked)
    }

    /// Hands a transaction to the API, which decides what it's worth.
    @discardableResult
    func send(_ purchase: Purchase, api: APIClient) async -> Outcome {
        await send(purchase, api: api, for: generation)
    }

    /// Sends what the Apple ID has, for whoever was signed in at `asked`.
    private func sync(api: APIClient, for asked: Int) async {
        for purchase in await source.current() {
            // Signed out meanwhile: the next athlete's sync sends them.
            guard asked == generation else { return }
            await send(purchase, api: api, for: asked)
        }
    }

    private func send(_ purchase: Purchase, api: APIClient, for asked: Int) async -> Outcome {
        do {
            let status: PlanStatus = try await api.post(
                "api/me/subscriptions/apple",
                body: TransactionBody(transaction: purchase.jws)
            )
            await purchase.finish()
            guard asked == generation else { return .counted }
            // The API saved the purchase before answering. Every read already
            // under way may have missed it; any read from now on sees it.
            staleReads = lastRead
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
