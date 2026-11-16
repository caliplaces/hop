import SwiftUI

/// "This is you": right after claiming a handle, the athlete sees what their
/// page shows about them, and can change their name and photo before anyone
/// else does.
struct ProfileSetupView: View {
    @Environment(Session.self) private var session
    @State private var editor: ProfileEditor
    @State private var confirmed = false
    @FocusState private var editingName: Bool

    init(me: Me, session: Session) {
        // Saves belong to this session, even if they sign out meanwhile.
        let token = session.token
        _editor = State(initialValue: ProfileEditor(me: me, api: session.api) { [weak session] me in
            session?.update(me, from: token)
        })
    }

    private var color: PaletteColor { editor.me.paletteColor }

    var body: some View {
        // In a navigation stack for the account menu, like claiming a handle.
        NavigationStack {
            content
                .toolbar { AccountButton() }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("This is you")
                    .font(.largeTitle.bold())
                    .padding(.top, 12)
                    .accessibilityAddTraits(.isHeader)
                Text("Your page shows this to everyone who sends you clips.")
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 6)

                ProfileCard(editor: editor, editingName: $editingName)
                    .disabled(editor.isSaving)
                    .padding(.top, 28)

                if let problem = editor.problem {
                    Label(problem, systemImage: "exclamationmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                        .padding(.top, 16)
                        .transition(.opacity)
                }

                ProfileFootnote()
                    .padding(.top, 16)
                    .padding(.horizontal, 12)

                Button {
                    Task { await confirm() }
                } label: {
                    ZStack {
                        Text("Looks good")
                            .opacity(editor.isSaving ? 0 : 1)
                        if editor.isSaving { ProgressView().tint(color.onColor) }
                    }
                    .font(.headline)
                    .foregroundStyle(color.onColor)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.extraLarge)
                .tint(color.color)
                .disabled(!editor.canSave)
                .padding(.top, 32)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .animation(.smooth(duration: 0.25), value: editor.problem)
        }
        .scrollDismissesKeyboard(.interactively)
        .background {
            Aura(colors: [color.color, color.color, Palette.brand.color], intensity: 0.9)
                .ignoresSafeArea()
        }
        .sensoryFeedback(.success, trigger: confirmed) { _, now in now }
        // The account menu can change the profile while this is open.
        .onChange(of: session.me) { _, me in
            if let me { editor.sync(with: me) }
        }
    }

    /// Saves any changes and that they've seen it, which moves the app on.
    private func confirm() async {
        editingName = false
        confirmed = await editor.save(confirming: true)
    }
}
