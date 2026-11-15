import Foundation

/// The athlete's plan, storage and subscription, as `GET /api/me/plan`
/// describes them. The API decides the plan; the app only shows it.
nonisolated struct PlanStatus: Codable, Equatable, Sendable {
    enum Plan: String, Codable, Sendable {
        case free, plus
    }

    struct Storage: Codable, Equatable, Sendable {
        let usedBytes: Int64
        let limitBytes: Int64
    }

    /// What a plan includes. `retentionDays` is nil when clips are kept for good.
    struct Allowance: Codable, Equatable, Sendable {
        let storageBytes: Int64
        let retentionDays: Int?
    }

    struct Subscription: Codable, Equatable, Sendable {
        let productId: String
        /// End of the paid period, in milliseconds.
        let expiresAt: Int64
        /// While Apple retries a failed renewal, Hop+ carries on until this.
        let graceExpiresAt: Int64?
        let autoRenew: Bool
        let environment: String
    }

    struct Plans: Codable, Equatable, Sendable {
        let free: Allowance
        let plus: Allowance
    }

    let plan: Plan
    let storage: Storage
    let retentionDays: Int?
    let subscription: Subscription?
    /// Set on every purchase, so the App Store ties it to this account.
    let appAccountToken: UUID
    let plans: Plans
    /// Goes up whenever the athlete's subscriptions change, and the server
    /// reads it first, so the rest of the reply is at least this new. A reply
    /// with a lower revision than the one on show read the plan before a change.
    let revision: Int64

    /// How full the athlete's storage is, from 0 to 1.
    var usedFraction: Double {
        guard storage.limitBytes > 0 else { return 0 }
        return min(Double(storage.usedBytes) / Double(storage.limitBytes), 1)
    }

    /// On the free plan with little room left: worth a word about Hop+.
    var isNearlyFull: Bool { plan == .free && usedFraction >= 0.8 }

    /// No room for another clip until some go, or Hop+.
    var isFull: Bool { storage.usedBytes >= storage.limitBytes }

    /// The paid period ended and Apple is retrying the payment: Hop+ lasts
    /// until the returned date unless it goes through.
    func billingGraceEnds(at now: Date = .now) -> Date? {
        guard let subscription, let grace = subscription.graceExpiresAt else { return nil }
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        guard subscription.expiresAt <= nowMs, nowMs < grace else { return nil }
        return Date(milliseconds: grace)
    }
}

nonisolated extension Date {
    init(milliseconds: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
    }
}

nonisolated extension Int64 {
    /// Bytes as people read storage: "15 GB", counted in 1024s like the plans.
    var storageText: String {
        formatted(.byteCount(style: .memory, spellsOutZero: false))
    }
}
