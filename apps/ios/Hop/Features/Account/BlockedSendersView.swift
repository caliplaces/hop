import SwiftUI

/// Who the athlete blocked from sending them clips, from the account sheet.
/// Swipe to unblock.
struct BlockedSendersView: View {
    @State private var model: BlockedSenders

    init(api: APIClient) {
        _model = State(initialValue: BlockedSenders(api: api))
    }

    var body: some View {
        Group {
            if let senders = model.senders {
                if senders.isEmpty {
                    ContentUnavailableView {
                        Label("No one is blocked", systemImage: "hand.raised")
                    } description: {
                        Text("Block someone from a clip they sent you, and they can’t send you more.")
                    }
                } else {
                    List {
                        Section {
                            ForEach(senders) { sender in
                                row(sender)
                                    .swipeActions {
                                        Button("Unblock") { Task { await model.unblock(sender) } }
                                            .tint(Theme.ink)
                                    }
                            }
                        } footer: {
                            Text("Swipe left to let someone send you clips again. Clips that went when you blocked them don’t come back.")
                        }
                    }
                }
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("Couldn’t load who you blocked", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again") { Task { await model.load() } }
                        .buttonStyle(.glass)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Blocked Senders")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .alert(
            "Couldn’t unblock",
            isPresented: Binding(get: { model.problem != nil }, set: { if !$0 { model.problem = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.problem ?? "")
        }
    }

    private func row(_ sender: BlockedSender) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: sender.name)
                .font(.body)
            Text("Blocked \(sender.blockedAt, format: .relative(presentation: .named))")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Swipe left to unblock")
    }
}
