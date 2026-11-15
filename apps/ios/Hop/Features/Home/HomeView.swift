import SwiftUI

/// The signed-in app: the inbox, and the athlete's own link.
struct HomeView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @Environment(\.scenePhase) private var scenePhase
    /// The QR code full screen, outside Event mode.
    @State private var showingQRCode = false
    /// A link that arrived before Event mode settled, opened once it has.
    @State private var pendingLink: HopDeepLink?

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
        .background {
            // Its own anchor, apart from Event mode's full-screen cover.
            Color.clear.fullScreenCover(isPresented: $showingQRCode) { QRCodeScreen() }
        }
        // The Live Activity, the widgets, Control Center and Shortcuts open
        // the QR code: Event mode's while it runs, the pass's otherwise. On a
        // cold launch the link waits until Event mode has resumed, or it
        // would open the pass while an event is running.
        .onOpenURL { url in
            guard let link = HopDeepLink(url: url) else { return }
            if eventMode.hasSettled { open(link) } else { pendingLink = link }
        }
        .onChange(of: eventMode.hasSettled) { _, settled in
            guard settled, let link = pendingLink else { return }
            pendingLink = nil
            open(link)
        }
    }

    private func open(_ link: HopDeepLink) {
        switch link {
        case .eventStage:
            if eventMode.run != nil { eventMode.isStagePresented = true }
        case .qrCode:
            if eventMode.run != nil {
                eventMode.isStagePresented = true
            } else {
                showingQRCode = true
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
