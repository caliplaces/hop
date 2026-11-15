import SwiftUI
import UIKit

/// Event mode on stage: the QR code as big as it gets, the screen bright and
/// awake, and Bobble hopping each time clips land.
struct EventStage: View {
    @Environment(EventMode.self) private var eventMode
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The arrival on show in place of the live pill, for a few seconds.
    @State private var toast: EventMode.Arrival?
    @State private var confirmingEnd = false

    var body: some View {
        Group {
            if let run = eventMode.run, let me = session.me, let link = me.link {
                stage(run: run, color: me.paletteColor, link: link)
            } else {
                Theme.canvas.ignoresSafeArea()
            }
        }
        .onAppear { StageLights.on() }
        .onDisappear { StageLights.off() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { StageLights.on() } else { StageLights.off() }
        }
        .onChange(of: eventMode.arrival) { _, arrival in
            guard let arrival else { return }
            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.45, bounce: 0.3)) {
                toast = arrival
            }
            AccessibilityNotification.Announcement(arrival.announcement).post()
        }
        .task(id: toast?.id) {
            guard toast != nil else { return }
            try? await Task.sleep(for: .seconds(3.5))
            withAnimation(.smooth(duration: 0.35)) { toast = nil }
        }
        .sensoryFeedback(.success, trigger: eventMode.arrival?.id) { _, new in new != nil }
    }

    private func stage(run: EventRun, color: PaletteColor, link: URL) -> some View {
        VStack(spacing: 0) {
            topBar(run: run, color: color)

            Spacer(minLength: 12)

            VStack(spacing: 2) {
                Text(run.title)
                    .font(.title2.bold())
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text(verbatim: link.spoken)
                    .font(.headline)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            QRStage(link: link, color: color, hop: reduceMotion ? nil : eventMode.arrival?.id)
                .padding(.top, 8)

            Text("Scan to send me your clips")
                .font(.title3.weight(.semibold))
                .padding(.top, 18)

            Spacer(minLength: 12)

            counter(color: color)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .background {
            Aura(colors: [color.color, color.color, Palette.brand.color], intensity: 1)
                .ignoresSafeArea()
        }
        .background(Theme.canvas)
    }

    private func topBar(run: EventRun, color: PaletteColor) -> some View {
        HStack(spacing: 12) {
            Button("Minimize", systemImage: "chevron.down") {
                eventMode.isStagePresented = false
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .fixedSize()

            Spacer(minLength: 0)

            // Takes the room the buttons leave.
            Group {
                if let toast {
                    ArrivalPill(arrival: toast, color: color)
                        .transition(.blurReplace)
                } else {
                    LivePill(startedAt: run.startedAt, isOffline: eventMode.isOffline)
                        .transition(.blurReplace)
                }
            }
            .layoutPriority(1)

            Spacer(minLength: 0)

            Button("End") { confirmingEnd = true }
                .buttonStyle(.glass)
                .controlSize(.large)
                .fixedSize()
                .confirmationDialog("End Event mode?", isPresented: $confirmingEnd, titleVisibility: .visible) {
                    Button("End Event mode", role: .destructive) {
                        Task { await eventMode.end() }
                    }
                } message: {
                    Text("Your link keeps taking clips for “\(run.title)”.")
                }
        }
        .padding(.top, 8)
    }

    private func counter(color: PaletteColor) -> some View {
        HStack(spacing: 16) {
            Text(eventMode.clips, format: .number)
                .font(.system(size: 52, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText(value: Double(eventMode.clips)))
                .foregroundStyle(Theme.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text(eventMode.clips == 1 ? "clip so far" : "clips so far")
                    .font(.headline)
                Group {
                    if let latest = eventMode.latest {
                        Text("Latest from \(latest)")
                    } else {
                        Text("They show up here as they land.")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .capsule)
        .animation(.snappy, value: eventMode.clips)
        .accessibilityElement(children: .combine)
    }
}

/// The QR code on a white card, with Bobble peeking over its top edge. Each
/// time `hop` changes, Bobble hops and a ripple runs out from the card.
private struct QRStage: View {
    let link: URL
    let color: PaletteColor
    let hop: UUID?

    var body: some View {
        ZStack(alignment: .top) {
            color.bobble
                .resizable()
                .scaledToFit()
                .frame(width: 116, height: 116)
                .keyframeAnimator(initialValue: Bounce(), trigger: hop) { bobble, bounce in
                    bobble
                        .scaleEffect(x: bounce.stretch, y: 1 / bounce.stretch, anchor: .bottom)
                        .offset(y: bounce.lift)
                } keyframes: { _ in
                    KeyframeTrack(\.lift) {
                        CubicKeyframe(6, duration: 0.08)
                        SpringKeyframe(-46, duration: 0.28, spring: .snappy)
                        SpringKeyframe(0, duration: 0.6, spring: .bouncy)
                    }
                    KeyframeTrack(\.stretch) {
                        CubicKeyframe(1.12, duration: 0.08)
                        SpringKeyframe(0.9, duration: 0.2)
                        SpringKeyframe(1, duration: 0.5, spring: .bouncy)
                    }
                }
                .accessibilityHidden(true)

            QRCodeView(text: link.absoluteString, padding: 22, cornerRadius: 40)
                .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
                .background {
                    RoundedRectangle(cornerRadius: 40)
                        .strokeBorder(color.color, lineWidth: 4)
                        .keyframeAnimator(initialValue: Ripple(), trigger: hop) { ring, ripple in
                            ring
                                .scaleEffect(ripple.scale)
                                .opacity(ripple.opacity)
                        } keyframes: { _ in
                            KeyframeTrack(\.scale) {
                                LinearKeyframe(1, duration: 0.01)
                                CubicKeyframe(1.14, duration: 0.9)
                            }
                            KeyframeTrack(\.opacity) {
                                LinearKeyframe(0.9, duration: 0.01)
                                CubicKeyframe(0, duration: 0.9)
                            }
                        }
                }
                .frame(maxWidth: 340)
                // Bobble peeks over the card's top edge, eyes and all.
                .padding(.top, 92)
        }
    }

    private struct Bounce {
        var lift: CGFloat = 0
        var stretch: CGFloat = 1
    }

    private struct Ripple {
        var scale: CGFloat = 1
        var opacity: Double = 0
    }
}

/// "● LIVE 12:04", with the time since Event mode started.
private struct LivePill: View {
    let startedAt: Date
    let isOffline: Bool

    var body: some View {
        HStack(spacing: 8) {
            LiveDot(isOffline: isOffline)
            Text(isOffline ? "OFFLINE" : "LIVE")
                .font(.caption.weight(.heavy))
                .tracking(1.2)
            Text(startedAt, style: .timer)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

/// Who just sent clips, in the live pill's place.
private struct ArrivalPill: View {
    let arrival: EventMode.Arrival
    let color: PaletteColor

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.headline)
                .foregroundStyle(color.onColor, color.color)
            Text(arrival.headline)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.leading, 10)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular.tint(color.color.opacity(0.3)), in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

/// A red dot that breathes while Event mode is live, grey while offline.
struct LiveDot: View {
    var isOffline = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(isOffline ? Color.gray : Color(light: 0xE5383B, dark: 0xFF5A5F))
            .frame(width: 8, height: 8)
            .phaseAnimator(reduceMotion || isOffline ? [1.0] : [1.0, 0.35]) { dot, opacity in
                dot.opacity(opacity)
            } animation: { _ in
                .easeInOut(duration: 0.9)
            }
            .accessibilityHidden(true)
    }
}

/// Keeps the screen at full brightness and awake while the QR code is on
/// show, and puts both back as they were after.
enum StageLights {
    private static var saved: (screen: UIScreen, brightness: CGFloat)?

    static func on() {
        UIApplication.shared.isIdleTimerDisabled = true
        guard saved == nil,
              let screen = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first?.screen
        else { return }
        saved = (screen, screen.brightness)
        screen.brightness = 1
    }

    static func off() {
        UIApplication.shared.isIdleTimerDisabled = false
        guard let saved else { return }
        saved.screen.brightness = saved.brightness
        self.saved = nil
    }
}
