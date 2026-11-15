import SwiftUI

/// The signed-in app: the inbox, and the athlete's own link.
struct HomeView: View {
    @Environment(Session.self) private var session

    var body: some View {
        TabView {
            Tab("Inbox", systemImage: "tray.full") {
                InboxView()
            }
            Tab("My Hop", systemImage: "qrcode") {
                MyHopView()
            }
        }
        .tint(session.me?.paletteColor.color ?? Palette.brand.color)
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
