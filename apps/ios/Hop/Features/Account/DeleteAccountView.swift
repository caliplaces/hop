import StoreKit
import SwiftUI

/// Deleting the account, from the account sheet: what goes and what stays,
/// a word about Hop+ (Apple bills it until it's cancelled there), and a
/// confirmation. Once the server confirms, the app signs out.
struct DeleteAccountView: View {
    @Environment(Session.self) private var session
    @Environment(HopPlus.self) private var hopPlus
    @State private var confirming = false
    @State private var deleting = false
    @State private var failure: String?
    @State private var managingSubscription = false

    private static let red = Color(light: 0xD92D20, dark: 0xFF6369)

    /// Hop+ that will renew: deleting the account doesn't stop Apple billing it.
    private var renewingHopPlus: Bool {
        hopPlus.status?.plan == .plus && hopPlus.status?.subscription?.autoRenew == true
    }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.xmark")
                        .font(.system(size: 52, weight: .regular))
                        .foregroundStyle(Self.red)
                        .symbolRenderingMode(.hierarchical)
                        .accessibilityHidden(true)
                    Text("Delete your Hop account?")
                        .font(.title3.bold())
                    Text("This can’t be undone.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }

            Section("What happens") {
                row("Every clip and event in your inbox is deleted.", systemImage: "film.stack")
                row("Your name and photo are removed.", systemImage: "person.crop.circle")
                if let link = session.me?.link {
                    row(
                        "\(link.spoken) stops working, and nobody else can take it.",
                        systemImage: "link"
                    )
                }
                row("You’re signed out on every device.", systemImage: "rectangle.portrait.and.arrow.right")
            }

            if renewingHopPlus {
                Section {
                    row(
                        "Deleting your account doesn’t cancel Hop+. Apple keeps billing you until you cancel it.",
                        systemImage: "creditcard"
                    )
                    Button("Manage Subscription") { managingSubscription = true }
                } header: {
                    Text(verbatim: "Hop+")
                }
            }

            Section {
                Button(role: .destructive) {
                    confirming = true
                } label: {
                    HStack {
                        Text("Delete Account")
                            .foregroundStyle(Self.red)
                        if deleting {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(deleting)
            } footer: {
                Text("Save any clips you want to keep first. Your Caliplaces account isn’t affected.")
            }
        }
        .navigationTitle("Delete Account")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(deleting)
        .interactiveDismissDisabled(deleting)
        .alert("Delete your Hop account?", isPresented: $confirming) {
            Button("Delete Account", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your clips, events and profile are deleted for good.")
        }
        .alert(
            "Couldn’t delete your account",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .manageSubscriptionsSheet(isPresented: $managingSubscription)
    }

    private func row(_ text: LocalizedStringKey, systemImage: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(Theme.muted)
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            // Signs out once the server confirms, which leaves this screen.
            try await session.deleteAccount()
        } catch {
            failure = error.localizedDescription
        }
    }
}
