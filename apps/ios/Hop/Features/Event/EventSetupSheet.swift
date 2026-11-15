import SwiftUI

/// Before Event mode starts: which event the clips should go to. A new one
/// by default, or the one the link already uploads into.
struct EventSetupSheet: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @Environment(\.dismiss) private var dismiss
    @State private var live: Hop?
    @State private var target = Choice.newEvent
    @State private var title = ""
    @State private var isStarting = false
    @State private var problem: String?
    @FocusState private var naming: Bool

    /// Called once Event mode is running, after the sheet is gone.
    let onStarted: () -> Void

    private enum Choice: Hashable {
        case newEvent
        case live
    }

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    /// The name a new event gets when the athlete doesn't type one.
    private var defaultTitle: String {
        Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    color.bobble
                        .resizable()
                        .scaledToFit()
                        .frame(width: 96, height: 96)
                        .accessibilityHidden(true)
                    Text("Event mode")
                        .font(.largeTitle.bold())
                        .padding(.top, 4)
                        .accessibilityAddTraits(.isHeader)
                    Text("Your QR code fills the screen and the screen stays on. Hop counts the clips as they land, here and on your Lock Screen.")
                        .font(.body)
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                        .padding(.top, 6)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Clips go to")
                            .font(.headline)
                            .padding(.leading, 4)
                        newEventOption
                        if let live {
                            liveOption(live)
                        }
                    }
                    .padding(.top, 28)

                    if let problem {
                        Label(problem, systemImage: "exclamationmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 12)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            // At the bottom of the sheet, and above the keyboard while naming.
            .safeAreaInset(edge: .bottom) {
                goLiveButton
                    .padding(.horizontal, 24)
                    .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // Once Go live is on its way, it finishes: cancelling
                    // now would leave an event started behind the athlete's back.
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                        .disabled(isStarting)
                }
            }
        }
        .interactiveDismissDisabled(isStarting)
        .task { await loadLiveEvent() }
    }

    private var goLiveButton: some View {
        Button {
            Task { await goLive() }
        } label: {
            ZStack {
                Label("Go live", systemImage: "dot.radiowaves.left.and.right")
                    .opacity(isStarting ? 0 : 1)
                if isStarting { ProgressView().tint(color.onColor) }
            }
            .font(.headline)
            .foregroundStyle(color.onColor)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.extraLarge)
        .tint(color.color)
        .disabled(isStarting)
    }

    private var newEventOption: some View {
        Option(title: String(localized: "A new event"), isSelected: target == .newEvent, color: color) {
            target = .newEvent
            naming = true
        } detail: {
            TextField(defaultTitle, text: $title)
                .font(.body)
                .textInputAutocapitalization(.words)
                .submitLabel(.go)
                .focused($naming)
                .onSubmit { Task { await goLive() } }
                .disabled(isStarting)
                .accessibilityLabel("Event name")
        }
        .onChange(of: naming) { _, now in
            if now { target = .newEvent }
        }
    }

    private func liveOption(_ hop: Hop) -> some View {
        Option(title: hop.title, isSelected: target == .live, color: color) {
            target = .live
            naming = false
        } detail: {
            Text("Live now · \(hop.clipCount)")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
    }

    /// The event the link uploads into now, to offer carrying on with it.
    /// One started today is most likely the one they want.
    private func loadLiveEvent() async {
        struct Reply: Decodable { let hops: [Hop] }
        guard let activeHopId = session.me?.activeHopId,
              let reply: Reply = try? await session.api.get("api/me/hops"),
              let hop = reply.hops.first(where: { $0.id == activeHopId && !$0.isClosed })
        else { return }
        live = hop
        let created = Date(timeIntervalSince1970: hop.createdAt / 1000)
        if Calendar.current.isDateInToday(created), title.isEmpty, !naming {
            target = .live
        }
    }

    private func goLive() async {
        guard !isStarting, let me = session.me else { return }
        let chosen: EventMode.Target
        switch (target, live) {
        case (.live, let hop?):
            chosen = .existing(hop)
        default:
            let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
            chosen = .newEvent(title: String((name.isEmpty ? defaultTitle : name).prefix(80)))
        }
        isStarting = true
        problem = nil
        naming = false
        defer { isStarting = false }
        do {
            try await eventMode.start(chosen, me: me, api: session.api)
            // The link now uploads into the event.
            await session.refresh()
            guard eventMode.run != nil else { return }
            dismiss()
            onStarted()
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// One choice in a list, as a glass card with a check. The title is what
/// VoiceOver selects; the detail below it stays its own element, so a text
/// field in it can still be edited.
private struct Option<Detail: View>: View {
    let title: String
    let isSelected: Bool
    let color: PaletteColor
    let action: () -> Void
    @ViewBuilder let detail: Detail

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(isSelected ? color.color : Theme.muted)
                .contentTransition(.symbolEffect(.replace))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
                    .accessibilityAction(.default, action)
                detail
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        .contentShape(.rect(cornerRadius: 24))
        .onTapGesture(perform: action)
        .animation(.snappy(duration: 0.2), value: isSelected)
    }
}
