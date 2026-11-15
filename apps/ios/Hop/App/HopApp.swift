import SwiftUI

@main
struct HopApp: App {
    @State private var session = Session()
    @State private var eventMode = EventMode()

    init() {
        // Downloads cut short by the app quitting would otherwise linger.
        ClipTransfer.removeLeftovers()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(eventMode)
        }
    }
}

/// Signed out, the welcome bubble; new, claiming a handle; otherwise the app.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode

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
            // Thumbnails are private to whoever was signed in.
            if !signedIn { Thumbnails.shared.removeAll() }
        }
        // The widgets show this athlete's QR code, and nobody's once they sign out.
        .onChange(of: session.me, initial: true) { _, me in
            if me != nil || !session.isSignedIn { HopCard.publish(me) }
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
