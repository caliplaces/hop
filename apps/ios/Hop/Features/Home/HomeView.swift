import SwiftUI

/// The signed-in app: the inbox, and the athlete's own link.
struct HomeView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var eventMode = eventMode
        TabView {
            Tab("Inbox", systemImage: "tray.full") {
                InboxView()
            }
            Tab("My Hop", systemImage: "qrcode") {
                MyHopView()
            }
        }
        .tint(session.me?.paletteColor.color ?? Palette.brand.color)
        .eventAccessory(isEnabled: eventMode.run != nil)
        .fullScreenCover(isPresented: $eventMode.isStagePresented) {
            EventStage()
        }
        // Counts clips while the app is open: often while the QR code is on
        // show, now and then otherwise.
        .task(id: watch) {
            guard watch.hopId != nil, watch.isActive else { return }
            await eventMode.watch(api: session.api, every: watch.isOnStage ? .seconds(4) : .seconds(15))
        }
        // Tapping the Live Activity brings the QR code back.
        .onOpenURL { url in
            if url == EventActivityAttributes.stageURL, eventMode.run != nil {
                eventMode.isStagePresented = true
            }
        }
    }

    private var watch: Watch {
        Watch(
            hopId: eventMode.run?.hopId,
            isActive: scenePhase == .active,
            isOnStage: eventMode.isStagePresented
        )
    }

    private struct Watch: Equatable {
        let hopId: String?
        let isActive: Bool
        let isOnStage: Bool
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
        .environment(EventMode())
}
