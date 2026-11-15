import SwiftUI

/// The signed-in app. The inbox fills its tab in the next step.
struct HomeView: View {
    @Environment(Session.self) private var session

    var body: some View {
        TabView {
            Tab("Inbox", systemImage: "tray.full") {
                InboxPlaceholder()
            }
            Tab("My Hop", systemImage: "qrcode") {
                MyHopView()
            }
        }
        .tint(session.me?.paletteColor.color ?? Palette.brand.color)
    }
}

private struct InboxPlaceholder: View {
    @Environment(Session.self) private var session

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label {
                    Text("No clips yet")
                } icon: {
                    (session.me?.paletteColor ?? Palette.brand).bobble
                        .resizable()
                        .scaledToFit()
                        .frame(width: 120, height: 120)
                        .accessibilityHidden(true)
                }
            } description: {
                Text("Share your Hop link at your next event. Clips people send you land here, sorted by event.")
            }
            .background(Theme.canvas)
            .navigationTitle("Inbox")
            .toolbar { AccountMenu() }
        }
    }
}

/// Who's signed in, and signing out.
struct AccountMenu: ToolbarContent {
    @Environment(Session.self) private var session

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu("Account", systemImage: "person.crop.circle") {
                if let me = session.me {
                    Section {
                        Text(me.name ?? me.email ?? String(localized: "Signed in"))
                        if let link = me.link {
                            Text(verbatim: link.spoken)
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

#Preview {
    HomeView()
        .environment(Session())
}
