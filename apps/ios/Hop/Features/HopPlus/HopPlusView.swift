import StoreKit
import SwiftUI

/// Hop+: more room, and every clip kept for good. Apple's subscription store
/// under Hop's own header, so prices, trials, Restore and the fine print are
/// always right for the athlete's country.
struct HopPlusView: View {
    @Environment(Session.self) private var session
    @Environment(HopPlus.self) private var hopPlus
    @Environment(\.dismiss) private var dismiss
    @State private var welcomed = false
    @State private var notice: Notice?

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    var body: some View {
        ZStack {
            if welcomed, let status = hopPlus.status {
                HopPlusWelcome(plans: status.plans, color: color) { dismiss() }
                    .transition(.blurReplace)
            } else if let status = hopPlus.status {
                store(status)
            } else if let error = hopPlus.loadError {
                ContentUnavailableView {
                    Label("Couldn’t load Hop+", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again") { Task { await hopPlus.refresh(api: session.api) } }
                        .buttonStyle(.glass)
                }
            } else {
                ProgressView()
            }
        }
        .animation(.smooth(duration: 0.5), value: welcomed)
        .presentationBackground {
            Aura(colors: [color.color, Palette.brand.color, color.color], intensity: 0.9)
        }
        .task {
            if hopPlus.status == nil { await hopPlus.refresh(api: session.api) }
        }
        // Restore in the store doesn't report back: whatever it found is sent
        // once the sheet closes.
        .onDisappear {
            let api = session.api
            Task { await hopPlus.sync(api: api) }
        }
        .alert(
            notice?.title ?? "",
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } }),
            presenting: notice
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { notice in
            Text(notice.message)
        }
    }

    private func store(_ status: PlanStatus) -> some View {
        SubscriptionStoreView(productIDs: StoreKitPurchases.productIDs) {
            HopPlusHeader(status: status, color: color)
        }
        .subscriptionStoreControlStyle(.compactPicker)
        .subscriptionStoreButtonLabel(.multiline)
        .storeButton(.visible, for: .restorePurchases, .policies)
        // A code redeemed here carries no account token, so the API couldn't
        // tell whose it is. Codes can still be redeemed in the App Store.
        .storeButton(.hidden, for: .redeemCode)
        .subscriptionStorePolicyDestination(url: HopLegal.terms, for: .termsOfService)
        .subscriptionStorePolicyDestination(url: HopLegal.privacy, for: .privacyPolicy)
        // Ties the purchase to this account, which is how the API knows whose it is.
        .inAppPurchaseOptions { _ in [.appAccountToken(status.appAccountToken)] }
        .onInAppPurchaseCompletion { _, result in await complete(result) }
        .containerBackground(.clear, for: .subscriptionStoreFullHeight)
        .tint(color.color)
    }

    private func complete(_ result: Result<Product.PurchaseResult, any Error>) async {
        switch result {
        case let .success(.success(verification)):
            guard let purchase = StoreKitPurchases.purchase(verification) else {
                notice = .unverified
                return
            }
            switch await hopPlus.send(purchase, api: session.api) {
            case .counted:
                welcomed = true
            case let .refused(problem):
                notice = Notice(problem)
            case .later:
                notice = .later
            }
        case .success(.pending):
            notice = .pending
        case .success(.userCancelled):
            break
        case let .failure(error):
            notice = Notice(title: String(localized: "Purchase didn’t go through"), message: error.localizedDescription)
        @unknown default:
            break
        }
    }

    private struct Notice: Identifiable {
        let title: String
        let message: String
        var id: String { title + message }

        init(title: String, message: String) {
            self.title = title
            self.message = message
        }

        init(_ problem: HopPlus.Problem) {
            self = switch problem {
            case .otherAccount: .otherAccount
            case .deletedAccount: .deletedAccount
            case .testPurchase: .testPurchase
            case .unverified: .unverified
            }
        }

        static let pending = Notice(
            title: String(localized: "Waiting for approval"),
            message: String(localized: "Hop+ starts as soon as the purchase is approved.")
        )
        static let later = Notice(
            title: String(localized: "Almost there"),
            message: String(localized: "Your purchase went through, but Hop couldn’t confirm it just now. Hop+ starts as soon as you’re back online.")
        )
        static let otherAccount = Notice(
            title: String(localized: "Hop+ is on another account"),
            message: String(localized: "This Apple Account’s Hop+ belongs to another Hop account. Sign in with that one to use it.")
        )
        static let deletedAccount = Notice(
            title: String(localized: "Hop+ is on a deleted account"),
            message: String(localized: "This Apple Account’s Hop+ belongs to a Hop account that was deleted. Cancel it in your Apple Account’s subscriptions, then subscribe again here.")
        )
        static let testPurchase = Notice(
            title: String(localized: "Test purchase"),
            message: String(localized: "Purchases in test builds don’t unlock Hop+.")
        )
        static let unverified = Notice(
            title: String(localized: "Couldn’t verify the purchase"),
            message: String(localized: "Hop couldn’t check this purchase with the App Store. Please try again later.")
        )
    }
}

