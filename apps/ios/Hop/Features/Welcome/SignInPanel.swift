import AuthenticationServices
import SwiftUI

/// The sign-in screen's foreground, shown once the welcome bubble has opened.
/// Its background (the aura and Bobble) is the inside of the bubble itself.
struct SignInPanel: View {
    let layout: BubbleLayout
    var onClose: () -> Void
    /// Reports how far the content is scrolled, for Bobble, who is drawn by
    /// the bubble behind this panel.
    var onScroll: (CGFloat) -> Void = { _ in }

    /// The colours inside the bubble, and so behind sign-in.
    static let auraColors = [Palette.grape.color, Palette.indigo.color, Palette.bubblegum.color]

    @Environment(Session.self) private var session
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var isSigningIn = false
    @State private var problem: String?

    var body: some View {
        // Fills the screen when it fits; with large text sizes it scrolls
        // instead of cutting the text off.
        ScrollView {
            content
                .frame(minHeight: layout.size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, offset in
            onScroll(offset)
        }
        // The panel lays itself out around the safe area already.
        .ignoresSafeArea()
        .frame(width: layout.size.width, height: layout.size.height)
        .overlay(alignment: .topLeading) {
            Button(action: onClose) {
                Image(systemName: "chevron.down")
                    .font(.body.weight(.semibold))
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .accessibilityLabel("Back")
            .padding(.leading, 20)
            .padding(.top, layout.insets.top + 8)
        }
    }

    /// Shows Caliplaces' sign-in page in a web authentication session, which
    /// shares Safari's cookies, so anyone already signed in there just confirms.
    private func signIn() async {
        isSigningIn = true
        problem = nil
        defer { isSigningIn = false }
        do {
            try await session.signIn { url in
                try await webAuthenticationSession.authenticate(
                    using: url,
                    callback: .customScheme(HopServer.callbackScheme),
                    preferredBrowserSession: .shared,
                    additionalHeaderFields: [:]
                )
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // They closed the sign-in sheet; nothing went wrong.
        } catch {
            problem = error.localizedDescription
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            Color.clear
                .frame(height: layout.heroCenter.y + layout.heroSize / 2 + 8)
                .accessibilityHidden(true)

            VStack(spacing: 10) {
                Text("Welcome to Hop")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("Sign in with your Caliplaces account to see every clip people send you.")
                    .font(.body)
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 32)

            Spacer(minLength: 24)

            Button {
                Task { await signIn() }
            } label: {
                ZStack {
                    Text("Continue with Caliplaces")
                        .opacity(isSigningIn ? 0 : 1)
                    if isSigningIn {
                        ProgressView()
                            .tint(.white)
                            .accessibilityLabel("Signing in")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.extraLarge)
            .tint(Palette.brand.color)
            .disabled(isSigningIn)
            .padding(.horizontal, 24)

            Group {
                if let problem {
                    Text(problem)
                        .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                } else {
                    Text("New here? You’ll claim your Hop link next.")
                        .foregroundStyle(Theme.muted)
                }
            }
            .font(.footnote)
            .padding(.top, 14)
            .padding(.horizontal, 32)
        }
        .foregroundStyle(Theme.ink)
        .multilineTextAlignment(.center)
        .padding(.bottom, layout.insets.bottom + 16)
    }
}
