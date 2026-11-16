import StoreKit

/// A Hop+ transaction StoreKit verified on this device, to hand to the API.
nonisolated struct Purchase: Sendable {
    let id: UInt64
    let productID: String
    /// Apple's signed transaction. The API verifies it again, on its own.
    let jws: String
    /// Tells StoreKit it's been dealt with, so it stops coming back.
    let finish: @Sendable () async -> Void
}

/// Where Hop+ purchases come from: StoreKit in the app, a fake in tests.
nonisolated protocol PurchaseSource: Sendable {
    /// Transactions not yet finished, and the subscriptions this Apple ID has now.
    func current() async -> [Purchase]
    /// Only the transactions not yet finished: ones the API hasn't answered for.
    func unfinished() async -> [Purchase]
    /// Transactions as they happen: renewals, refunds, Ask to Buy approvals,
    /// purchases on another device.
    func updates() -> AsyncStream<Purchase>
    /// Asks the App Store for this Apple ID's purchases again.
    func restore() async throws
}

nonisolated struct StoreKitPurchases: PurchaseSource {
    /// Hop+ monthly and yearly, one subscription group in App Store Connect.
    static let productIDs = ["hop_plus_annual", "hop_plus"]

    func current() async -> [Purchase] {
        var seen = Set<UInt64>()
        var purchases: [Purchase] = []
        for await result in Transaction.unfinished {
            if let purchase = Self.purchase(result), seen.insert(purchase.id).inserted {
                purchases.append(purchase)
            }
        }
        for await result in Transaction.currentEntitlements {
            if let purchase = Self.purchase(result), seen.insert(purchase.id).inserted {
                purchases.append(purchase)
            }
        }
        return purchases
    }

    func unfinished() async -> [Purchase] {
        var purchases: [Purchase] = []
        for await result in Transaction.unfinished {
            if let purchase = Self.purchase(result) { purchases.append(purchase) }
        }
        return purchases
    }

    func updates() -> AsyncStream<Purchase> {
        AsyncStream { continuation in
            let task = Task {
                for await result in Transaction.updates {
                    if let purchase = Self.purchase(result) { continuation.yield(purchase) }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func restore() async throws {
        try await AppStore.sync()
    }

    /// A Hop+ transaction StoreKit verified. Anything else is left alone:
    /// data that fails here would fail on the server too.
    static func purchase(_ result: VerificationResult<Transaction>) -> Purchase? {
        guard case let .verified(transaction) = result,
              productIDs.contains(transaction.productID)
        else { return nil }
        return Purchase(
            id: transaction.id,
            productID: transaction.productID,
            jws: result.jwsRepresentation,
            finish: { await transaction.finish() }
        )
    }
}