/// Where the store's Terms and Privacy buttons lead.
enum HopLegal {
    /// Hop's terms, which say Apple's standard licence agreement applies to the app too.
    static var terms: URL { HopServer.baseURL.appending(path: "terms") }
    static var privacy: URL { HopServer.baseURL.appending(path: "privacy") }
}

/// The top of the store: what Hop+ is, side by side with the free plan.
struct HopPlusHeader: View {
    let status: PlanStatus
    let color: PaletteColor
    /// How much paying yearly saves, in whole percent, from the live prices.
    @State private var yearlySaving: Int?

    var body: some View {
        VStack(spacing: 22) {
            HopPlusMark(color: color)
                .padding(.top, 28)

            VStack(spacing: 8) {
                Text("Every clip, kept for good")
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
                Text("Room for a whole season of events, and nothing ever leaves your inbox.")
                    .font(.callout)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 12)

            PlanComparison(plans: status.plans, color: color)

            if let yearlySaving {
                Text("Save \(yearlySaving)% with yearly")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .glassEffect(.regular.tint(color.color.opacity(0.35)), in: .capsule)
            }

            if status.plan == .free, let expiring = status.expiring {
                // Why they're here, if the banner about clips leaving sent them.
                Text("\(Image(systemName: "clock.badge.exclamationmark")) \(ExpiryNudge.title(expiring)). With Hop+, they stay.")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            }

            if status.plan == .free, status.storage.usedBytes > 0 {
                Text("You’re using \(status.storage.usedBytes.storageText) of \(status.storage.limitBytes.storageText).")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .task { yearlySaving = await Self.loadYearlySaving() }
    }

    private static func loadYearlySaving() async -> Int? {
        guard let products = try? await Product.products(for: StoreKitPurchases.productIDs),
              let monthly = products.first(where: { $0.id == "hop_plus" }),
              let yearly = products.first(where: { $0.id == "hop_plus_annual" })
        else { return nil }
        return yearlySaving(monthly: monthly.price, yearly: yearly.price)
    }

    /// Whole percent saved by a year at `yearly` over twelve months at
    /// `monthly`, rounded down so it never claims more. Nil when it's small.
    nonisolated static func yearlySaving(monthly: Decimal, yearly: Decimal) -> Int? {
        let twelveMonths = monthly * 12
        guard twelveMonths > 0 else { return nil }
        let percent = NSDecimalNumber(decimal: (1 - yearly / twelveMonths) * 100).doubleValue
        let whole = Int(percent.rounded(.down))
        return whole >= 5 ? whole : nil
    }
}

/// "Hop+", with the plus in the athlete's colour, lit from within.
struct HopPlusMark: View {
    let color: PaletteColor
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var glowing = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(verbatim: "Hop")
                .foregroundStyle(Theme.ink)
            Text(verbatim: "+")
                .foregroundStyle(color.color.gradient)
                .shadow(color: color.color.opacity(glowing ? 0.7 : 0.35), radius: glowing ? 18 : 10)
        }
        .font(.system(size: 64, weight: .heavy, design: .rounded))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "Hop+"))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) { glowing = true }
        }
    }
}

/// Free and Hop+, row by row.
struct PlanComparison: View {
    let plans: PlanStatus.Plans
    let color: PaletteColor

    var body: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 14) {
            GridRow {
                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                Text("Free")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                Text(verbatim: "Hop+")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(color.color)
            }
            Divider().gridCellColumns(3)
            row(
                "Storage",
                systemImage: "externaldrive",
                free: plans.free.storageBytes.storageText,
                plus: plans.plus.storageBytes.storageText
            )
            row(
                "Clips kept",
                systemImage: "clock.arrow.circlepath",
                free: retention(plans.free.retentionDays),
                plus: retention(plans.plus.retentionDays)
            )
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }

    private func row(_ title: LocalizedStringKey, systemImage: String, free: String, plus: String) -> some View {
        GridRow {
            Label(title, systemImage: systemImage)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(free)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .frame(minWidth: 64)
            Text(plus)
                .font(.subheadline.weight(.semibold))
                .frame(minWidth: 64)
        }
    }

    private func retention(_ days: Int?) -> String {
        guard let days else { return String(localized: "Forever") }
        return String(localized: "\(days) days")
    }
}

/// Shown once a purchase counts.
struct HopPlusWelcome: View {
    let plans: PlanStatus.Plans
    let color: PaletteColor
    let done: () -> Void
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 84))
                .foregroundStyle(color.color.gradient)
                .symbolEffect(.bounce, value: appeared)
            Text("Welcome to Hop+")
                .font(.largeTitle.weight(.bold))
            Text("\(plans.plus.storageBytes.storageText) of room, and every clip kept for good.")
                .font(.title3)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            Spacer()
            Button(action: done) {
                Text("Done")
                    .font(.headline)
                    .foregroundStyle(color.onColor)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.extraLarge)
            .tint(color.color)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sensoryFeedback(.success, trigger: appeared)
        .onAppear { appeared = true }
    }
}
