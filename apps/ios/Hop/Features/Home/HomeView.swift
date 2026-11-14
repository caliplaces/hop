import SwiftUI

/// The signed-in app. The inbox, the Hop pass and Event mode fill these tabs in
/// the next steps; for now they say what's coming.
struct HomeView: View {
    var body: some View {
        TabView {
            Tab("Inbox", systemImage: "tray.full") {
                ComingSoon(
                    title: "Inbox",
                    headline: "No clips yet",
                    message: "Share your Hop link at your next event. Clips people send you land here, sorted by event."
                )
            }
            Tab("My Hop", systemImage: "qrcode") {
                ComingSoon(
                    title: "My Hop",
                    headline: "Your Hop pass",
                    message: "Your QR code and Event mode are coming next."
                )
            }
        }
        .tint(Palette.brand.color)
    }
}

private struct ComingSoon: View {
    let title: LocalizedStringKey
    let headline: LocalizedStringKey
    let message: LocalizedStringKey

    @Environment(Session.self) private var session

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label {
                    Text(headline)
                } icon: {
                    Image(.bobbleIdle)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 120, height: 120)
                        .accessibilityHidden(true)
                }
            } description: {
                Text(message)
            }
            .background(Theme.canvas)
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Account", systemImage: "person.crop.circle") {
                        if let me = session.me {
                            Section {
                                Text(me.name ?? me.email ?? String(localized: "Signed in"))
                                if let handle = me.handle {
                                    Text(verbatim: "onmyhop.com/\(handle)")
                                }
                            }
                        }
                        Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            Task { await session.signOut() }
                        }
                    }
                }
            }
        }
    }
}

#Preview {
    HomeView()
        .environment(Session())
}
