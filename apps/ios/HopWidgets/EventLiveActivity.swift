import ActivityKit
import SwiftUI
import WidgetKit

/// Event mode on the Lock Screen and in the Dynamic Island. The Lock Screen
/// shows the QR code, so people can scan it without the phone being unlocked.
struct EventLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: EventActivityAttributes.self) { context in
            LockScreenEvent(event: context.attributes, state: context.state)
                .widgetURL(EventActivityAttributes.stageURL)
        } dynamicIsland: { context in
            let event = context.attributes
            let state = context.state
            let color = Palette.color(id: event.color)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        color.face
                            .resizable()
                            .scaledToFit()
                            .frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 0) {
                            LiveLabel()
                            Text(event.startedAt, style: .timer)
                                .font(.caption.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ClipCount(clips: state.clips, size: 30)
                        .foregroundStyle(color.onDark)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 12) {
                        QRCodeView(text: event.link.absoluteString, padding: 5, cornerRadius: 12)
                            .frame(width: 72, height: 72)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.headline)
                                .lineLimit(1)
                            Text(verbatim: event.link.spoken)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            if let latest = state.latest {
                                Text("Latest from \(latest)")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(color.onDark)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                color.face
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)
            } compactTrailing: {
                Text(state.clips, format: .number)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(state.clips)))
                    .foregroundStyle(color.onDark)
            } minimal: {
                Text(state.clips, format: .number)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(state.clips)))
                    .foregroundStyle(color.onDark)
            }
            .widgetURL(EventActivityAttributes.stageURL)
            .keylineTint(color.onDark)
        }
    }
}

/// The Lock Screen banner: the QR code big enough to scan, and the event.
private struct LockScreenEvent: View {
    let event: EventActivityAttributes
    let state: EventActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 16) {
            QRCodeView(text: event.link.absoluteString, padding: 7, cornerRadius: 16)
                .frame(width: 116, height: 116)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    LiveLabel()
                    Text(event.startedAt, style: .timer)
                        .font(.caption.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Text(event.title)
                    .font(.headline)
                    .lineLimit(1)
                    .padding(.top, 6)
                Text(verbatim: event.link.spoken)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 6)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    ClipCount(clips: state.clips, size: 32)
                    if let latest = state.latest {
                        Text("· \(latest)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
    }
}

/// "● LIVE"
private struct LiveLabel: View {
    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color(hex: 0xFF453A))
                .frame(width: 7, height: 7)
            Text("LIVE")
                .font(.caption2.weight(.heavy))
                .tracking(1)
        }
    }
}

/// "7 clips", the number large.
private struct ClipCount: View {
    let clips: Int
    let size: CGFloat

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(clips, format: .number)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText(value: Double(clips)))
            Text(clips == 1 ? "clip" : "clips")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private extension PaletteColor {
    /// Bobble's face in this colour.
    var face: Image { Image("Face-\(id)") }

    /// This colour, or white where it would be too dark to read on the
    /// Dynamic Island's black.
    var onDark: Color {
        Palette.contrast(hex, 0x000000) >= 3 ? color : .white
    }
}
