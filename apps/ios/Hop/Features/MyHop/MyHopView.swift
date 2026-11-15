import SwiftUI
import UIKit

/// The athlete's link: what to say, show or send at an event.
struct MyHopView: View {
    @Environment(Session.self) private var session
    @Environment(EventMode.self) private var eventMode
    @State private var copied = false
    @State private var settingUpEvent = false
    /// Set when the setup sheet started Event mode, to go on stage once
    /// the sheet is gone.
    @State private var startedEvent = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let me = session.me, let link = me.link {
                    content(me: me, link: link)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 300)
                }
            }
            .background {
                Aura(colors: [color.color, color.color, Palette.brand.color], intensity: 0.7)
                    .ignoresSafeArea()
            }
            .navigationTitle("My Hop")
            .toolbar { AccountMenu() }
            .sheet(isPresented: $settingUpEvent, onDismiss: {
                if startedEvent {
                    startedEvent = false
                    eventMode.isStagePresented = true
                }
            }) {
                EventSetupSheet { startedEvent = true }
            }
        }
    }

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    private func content(me: Me, link: URL) -> some View {
        VStack(spacing: 20) {
            VStack(spacing: 16) {
                HStack(spacing: 12) {
                    me.paletteColor.bobble
                        .resizable()
                        .scaledToFit()
                        .frame(width: 52, height: 52)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Upload it on my Hop")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                        Text(verbatim: link.spoken)
                            .font(.title3.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 0)
                }
                QRCodeView(text: link.absoluteString)
                    .frame(maxWidth: 260)
                Text("Anyone can scan this or open the link to send you their clips. No app or account needed.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(20)
            .glassEffect(.regular, in: .rect(cornerRadius: 32))

            eventModeButton(color: me.paletteColor)

            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    Button {
                        UIPasteboard.general.url = link
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(maxWidth: .infinity)
                    }
                    ShareLink(item: link) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    Link(destination: link) {
                        Label("Open", systemImage: "safari")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }

    /// Starts Event mode, or goes back to the one that's running.
    private func eventModeButton(color: PaletteColor) -> some View {
        Button {
            if eventMode.run != nil {
                eventMode.isStagePresented = true
            } else {
                settingUpEvent = true
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .symbolEffect(.variableColor.iterative, isActive: eventMode.run != nil)
                Text(eventMode.run != nil ? "Back to Event mode" : "Start Event mode")
            }
            .font(.headline)
            .foregroundStyle(color.onColor)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.extraLarge)
        .tint(color.color)
    }
}
