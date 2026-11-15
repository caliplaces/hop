import SwiftUI

/// The running event above the tab bar, like a song that's playing: its
/// name, the clips so far and how long it's been live. Tap it for the QR code.
struct EventAccessory: View {
    @Environment(EventMode.self) private var eventMode

    var body: some View {
        if let run = eventMode.run {
            Button {
                eventMode.isStagePresented = true
            } label: {
                HStack(spacing: 12) {
                    LiveDot(isOffline: eventMode.isOffline)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(run.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(eventMode.clips == 1 ? "1 clip so far" : "\(eventMode.clips) clips so far")
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                            .contentTransition(.numericText(value: Double(eventMode.clips)))
                    }
                    Spacer(minLength: 8)
                    Text(run.startedAt, style: .timer)
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.muted)
                    Image(systemName: "qrcode")
                        .font(.title3)
                }
                .padding(.horizontal, 18)
                .contentShape(.rect)
                .animation(.snappy, value: eventMode.clips)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Event mode, \(run.title)")
            .accessibilityValue(eventMode.clips == 1 ? "1 clip so far" : "\(eventMode.clips) clips so far")
            .accessibilityHint("Shows your QR code")
        }
    }
}

extension View {
    /// The running event above the tab bar. Needs iOS 26.1; on 26.0 the
    /// My Hop tab leads back to Event mode instead.
    @ViewBuilder func eventAccessory(isEnabled: Bool) -> some View {
        if #available(iOS 26.1, *) {
            tabViewBottomAccessory(isEnabled: isEnabled) { EventAccessory() }
        } else {
            self
        }
    }
}
