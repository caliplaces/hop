import SwiftUI

@main
struct HopApp: App {
    @State private var session = Session()
    @State private var eventMode = EventMode()
    @State private var hopPlus = HopPlus()

    init() {
        // Downloads cut short by the app quitting would otherwise linger.
        ClipTransfer.removeLeftovers()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(eventMode)
                .environment(hopPlus)
        }
    }
}

/// Signed out, the welcome bubble; new, claiming a handle; otherwise the app.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @Environment(HopPlus.self) private var hopPlus
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if !session.isSignedIn {
                WelcomeView()
                    .transition(.opacity)
            } else if let me = session.me, me.handle == nil {
                ClaimHopView(me: me, api: session.api)
                    .transition(.opacity)
            } else {
                HomeView()
                    .transition(.opacity.combined(with: .scale(scale: 1.04)))
            }
        }
        .animation(.smooth(duration: 0.45), value: session.isSignedIn)
        .animation(.smooth(duration: 0.45), value: session.me?.handle)
        .task { await session.refresh() }
        .onChange(of: session.isSignedIn) { _, signedIn in
            guard !signedIn else { return }
            // Thumbnails and the widgets' card are private to whoever was
            // signed in. The card is cleared here too because a session that
            // expired before the profile loaded never changes `me`.
            Thumbnails.shared.removeAll()
            HopCard.publish(nil)
        }
        // The widgets show this athlete's QR code, and nobody's once they sign out.
        .onChange(of: session.me, initial: true) { _, me in
            if me != nil || !session.isSignedIn { HopCard.publish(me) }
        }
        // Hop+ follows whoever is signed in: their plan, and every App Store
        // transaction handed to the API. Started at launch, as StoreKit asks,
        // so no renewal or refund is missed.
        .task(id: session.token) {
            guard session.isSignedIn else {
                hopPlus.reset()
                return
            }
            await hopPlus.run(api: session.api)
        }
        // Storage fills up while the app is away.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, session.isSignedIn else { return }
            let api = session.api
            Task { await hopPlus.refresh(api: api) }
        }
        // Carries on with an event that was running when the app quit, or
        // ends it: it belongs to whoever is signed in, and only to them.
        .task(id: session.me?.id) {
            if let me = session.me {
                await eventMode.resume(for: me, api: session.api)
            } else if !session.isSignedIn {
                await eventMode.reset()
            }
        }
    }
}
