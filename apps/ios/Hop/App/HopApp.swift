import SwiftUI

@main
struct HopApp: App {
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
        }
    }
}

/// Signed out, the welcome bubble; new, claiming a handle; otherwise the app.
struct RootView: View {
    @Environment(Session.self) private var session

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
    }
}
