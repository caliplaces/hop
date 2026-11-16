import SwiftUI

/// Reporting a clip to Hop's team: why, in a word or more, and whether to
/// block whoever sent it too.
struct ReportClipSheet: View {
    let clip: Clip
    /// Called once it's sent: whether the sender was blocked too, and any
    /// reason they couldn't be.
    let onReported: (_ blocked: Bool, _ blockProblem: String?) -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var reason: ReportReason?
    @State private var note = ""
    @State private var alsoBlock = true
    @State private var sending = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(ReportReason.allCases) { option in
                        Button {
                            reason = option
                        } label: {
                            HStack {
                                Text(option.title)
                                    .foregroundStyle(Theme.ink)
                                Spacer()
                                if reason == option {
                                    Image(systemName: "checkmark")
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(Theme.ink)
                                }
                            }
                        }
                        .accessibilityAddTraits(reason == option ? .isSelected : [])
                    }
                } header: {
                    Text("What’s wrong with it?")
                }

                Section {
                    TextField("Anything else? (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...6)
                        .onChange(of: note) { _, value in
                            if value.count > Moderation.maxNoteLength {
                                note = String(value.prefix(Moderation.maxNoteLength))
                            }
                        }
                } footer: {
                    Text("Hop’s team gets your report with this clip, and looks into it.")
                }

                Section {
                    Toggle(isOn: $alsoBlock) {
                        Text("Block \(clip.contributor)")
                    }
                } footer: {
                    Text("Their clips leave your inbox, and they can’t send you more. You can unblock them in Account.")
                }

                if let problem {
                    Section {
                        Label(problem, systemImage: "exclamationmark.circle.fill")
                            .foregroundStyle(Color(light: 0xD92D20, dark: 0xFF6369))
                    }
                }
            }
            .navigationTitle("Report Clip")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Theme.ink)
            .interactiveDismissDisabled(sending)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if sending {
                        ProgressView()
                    } else {
                        Button("Send") { Task { await send() } }
                            .disabled(reason == nil)
                    }
                }
            }
        }
    }

    private func send() async {
        guard let reason else { return }
        sending = true
        problem = nil
        defer { sending = false }
        do {
            try await Moderation.report(clip, reason: reason, note: note, api: session.api)
        } catch {
            problem = error.localizedDescription
            return
        }
        // Reported either way; blocking is the extra.
        var blocked = false
        var blockProblem: String?
        if alsoBlock {
            do {
                try await Moderation.block(clip, api: session.api)
                blocked = true
            } catch {
                blockProblem = error.localizedDescription
            }
        }
        onReported(blocked, blockProblem)
        dismiss()
    }
}
