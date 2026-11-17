import StoreKit
import SwiftUI

/// Screens the account sheet pushes.
enum AccountRoute: Hashable {
    case profile
    case blockedSenders
    case deleteAccount
}

/// The athlete's account: who they are, their plan and storage, and signing out.
struct AccountView: View {
    @Environment(Session.self) private var session
    @Environment(HopPlus.self) private var hopPlus
    @Environment(\.dismiss) private var dismiss
    @State private var showingHopPlus = false
    @State private var managingSubscription = false
    @State private var restoring = false
    @State private var restoreFailure: String?

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    var body: some View {
        NavigationStack {
            Form {
                if let me = session.me {
                    Section {
                        NavigationLink(value: AccountRoute.profile) {
                            profile(me)
                        }
                    }
                }

                Section("Plan") {
                    if let status = hopPlus.status {
                        PlanSummary(status: status, color: color)
                        if status.plan == .plus, status.subscription?.isFromWebsite == true {
                            // Apple's sheet can't manage it, and the app
                            // doesn't link to payments elsewhere.
                            Label("Billed through the Hop website, where you can manage it.", systemImage: "creditcard")
                                .font(.subheadline)
                                .foregroundStyle(Theme.muted)
                        } else if status.plan == .plus {
                            Button("Manage Subscription", systemImage: "creditcard") {
                                managingSubscription = true
                            }
                        } else {
                            Button {
                                showingHopPlus = true
                            } label: {
                                Text("Get Hop+")
                                    .font(.headline)
                                    .foregroundStyle(color.onColor)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glassProminent)
                            .controlSize(.large)
                            .tint(color.color)
                            .listRowSeparator(.hidden)
                        }
                    } else if let error = hopPlus.loadError {
                        Label(error, systemImage: "wifi.exclamationmark")
                            .foregroundStyle(Theme.muted)
                    } else {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    }
                }

                if let problem = hopPlus.problem, hopPlus.status?.plan != .plus {
                    Section {
                        Label(explanation(problem), systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                    }
                }

                Section {
                    Button {
                        Task { await restore() }
                    } label: {
                        HStack {
                            Label("Restore Purchases", systemImage: "arrow.clockwise")
                            if restoring {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(restoring)
                } footer: {
                    Text("Bought Hop+ on another device? Restoring brings it here.")
                }

                if let me = session.me {
                    NewClipsSection(me: me)
                }

                Section {
                    NavigationLink(value: AccountRoute.blockedSenders) {
                        Label("Blocked Senders", systemImage: "hand.raised")
                    }
                }

                Section {
                    Link(destination: HopLegal.privacy) {
                        Label("Privacy", systemImage: "hand.raised.square")
                    }
                    Link(destination: HopLegal.terms) {
                        Label("Terms", systemImage: "doc.text")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        dismiss()
                        Task {
                            await session.signOut { await PushNotifications.shared.unregister(api: $0) }
                        }
                    } label: {
                        // Red throughout, icon included.
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    NavigationLink(value: AccountRoute.deleteAccount) {
                        Text("Delete Account")
                            .foregroundStyle(.red)
                    }
                }
            }
            .tint(Theme.ink)
            // By value, not with the view itself: a link holding its view
            // keeps that view's state, so an edit cancelled on one visit
            // would still be there on the next.
            .navigationDestination(for: AccountRoute.self) { route in
                switch route {
                case .profile:
                    if let me = session.me { EditProfileView(me: me, session: session) }
                case .blockedSenders:
                    BlockedSendersView(api: session.api)
                case .deleteAccount:
                    DeleteAccountView()
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showingHopPlus) { HopPlusView() }
            .manageSubscriptionsSheet(isPresented: $managingSubscription)
            // Changes made in the App Store's sheet reach the API through
            // StoreKit's updates; the numbers are reloaded when it closes.
            .onChange(of: managingSubscription) { _, managing in
                guard !managing else { return }
                Task { await hopPlus.refresh(api: session.api) }
            }
            .task { await hopPlus.refresh(api: session.api) }
            .alert(
                "Couldn’t restore purchases",
                isPresented: Binding(get: { restoreFailure != nil }, set: { if !$0 { restoreFailure = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(restoreFailure ?? "")
            }
        }
    }

    private func profile(_ me: Me) -> some View {
        HStack(spacing: 14) {
            Avatar(me: me, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(me.name ?? me.email ?? String(localized: "Signed in"))
                        .font(.headline)
                    if me.hopPlus { HopPlusBadge(color: me.paletteColor) }
                }
                if let link = me.link {
                    Text(verbatim: link.spoken)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func explanation(_ problem: HopPlus.Problem) -> String {
        switch problem {
        case .otherAccount:
            String(localized: "Hop+ on this Apple Account belongs to another Hop account.")
        case .deletedAccount:
            String(localized: "Hop+ on this Apple Account belongs to a deleted Hop account. Cancel it in your Apple Account’s subscriptions, then subscribe again.")
        case .testPurchase:
            String(localized: "Purchases in test builds don’t unlock Hop+.")
        case .unverified:
            String(localized: "Hop couldn’t verify a purchase from this Apple Account.")
        }
    }

    private func restore() async {
        restoring = true
        defer { restoring = false }
        do {
            try await hopPlus.restore(api: session.api)
        } catch StoreKitError.userCancelled {
            // They closed the App Store's sign-in: nothing to say.
        } catch {
            restoreFailure = error.localizedDescription
        }
    }
}
