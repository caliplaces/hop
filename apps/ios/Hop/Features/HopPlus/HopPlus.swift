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
    /// Plan requests (reads and purchases) are numbered as they start.
    /// Replies are ordered by the server's revision first, so one that read
    /// the plan before a change never replaces one that saw it, whichever
    /// arrives last. Among replies of one revision, the later request wins.
    private var lastRequest = 0
    private var shownRequest = 0

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
        let request = startRequest()
        do {
            let status: PlanStatus = try await api.get("api/me/plan")
            if show(status, from: request, for: asked) { loadError = nil }
        } catch {
            // Only worth saying while there's no plan to show.
            guard asked == generation, self.status == nil else { return }
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
        let request = startRequest()
        do {
            let status: PlanStatus = try await api.post(
                "api/me/subscriptions/apple",
                body: TransactionBody(transaction: purchase.jws)
            )
            await purchase.finish()
            guard asked == generation else { return .counted }
            show(status, from: request, for: asked)
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

    private func startRequest() -> Int {
        lastRequest += 1
        return lastRequest
    }

    /// Shows `status` unless the athlete has signed out since `asked`, or
    /// what's on show is newer: a higher revision, or the same revision from
    /// a later request. Returns whether it did.
    @discardableResult
    private func show(_ status: PlanStatus, from request: Int, for asked: Int) -> Bool {
        guard asked == generation else { return false }
        if let shown = self.status {
            let newer = status.revision > shown.revision
                || (status.revision == shown.revision && request > shownRequest)
            guard newer else { return false }
        }
        shownRequest = request
        self.status = status
        return true
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
