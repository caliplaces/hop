import SwiftUI

/// The sign-in screen's foreground, shown once the welcome bubble has opened.
/// Its background (the aura and Bobble) is the inside of the bubble itself.
struct SignInPanel: View {
    let layout: BubbleLayout
    var onContinue: () -> Void
    var onClose: () -> Void
    /// Reports how far the content is scrolled, for Bobble, who is drawn by
    /// the bubble behind this panel.
    var onScroll: (CGFloat) -> Void = { _ in }

    /// The colours inside the bubble, and so behind sign-in.
    static let auraColors = [Palette.grape.color, Palette.indigo.color, Palette.bubblegum.color]

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

            Button(action: onContinue) {
                Text("Continue with Caliplaces")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.extraLarge)
            .tint(Palette.brand.color)
            .padding(.horizontal, 24)

            Text("New here? You’ll claim your Hop link next.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .padding(.top, 14)
        }
        .foregroundStyle(Theme.ink)
        .multilineTextAlignment(.center)
        .padding(.bottom, layout.insets.bottom + 16)
    }
}
