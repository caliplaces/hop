import SwiftUI

/// Changing the name and photo on the athlete's page, from the account sheet.
/// Nothing changes until Save; Cancel, or going back, leaves it as it was.
/// Pushed by value (`AccountRoute.profile`), so each visit starts afresh.
struct EditProfileView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var editor: ProfileEditor
    @FocusState private var editingName: Bool

    init(me: Me, session: Session) {
        let token = session.token
        _editor = State(initialValue: ProfileEditor(me: me, api: session.api) { [weak session] me in
            session?.update(me, from: token)
        })
    }

    private var color: PaletteColor { editor.me.paletteColor }
    /// Unsaved changes, or a save on its way: leaving takes a deliberate Cancel.
    private var holding: Bool { editor.hasChanges || editor.isSaving }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ProfileCard(editor: editor, editingName: $editingName)
                    .disabled(editor.isSaving)
                    .padding(.top, 12)

                if let problem = editor.problem {
                    Label(problem, systemImage: "exclamationmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                        .multilineTextAlignment(.center)
                        .padding(.top, 16)
                        .transition(.opacity)
                }

                ProfileFootnote()
                    .padding(.top, 16)
                    .padding(.horizontal, 12)

                if !editor.me.hopPlus {
                    HopPlusMarkRow(color: color)
                        .padding(.top, 28)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .animation(.smooth(duration: 0.25), value: editor.problem)
        }
        .scrollDismissesKeyboard(.interactively)
        .background {
            Aura(colors: [color.color, Palette.brand.color, color.color], intensity: 0.6)
                .ignoresSafeArea()
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(holding)
        .interactiveDismissDisabled(holding)
        // Buying Hop+ from here reloads the profile, which brings the mark.
        .onChange(of: session.me) { _, me in
            if let me { editor.sync(with: me) }
        }
        .toolbar {
            if holding {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(editor.isSaving)
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                if editor.isSaving {
                    ProgressView()
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!editor.hasChanges || !editor.canSave)
                }
            }
        }
    }

    private func save() async {
        editingName = false
        if await editor.save() { dismiss() }
    }
}
