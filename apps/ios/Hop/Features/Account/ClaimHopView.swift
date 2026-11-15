import SwiftUI

/// The first thing a new athlete does: claim onmyhop.com/<handle> and pick the
/// colour Bobble and their upload page wear.
struct ClaimHopView: View {
    @Environment(Session.self) private var session
    @State private var model: ClaimHopModel
    @State private var celebrating = false
    @FocusState private var editing: Bool

    init(me: Me, api: APIClient) {
        _model = State(initialValue: ClaimHopModel(me: me, api: api))
    }

    var body: some View {
        // In a navigation stack for the account menu, so someone signed in
        // with the wrong account can sign out instead of claiming a handle.
        NavigationStack {
            form
                .toolbar { AccountMenu() }
        }
    }

    private var form: some View {
        ScrollView {
            VStack(spacing: 0) {
                model.color.bobble
                    .resizable()
                    .scaledToFit()
                    .frame(width: 150, height: 150)
                    .scaleEffect(celebrating ? 1.18 : 1)
                    .offset(y: celebrating ? -18 : 0)
                    .animation(.spring(duration: 0.45, bounce: 0.55), value: celebrating)
                    .contentTransition(.opacity)
                    .animation(.smooth(duration: 0.25), value: model.color)
                    .accessibilityLabel("Bobble, wearing your colour")
                    .padding(.top, 12)

                Text("Claim your Hop")
                    .font(.largeTitle.bold())
                    .padding(.top, 8)
                    .accessibilityAddTraits(.isHeader)
                Text("This is the link everyone uploads your clips to.")
                    .font(.body)
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 6)

                handleField
                    .disabled(isLocked)
                    .padding(.top, 28)
                statusLine
                    .padding(.top, 10)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Pick your colour").font(.headline)
                    Text("Bobble and your upload page wear it.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    ColorChooser(selection: $model.color)
                        .disabled(isLocked)
                        .padding(.top, 12)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 32)

                Button {
                    Task { await claim() }
                } label: {
                    ZStack {
                        Text(celebrating ? "It’s yours!" : "Claim it")
                            .opacity(model.isClaiming ? 0 : 1)
                        if model.isClaiming { ProgressView().tint(model.color.onColor) }
                    }
                    .font(.headline)
                    .foregroundStyle(model.color.onColor)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.extraLarge)
                .tint(model.color.color)
                .disabled(!model.canClaim || celebrating)
                .padding(.top, 32)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background {
            Aura(colors: [model.color.color, model.color.color, Palette.brand.color], intensity: 0.9)
                .ignoresSafeArea()
                .animation(.smooth(duration: 0.4), value: model.color)
        }
        .sensoryFeedback(.selection, trigger: model.color)
        .sensoryFeedback(.success, trigger: celebrating) { _, now in now }
    }

    /// What's being claimed can't change until the server has answered.
    private var isLocked: Bool { model.isClaiming || celebrating }

    private var handleField: some View {
        HStack(spacing: 0) {
            Text(verbatim: "\(HopServer.baseURL.spoken)/")
                .foregroundStyle(Theme.muted)
            TextField("yourname", text: $model.input)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.username)
                .submitLabel(.done)
                .focused($editing)
                .onSubmit { Task { await claim() } }
                .accessibilityLabel("Handle")
        }
        .font(.title3.weight(.medium))
        .multilineTextAlignment(.leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .glassEffect(.regular.interactive(), in: .capsule)
        .onTapGesture { editing = true }
    }

    @ViewBuilder private var statusLine: some View {
        Group {
            if let problem = model.problem {
                Label(problem, systemImage: "exclamationmark.circle.fill")
                    .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
            } else {
                switch model.status {
                case .idle:
                    Text("You get one, so pick something you’ll say out loud.")
                        .foregroundStyle(Theme.muted)
                case .checking:
                    ProgressView().controlSize(.small)
                case .available:
                    Label("Available", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color(light: 0x0F8A4F, dark: 0x3DDC97))
                case let .unavailable(reason):
                    Text(reason)
                        .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                }
            }
        }
        .font(.subheadline)
        .frame(minHeight: 22)
        .animation(.smooth(duration: 0.2), value: model.status)
        .accessibilityElement(children: .combine)
    }

    private func claim() async {
        guard model.canClaim else { return }
        editing = false
        guard let me = await model.claim() else { return }
        celebrating = true
        // Let Bobble celebrate before the app takes over.
        try? await Task.sleep(for: .milliseconds(900))
        session.update(me)
    }
}

/// The twelve athlete colours as glass swatches.
struct ColorChooser: View {
    @Binding var selection: PaletteColor

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 6), spacing: 12) {
            ForEach(Palette.all) { color in
                Button {
                    selection = color
                } label: {
                    Circle()
                        .fill(color.color)
                        .overlay {
                            if color == selection {
                                Image(systemName: "checkmark")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(color.onColor)
                            }
                        }
                        .padding(4)
                        .overlay {
                            Circle().strokeBorder(color.color, lineWidth: color == selection ? 2.5 : 0)
                        }
                        .aspectRatio(1, contentMode: .fit)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(color.name)
                .accessibilityAddTraits(color == selection ? .isSelected : [])
            }
        }
        .animation(.spring(duration: 0.25), value: selection)
    }
}
