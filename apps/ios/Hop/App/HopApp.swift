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

/// Signed out, the welcome bubble; signed in, the app.
struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        ZStack {
            if session.isSignedIn {
                HomeView()
                    .transition(.opacity.combined(with: .scale(scale: 1.04)))
            } else {
                WelcomeView {
                    withAnimation(.smooth(duration: 0.45)) { session.signIn() }
                }
                .transition(.opacity)
            }
        }
    }
}
