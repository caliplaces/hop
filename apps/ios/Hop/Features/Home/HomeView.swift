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
    @State private var tab = HomeTab.inbox
    @State private var push = PushNotifications.shared

    var body: some View {
        @Bindable var eventMode = eventMode
        TabView(selection: $tab) {
            Tab("Inbox", systemImage: "tray.full", value: .inbox) {
                InboxView()
            }
            Tab("My Hop", systemImage: "qrcode", value: .myHop) {
                MyHopView()
            }
        }
        // A tapped notification opens in the inbox (InboxView takes it from there).
        .onChange(of: push.opened, initial: true) { _, opened in
            if opened != nil { tab = .inbox }
        }
        // Notifications may have been allowed, or turned off, in Settings.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await push.refresh() } }
        }
        // Chrome stays neutral; the athlete's colour is for real accents
        // (Event mode, the pass, Hop+), set where they appear.
        .tint(Theme.ink)
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

enum HomeTab: Hashable {
    case inbox
    case myHop
}

/// Opens the athlete's account: their plan, storage and signing out.
struct AccountButton: ToolbarContent {
    @Environment(Session.self) private var session
    @State private var showingAccount = false

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { showingAccount = true } label: {
                Avatar(me: session.me, size: 32)
            }
            .accessibilityLabel("Account")
            .sheet(isPresented: $showingAccount) { AccountView() }
        }
        .sharedBackgroundVisibility(.hidden)
    }
}

#Preview {
    HomeView()
        .environment(Session())
        .environment(EventMode())
        .environment(HopPlus())
}
