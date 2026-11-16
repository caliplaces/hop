import SwiftUI

/// Reporting a clip to Hop's team: why, in a word or more, and whether to
/// block whoever sent it too.
struct ReportClipSheet: View {
    let clip: Clip
    /// Called once it's sent: the clips that left the inbox if the sender
    /// was blocked too (nil if not), and any reason they couldn't be.
    let onReported: (_ removed: Set<String>?, _ blockProblem: String?) -> Void

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
                            // As the API counts, so what's typed is what's accepted.
                            let limited = Moderation.limited(value)
                            if limited != value { note = limited }
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
            .disabled(sending)
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
        // What the form says now is what's sent, even if it's touched while
        // sending (it's disabled meanwhile anyway).
        guard let reason else { return }
        let note = note
        let block = alsoBlock
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
        var removed: Set<String>?
        var blockProblem: String?
        if block {
            do {
                removed = try await Moderation.block(clip, api: session.api)
            } catch {
                blockProblem = error.localizedDescription
            }
        }
        onReported(removed, blockProblem)
        dismiss()
    }
}
