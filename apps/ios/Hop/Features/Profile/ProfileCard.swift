import PhotosUI
import SwiftUI

/// The top of the athlete's page as others see it, editable: their photo,
/// their name, the Hop+ mark when they have it, and their link.
struct ProfileCard: View {
    @Bindable var editor: ProfileEditor
    var editingName: FocusState<Bool>.Binding

    @State private var showingPicker = false
    @State private var pickerItem: PhotosPickerItem?

    private var me: Me { editor.me }
    private var color: PaletteColor { me.paletteColor }
    private static let red = Color(light: 0xD92D20, dark: 0xFF6369)

    var body: some View {
        VStack(spacing: 0) {
            photo
            nameField
                .padding(.top, 20)
            if let problem = shownNameProblem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(Self.red)
                    .padding(.top, 8)
                    .transition(.opacity)
            }
            if me.hopPlus {
                HopPlusBadge(color: color)
                    .padding(.top, 12)
            }
            if let link = me.link {
                Label {
                    Text(verbatim: link.spoken)
                } icon: {
                    Image(systemName: "link")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.muted)
                .padding(.top, 14)
            }
        }
        .animation(.smooth(duration: 0.2), value: shownNameProblem)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.vertical, 28)
        .glassEffect(.regular, in: .rect(cornerRadius: 32))
        .photosPicker(
            isPresented: $showingPicker,
            selection: $pickerItem,
            matching: .images,
            preferredItemEncoding: .current
        )
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            pickerItem = nil
            Task { await editor.choosePhoto { try await item.loadTransferable(type: Data.self) } }
        }
    }

    /// Their photo, with a camera badge. Tapping picks one; with a photo
    /// already, it offers to change or remove it.
    @ViewBuilder private var photo: some View {
        if editor.hasPhoto {
            Menu {
                Button("Choose Photo", systemImage: "photo.on.rectangle") { showingPicker = true }
                Button("Remove Photo", systemImage: "trash", role: .destructive) { editor.removePhoto() }
            } label: {
                photoLabel
            }
            .accessibilityLabel("Change profile photo")
        } else {
            Button { showingPicker = true } label: { photoLabel }
                .accessibilityLabel("Add a profile photo")
        }
    }

    private var photoLabel: some View {
        Avatar(photo: editor.shownPhoto, initial: editor.shownInitial, color: color, size: 116)
            .overlay {
                if editor.isPreparingPhoto {
                    Circle()
                        .fill(.black.opacity(0.35))
                        .overlay { ProgressView().tint(.white) }
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 36, height: 36)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .offset(x: 2, y: 2)
                    .accessibilityHidden(true)
            }
            .animation(.smooth(duration: 0.2), value: editor.isPreparingPhoto)
            .contentShape(.circle)
    }

    private var nameField: some View {
        TextField("Your name", text: $editor.name)
            .font(.title2.weight(.bold))
            .multilineTextAlignment(.center)
            .textContentType(.name)
            .textInputAutocapitalization(.words)
            .submitLabel(.done)
            .focused(editingName)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Theme.ink.opacity(0.06), in: .capsule)
            .accessibilityLabel("Name")
    }

    /// What's wrong with the name, once there's one to be wrong. An empty
    /// field speaks for itself: its placeholder, and a disabled button.
    private var shownNameProblem: String? {
        editor.normalizedName.isEmpty ? nil : editor.nameProblem
    }
}

/// The line under the card: who sees it, and where it's kept.
struct ProfileFootnote: View {
    var body: some View {
        Text("Anyone with your link sees this. It’s saved in Hop only, not in your Caliplaces account.")
            .font(.footnote)
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
}

/// For athletes without Hop+: what the mark is, and the way to it.
struct HopPlusMarkRow: View {
    let color: PaletteColor
    @State private var showingHopPlus = false

    var body: some View {
        Button {
            showingHopPlus = true
        } label: {
            HStack(spacing: 14) {
                HopPlusBadge(color: color)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Get the Hop+ mark")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("Shown next to your name.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .contentShape(.rect(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        .sheet(isPresented: $showingHopPlus) { HopPlusView() }
    }
}
